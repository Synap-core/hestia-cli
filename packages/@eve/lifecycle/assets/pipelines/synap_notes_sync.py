"""
title: Synap Notes Sync
author: Eve
version: 0.1.0
license: MIT
description: |
  Detects "save this as a note", "remember this", "make a note" style
  intents in the user's message, and (when matched) creates a note
  entity in the user's Synap pod via the Hub Protocol.

  Two flavors:
    1. Slash form: `/note <body>` — explicit, deterministic.
    2. Natural-language form: a regex over a small set of canonical
       phrases. Conservative on purpose — false positives are worse
       than false negatives here, since silent dropping is better than
       cluttering the pod with model fluff.

  The note's content is the *user's most recent message* with the
  trigger phrase stripped. We do not ask the model to "summarise" the
  note — that would add latency and tokens for marginal value.

  When a note is created the inlet appends a small confirmation to the
  outgoing system context so the model can naturally acknowledge it
  ("✓ Noted as 'Foo bar…'") instead of pretending the user just asked
  a question.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)


# Slash form: /note, /n, /remember
SLASH_PATTERN = re.compile(
    r"^\s*/(?:note|remember|n)\s+(?P<body>.+)$",
    re.IGNORECASE | re.DOTALL,
)

# Natural-language form: capture whatever follows the trigger up to ~500 chars.
# We *don't* match "remember to ..." because that's a task, not a note.
NL_PATTERN = re.compile(
    r"""
    ^\s*
    (?:please\s+)?
    (?:
        (?:save|file|store|add|drop)\s+(?:this|that|the\s+following)\s+(?:as\s+)?(?:a\s+)?note
        |
        make\s+(?:a\s+)?note(?:\s+(?:of|about|that))?
        |
        note\s+to\s+self
        |
        (?:remember|memorize)\s+this
        |
        (?:remember|memorize)\s+that
    )
    [\s:,.\-]*
    (?P<body>.+)?
    $
    """,
    re.IGNORECASE | re.DOTALL | re.VERBOSE,
)


class Pipeline:
    class Valves(BaseModel):
        SYNAP_API_URL: str = "http://synap-backend-backend-1:4000"
        SYNAP_API_KEY: str = ""
        # Tag every note created via this pipeline so they're filterable
        # in the Synap dashboard.
        TAG: str = "openwebui"
        # When true, also append a "✓ Saved" footer to the assistant
        # reply so the user has visible feedback.
        SHOW_FOOTER: bool = True
        # Cap title length — long titles look bad in entity lists.
        TITLE_MAX: int = 80
        # Per-user sub-tokens — when on AND the pod has
        # HUB_PROTOCOL_SUB_TOKENS=true, each note creation forwards the OWUI
        # user.id via X-External-User-Id so notes land on a per-human Synap
        # user. OFF by default (opt-in).
        PER_USER_TOKENS: bool = False
        DEBUG: bool = False

    def __init__(self) -> None:
        self.name = "Synap Notes Sync"
        self.type = "filter"
        # After welcome (-100) / eve-help (-20) / hermes-dispatch (-10) /
        # knowledge (-5) — we want slash dispatch to win first if the
        # user types `/scaffold`. Notes is a fallback intent.
        self.priority = -2

        self.valves = self.Valves(
            **{
                "SYNAP_API_URL": os.getenv("SYNAP_API_URL", self.Valves().SYNAP_API_URL),
                "SYNAP_API_KEY": os.getenv("SYNAP_API_KEY", self.Valves().SYNAP_API_KEY),
                "PER_USER_TOKENS": os.getenv("SYNAP_PER_USER_TOKENS", "0") == "1",
                "DEBUG": os.getenv("SYNAP_PIPELINE_DEBUG", "0") == "1",
            },
        )

        # Keyed by (user, chat) → last note title we created. Outlet uses
        # this to render a footer; cleared after rendering.
        self._last_note: dict[tuple[str, str], str] = {}

    async def on_startup(self) -> None:
        logger.info("[synap-notes] startup")

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

        note_body = _extract_note_body(last_user)
        if note_body is None:
            return body

        owui_user_id = (user or {}).get("id")

        try:
            entity_id, title = await self._create_note(
                note_body, last_user, owui_user_id
            )
        except Exception as err:
            logger.warning("[synap-notes] create failed: %s", err)
            return body

        cache_key = ((user or {}).get("id", "anon"), body.get("chat_id") or body.get("id") or "unknown")
        self._last_note[cache_key] = title

        # Hint to the model: don't try to answer the message as if it
        # were a question — confirm the save instead.
        body.setdefault("messages", []).insert(
            0,
            {
                "role": "system",
                "content": (
                    f"The user just saved a note (id={entity_id}, title={title!r}). "
                    "Reply briefly to confirm — don't restate the note or ask follow-up questions."
                ),
            },
        )

        if self.valves.DEBUG:
            logger.info("[synap-notes] saved note %s: %r", entity_id, title)

        return body

    async def outlet(self, body: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.valves.SHOW_FOOTER:
            return body
        cache_key = ((user or {}).get("id", "anon"), body.get("chat_id") or body.get("id") or "unknown")
        title = self._last_note.pop(cache_key, None)
        if not title:
            return body
        _append_footer(body, f"✓ Saved as Synap note: \"{title}\"")
        return body

    # ---------------------------------------------------------------------
    # Hub Protocol
    # ---------------------------------------------------------------------

    async def _create_note(
        self,
        note_body: str,
        full_message: str,
        owui_user_id: str | None = None,
    ) -> tuple[str, str]:
        """Create a note entity, return (id, title).

        The full user message is preserved as `properties.source.original`
        so we don't lose context if the trigger-stripping was too aggressive.

        When PER_USER_TOKENS is on and an OWUI user id is available, we
        forward it via X-External-User-Id so the pod auth middleware can
        route the write to the correct per-human Synap user.
        """
        title = note_body.strip().splitlines()[0][: self.valves.TITLE_MAX]
        if len(title) == self.valves.TITLE_MAX and not title.endswith("…"):
            title = title.rstrip() + "…"

        payload = {
            "title": title,
            "profileSlug": "note",
            "properties": {
                "content": note_body.strip(),
                "tags": [self.valves.TAG],
                "source": {
                    "channel": "openwebui",
                    "original": full_message[:2000],
                },
            },
        }

        headers = {
            "Authorization": f"Bearer {self.valves.SYNAP_API_KEY}",
            "Content-Type": "application/json",
        }
        if self.valves.PER_USER_TOKENS and owui_user_id:
            headers["X-External-User-Id"] = owui_user_id

        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.post(
                f"{self.valves.SYNAP_API_URL}/api/hub/entities",
                json=payload,
                headers=headers,
            )
            res.raise_for_status()
            data = res.json()

        entity_id = data.get("entityId") or data.get("id") or "unknown"
        return str(entity_id), title


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


def _extract_note_body(text: str) -> str | None:
    """Return the note body if `text` matches a save-as-note intent.

    Returns None when no intent is detected — the message should fall
    through to the model as normal.
    """
    if not text:
        return None
    m = SLASH_PATTERN.match(text)
    if m:
        body = (m.group("body") or "").strip()
        return body or None
    m = NL_PATTERN.match(text)
    if m:
        body = (m.group("body") or "").strip()
        # If the trigger phrase had no body ("note to self") we still
        # save the entire message as the note — better than nothing.
        return body or text.strip()
    return None


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
