# OpenWebUI ↔ Synap integration strategy

**Date:** 2026-05-03
**Status:** Tracks A and B shipped (8 reference pipelines live in `packages/@eve/lifecycle/assets/pipelines/`); Track C still proposal-only.

## TL;DR

OpenWebUI's data model is **already** astonishingly close to Synap's: it has
`notes`, `calendar`, `channels`, `memories`, `knowledge`, `automations`,
`skills`, `tools`, `prompts` — every one of these maps almost 1:1 to a Synap
profile. The storage layer is uniformly clean (`XTable` class with CRUD
methods + module-level singleton + routers consume only the singleton API),
which makes pluggable storage tractable.

There are three tracks we can pursue, in increasing order of cost and
ambition:

- **Track A** — Discoverability & wiring inside OpenWebUI's existing
  extension points (Functions, Pipelines, HTTP API, branding). Zero
  upstream changes. Ships in days.
- **Track B** — Synap-aware Pipelines that mirror, sync, or augment data
  between OpenWebUI's local store and the Synap pod. Some already exist
  (memory injection, channel sync). More to add. No upstream changes.
- **Track C** — A small, generic upstream PR series introducing
  **pluggable storage backends** for one model at a time. Each PR is
  self-contained, additive, and benefits the entire OpenWebUI ecosystem.
  Ships per-PR over weeks.

We should not fork. Forks are graveyards. Track C lets users keep their
data in Synap while OpenWebUI stays in its own lane.

---

## What OpenWebUI actually has

Verified by reading
[github.com/open-webui/open-webui/tree/main/backend/open_webui/models](https://github.com/open-webui/open-webui/tree/main/backend/open_webui/models):

| File | What it is | Notes |
|---|---|---|
| `users.py`, `auths.py`, `groups.py`, `access_grants.py`, `oauth_sessions.py` | Identity + auth | OpenWebUI-owned. Don't touch. |
| `chats.py`, `messages.py`, `chat_messages.py`, `shared_chats.py` | Conversations | Messages are dense / hot path. Defer. |
| `notes.py` | Per-user notes | Title + JSON `data` + JSON `meta` + pinned flag. **Cleanest abstraction.** |
| `calendar.py` | Events with `rrule`, attendees, location | No external sync (Google/CalDAV). Standalone. |
| `automations.py` | Scheduled prompts (cron-style, `rrule + next_run_at + prompt + model_id`) | Simpler than Synap's automation graph — **not 1:1**. |
| `channels.py` | Group chat rooms with members, files, webhooks | Most complex — has multiple join tables. |
| `memories.py` | Plain-text long-term memory snippets | No embeddings in this layer; vectors live elsewhere. |
| `knowledge.py` | RAG knowledge bases as collections of file refs | Vector index lives in `utils/embeddings.py`, not here. |
| `tools.py` | Tool definitions | Already integrates with MCP via `utils/mcp/`. |
| `skills.py` | Skill definitions | Note: OpenWebUI also has "skills"! |
| `prompts.py`, `prompt_history.py` | Prompt library | Reusable prompts, similar to Synap notes. |
| `models.py` | Custom model presets (system prompt + base + tools) | Configuration, not user data. |
| `functions.py` | Python functions registered as filters/pipes | Code, not data. |
| `tags.py`, `folders.py` | Organization | Cross-cutting. |
| `files.py` | File blobs | Tied to OpenWebUI's filesystem. Last to migrate. |
| `feedbacks.py` | Thumbs up/down on responses | Telemetry. Probably stays local. |

**The pattern is uniform**:

```python
# notes.py (paraphrased)
class NoteTable:
    async def insert_new_note(self, user_id, form): ...
    async def get_notes_by_user_id(self, user_id, limit, offset): ...
    async def get_note_by_id(self, note_id): ...
    async def update_note_by_id(self, note_id, form): ...
    async def delete_note_by_id(self, note_id): ...

Notes = NoteTable()  # module-level singleton
```

Routers (e.g. `routers/notes.py`) only call `Notes.method(...)`. They never
touch SQLAlchemy directly. **This is the abstraction shape that makes
pluggable storage feasible.**

---

## Where Synap overlaps

| OpenWebUI model | Synap concept | Overlap quality |
|---|---|---|
| `notes` | `note` profile | **1:1** — title + content + tags |
| `calendar` | `event` profile | **1:1** — start/end/recurrence/attendees already in Synap profile |
| `channels` | Synap channels (`ai_thread`, `external_import`, etc.) | **1:1** — Synap has richer channel types; OpenWebUI's are a subset |
| `memories` | Knowledge facts in `memories` table + `entities` | **1:1** — text snippets per-user |
| `knowledge` | `bookmark` / `article` / `file` profiles + entity vectors | **Subset** — OpenWebUI's knowledge = collection of files; Synap's is broader |
| `automations` | Synap automation engine (`automations` + `automation_runs`) | **Partial** — OpenWebUI's are scheduled prompts, Synap's are full DAGs |
| `tools` | Synap tools (Hub Protocol) + OpenClaw MCP | **Partial** — different protocols, same goal |
| `skills` | Synap skills (`skills` table + skill files) | **1:1** — both are agent-invocable scripts |
| `prompts` | `note` profile with `kind=prompt`, or a custom profile | **1:1** with a reasonable extension |
| `tags`, `folders` | Synap entity tags + relations | **1:1** |
| `users`, `auths`, `groups` | Synap users + workspace_members | OpenWebUI has its own. Don't merge. |
| `chats`, `messages` | Synap channels + messages | **1:1** but very hot path |

**Bottom line**: every "second-brain-shaped" feature in OpenWebUI has a
direct Synap equivalent. Identity, auth, hot-path messages, and feedback
should stay local to OpenWebUI.

---

## Track A — Native discoverability (no upstream changes)

These ship in days, in our repo, no PR to OpenWebUI required.
A1, A2, A3 are **shipped** as filter pipelines (the welcome system prompt
approach turned out cleaner than the API-seeded chat originally proposed —
no admin race condition, no DB write, fires for every fresh conversation
not just the first install).

### A1. Welcome chat seeding (highest ROI) — **SHIPPED as `synap_welcome.py`**

After admin signup, our install script POSTs to OpenWebUI's HTTP API to
pre-create a pinned **"Welcome to Eve"** chat with markdown content
explaining what's wired:

```
👋 Welcome to Eve

You're chatting through Open WebUI but everything is wired to your
Synap pod underneath.

What's connected:
- 🧠 Memory: I auto-recall relevant entities from your pod
- 🔗 Channels: this chat will mirror to a Synap channel
- 🛠 Tools (via Pipelines):
    /scaffold <prompt>  → dispatches to Hermes (builder)
    /recall <query>     → search your pod
- 🦾 OpenClaw: agent loop with MCP servers (configure on the dashboard)

Try:
- "What did I write about X last week?"
- "/scaffold a Telegram bot that posts daily summaries"
- "Remember: Alice prefers async"

[Open Eve dashboard →]
```

**Implementation note**: Realized as a `filter` pipeline at priority -100
that detects `_is_first_turn()` (no prior assistant message + exactly one
user message) and prepends a system prompt describing the wired
integrations. Model's first reply naturally references the available
tools because the model itself was told about them. Power users override
the prompt via the `WELCOME_PROMPT` valve.

**Cost**: shipped.

### A2. Reply augmentation pipeline — **SHIPPED**

Extend `synap_memory_filter.py` to **append** a small footer to assistant
replies when memory was actually used:

> 💭 *Recalled 3 entities: Alice (Person), Q4 Roadmap (Project), Standup Notes (Note)*

This turns invisible magic into visible proof. Same for channel sync,
tool calls, etc.

**Implementation note**: Each context-injecting pipeline now stashes its
inject count keyed by `(user, chat)` in inlet, then pops it in outlet to
render an italic footer:
- `synap_memory_filter.py` → `💭 Recalled N memories from your Synap pod`
- `synap_channel_sync.py` → `🔗 Mirrored to Synap channel`
- `synap_knowledge_sync.py` → `📚 Recalled N facts from Synap knowledge`
- `synap_calendar_awareness.py` → `📅 Pulled N upcoming events from Synap`
- `synap_notes_sync.py` → `✓ Saved as Synap note: "<title>"`

Each pipeline carries a `SHOW_FOOTER` valve so power users can disable.

**Cost**: shipped.

### A3. `/eve` slash function — **SHIPPED as `synap_eve_help.py`**

Register a Function (Python, drops into `FUNCTIONS_DIR`) that surfaces a
curated overview when the user types `/eve` in chat. Similar to
GitHub Copilot's `/help`.

**Implementation note**: Built as a filter pipeline (priority -20) rather
than an OpenWebUI Function — Functions need MV3-style Tool registration
which the user has to enable per-conversation. Filter is automatic.
Pattern matches `/eve`, `/eve help`, `/eve features`, `/help`. Short-
circuits the model with `body["messages"] = [{role: "system",
content: HELP_MESSAGE}]` + `stream=false` + `max_tokens=16`. Help text
edits via the `HELP_MESSAGE` valve.

**Cost**: shipped.

### A4. Branding chrome — partial

- `WEBUI_NAME=Eve` (shipped — set in `OPENWEBUI_COMPOSE_YAML`)
- Custom logo + favicon mounted into `/app/backend/data/logo` (deferred —
  needs an Eve logo SVG and a volume mount in the compose YAML)
- Admin banner via OpenWebUI API on first install:
  *"Connected to your Synap pod • [open dashboard →]"* (deferred — admin
  banners need a one-time API call after admin user exists, which means
  watching the admin signup or letting the dashboard kick it off)

**Cost**: 0.5 day remaining.

---

## Track B — Pipelines as bidirectional bridge

All three shipped as standalone filter pipelines. Bidirectionality is
*one-way* in this iteration: data flows from chat into Synap and from
Synap into context, but we don't yet pull OpenWebUI's local stores
back into Synap or vice-versa. That requires Track C.

**Pipelines (dedup):** `synap_channel_sync.py` (v0.3.0+) now relies on
server-side dedup via `externalId`. The pipeline POSTs every chat to
`/api/hub/threads` with `externalSource=openwebui` and
`externalId=<owui_user>:<chat_id>`; the Hub Protocol upserts on the
partial unique index `channels_external_source_id_unique` and returns
`reused: true` when the thread already exists. The previous in-process
`_thread_cache` was removed — it reset on every container restart and
caused duplicate threads. Other sidecars that mirror conversations
(future Slack/Discord/etc.) should follow the same convention.

### B1. Knowledge sync pipeline — **SHIPPED as `synap_knowledge_sync.py`**

Pulls relevant key/value entries from `/api/hub/knowledge/search` and
injects them as a system block above the user's question. Knowledge
is *curated*, *namespaced*, *pinned* facts (project conventions, API
keys, "always reply in French") — distinct from memory's fuzzy recall.
Priority -5, sits above `synap_memory_filter` so pinned facts come
first. Renders `📚 Recalled N facts` footer.

Original spec called for file mirroring (OWUI Knowledge → Synap files);
we chose key/value sync instead because that's the lower-risk slice
and benefits any RAG flow. File mirroring lands in Track C as part
of pluggable storage.

### B2. Notes sync pipeline — **SHIPPED as `synap_notes_sync.py`**

Detects "save this as a note", "make a note", `/note <body>`, `/n`,
`/remember` intents in the user's message. When matched: creates a
note entity via `POST /api/hub/entities` with `profileSlug=note`,
preserves the original message in `properties.source.original`, hints
to the model with a synthesised system message ("the user just saved
a note, reply briefly to confirm") so the model's reply is an ack
rather than treating the message as a question. Renders `✓ Saved as
Synap note` footer.

Pattern is conservative on purpose — false positives clutter the pod.
Bidirectional sync (OWUI notes ↔ Synap notes) is Track C.

### B3. Calendar awareness pipeline — **SHIPPED as `synap_calendar_awareness.py`**

Trigger-gated (regex over canonical phrases like "what's on my
calendar today", "do I have anything Tuesday", "next call with…").
When triggered, pulls event entities (`profileSlug=event`) from the
pod, filters to those within `WINDOW_DAYS` (default 14), formats as a
system block. Trigger-gated to avoid spending tokens on calendar
context for every chat. Renders `📅 Pulled N upcoming events` footer.

Event-creation half ("remind me to call Alice Tuesday") is deferred
— wants a date parser + the right entity profile selection, more
careful than just matching a regex.

**Track B cost**: shipped. Bidirectional roundtrips deferred to Track C.

---

## Track C — Pluggable storage backends (upstream PR series)

This is the strategic play. Each PR is small, additive, and generic.

### Architecture

Introduce a `StorageBackend` abstract class (Python `Protocol` or `ABC`)
per model. The default implementation wraps the existing SQLAlchemy
code. Alternative implementations call HTTP endpoints.

```python
# proposed: backend/open_webui/models/_storage.py

from typing import Protocol

class NotesBackend(Protocol):
    async def insert_new_note(self, user_id: str, form: dict) -> Note: ...
    async def get_note_by_id(self, note_id: str) -> Note | None: ...
    async def get_notes_by_user_id(self, user_id: str, limit: int, offset: int) -> list[Note]: ...
    async def update_note_by_id(self, note_id: str, form: dict) -> Note | None: ...
    async def delete_note_by_id(self, note_id: str) -> bool: ...
    async def search_notes(self, user_id: str, query: str) -> list[Note]: ...
```

Selected via env:

```bash
# Default — current behavior, no migration needed
WEBUI_NOTES_BACKEND=sqlite

# External — calls user-provided HTTP endpoint
WEBUI_NOTES_BACKEND=external
WEBUI_NOTES_BACKEND_URL=http://synap-backend:4000/api/hub/openwebui/notes
WEBUI_NOTES_BACKEND_API_KEY=sk_xxx
```

The external implementation is a thin HTTP shim:

```python
# proposed: backend/open_webui/storage/external_notes.py

class ExternalNotesBackend:
    async def insert_new_note(self, user_id, form):
        r = await httpx.post(f"{self.url}/notes", json={"user_id": user_id, **form})
        return Note(**r.json())
    # ... etc
```

The Synap side implements the matching endpoints in Hub Protocol —
each is a thin shim mapping to `EntityRepository.create({profileSlug: 'note', ...})`.

### PR series (in proposed order)

| PR | Model | Why this order |
|---|---|---|
| **#1** | `notes` | Smallest, cleanest, no cross-model deps. Proof-of-concept. |
| **#2** | `memories` | Plain text, even simpler than notes. |
| **#3** | `prompts` + `prompt_history` | Same shape as notes; easy add-on once #1 lands. |
| **#4** | `calendar` | Standalone, has attendees join — good test of complex shapes. |
| **#5** | `knowledge` | More complex (KB ↔ file refs); already RAG-bound, valuable for sovereignty users. |
| **#6** | `channels` | Most complex — members, webhooks, files. Save for last. |
| **#7** | `automations` | Cleanest for users; OpenWebUI's automations are simpler than Synap's so the mapping needs care. |
| Skip | `users`, `auths`, `groups`, `access_grants`, `oauth_sessions` | Don't externalize identity. |
| Skip | `chats`, `messages`, `chat_messages` | Hot path; latency-sensitive. May revisit. |
| Skip | `tools`, `functions`, `models` | Configuration, not user data. |
| Skip | `files` | Blob storage is a separate problem (s3 etc.). |
| Skip | `feedbacks` | Telemetry stays local. |

### Why this is interesting upstream

The pitch to OpenWebUI's maintainers isn't "make Eve work better". It's:

1. **Sovereignty narrative** — users increasingly want one source of
   truth, not data fragmented across every app. A pluggable backend
   makes OpenWebUI **the chat UI** rather than another silo.
2. **Cloud / SaaS angle** — OpenWebUI Cloud could offer hosted backends
   (Postgres, Redis, S3, etc.) without changing user-facing behavior.
3. **Generic, not vendor-specific** — the interface is HTTP shaped
   like REST + JSON. Any backend (Synap, Notion, Obsidian, custom Postgres)
   can implement it. We don't ask them to merge any Synap code.
4. **Self-contained PRs** — each PR adds one model's pluggability;
   none rewrites existing behavior. Default path stays SQLite. Easy to
   review, easy to revert if a regression appears.

### Why it might get rejected (and what to do)

- **Maintainer scope concern**: "Pipelines and Tools are our integration story."
  - **Mitigation**: frame the PR as supporting *deployment patterns*, not *integrations*. SaaS hosters and sovereignty users both win.
- **Performance concern**: HTTP per-CRUD is slower than local SQL.
  - **Mitigation**: backend is opt-in. Default behavior unchanged.
  - Add request batching + caching at the HTTP layer if benchmarks show it matters.
- **Schema-coupling concern**: external backends might lag schema changes.
  - **Mitigation**: make the Protocol versioned (`X-OpenWebUI-Storage-API: 1`). Document a deprecation policy.
- **Worst case**: PR #1 is rejected. We learn the maintainer's appetite without burning much capital. We fall back to Track B (pipelines) which is already useful.

### Sequencing

1. **Open a discussion issue** on github.com/open-webui/open-webui titled
   *"RFC: pluggable storage backends per model"*. Explain the use case
   (self-hosted second brains, SaaS hosters), point at the model layer's
   already-clean abstraction, sketch the Notes Protocol. Get the
   maintainer's reaction **before** writing code.
2. If reception is positive, send PR #1 (Notes backend) as a single
   self-contained change.
3. Stagger remaining PRs based on community traction.

### What Synap needs to ship

For each model exposed via storage backend, we add a corresponding Hub
Protocol endpoint (or sub-router):

```
POST   /api/hub/openwebui/notes        → entities.create(profileSlug='note')
GET    /api/hub/openwebui/notes/:id    → entities.get
PUT    /api/hub/openwebui/notes/:id    → entities.update
DELETE /api/hub/openwebui/notes/:id    → entities.delete
GET    /api/hub/openwebui/notes/search → entities.search
```

Per-user scoping uses the existing Hub Protocol `getUserAccessibleWorkspaceIds`
helper. The OpenWebUI user_id maps 1:1 to a Synap user (linked via OAuth
or explicit pairing on first install).

---

## What we should ship first (recommended order)

1. **Track A1** (welcome chat seeding) — 1 day, biggest discoverability win
2. **Track A2** (reply augmentation footer) — 0.5 day, makes integrations *visible*
3. **Track A3** (/eve slash function) — 0.5 day
4. **Track A4** (branding) — 0.5 day
5. **Track B1** (knowledge sync pipeline) — 2 days, real utility
6. **Track C RFC** (open the upstream discussion) — 1 day to draft, then community-paced
7. **Track C PR #1** (Notes backend) — 1 week from green-light

We should NOT start Track C without first running Track A end-to-end on
a real install. Track A teaches us what users actually use OpenWebUI
*for*, which determines which Track C PR to prioritize.

---

## Open questions

1. **User mapping**: how does OpenWebUI's `user_id` map to Synap's user?
   - First-time admin signup creates a Synap user pairing
   - Subsequent OpenWebUI users authenticate against the same identity (OAuth from Synap?)
   - Or: keep them separate (every OpenWebUI user has *one* paired Synap workspace)
2. **Workspace scoping**: which Synap workspace receives an OpenWebUI note?
   - User's first workspace by default
   - Configurable per-user via OpenWebUI account settings
3. **Conflict resolution**: if a user creates a note both in OpenWebUI and Synap dashboard before sync, who wins?
   - Last-writer-wins (existing Synap pattern)
   - Or per-model conflict policy
4. **Auth between OpenWebUI and Synap**:
   - Bearer token in env (simplest)
   - Per-user OAuth (richer but more setup)

---

## What's new in hestia-cli (May 2026)

The synap-backend just shipped a batch of Hub Protocol capabilities; this
release surfaces them in hestia-cli without changing default behavior.

- **Pipeline source attribution.** `synap_notes_sync.py` (→ v0.2.0) and
  `synap_hermes_dispatch.py` (→ v0.3.0) now set top-level
  `source: "openwebui-pipeline"` on every entity they create. The pod's
  audit trail used to default to "intelligence" for these writes — now
  notes / tasks dispatched from chat are correctly credited to the
  pipeline surface. `synap_channel_sync.py` is unchanged: it calls
  `/threads` + `/messages`, neither of which take a `source` field.
- **Doctor Hub Protocol probe.** A new check in `eve-dashboard/lib/doctor.ts`
  hits `/api/hub/openapi.json` on the configured pod, parses the response,
  and asserts `openapi: 3.x`. Failure modes are distinguished: 401/403 vs
  404 vs network error vs non-JSON vs missing-openapi-field, each with a
  targeted fix hint. Tagged `integrationId: "synap"` so it can be filtered
  alongside the existing per-integration checklists.
- **OpenWebUI drawer capability surface.** The Open WebUI config panel now
  has a compact "Hub Protocol features" card surfacing Idempotency-Key,
  the OpenAPI spec link (machine-readable + Swagger UI on dev pods), the
  per-user sub-token feature with collapsible Mode 1 / Mode 2 explainer,
  and the live event stream URL. Pulls the pod URL from the existing
  `/api/secrets-summary` route — no new API.
- **Channels page multi-user explainer.** The Channels page got a small
  collapsible accordion explaining per-user sub-tokens for shared OWUI
  installs, linking back to the Open WebUI drawer for setup details. We
  deliberately did NOT add a toggle: turning sub-tokens on requires
  propagating `HUB_PROTOCOL_SUB_TOKENS=true` through the synap-backend
  container, which is a separate piece of work deferred until users
  actually ask for it.

Pipeline behavior with the new feature flags off (per-user tokens, etc.) is
byte-identical to the previous version — only the audit `source` field
changed for the two pipelines that POST entities.

## References

- OpenWebUI source: https://github.com/open-webui/open-webui
- Models directory: https://github.com/open-webui/open-webui/tree/main/backend/open_webui/models
- Pipelines docs: https://docs.openwebui.com/pipelines/
- MCP support: https://docs.openwebui.com/openapi-servers/mcp/
- Synap Hub Protocol: `synap-backend/packages/api/src/routers/hub-protocol-rest.ts`
- Eve dashboard memory: `~/.claude/projects/.../memory/eve-dashboard-2026-05.md`
