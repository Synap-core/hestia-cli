"""
title: Synap Calendar Awareness
author: Eve
version: 0.1.0
license: MIT
description: |
  Pulls upcoming event entities from the user's Synap pod and injects
  them into the system context whenever the user asks something
  schedule-related — "what's on my calendar today", "do I have anything
  Tuesday", "when's my next call with Alice".

  Why a trigger-gated injection (not always-on)? Calendar context is
  bulky and irrelevant to most chats. Injecting it only when the user
  asks keeps token spend down without losing the capability.

  Trigger detection is a small regex over canonical phrases, plus the
  presence of date words ("today", "tomorrow", weekday names, "this
  week"). Conservative — when in doubt, no injection.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)


CALENDAR_TRIGGERS = re.compile(
    r"""
    \b(
        calendar | agenda | schedule | scheduling
        | (?:meeting|call|appointment)s?
        | (?:next|upcoming|today's|this\s+week's)\s+(?:meeting|call|event|appointment)s?
        | what'?s?\s+on\s+my\s+(?:calendar|agenda|schedule)
        | what\s+(?:do\s+i\s+have|am\s+i\s+doing)\s+(?:today|tomorrow|this\s+week)
        | when'?s?\s+my\s+next
        | do\s+i\s+have\s+(?:anything|any\s+meetings?|plans?|time)
        | free\s+time
        | event\s+at
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)


class Pipeline:
    class Valves(BaseModel):
        SYNAP_API_URL: str = "http://synap-backend-backend-1:4000"
        SYNAP_API_KEY: str = ""
        # How many upcoming events to fetch.
        TOP_K: int = 10
        # Window: events occurring within the next N days. Beyond this
        # is treated as "not relevant for casual scheduling chat".
        WINDOW_DAYS: int = 14
        # Append a "📅 Pulled N events" footer.
        SHOW_FOOTER: bool = True
        DEBUG: bool = False

    def __init__(self) -> None:
        self.name = "Synap Calendar Awareness"
        self.type = "filter"
        # Run alongside the other context injectors but slightly later so
        # we don't push the (more authoritative) knowledge entries down.
        self.priority = -1

        self.valves = self.Valves(
            **{
                "SYNAP_API_URL": os.getenv("SYNAP_API_URL", self.Valves().SYNAP_API_URL),
                "SYNAP_API_KEY": os.getenv("SYNAP_API_KEY", self.Valves().SYNAP_API_KEY),
                "DEBUG": os.getenv("SYNAP_PIPELINE_DEBUG", "0") == "1",
            },
        )

        self._last_injection: dict[tuple[str, str], int] = {}

    async def on_startup(self) -> None:
        logger.info("[synap-calendar] startup")

    async def on_shutdown(self) -> None:
        pass

    # ---------------------------------------------------------------------
    # Filter hooks
    # ---------------------------------------------------------------------

    async def inlet(self, body: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.valves.SYNAP_API_KEY:
            return body

        last_user = _last_user_message(body)
        if not last_user or not CALENDAR_TRIGGERS.search(last_user):
            return body

        try:
            events = await self._fetch_upcoming()
        except Exception as err:
            logger.warning("[synap-calendar] fetch failed: %s", err)
            return body

        if not events:
            return body

        body.setdefault("messages", []).insert(
            0,
            {"role": "system", "content": _format_events(events)},
        )

        cache_key = ((user or {}).get("id", "anon"), body.get("chat_id") or body.get("id") or "unknown")
        self._last_injection[cache_key] = len(events)

        if self.valves.DEBUG:
            logger.info("[synap-calendar] injected %d events", len(events))
        return body

    async def outlet(self, body: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.valves.SHOW_FOOTER:
            return body
        cache_key = ((user or {}).get("id", "anon"), body.get("chat_id") or body.get("id") or "unknown")
        n = self._last_injection.pop(cache_key, 0)
        if n == 0:
            return body
        _append_footer(body, f"📅 Pulled {n} upcoming event{'s' if n != 1 else ''} from Synap")
        return body

    # ---------------------------------------------------------------------
    # Hub Protocol
    # ---------------------------------------------------------------------

    async def _fetch_upcoming(self) -> list[dict[str, Any]]:
        """List event entities, then filter to those in the next WINDOW_DAYS.

        Hub Protocol's GET /entities doesn't accept a date filter, so we
        pull a sensible page (4× TOP_K) sorted by recency and post-filter
        client-side. This is fine for personal-scale calendars (hundreds,
        not thousands of upcoming events).
        """
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.get(
                f"{self.valves.SYNAP_API_URL}/api/hub/entities",
                params={
                    "profileSlug": "event",
                    "limit": self.valves.TOP_K * 4,
                    "sort": "updatedAt:desc",
                },
                headers={"Authorization": f"Bearer {self.valves.SYNAP_API_KEY}"},
            )
            if not res.is_success:
                logger.debug("[synap-calendar] HTTP %s", res.status_code)
                return []
            data = res.json()

        rows: list[dict[str, Any]]
        if isinstance(data, list):
            rows = data
        elif isinstance(data, dict):
            rows = data.get("entities") or data.get("items") or []
        else:
            rows = []

        now = datetime.now(timezone.utc)
        cutoff = now + timedelta(days=self.valves.WINDOW_DAYS)

        upcoming: list[tuple[datetime, dict[str, Any]]] = []
        for row in rows:
            props = row.get("properties") or {}
            start_raw = (
                props.get("startDate")
                or props.get("start")
                or props.get("startsAt")
                or row.get("startDate")
            )
            start = _parse_dt(start_raw)
            if not start:
                continue
            if start < now or start > cutoff:
                continue
            upcoming.append((start, row))

        upcoming.sort(key=lambda x: x[0])
        return [r for _, r in upcoming[: self.valves.TOP_K]]


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


def _parse_dt(raw: Any) -> datetime | None:
    if not raw:
        return None
    if isinstance(raw, (int, float)):
        try:
            return datetime.fromtimestamp(float(raw), tz=timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None
    if isinstance(raw, str):
        text = raw.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    return None


def _format_events(events: list[dict[str, Any]]) -> str:
    parts: list[str] = [
        "## Upcoming events (Synap calendar)",
        "From the user's pod. Times are in the user's local timezone if Synap stored them that way.",
        "",
    ]
    for e in events:
        props = e.get("properties") or {}
        title = e.get("title") or props.get("title") or "(untitled)"
        start = props.get("startDate") or props.get("start") or "?"
        end = props.get("endDate") or props.get("end")
        location = props.get("location")
        line = f"- **{title}** — {start}"
        if end:
            line += f" → {end}"
        if location:
            line += f" @ {location}"
        parts.append(line)
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
