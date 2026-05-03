"""
title: Synap /eve help
author: Eve
version: 0.1.0
license: MIT
description: |
  Catches `/eve`, `/eve help`, and `/help` slash commands and short-circuits
  the model with a static help message listing every Synap-aware capability
  wired into this Open WebUI install. No tokens spent, instant response.

  The intent: a user types `/eve` when they're not sure what's possible,
  and the chat itself tells them. Discoverability inside the chat surface
  rather than buried in dashboard panels.

  Pattern follows synap_hermes_dispatch.py: detect → replace messages with
  a single system message → set stream=false + max_tokens=16 so the model
  call is cheap.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

from pydantic import BaseModel

logger = logging.getLogger(__name__)


# `/eve`, `/eve help`, `/eve features`, plain `/help`. We deliberately
# don't catch `/eve <freeform>` — that should fall through to the model,
# which will likely route the question back via the welcome prompt.
HELP_PATTERN = re.compile(
    r"^\s*/(?:help|eve(?:\s+(?:help|features|status|\?))?)\s*$",
    re.IGNORECASE,
)


HELP_MESSAGE = """\
**Eve — Synap-aware Open WebUI**

This chat is connected to your sovereign data pod. Here's what's wired up:

**🧠 Memory + Context (automatic)**
- Every question pulls relevant notes, tasks, and entities from your Synap pod.
- Look for the `💭 Recalled …` footer at the bottom of replies.
- Stores: `/api/hub/memory`, `/api/hub/entities`.

**🔗 Channel Sync (automatic)**
- Every chat is mirrored to a Synap thread.
- Search all your conversations from the Synap dashboard.
- Look for the `🔗 Mirrored to Synap` footer.

**🛠️ Build with Hermes**
- `/scaffold <description>` — start a new project
- `/deploy <path>` — deploy a directory
- `/fix <description>` — file a build-time bug
- `/build`, `/migrate`, `/test` — run skills against the active workspace

**📅 Calendar Awareness** — ask "what's on my calendar today?" and Eve pulls upcoming events from your pod.

**📚 Knowledge Sync** — facts you've stored via `/api/hub/knowledge` are surfaced when relevant.

**📝 Notes** — say "save this as a note" or "remember this" and Eve files a note entity.

**Need more?**
- Open the **Eve dashboard** (`http://localhost:3001` or your domain) for full system control.
- Check `/dashboard/doctor` if integrations look broken.
- Run `eve doctor` from the host to check stack health.

_Type `/eve` anytime to see this list again._
"""


class Pipeline:
    class Valves(BaseModel):
        # Toggle the whole filter on/off.
        ENABLED: bool = True
        # Customisable help text — power users can override per install.
        HELP_MESSAGE: str = HELP_MESSAGE
        DEBUG: bool = False

    def __init__(self) -> None:
        self.name = "Synap /eve help"
        self.type = "filter"
        # Run before hermes dispatch (-10) so `/eve` doesn't get caught
        # by any future broader pattern match.
        self.priority = -20

        self.valves = self.Valves(
            **{
                "DEBUG": os.getenv("SYNAP_PIPELINE_DEBUG", "0") == "1",
            },
        )

    async def on_startup(self) -> None:
        logger.info("[synap-eve-help] startup")

    async def on_shutdown(self) -> None:
        pass

    # ---------------------------------------------------------------------
    # Filter hooks
    # ---------------------------------------------------------------------

    async def inlet(self, body: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.valves.ENABLED:
            return body

        last_user = _last_user_message(body)
        if not last_user:
            return body
        if not HELP_PATTERN.match(last_user):
            return body

        # Short-circuit: the system message *is* the answer. Open WebUI
        # streams it back as the assistant reply.
        body["messages"] = [
            {"role": "system", "content": self.valves.HELP_MESSAGE},
        ]
        body["stream"] = False
        body["max_tokens"] = 16  # We just want the model to echo the system msg.

        if self.valves.DEBUG:
            logger.info("[synap-eve-help] short-circuited /eve help")
        return body

    async def outlet(self, body: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
        return body


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
