"""
title: Synap Knowledge Sync
author: Eve
version: 0.1.0
license: MIT
description: |
  Pulls relevant key/value knowledge entries from the user's Synap pod and
  injects them as a system message before the model sees the question.

  Knowledge is curated, structured, and namespaced — distinct from "memory"
  (recall fragments, fuzzy) and "entities" (typed first-class objects).
  Examples: API keys to other systems, project conventions, glossary
  definitions, "always reply in French", style guide rules.

  This is a counterpart to synap_memory_filter.py — together they give the
  model both fuzzy recall (memory) and structured pinned facts (knowledge).
  Each runs at a different priority so their context blocks stack cleanly.
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
        # Maximum knowledge entries to fetch per turn.
        TOP_K: int = 5
        # If set, restrict to this namespace (e.g., "openwebui", "global").
        # Empty = all namespaces.
        NAMESPACE: str = ""
        # Append a "📚 Recalled N facts" footer to assistant replies.
        SHOW_FOOTER: bool = True
        DEBUG: bool = False

    def __init__(self) -> None:
        self.name = "Synap Knowledge Sync"
        self.type = "filter"
        # Run after the welcome (-100) and eve-help (-20) but before the
        # memory injection (0) so structured facts come first in the
        # system context (most pinned).
        self.priority = -5

        self.valves = self.Valves(
            **{
                "SYNAP_API_URL": os.getenv("SYNAP_API_URL", self.Valves().SYNAP_API_URL),
                "SYNAP_API_KEY": os.getenv("SYNAP_API_KEY", self.Valves().SYNAP_API_KEY),
                "DEBUG": os.getenv("SYNAP_PIPELINE_DEBUG", "0") == "1",
            },
        )

        # Per-(user, chat) inject counter for the outlet footer.
        self._last_injection: dict[tuple[str, str], int] = {}

    async def on_startup(self) -> None:
        logger.info("[synap-knowledge] startup; pod=%s", self.valves.SYNAP_API_URL)

    async def on_shutdown(self) -> None:
        pass

    # ---------------------------------------------------------------------
    # Filter hooks
    # ---------------------------------------------------------------------

    async def inlet(self, body: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.valves.SYNAP_API_KEY:
            return body

        last_user = _last_user_message(body)
        if not last_user:
            return body

        try:
            entries = await self._search_knowledge(last_user)
        except Exception as err:
            logger.warning("[synap-knowledge] search failed: %s", err)
            return body

        if not entries:
            return body

        body.setdefault("messages", []).insert(
            0,
            {
                "role": "system",
                "content": _format_entries(entries),
            },
        )

        cache_key = ((user or {}).get("id", "anon"), body.get("chat_id") or body.get("id") or "unknown")
        self._last_injection[cache_key] = len(entries)

        if self.valves.DEBUG:
            logger.info("[synap-knowledge] injected %d entries", len(entries))
        return body

    async def outlet(self, body: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.valves.SHOW_FOOTER:
            return body

        cache_key = ((user or {}).get("id", "anon"), body.get("chat_id") or body.get("id") or "unknown")
        n = self._last_injection.pop(cache_key, 0)
        if n == 0:
            return body
        _append_footer(body, f"📚 Recalled {n} fact{'s' if n != 1 else ''} from Synap knowledge")
        return body

    # ---------------------------------------------------------------------
    # Hub Protocol
    # ---------------------------------------------------------------------

    async def _search_knowledge(self, query: str) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"q": query, "limit": self.valves.TOP_K}
        # Namespace filter is honoured by the list endpoint, not the
        # full-text-search one — that scopes by workspace only. So if
        # the user wants a namespace filter we apply it client-side.
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.get(
                f"{self.valves.SYNAP_API_URL}/api/hub/knowledge/search",
                params=params,
                headers={"Authorization": f"Bearer {self.valves.SYNAP_API_KEY}"},
            )
            if not res.is_success:
                logger.debug("[synap-knowledge] search HTTP %s", res.status_code)
                return []
            data = res.json()

        items: list[dict[str, Any]] = []
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = data.get("items") or data.get("results") or []

        if self.valves.NAMESPACE:
            items = [
                item for item in items
                if (item.get("namespace") or "") == self.valves.NAMESPACE
            ]

        return items[: self.valves.TOP_K]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _last_user_message(body: dict[str, Any]) -> str:
    messages = body.get("messages") or []
    for msg in reversed(messages):
        if msg.get("role") == "user":
            content = msg.get("content") or ""
            if isinstance(content, list):
                content = "\n".join(p.get("text", "") for p in content if isinstance(p, dict))
            return str(content).strip()
    return ""


def _format_entries(entries: list[dict[str, Any]]) -> str:
    parts: list[str] = [
        "## Pinned facts (Synap knowledge base)",
        "These are curated rules and reference values from the user's pod. "
        "Treat them as authoritative — they override your training defaults.",
        "",
    ]
    for e in entries:
        key = e.get("key") or "(no-key)"
        ns = e.get("namespace") or "global"
        value = e.get("value")
        if isinstance(value, (dict, list)):
            import json
            rendered = json.dumps(value, ensure_ascii=False)[:300]
        else:
            rendered = str(value or "")[:300]
        parts.append(f"- **{key}** (`{ns}`): {rendered}")
    return "\n".join(parts)


def _append_footer(body: dict[str, Any], footer: str) -> None:
    messages = body.get("messages") or []
    for msg in reversed(messages):
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content")
        if isinstance(content, list):
            content.append({"type": "text", "text": f"\n\n_{footer}_"})
            return
        if isinstance(content, str):
            msg["content"] = content.rstrip() + f"\n\n_{footer}_"
            return
        return
