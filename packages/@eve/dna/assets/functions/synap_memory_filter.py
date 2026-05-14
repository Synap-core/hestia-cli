"""
title: Synap Memory Injection
author: Eve
version: 0.3.0
license: MIT
description: |
  Pre-prompt filter that pulls relevant memories + entities from your Synap
  pod via the Hub Protocol REST API and injects them as a system message
  before the model sees the user's question.

  Without this, Open WebUI is a generic chat front-end. With it, the model
  sees your notes, tasks, projects, and learned facts — your Synap pod
  becomes the model's long-term memory.

  v0.3.0 — ported from the standalone Pipelines container to a native
  Open WebUI Function. The behaviour is byte-identical; only the class
  name changed (`Pipeline` → `Filter`) and the framework hooks moved from
  the Pipelines runtime into OWUI's in-process Function loader.

  Per-user identity: when PER_USER_TOKENS is on AND the pod has
  HUB_PROTOCOL_SUB_TOKENS=true, the OWUI user.id is forwarded via
  `X-External-User-Id` so each human's recall lands on the right Synap
  user. Default off — single-tenant behavior is byte-identical.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class Filter:
    """Open WebUI Filter — runs `inlet` before each chat completion and
    `outlet` after, augmenting the message stream with Synap context."""

    class Valves(BaseModel):
        # The Hub Protocol REST base — points at the Synap pod's HTTP service.
        # Default works inside the eve-network bridge.
        SYNAP_API_URL: str = "http://eve-brain-synap:4000"
        # Bearer token (eve agent's hubApiKey, written by Eve's
        # openwebui-functions-sync at install time).
        SYNAP_API_KEY: str = ""
        # How many memories + entities to pull per turn. Higher = more
        # context, slower + more tokens.
        TOP_K_MEMORIES: int = 6
        TOP_K_ENTITIES: int = 4
        # Append a small "💭 Recalled N from your Synap pod" footer to the
        # assistant reply so users can see the integration ran. Off-switch
        # for power users who want clean output.
        SHOW_FOOTER: bool = True
        # When on AND the pod has HUB_PROTOCOL_SUB_TOKENS=true, forwards the
        # OWUI user.id via X-External-User-Id so each human's data lands
        # under the right Synap user. OFF by default (opt-in).
        PER_USER_TOKENS: bool = False
        # When true, every injection is logged with the matched count.
        DEBUG: bool = False

    def __init__(self) -> None:
        # Display name in the Functions admin list.
        self.name = "Synap Memory Injection"

        self.valves = self.Valves(
            **{
                "SYNAP_API_URL": os.getenv("SYNAP_API_URL", self.Valves().SYNAP_API_URL),
                "SYNAP_API_KEY": os.getenv("SYNAP_API_KEY", self.Valves().SYNAP_API_KEY),
                "PER_USER_TOKENS": os.getenv("SYNAP_PER_USER_TOKENS", "0") == "1",
                "DEBUG": os.getenv("SYNAP_FUNCTION_DEBUG", "0") == "1",
            },
        )

        # Per-(user, chat) counters of what we injected on the most recent
        # inlet — used by the outlet to render a "💭 Recalled N" footer
        # without re-fetching context.
        self._last_injection: dict[tuple[str, str], tuple[int, int]] = {}

    # ---------------------------------------------------------------------
    # Filter hooks
    # ---------------------------------------------------------------------

    async def inlet(self, body: dict[str, Any], __user__: dict[str, Any] | None = None) -> dict[str, Any]:
        """Mutate the outgoing chat-completion body before it hits the model.

        Open WebUI Functions framework passes the user dict via the
        double-underscore convention (__user__), distinguishing it from any
        argument the wrapped model itself might accept.
        """
        if not self.valves.SYNAP_API_KEY:
            # Mark as disabled so outlet can show a one-time diagnostic footer.
            cache_key = ((__user__ or {}).get("id", "anon"), body.get("chat_id") or body.get("id") or "unknown")
            self._last_injection[cache_key] = (-1, -1)  # sentinel: disabled
            return body

        last_user = _last_user_message(body)
        if not last_user:
            return body

        owui_user_id = (__user__ or {}).get("id")

        try:
            ctx = await self._fetch_context(last_user, owui_user_id)
        except Exception as err:
            logger.warning("[synap-memory] context fetch failed: %s", err)
            return body

        if not ctx:
            return body

        body.setdefault("messages", []).insert(
            0,
            {
                "role": "system",
                "content": _format_context(ctx),
            },
        )

        n_mem = len(ctx.get("memories", []))
        n_ent = len(ctx.get("entities", []))
        cache_key = ((__user__ or {}).get("id", "anon"), body.get("chat_id") or body.get("id") or "unknown")
        self._last_injection[cache_key] = (n_mem, n_ent)

        if self.valves.DEBUG:
            logger.info("[synap-memory] injected %d memories + %d entities", n_mem, n_ent)
        return body

    async def outlet(self, body: dict[str, Any], __user__: dict[str, Any] | None = None) -> dict[str, Any]:
        """Append a 'Recalled N' footer so users see the integration worked."""
        if not self.valves.SHOW_FOOTER:
            return body

        cache_key = ((__user__ or {}).get("id", "anon"), body.get("chat_id") or body.get("id") or "unknown")
        injected = self._last_injection.pop(cache_key, None)
        if not injected:
            return body
        n_mem, n_ent = injected
        if n_mem == 0 and n_ent == 0:
            return body

        bits: list[str] = []
        if n_mem:
            bits.append(f"{n_mem} memor{'y' if n_mem == 1 else 'ies'}")
        if n_ent:
            bits.append(f"{n_ent} entit{'y' if n_ent == 1 else 'ies'}")
        _append_footer(body, f"💭 Recalled {' + '.join(bits)} from your Synap pod")
        return body

    # ---------------------------------------------------------------------
    # Hub Protocol calls
    # ---------------------------------------------------------------------

    def _headers(self, owui_user_id: str | None = None) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.valves.SYNAP_API_KEY}",
            "Content-Type": "application/json",
        }
        # When the pod has HUB_PROTOCOL_SUB_TOKENS=true, this header tells
        # the auth middleware to swap c.userId to the per-OWUI-user mapping.
        if self.valves.PER_USER_TOKENS and owui_user_id:
            headers["X-External-User-Id"] = owui_user_id
        return headers

    async def _fetch_context(
        self, query: str, owui_user_id: str | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        """Pull relevant memories + entities from the Synap pod."""
        headers = self._headers(owui_user_id)

        async with httpx.AsyncClient(timeout=8.0) as client:
            # GET /api/hub/memory — semantic recall over the user's notes.
            mem_task = client.get(
                f"{self.valves.SYNAP_API_URL}/api/hub/memory",
                params={"q": query, "limit": self.valves.TOP_K_MEMORIES},
                headers=headers,
            )
            # GET /api/hub/entities?q=... — search via Typesense.
            ent_task = client.get(
                f"{self.valves.SYNAP_API_URL}/api/hub/entities",
                params={"q": query, "limit": self.valves.TOP_K_ENTITIES},
                headers=headers,
            )
            mem_res, ent_res = await _gather_results(mem_task, ent_task)

        memories: list[dict[str, Any]] = []
        if mem_res is not None and mem_res.status_code == 200:
            data = mem_res.json()
            if isinstance(data, dict):
                memories = data.get("memories", []) or []
            elif isinstance(data, list):
                memories = data

        entities: list[dict[str, Any]] = []
        if ent_res is not None and ent_res.status_code == 200:
            data = ent_res.json()
            if isinstance(data, list):
                entities = data
            elif isinstance(data, dict):
                entities = data.get("entities", []) or []

        return {"memories": memories, "entities": entities}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _last_user_message(body: dict[str, Any]) -> str:
    """Return the latest user message text from the body, or empty string."""
    messages = body.get("messages") or []
    for msg in reversed(messages):
        if msg.get("role") == "user":
            content = msg.get("content") or ""
            if isinstance(content, list):
                content = "\n".join(p.get("text", "") for p in content if isinstance(p, dict))
            return str(content).strip()
    return ""


def _format_context(ctx: dict[str, list[dict[str, Any]]]) -> str:
    parts: list[str] = [
        "You have access to the user's Synap pod. Below is context relevant "
        "to their current question. Use it when it helps; ignore it when it doesn't.",
    ]

    memories = ctx.get("memories", [])
    if memories:
        parts.append("\n## Memories")
        for m in memories:
            content = (m.get("content") or "").strip()
            if content:
                parts.append(f"- {content}")

    entities = ctx.get("entities", [])
    if entities:
        parts.append("\n## Entities")
        for e in entities:
            label = e.get("label") or e.get("title") or e.get("id") or "(unknown)"
            kind = e.get("profileSlug") or e.get("type") or "entity"
            content = (e.get("description") or e.get("content") or "").strip()
            if content:
                parts.append(f"- **{label}** [{kind}] — {content[:200]}")
            else:
                parts.append(f"- **{label}** [{kind}]")

    return "\n".join(parts)


async def _gather_results(*coros: Any) -> tuple[Any, ...]:
    """Run coroutines concurrently, returning None for any that raise."""
    import asyncio

    async def safe(coro: Any) -> Any:
        try:
            return await coro
        except Exception as err:
            logger.debug("[synap-memory] sub-call failed: %s", err)
            return None

    return tuple(await asyncio.gather(*(safe(c) for c in coros)))


def _append_footer(body: dict[str, Any], footer: str) -> None:
    """Append italicized footer to the last assistant message in `body`."""
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
