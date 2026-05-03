"""
title: Synap Channel Sync
author: Eve
version: 0.2.0
license: MIT
description: |
  Mirrors every Open WebUI conversation into a Synap channel via the Hub
  Protocol. Each chat becomes a thread; each user / assistant message is
  posted to that thread. The result: Open WebUI conversations show up in
  Synap views, agent contexts, and search — without leaving the chat UI.

  One-way mirror: Open WebUI → Synap. We don't pull Synap messages back
  into Open WebUI; if you want bidirectional, use Synap's own chat UI.

  Reply augmentation: when DEBUG_FOOTER is on, the assistant reply gets a
  small "🔗 Mirrored to Synap" footer so the user can see the integration
  did its job. Off by default to keep replies clean.
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
        # Thread title prefix — makes Open WebUI threads easy to filter on
        # the Synap side.
        TITLE_PREFIX: str = "💬 "
        # Show a small footer on assistant replies confirming the mirror
        # worked. Helps users discover the integration; can be turned off
        # by power users who want clean output.
        SHOW_FOOTER: bool = True
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

        # Cache: { (owui_user_id, owui_chat_id) → synap_thread_id }
        self._thread_cache: dict[tuple[str, str], str] = {}
        # Resolved auth context — fetched lazily on first call.
        self._synap_user_id: str | None = None
        self._workspace_id: str | None = None

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
        owui_user_id = (user or {}).get("id", "anonymous")

        try:
            thread_id = await self._ensure_thread(owui_user_id, chat_id, body)
            await self._post_message(thread_id, "user", last_user)
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
        owui_user_id = (user or {}).get("id", "anonymous")
        cache_key = (owui_user_id, chat_id)
        thread_id = self._thread_cache.get(cache_key)
        if not thread_id:
            try:
                thread_id = await self._ensure_thread(owui_user_id, chat_id, body)
            except Exception as err:
                logger.warning("[synap-channel-sync] outlet thread lookup failed: %s", err)
                return body

        try:
            await self._post_message(thread_id, "assistant", last_assistant)
        except Exception as err:
            logger.warning("[synap-channel-sync] outlet post failed: %s", err)
            return body

        if self.valves.SHOW_FOOTER:
            _append_footer(body, "🔗 Mirrored to Synap channel")

        return body

    # ---------------------------------------------------------------------
    # Hub Protocol — auth context, thread + message helpers
    # ---------------------------------------------------------------------

    def _enabled(self) -> bool:
        return bool(self.valves.SYNAP_API_KEY)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.valves.SYNAP_API_KEY}",
            "Content-Type": "application/json",
        }

    async def _resolve_context(self, client: httpx.AsyncClient) -> tuple[str, str] | None:
        """Resolve Synap user + default workspace from the bearer token.

        Cached after first success — pipelines containers stay alive across
        many chats, so we only pay this lookup once.
        """
        if self._synap_user_id and self._workspace_id:
            return (self._synap_user_id, self._workspace_id)

        me = await client.get(
            f"{self.valves.SYNAP_API_URL}/api/hub/users/me",
            headers=self._headers(),
        )
        if not me.is_success:
            logger.warning(
                "[synap-channel-sync] /users/me returned HTTP %s — bad API key?",
                me.status_code,
            )
            return None
        self._synap_user_id = (me.json() or {}).get("id")

        ws = await client.get(
            f"{self.valves.SYNAP_API_URL}/api/hub/workspaces",
            headers=self._headers(),
        )
        if not ws.is_success:
            logger.warning(
                "[synap-channel-sync] /workspaces returned HTTP %s",
                ws.status_code,
            )
            return None
        wslist = (ws.json() or {}).get("workspaces") or []
        if not wslist:
            logger.warning("[synap-channel-sync] no workspaces accessible to API key")
            return None
        # Pick the first workspace — Hub Protocol returns them in stable order
        # for a given user. Multi-workspace users would need explicit routing,
        # which we'd surface as a per-pipeline valve.
        self._workspace_id = wslist[0].get("id")

        if not self._synap_user_id or not self._workspace_id:
            return None
        return (self._synap_user_id, self._workspace_id)

    async def _ensure_thread(
        self, owui_user_id: str, chat_id: str, body: dict[str, Any],
    ) -> str:
        """Find or create a Synap thread for this Open WebUI conversation."""
        cache_key = (owui_user_id, chat_id)
        if cache_key in self._thread_cache:
            return self._thread_cache[cache_key]

        title = (
            self.valves.TITLE_PREFIX
            + (body.get("title") or _summarize_first_message(body) or "Open WebUI chat")
        )

        async with httpx.AsyncClient(timeout=8.0) as client:
            ctx = await self._resolve_context(client)
            if ctx is None:
                raise RuntimeError("could not resolve Synap user/workspace from API key")
            synap_user_id, workspace_id = ctx

            res = await client.post(
                f"{self.valves.SYNAP_API_URL}/api/hub/threads",
                json={
                    "userId": synap_user_id,
                    "workspaceId": workspace_id,
                    "title": title[:120],
                    "branchPurpose": f"openwebui:{chat_id}",
                },
                headers=self._headers(),
            )
            res.raise_for_status()
            data = res.json()

        thread_id = data.get("id")
        if not thread_id:
            raise RuntimeError(f"/threads returned no id: {data}")

        self._thread_cache[cache_key] = thread_id
        if self.valves.DEBUG:
            logger.info("[synap-channel-sync] created thread %s for chat %s", thread_id, chat_id)
        return thread_id

    async def _post_message(self, thread_id: str, role: str, content: str) -> None:
        async with httpx.AsyncClient(timeout=8.0) as client:
            ctx = await self._resolve_context(client)
            if ctx is None:
                raise RuntimeError("could not resolve Synap user from API key")
            synap_user_id, _ws = ctx

            res = await client.post(
                f"{self.valves.SYNAP_API_URL}/api/hub/threads/{thread_id}/messages",
                json={
                    "role": role,
                    "content": content,
                    "userId": synap_user_id,
                    # Disable autoRespond — we don't want Synap's IS replying
                    # to OWUI mirrors. The user already got their answer here.
                    "autoRespond": False,
                },
                headers=self._headers(),
            )
            # Don't fail closed: log status only (response bodies can include
            # auth/user tokens and shouldn't end up in container logs).
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


def _append_footer(body: dict[str, Any], footer: str) -> None:
    """Append a small footer to the last assistant message in `body`.

    Open WebUI passes the assistant message in `body["messages"]` for outlets;
    mutating its content is the supported way to augment the visible reply.
    """
    messages = body.get("messages") or []
    for msg in reversed(messages):
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content")
        if isinstance(content, list):
            # Multi-part — append a text part rather than mutating existing parts.
            content.append({"type": "text", "text": f"\n\n_{footer}_"})
            return
        if isinstance(content, str):
            msg["content"] = content.rstrip() + f"\n\n_{footer}_"
            return
        return
