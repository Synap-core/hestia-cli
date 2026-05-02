"""
title: Synap Channel Sync
author: Eve
version: 0.1.0
license: MIT
description: |
  Mirrors every Open WebUI conversation into a Synap channel. Each chat
  becomes a channel; each user / assistant message gets posted via the
  Hub Protocol. This makes Open WebUI conversations show up in your Synap
  views, agent contexts, and search results — without leaving the chat UI.

  This is a one-way mirror: messages flow from Open WebUI → Synap. We don't
  pull Synap messages back into Open WebUI to keep the UX simple. If you
  want bidirectional, use Synap's own chat UI.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class Pipeline:
    class Valves(BaseModel):
        SYNAP_API_URL: str = "http://synap-backend-backend-1:4000"
        SYNAP_API_KEY: str = ""
        # Channel type to use when creating channels for new conversations.
        # `external_import` keeps them clearly tagged as not-native-Synap.
        CHANNEL_TYPE: str = "external_import"
        # Source identifier — shows up in Synap as the channel's `source` field.
        SOURCE: str = "openwebui"
        DEBUG: bool = False

    def __init__(self) -> None:
        self.name = "Synap Channel Sync"
        self.type = "filter"
        # Run *after* the memory filter so we mirror the augmented prompt too,
        # which makes the synced channel look the same as what the model saw.
        self.priority = 10

        self.valves = self.Valves(
            **{
                "SYNAP_API_URL": os.getenv("SYNAP_API_URL", self.Valves().SYNAP_API_URL),
                "SYNAP_API_KEY": os.getenv("SYNAP_API_KEY", self.Valves().SYNAP_API_KEY),
                "DEBUG": os.getenv("SYNAP_PIPELINE_DEBUG", "0") == "1",
            },
        )

        # Cache: { (user_id, owui_chat_id) → synap_channel_id }
        # In-process — fine for a single pipelines container; persistence
        # comes from Synap itself (we re-discover by external_id on miss).
        self._channel_cache: dict[tuple[str, str], str] = {}

    async def on_startup(self) -> None:
        logger.info("[synap-channel-sync] startup")

    async def on_shutdown(self) -> None:
        pass

    # ---------------------------------------------------------------------
    # Filter hooks
    # ---------------------------------------------------------------------

    async def inlet(self, body: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
        """Mirror the latest user message to Synap before the model runs."""
        if not self._enabled():
            return body

        last_user = _last_message(body, "user")
        if not last_user:
            return body

        chat_id = body.get("chat_id") or body.get("id") or "unknown"
        user_id = (user or {}).get("id", "anonymous")

        try:
            channel_id = await self._ensure_channel(user_id, chat_id, body)
            await self._post_message(channel_id, "user", last_user, user_id)
        except Exception as err:
            logger.warning("[synap-channel-sync] inlet failed: %s", err)

        return body

    async def outlet(self, body: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
        """Mirror the model's response to Synap after the call completes."""
        if not self._enabled():
            return body

        last_assistant = _last_message(body, "assistant")
        if not last_assistant:
            return body

        chat_id = body.get("chat_id") or body.get("id") or "unknown"
        user_id = (user or {}).get("id", "anonymous")
        cache_key = (user_id, chat_id)
        channel_id = self._channel_cache.get(cache_key)
        if not channel_id:
            # No inlet was recorded for this turn — best-effort lookup.
            try:
                channel_id = await self._ensure_channel(user_id, chat_id, body)
            except Exception as err:
                logger.warning("[synap-channel-sync] outlet channel lookup failed: %s", err)
                return body

        try:
            await self._post_message(channel_id, "assistant", last_assistant, user_id)
        except Exception as err:
            logger.warning("[synap-channel-sync] outlet post failed: %s", err)

        return body

    # ---------------------------------------------------------------------
    # Hub Protocol — channel + message helpers
    # ---------------------------------------------------------------------

    def _enabled(self) -> bool:
        return bool(self.valves.SYNAP_API_KEY)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.valves.SYNAP_API_KEY}",
            "Content-Type": "application/json",
        }

    async def _ensure_channel(
        self, user_id: str, chat_id: str, body: dict[str, Any],
    ) -> str:
        """Find or create a Synap channel for this Open WebUI conversation."""
        cache_key = (user_id, chat_id)
        if cache_key in self._channel_cache:
            return self._channel_cache[cache_key]

        # External_id makes lookups deterministic on the Synap side — even
        # across pipelines container restarts.
        external_id = f"openwebui:{user_id}:{chat_id}"
        title = body.get("title") or _summarize_first_message(body) or "Open WebUI chat"

        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.post(
                f"{self.valves.SYNAP_API_URL}/api/hub/channels/upsert",
                json={
                    "type": self.valves.CHANNEL_TYPE,
                    "source": self.valves.SOURCE,
                    "externalId": external_id,
                    "title": title,
                    "metadata": {
                        "owuiChatId": chat_id,
                        "owuiUserId": user_id,
                    },
                },
                headers=self._headers(),
            )
            res.raise_for_status()
            data = res.json()

        channel_id = data.get("channelId") or data.get("id")
        if not channel_id:
            raise RuntimeError(f"Hub Protocol returned no channelId: {data}")

        self._channel_cache[cache_key] = channel_id
        return channel_id

    async def _post_message(
        self, channel_id: str, role: str, content: str, user_id: str,
    ) -> None:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.post(
                f"{self.valves.SYNAP_API_URL}/api/hub/messages",
                json={
                    "channelId": channel_id,
                    "role": role,
                    "content": content,
                    "externalUserId": user_id,
                },
                headers=self._headers(),
            )
            # 4xx means the message was rejected (auth, validation, etc.) —
            # we don't want to silently swallow that, but we also don't want
            # to break the user's chat over it. Log the *status* only —
            # error response bodies from Synap can include auth context,
            # user identifiers, or token fragments, which shouldn't end up
            # in container logs that may be shipped elsewhere.
            if not res.is_success:
                logger.warning(
                    "[synap-channel-sync] message post returned HTTP %s",
                    res.status_code,
                )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _last_message(body: dict[str, Any], role: str) -> str:
    messages = body.get("messages") or []
    for msg in reversed(messages):
        if msg.get("role") == role:
            content = msg.get("content") or ""
            if isinstance(content, list):
                content = "\n".join(
                    p.get("text", "") for p in content if isinstance(p, dict)
                )
            text = str(content).strip()
            if text:
                return text
    return ""


def _summarize_first_message(body: dict[str, Any]) -> str:
    """Use the first user message (truncated) as the channel title."""
    messages = body.get("messages") or []
    for msg in messages:
        if msg.get("role") == "user":
            content = msg.get("content") or ""
            if isinstance(content, list):
                content = "\n".join(
                    p.get("text", "") for p in content if isinstance(p, dict)
                )
            text = str(content).strip()
            if not text:
                continue
            return text[:80] + ("…" if len(text) > 80 else "")
    return ""
