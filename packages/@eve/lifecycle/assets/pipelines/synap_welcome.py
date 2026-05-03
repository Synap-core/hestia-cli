"""
title: Synap Welcome
author: Eve
version: 0.1.0
license: MIT
description: |
  Detects the first turn of a fresh conversation and prepends a system
  message that introduces what this Open WebUI install can actually do
  with Synap behind it: memory injection, channel sync, /scaffold +
  /deploy + /fix slash commands, /eve help.

  Without this, a new user opens Open WebUI, sees a generic chat box, and
  has no idea any of the integrations are wired up. With it, the model's
  very first reply naturally references the available tools — *because
  the model itself was told about them in the system prompt*.

  Runs only on the first user turn (no prior assistant messages). Cheap:
  no Hub Protocol calls, no network, just message-list inspection.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from pydantic import BaseModel

logger = logging.getLogger(__name__)


# Default welcome prompt. Edited via the WELCOME_PROMPT valve in OWUI's
# admin → pipelines panel — power users can rewrite to taste.
DEFAULT_WELCOME = """\
You are Eve, the assistant for this user's sovereign Synap stack. \
This Open WebUI is wired up to:

- **Synap Memory** — relevant notes, tasks, and entities are auto-injected \
into your context (look for "Recalled N memories" footers).
- **Channel Sync** — every chat is mirrored to a Synap channel for later search.
- **Hermes Slash Commands** — when the user types `/scaffold`, `/deploy`, \
`/fix`, `/build`, `/migrate`, or `/test`, the request is queued as a Hermes \
build task. Don't try to answer those yourself — the dispatch pipeline \
handles them. Tell the user where to track progress (Hermes drawer in dashboard).
- **`/eve` help** — surfaces the full feature list. If a user seems unsure \
what to do, suggest they type `/eve`.

Be brief and proactive. If a question maps to one of the integrations \
(building something, recalling a fact, checking a task) say so and route \
the user there.
"""


class Pipeline:
    class Valves(BaseModel):
        # Toggle the whole filter on/off without uninstalling.
        ENABLED: bool = True
        # The system prompt prepended on first turn. Power users override.
        WELCOME_PROMPT: str = DEFAULT_WELCOME
        # Models the welcome should run for. Empty = all.
        MODELS: list[str] = []
        DEBUG: bool = False

    def __init__(self) -> None:
        self.name = "Synap Welcome"
        self.type = "filter"
        # Run *very* early — even before memory injection, so the
        # introduction sits at the top of the system stack and isn't
        # buried by recall blocks.
        self.priority = -100

        self.valves = self.Valves(
            **{
                "DEBUG": os.getenv("SYNAP_PIPELINE_DEBUG", "0") == "1",
            },
        )

    async def on_startup(self) -> None:
        logger.info("[synap-welcome] startup")

    async def on_shutdown(self) -> None:
        pass

    # ---------------------------------------------------------------------
    # Filter hooks
    # ---------------------------------------------------------------------

    async def inlet(self, body: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.valves.ENABLED:
            return body

        messages = body.get("messages") or []
        if not _is_first_turn(messages):
            return body

        # Prepend our intro as the first system message. We don't replace
        # any existing system message — Open WebUI's own system prompt
        # (model card, persona) should still apply.
        messages.insert(0, {"role": "system", "content": self.valves.WELCOME_PROMPT})
        body["messages"] = messages

        if self.valves.DEBUG:
            logger.info("[synap-welcome] injected welcome prompt for fresh conversation")

        return body

    async def outlet(self, body: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
        return body


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_first_turn(messages: list[dict[str, Any]]) -> bool:
    """True iff this is the model's first response in the conversation.

    "First turn" = there's exactly one user message *and* no prior assistant
    message. Tolerates pre-existing system messages (model cards, personas).
    """
    has_assistant = any(m.get("role") == "assistant" for m in messages)
    if has_assistant:
        return False
    user_count = sum(1 for m in messages if m.get("role") == "user")
    return user_count == 1
