"""
title: Synap Memory Injection
author: Eve
version: 0.1.0
license: MIT
description: |
  Pre-prompt filter that pulls relevant memories + entities from your Synap pod
  via the Hub Protocol REST API and injects them as a system message before
  the model sees the user's question.

  Without this, Open WebUI is a generic chat front-end. With it, the model
  sees your notes, tasks, projects, and learned facts — your Synap pod becomes
  the model's long-term memory.
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
        # The Hub Protocol REST base — points at the Synap pod's HTTP service.
        # Default works inside the eve-network bridge.
        SYNAP_API_URL: str = "http://synap-backend-backend-1:4000"
        # Bearer token issued for the pipelines sidecar (see eve add openwebui-pipelines).
        SYNAP_API_KEY: str = ""
        # How many memories + entities to pull per turn. Higher = more context,
        # slower + more tokens.
        TOP_K_MEMORIES: int = 6
        TOP_K_ENTITIES: int = 4
        # Models the filter should run for. Empty = all.
        MODELS: list[str] = []
        # When true, every injection is logged with the matched count.
        DEBUG: bool = False

    def __init__(self) -> None:
        # Open WebUI shows this name in the filter list.
        self.name = "Synap Memory Injection"
        # `filter` pipelines run on every chat completion. The `priority`
        # places us early in the stack so other filters see the augmented body.
        self.type = "filter"
        self.priority = 0

        self.valves = self.Valves(
            **{
                "SYNAP_API_URL": os.getenv("SYNAP_API_URL", self.Valves().SYNAP_API_URL),
                "SYNAP_API_KEY": os.getenv("SYNAP_API_KEY", self.Valves().SYNAP_API_KEY),
                "DEBUG": os.getenv("SYNAP_PIPELINE_DEBUG", "0") == "1",
            },
        )

    async def on_startup(self) -> None:
        logger.info("[synap-memory] startup; pod=%s", self.valves.SYNAP_API_URL)

    async def on_shutdown(self) -> None:
        pass

    # ---------------------------------------------------------------------
    # Filter hooks
    # ---------------------------------------------------------------------

    async def inlet(self, body: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
        """Mutate the outgoing chat-completion body before it hits the model."""
        if not self.valves.SYNAP_API_KEY:
            # Sidecar not wired — pass through silently. Better than failing
            # closed and breaking every chat.
            return body

        last_user = _last_user_message(body)
        if not last_user:
            return body

        try:
            ctx = await self._fetch_context(last_user)
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

        if self.valves.DEBUG:
            logger.info(
                "[synap-memory] injected %d memories + %d entities",
                len(ctx.get("memories", [])),
                len(ctx.get("entities", [])),
            )
        return body

    async def outlet(self, body: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
        """No outlet behavior — this is a one-way context injection."""
        return body

    # ---------------------------------------------------------------------
    # Hub Protocol calls
    # ---------------------------------------------------------------------

    async def _fetch_context(self, query: str) -> dict[str, list[dict[str, Any]]]:
        """Pull relevant memories + entities from the Synap pod."""
        headers = {
            "Authorization": f"Bearer {self.valves.SYNAP_API_KEY}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=8.0) as client:
            # GET /api/hub/memory — semantic recall over the user's notes.
            mem_task = client.get(
                f"{self.valves.SYNAP_API_URL}/api/hub/memory",
                params={"q": query, "limit": self.valves.TOP_K_MEMORIES},
                headers=headers,
            )
            # POST /api/hub/entities/search — entity search by content + label.
            ent_task = client.post(
                f"{self.valves.SYNAP_API_URL}/api/hub/entities/search",
                json={"q": query, "limit": self.valves.TOP_K_ENTITIES},
                headers=headers,
            )
            mem_res, ent_res = await _gather_results(mem_task, ent_task)

        memories: list[dict[str, Any]] = []
        if mem_res is not None and mem_res.status_code == 200:
            data = mem_res.json()
            memories = data.get("memories", []) if isinstance(data, dict) else []

        entities: list[dict[str, Any]] = []
        if ent_res is not None and ent_res.status_code == 200:
            data = ent_res.json()
            entities = data.get("entities", []) if isinstance(data, dict) else []

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
                # multi-part content (vision messages) — pull text parts
                content = "\n".join(p.get("text", "") for p in content if isinstance(p, dict))
            return str(content).strip()
    return ""


def _format_context(ctx: dict[str, list[dict[str, Any]]]) -> str:
    parts: list[str] = [
        "You have access to the user's Synap pod. Below is context relevant to "
        "their current question. Use it when it helps; ignore it when it doesn't.",
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
