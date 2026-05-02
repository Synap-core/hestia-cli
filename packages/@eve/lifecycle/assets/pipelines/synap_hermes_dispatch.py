"""
title: Hermes Dispatch
author: Eve
version: 0.1.0
license: MIT
description: |
  Intercepts builder slash commands in Open WebUI and dispatches them to
  Hermes via Synap's task system. Examples:

    /scaffold a Telegram bot that summarises my unread emails
    /deploy ./my-app
    /fix the failing migration in synap-backend

  When a slash command is detected we *short-circuit* the model call:
  instead of asking the LLM to "scaffold a Telegram bot", we create a
  Hermes task and stream its progress back to the chat. The model itself
  never sees the command.

  Without this, slash commands would be answered as plain text by whatever
  model is selected — which is fine for chat but doesn't actually build
  anything. With it, your stack does the work.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Recognised commands. Add more here as Hermes grows new skills.
COMMAND_PATTERN = re.compile(
    r"^\s*/(?P<command>scaffold|deploy|fix|build|migrate|test)\b\s*(?P<argument>.*)$",
    re.DOTALL,
)


class Pipeline:
    class Valves(BaseModel):
        SYNAP_API_URL: str = "http://synap-backend-backend-1:4000"
        SYNAP_API_KEY: str = ""
        # The Hermes daemon polls Synap for tasks of these types. We tag
        # everything we create with `hermes:dispatch` so the daemon knows it
        # comes from a chat slash command (vs. being created by an agent).
        TASK_TAG: str = "hermes:dispatch"
        # Fallback message returned to the user while Hermes works. The chat
        # UI shows this immediately; Hermes posts the actual result back to
        # the channel asynchronously.
        ACK_TEMPLATE: str = (
            "🛠️ Hermes received your **/{command}** request and queued task `{task_id}`.\n\n"
            "I'll post the result back to this channel when it's done. "
            "You can check progress at any time from the Hermes drawer in the dashboard."
        )
        DEBUG: bool = False

    def __init__(self) -> None:
        self.name = "Hermes Dispatch"
        self.type = "filter"
        # Run *before* memory injection — slash commands shouldn't waste
        # context fetching memories that won't be sent to the model.
        self.priority = -10

        self.valves = self.Valves(
            **{
                "SYNAP_API_URL": os.getenv("SYNAP_API_URL", self.Valves().SYNAP_API_URL),
                "SYNAP_API_KEY": os.getenv("SYNAP_API_KEY", self.Valves().SYNAP_API_KEY),
                "DEBUG": os.getenv("SYNAP_PIPELINE_DEBUG", "0") == "1",
            },
        )

    async def on_startup(self) -> None:
        logger.info("[hermes-dispatch] startup; pod=%s", self.valves.SYNAP_API_URL)

    async def on_shutdown(self) -> None:
        pass

    # ---------------------------------------------------------------------
    # Filter hooks
    # ---------------------------------------------------------------------

    async def inlet(self, body: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
        """Detect slash commands and replace them with an immediate ack."""
        if not self.valves.SYNAP_API_KEY:
            return body

        last_user_idx, last_user_text = _find_last_user(body)
        if last_user_text is None:
            return body

        match = COMMAND_PATTERN.match(last_user_text)
        if not match:
            return body

        command = match.group("command")
        argument = (match.group("argument") or "").strip()

        try:
            task_id = await self._dispatch(command, argument, user, body)
        except Exception as err:
            logger.warning("[hermes-dispatch] dispatch failed: %s", err)
            return body  # let the model handle it as if it were a normal message

        ack = self.valves.ACK_TEMPLATE.format(command=command, task_id=task_id)

        # Replace the user's slash command with the ack as a system message,
        # *and* tell the model not to do anything else by emptying the
        # remaining message list. Open WebUI still streams the system message
        # back to the chat.
        body["messages"] = [
            {"role": "system", "content": ack},
        ]
        # `stream: false` keeps the response simple — no token-by-token
        # streaming for what's already a short canned reply.
        body["stream"] = False
        # Hint to the routing layer that this should be a cheap model call —
        # the system message is already the answer.
        body["max_tokens"] = 16

        if self.valves.DEBUG:
            logger.info(
                "[hermes-dispatch] dispatched /%s task=%s arg=%r",
                command, task_id, argument[:80],
            )
        return body

    async def outlet(self, body: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
        # No outlet behavior — the model's reply is already the ack we set up.
        return body

    # ---------------------------------------------------------------------
    # Task creation via Hub Protocol
    # ---------------------------------------------------------------------

    async def _dispatch(
        self,
        command: str,
        argument: str,
        user: dict[str, Any] | None,
        body: dict[str, Any],
    ) -> str:
        """Create a Hermes-flagged task in Synap and return its id."""
        headers = {
            "Authorization": f"Bearer {self.valves.SYNAP_API_KEY}",
            "Content-Type": "application/json",
        }

        # `command` already came from a constrained regex group, but
        # double-check before interpolating it into a tag string.
        if not command.isalpha() or len(command) > 32:
            raise ValueError(f"command rejected: {command!r}")

        # `argument` is free-form natural language, hard-cap it.
        argument_clean = (argument or "")[:2000]

        # Identifiers on the request body come from arbitrary OpenAI-compat
        # clients — type-check and length-cap them before storing.
        owui_user_id = _safe_id((user or {}).get("id"))
        owui_chat_id = _safe_id(body.get("chat_id") or body.get("id"))

        payload = {
            "title": f"/{command} {argument_clean[:80]}".strip(),
            "description": argument_clean,
            "profileSlug": "task",
            "properties": {
                "status": "todo",
                "priority": "medium",
                "tags": [self.valves.TASK_TAG, f"hermes:command:{command}"],
                "source": "openwebui",
                "raw": json.dumps({
                    "command": command,
                    "argument": argument_clean,
                    "owuiUserId": owui_user_id,
                    "owuiChatId": owui_chat_id,
                })[:4000],
            },
        }

        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.post(
                f"{self.valves.SYNAP_API_URL}/api/hub/entities",
                json=payload,
                headers=headers,
            )
            res.raise_for_status()
            data = res.json()

        task_id = data.get("entityId") or data.get("id") or "unknown"
        return str(task_id)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_id(value: Any) -> str | None:
    """Coerce a body-supplied identifier into a safe, length-capped string.

    Open WebUI sets these fields itself, but other OpenAI-compat clients
    can send anything — bail on non-string/non-numeric types and cap
    length so we don't bloat the task's `raw` JSONB column.
    """
    if value is None:
        return None
    if not isinstance(value, (str, int)):
        return None
    text = str(value)
    if len(text) > 256:
        return text[:256]
    return text


def _find_last_user(body: dict[str, Any]) -> tuple[int, str | None]:
    messages = body.get("messages") or []
    for i in range(len(messages) - 1, -1, -1):
        msg = messages[i]
        if msg.get("role") == "user":
            content = msg.get("content") or ""
            if isinstance(content, list):
                content = "\n".join(
                    p.get("text", "") for p in content if isinstance(p, dict)
                )
            return i, str(content)
    return -1, None
