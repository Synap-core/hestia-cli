# Eve — completion plan

> Working document. Each item carries: **Symptom**, **Why it matters**, **Where it lives**, **What's actually happening**, **What needs to happen**, **Investigation needed**, **Size**. Mark items `[shipped: YYYY-MM-DD · <commit>]` as they land.
>
> Last refreshed: 2026-05-09. Reflects the state after Wave 1+2+3 of the centralised-state-of-Eve hardening pass (skills/knowledge/tools sync to OpenWebUI, channel credential validation, doctor coherence checks, blocking reconcile in `wireHermesIntoOpenwebui`).
>
> **Operator focus right now:** UI-side experience, not CLI. The team should not need to fill forms — workspaces in OpenWebUI should auto-populate from Synap + user data. Today they are empty for the user (only Ollama appears) even though the admin Connections panel shows the configured providers.

---

## 0. How to use this document

1. Pick an item by tag. **HERO** items are blocking the operator right now and should be cleared first.
2. Read **Where it lives** and **What's actually happening** before touching code.
3. If **Investigation needed** is non-empty, do that step first. Most items have a load-bearing unknown that, if skipped, will make the implementation wrong.
4. Bundle items only when their files don't overlap. Sites that touch `lifecycle/index.ts` or `wire-ai.ts` should be sequenced.
5. Update this doc when something ships. The ADR notes ("decisions worth not relearning") at the bottom should grow as we go.

---

## 1. **HERO** · OpenWebUI user-side surfacing is empty

### Symptom

The operator reports, verbatim:

> "I can see the OpenAPI connections inside OpenWUI admin settings, but I can't find it on the user content. Only Ollama seems to work, [it] does not show Hermes or the custom providers I added."

The latest update log includes:

```
✓ 🪈 Pipelines updated
  ↳ Container eve-openwebui-pipelines Running
  ↳ Installed 8 reference pipelines into /opt/openwebui-pipelines/pipelines
  ↳ ▶ Registering pipelines server in OpenWebUI…
  ↳ ▶ Registering model sources in OpenWebUI…
  ↳ Model source registration failed after retries — add manually: OpenWebUI Admin → Settings → OpenAI
```

Subsequent Hermes wiring still reports `Open WebUI wired to Synap IS + Hermes gateway` and `AI wiring reconciled ✓ (3 component(s))` — so the *env-file* path is working, but the *admin-API* path is not.

### Why it matters

This is the single largest blocker between "Eve installs and runs" and "Eve is a usable internal product". Every team member who logs into OpenWebUI sees an empty workspace — no Synap models, no skills as prompts, no knowledge collection, no Synap tool server. The admin sees Connections in the admin panel; everyone else sees only Ollama.

OpenWebUI splits configuration into two layers:

- **Env-driven** (`OPENAI_API_BASE_URLS`, `OPENAI_API_KEYS`) — populates `config.openai.api_base_urls` at boot. This is what the admin sees in Connections. It does **not** appear in the user-facing model dropdown by default.
- **Admin-API-driven persisted config** — the admin user uses `/api/v1/configs/`, `/api/v1/prompts/`, `/api/v1/knowledge/`, `tool_server.connections` to populate the *user-visible* surface. This is what Eve's `registerOpenwebuiAdminApi()` and (post-Wave 2) `syncOpenwebuiExtras()` are responsible for.

When admin reconcile fails, the admin layer surface (model dropdown, prompts, knowledge, tools) stays empty. That's exactly what the operator is seeing.

### Where it lives

- **`packages/@eve/dna/src/wire-ai.ts:779`** — `registerOpenwebuiAdminApi(modelSources, options)` is the single entry point that does:
  1. `waitForHealth()` — poll 12×5s = 60s budget for OWUI health
  2. `getAdminJwt()` — forge admin JWT (see `openwebui-admin.ts`)
  3. Pipelines registration (best-effort)
  4. `reconcileOpenwebuiManagedConfigViaAdmin()` — upsert model sources + managed config
- **`packages/@eve/dna/src/openwebui-admin.ts`** — `getAdminJwt()` does `docker exec` into the OWUI container to query the `auth` table for the admin user, reads `WEBUI_SECRET_KEY` from `/opt/openwebui/.env`, and forges an HS256 JWT.
- **`packages/@eve/dna/src/openwebui-bootstrap.ts`** — `ensureOpenWebuiBootstrapSecrets()` generates `adminEmail`/`adminPassword`/`adminName`. `writeOpenwebuiEnv()` writes them to `/opt/openwebui/.env`, preserving `WEBUI_SECRET_KEY` if present.
- **`packages/@eve/lifecycle/src/index.ts:1875`** — `registerPipelinesInOpenwebui()`. This is the call site that produces the operator's "failed after retries" log line.
- **`packages/@eve/dna/src/openwebui-extras.ts`** — `syncOpenwebuiExtras()` (Wave 2) — gates on `registerOpenwebuiAdminApi` returning `true`. If admin reconcile fails, none of the extras (skills/knowledge/tools) ever run.

### What's actually happening (hypotheses, ranked)

We do **not** know yet which step inside `registerOpenwebuiAdminApi` is returning false. The current message swallows the specific cause. The plausible failure modes, in order of probability:

1. **`waitForHealth()` times out.** OWUI takes longer than 60s to come fully online on the operator's host (Python boot + DB migrations + first-boot bootstrap when `ENABLE_PERSISTENT_CONFIG=true`). Particularly likely on a fresh post-update boot where SQLite migrations may run.
2. **`getAdminJwt()` returns null.** The admin row hasn't yet been written to OWUI's SQLite DB by its first-boot bootstrap. `WEBUI_ADMIN_EMAIL`/`PASSWORD`/`NAME` *should* trigger this on first boot, but on subsequent boots OWUI ignores them (the row already exists). If anything wiped the SQLite volume, the row is gone but env-driven recreation may be racy.
3. **`WEBUI_SECRET_KEY` drifted.** If the secret in `/opt/openwebui/.env` has been regenerated between the original install and now, the JWT we forge won't match the one OWUI's middleware verifies. `writeOpenwebuiEnv` preserves the key if present — but if the file was deleted/recreated outside Eve's control, a new key would be generated.
4. **Pipelines `OPENWEBUI_PIPELINES_API_KEY` missing or wrong.** Pipelines registration is silently skipped if the key is missing — but that produces a *different* log line ("No PIPELINES_API_KEY found"), so this is unlikely to be the operator's case.
5. **Network/timing edge.** The Pipelines section runs immediately after OWUI's section. Even though `Container hestia-openwebui Running` was logged, that's Docker reporting the container is up, not OWUI's HTTP server being ready.

### What needs to happen

#### A — Make the failure mode visible (do this first)

The current "failed after retries" message is uninformative. Operators have no way to know which of the four sub-steps failed. **Replace the boolean return with a structured outcome.**

```ts
// wire-ai.ts (proposed)
export type RegisterOutcome =
  | { ok: true }
  | { ok: false; stage: 'health' | 'jwt' | 'pipelines' | 'reconcile'; reason: string };

export async function registerOpenwebuiAdminApi(...): Promise<RegisterOutcome>
```

Update the three call sites to log the stage + reason. The cost is low and the debug payoff is enormous — every operator hit will produce a self-diagnosing log line.

#### B — Add a recovery command

Today an operator who hits the failure has only `eve update openwebui` to retry. Provide a focused retry:

```
eve openwebui sync       # alias: eve ai apply --extras-only
```

That command should: re-read secrets, run `registerOpenwebuiAdminApi` with extended health budget (180s), then `syncOpenwebuiExtras`. Surface the structured outcome from (A) directly.

#### C — Extend the health wait when called from a recovery command

Default 60s is fine for the inline update flow (we don't want `eve update` to hang). For `eve openwebui sync` and the fully blocking `wireHermesIntoOpenwebui` post-Hermes install, allow `waitForHealth({ budgetMs: 180000 })`.

#### D — Doctor: surface the same diagnosis

The W2.C `runStateCoherenceChecks` already probes OWUI for skills/knowledge/tools presence. Extend with one more check that *attempts* the same admin JWT acquisition the reconcile uses, so `eve doctor` can answer "would registration work right now?" before the operator runs `eve update`.

#### E — Fix the `wire-ai.ts:441` fire-and-forget asymmetry

See item **#5** for the full design. Until that lands, the OWUI-side admin upsert from the OWUI update flow itself is silently fire-and-forget — no operator feedback. The Pipelines flow's blocking call is the only one that surfaces.

### Investigation needed

Before implementing (A)–(D), gather data from the operator's actual environment. Don't assume which hypothesis is right. One short session that captures:

```bash
# 1. OWUI health right now
curl -sf http://localhost:3000/health   # or whatever port OWUI maps to

# 2. Is the admin row present?
docker exec hestia-openwebui sqlite3 /app/backend/data/webui.db \
  "SELECT id, email, role FROM auth LIMIT 5"

# 3. Is WEBUI_SECRET_KEY stable?
grep WEBUI_SECRET_KEY /opt/openwebui/.env
docker exec hestia-openwebui printenv WEBUI_SECRET_KEY

# 4. Forge a test JWT manually and try a list
node -e '
  const jwt = require("jsonwebtoken");
  const t = jwt.sign({ id: "<admin-user-id>", role: "admin" }, "<secret>");
  fetch("http://localhost:3000/api/v1/configs/", { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.status).then(console.log);
'

# 5. Check `eve doctor` output for the new state-coherence checks
eve doctor --no-color | grep -i -E "openwebui|admin|jwt"
```

The output of (1) and (2) alone narrows the hypothesis from 4 to 1.

### Size

- (A) structured outcome: **S** (~200 LOC + tests, 3 callsite updates)
- (B) recovery command: **S** (~150 LOC, one new command file)
- (C) extended health: **XS** (~10 LOC, plumb `budgetMs` option)
- (D) doctor enhancement: **XS** (~30 LOC in `doctor-state-coherence.ts`)
- (E) async cascade refactor: see item #5

Bundle (A)+(B)+(C)+(D) — about a half-day. (E) is independent and bigger.

---

## 2. **HERO** · Per-user OpenWebUI bootstrap from Synap

### Symptom (operator)

> "When I install or update Synap, the 'Eve' of the user, we should have on the workspace setting the models, the knowledge, the prompts, the skills, the tools already done. By the base of Synap data, and the data of the user when there is. For now, there is nothing."

> "I don't want to create forms."

### Why it matters

This is the "no SaaS dependency, no manual setup" promise. For a team using Synap as their data pod, the OpenWebUI experience should reflect their pod's state by default — every user lands in a pre-configured workspace, not an empty shell that requires admin setup per user.

Today there is exactly **one** OpenWebUI user provisioned: the admin. Other users either don't exist (signup disabled) or sign up fresh into an empty workspace. The admin-API-driven persisted config (when item #1 is fixed) populates the *system-wide* model sources, prompts, and knowledge — but those are global. Per-user state (default model, pinned prompts, attached knowledge collections, tool permissions) is not bootstrapped.

### Where it lives

- **OpenWebUI `users` table** in `/app/backend/data/webui.db` — managed by OWUI, not Eve
- **`packages/@eve/dna/src/openwebui-admin.ts`** — `getAdminJwt()` and the JWT-forging pattern can be adapted to query users
- **`packages/@eve/dna/src/openwebui-bootstrap.ts`** — only handles admin today; needs a sibling for per-user
- **Synap `users` table** in synap-backend — authoritative source of who exists
- **Synap Hub Protocol** `GET /api/hub/users` (verify endpoint exists; if not, this is the upstream gap)
- **`packages/@eve/dna/src/openwebui-extras.ts`** — current Wave 2 surface pushes are global; add per-user variants

### What's actually happening

Eve provisions the OWUI admin on first install via `WEBUI_ADMIN_EMAIL`/`PASSWORD`/`NAME` env vars at OWUI bootstrap time. After that, OWUI is on its own — `ENABLE_SIGNUP` controls whether new users can register, `DEFAULT_USER_ROLE` controls what role they land with. Eve has no concept of "Synap user X has an OWUI account."

If a Synap user signs up via the dashboard or via Synap's own auth flow, Eve does not propagate them to OWUI. So in OWUI they don't exist; if they sign up directly to OWUI, they're a fresh user with no Synap context.

### What needs to happen

#### A — Synap → OWUI user sync helper

New file `packages/@eve/dna/src/openwebui-users-sync.ts`. Mirrors Synap users into OWUI:

```ts
export async function syncSynapUsersToOpenwebui(
  cwd: string, hubBaseUrl: string, secrets: EveSecrets,
): Promise<{ created: number; updated: number; skipped: Array<{ userId: string; reason: string }> }>
```

For each Synap user (queried from Hub Protocol):
1. Look up by email in OWUI's `users` table (via admin API `GET /api/v1/users/`)
2. If missing → `POST /api/v1/auths/add` with email, name, role (mapped from Synap role)
3. If present → no-op (don't touch passwords)
4. Tag the user with metadata `{ synap_user_id, synced_at }` if OWUI's user model allows it

#### B — Per-user defaults helper

For each synced/existing user, push their per-user defaults via OWUI admin API:

- **Default model** — from Synap's `ai.serviceModels.openwebui` or per-workspace setting
- **Pinned prompts** — the three system skills (`synap`, `synap-schema`, `synap-ui`) auto-pinned for new users
- **Attached knowledge collections** — Synap Knowledge collection auto-attached to default models
- **Tool server access** — Synap Hub Protocol tool server allowed for the user's role

OWUI exposes `/api/v1/users/{id}/settings/update` (verify exact path). Build a normalised "Eve-managed defaults" payload, idempotent on user id.

#### C — Workspace template

Synap has the concept of workspaces. OWUI's notion of "workspace" is shallower (it has groups + per-model permissions). Map Synap workspace memberships → OWUI user groups, propagate per-workspace tools/knowledge → group-level permissions in OWUI.

This is the deepest structural piece. It needs a design pass before implementation — Synap workspace and OWUI groups have different shapes.

#### D — Wire into `eve update` flow

After `syncOpenwebuiExtras()` succeeds in `lifecycle/index.ts`, run:

```ts
await syncSynapUsersToOpenwebui(cwd, hubBaseUrl, secrets);
await applyPerUserDefaults(cwd, hubBaseUrl, secrets);
```

Both are best-effort with structured outcomes (see item #1's pattern).

#### E — Surface in dashboard

Eve Dashboard adds a "OpenWebUI users" panel showing: synced users, last sync time, drift between Synap and OWUI. One-click "re-sync all users" button.

### Investigation needed

1. **Does Synap have `GET /api/hub/users`?** Check `synap-backend/packages/api/src/routers/hub-protocol/rest/users.ts`. If it exists, what's the shape? If not, that's a Synap-side ticket before this work can start.
2. **OWUI per-user settings API.** Confirm endpoints exist for: list users, add user without password (or with auto-generated), update user settings, set per-user default model, set per-user pinned prompts. Search OWUI source `backend/apps/webui/routers/users.py`.
3. **OWUI group/permissions model.** OWUI v0.5+ added per-model RBAC and groups. Confirm the API and whether it can be driven from admin endpoints.

### Size

- (A) user sync helper: **M** (~400 LOC + tests)
- (B) per-user defaults: **M** (~300 LOC + tests, depends on (A))
- (C) workspace → group mapping: **L** (design pass + ~600 LOC + tests)
- (D) lifecycle wiring: **S**
- (E) dashboard panel: **M** (~400 LOC React + API route)

---

## 3. **HERO** · UI access to "Synap directly"

### Symptom (operator)

> "From the UX, I don't know how I can access RMS [Synap] directly."

The operator has Synap data, but inside OpenWebUI there's no obvious way to browse it, query it, or pin it. The Synap pod is a backend; the user-facing access is via the Eve Dashboard or via OWUI's chat interface (which just calls Synap as an LLM gateway).

### Why it matters

If users have to leave OWUI to access their own data, OWUI is just an LLM chat client and Synap is a hidden dependency. The promise of "your data is yours, unified across surfaces" requires a clear in-UI path from any conversation to "show me my Synap entities/notes/tasks/people."

### Where it lives

This is partially a frontend gap and partially an integration gap.

- **Eve Dashboard** (`packages/eve-dashboard/`) — has an admin surface but no obvious entry point to Synap data browsing
- **OpenWebUI chat surface** — has the Synap tool server (post Wave 1.E), so the LLM can query Synap, but the user can't directly browse
- **Synap pod's own UI** (e.g., `synap-app/`) — the canonical Synap browsing UI, but it's separate

### What's actually happening

Three surfaces live in parallel today:

1. **OpenWebUI** at `team.thearchitech.xyz` — chat UI, no Synap browsing
2. **Eve Dashboard** at the Eve domain — operator/admin functions
3. **Synap pod's own UI** (browser app at the same domain via different routes, or a separate app) — full Synap data browsing

A user has to know which surface to go to for what. The "RMS direct access" the operator describes is Synap data browsing inside the LLM workflow — i.e., either:

(a) An OpenWebUI page/sidebar that browses Synap entities, OR
(b) A dashboard widget that lets you switch between Synap data and OWUI chat in one tab, OR
(c) A unified Synap-app where the OWUI iframe is one panel.

### What needs to happen

This is more product than implementation. The deliverables are:

#### A — Decide the surface canon

Pick the surface that "owns" Synap data browsing. Three honest options:

- **Synap-app primary, OWUI iframe inside** — Synap's app is the workspace shell; OWUI is one panel. Pro: Synap is the source of truth, the experience matches the data model. Con: OWUI is iframed, loses some keyboard/UX polish.
- **OWUI primary, Synap browser as a sidebar plugin** — OWUI's pipelines or sidebar extension surfaces Synap data inline. Pro: matches user mental model ("I'm in chat"). Con: Synap features always second-class, OWUI plugin model is constraining.
- **Eve Dashboard primary, OWUI + Synap as panels** — Dashboard becomes the unified shell. Pro: Eve owns the operator + user experience. Con: heaviest implementation.

#### B — Add a "Synap" link on every OWUI page

Regardless of (A), the cheapest immediate win: add a sidebar entry in OWUI that links to the Synap UI (deep-linked to user's workspace). This can be done via OWUI's custom-URL support or by a small pipeline that injects a navigation prompt.

#### C — Inline "show in Synap" actions

When the LLM calls a Synap tool (`synap_entity_get`, `synap_search`, etc.), the response should include a `_synap_ref` field with a deep link the user can click in OWUI to open that entity in Synap-app. This requires:

1. Synap Hub Protocol responses to include canonical URLs (verify in `_codecs/`)
2. OWUI rendering to surface those URLs as clickable links in the chat (LLMs do this by default, but the citation pattern needs to be reliable)

### Investigation needed

1. **Is Synap-app shipped today?** Check `packages/eve-dashboard/` and `synap-app/` (separate repo) for the current state. The dashboard is the operator panel; Synap-app may be the user surface but it's possibly not deployed in the typical Eve install.
2. **OWUI sidebar customisation.** Does OWUI allow custom sidebar entries via admin config? `WEBUI_NAME` / external nav links?
3. **Hub Protocol response shape.** Confirm whether responses already include canonical URLs.

### Size

- (A) surface canon: **decision** (no code), then likely **L** for whichever path is chosen
- (B) sidebar link: **S** (~100 LOC, one admin API call)
- (C) inline actions: **M** (~300 LOC across Synap-side response shape + OWUI-side rendering)

---

## 4. Eve Dashboard parity with OpenWebUI

### Symptom

When the operator updates AI providers, channels, or skills via Eve Dashboard, the OpenWebUI surface should update in lockstep. Today the dashboard ↔ OWUI contract has 5 invariants (storage shape, routing semantics, required-creds map, reconcile cascade, WhatsApp ownership) — these are documented but not visualised.

The dashboard does not show: which OWUI prompts exist, which knowledge collections, which tool servers, which users. The operator has to log into OWUI admin to see what state actually got pushed.

### Why it matters

When the operator's complaint is "I don't see anything in OWUI", the dashboard should be able to answer "here's what Eve has pushed; here's what OWUI confirms is present; here's the drift if any." Without that loop, every "why isn't this working" is a SSH-and-grep session.

### Where it lives

- **`packages/eve-dashboard/app/api/openwebui/`** — does not exist yet; should mirror `app/api/channels/` shape
- **`packages/eve-dashboard/app/(os)/settings/`** — has AI settings page; needs a parallel "OpenWebUI sync state" view

### What's actually happening

The dashboard is informed about secrets writes and triggers reconciles. It does NOT read back from OWUI's admin API to confirm pushes succeeded. Every OWUI-side state observation requires manually logging in.

### What needs to happen

#### A — Mirror the W2.C doctor coherence checks in the dashboard

Use `runStateCoherenceChecks(secrets, { probeRemote: true })` from a dashboard API route, render the results as a panel: each surface as a row with status, last-checked time, fix link.

#### B — Add a "Force re-sync" button per surface

Each row gets a button that calls the appropriate sync helper (`pushSynapSkillsToOpenwebuiPrompts`, `syncSynapKnowledgeToOpenwebui`, `registerSynapAsOpenwebuiToolServer`). Reports the result inline.

#### C — Add the user/workspace bootstrap state once item #2 lands

Same pattern: list of synced users, drift indicator, force-resync.

### Size

- (A) coherence panel: **S** (~150 LOC API route + ~300 LOC React)
- (B) re-sync buttons: **S** (~100 LOC per surface)
- (C) user/workspace panel: **M** (depends on item #2)

---

## 5. Async cascade refactor of `wireOpenwebui`

### Symptom

The `wire-ai.ts:441` admin upsert is `void (async () => {...})()` — fire-and-forget. Errors are silently swallowed. The operator sees "Open WebUI wired to Synap IS + Hermes gateway" (from the env-file step) but has no signal whether the admin reconcile actually succeeded.

After Wave 3.B, two of the three call sites (`wireHermesIntoOpenwebui` at `lifecycle/index.ts:1224`, `registerPipelinesInOpenwebui` at `lifecycle/index.ts:1875`) await the result and surface it. The third stays fire-and-forget because its parent function is sync.

### Why it matters

Asymmetric semantics confuse operators. "Why does my `eve update hermes` tell me admin reconcile failed but `eve update openwebui` doesn't?" The honest answer is "the second one runs in a sync context that can't await the async work." That's not a satisfying explanation, and worse, it means a class of failures is invisible from one path.

### Where it lives

- **`packages/@eve/dna/src/wire-ai.ts:310`** — `wireOpenwebui(secrets): WireAiResult` (sync)
- **`packages/@eve/dna/src/wire-ai.ts:642`** — `wireComponentAi(componentId, secrets): WireAiResult` (sync, calls `wireOpenwebui`)
- **`packages/@eve/dna/src/wire-ai.ts:670`** — `wireAllInstalledComponents(secrets, components): WireAiResult[]` (sync, iterates)
- **`packages/@eve/dna/src/reconcile.ts`** — `reconcile()` calls `wireAllInstalledComponents` from many sync contexts
- **`packages/eve-dashboard/app/api/ai/route.ts`** — PATCH `/api/ai` calls these helpers

### What's actually happening

The whole wire-* chain returns sync `WireAiResult` objects. The OWUI-specific async work (admin API upsert, extras sync) was bolted on as a `void (async () => {...})()` block to avoid changing return types. Result: those blocks succeed or fail invisibly.

### What needs to happen

#### A — Make `wireOpenwebui` async

```ts
async function wireOpenwebui(secrets): Promise<WireAiResult>
```

The result type stays the same; await within the function. The fire-and-forget block becomes inline `await`.

#### B — Cascade async through wireComponentAi and wireAllInstalledComponents

```ts
async function wireComponentAi(componentId, secrets): Promise<WireAiResult>
async function wireAllInstalledComponents(secrets, components): Promise<WireAiResult[]>
```

#### C — Update all callers

Find all `wireComponentAi(...)` and `wireAllInstalledComponents(...)` callers; await them. Most are already in async contexts (lifecycle generators, dashboard API routes). The few sync ones need to be made async.

#### D — Preserve "non-fatal" semantics

The current fire-and-forget block exists because the operator was OK with silent failure of the admin API. After this refactor, errors will propagate. Wrap the admin API call in a try/catch that converts to a `WireAiResult` warning, so existing error semantics persist while gaining visibility.

### Investigation needed

1. **Caller graph.** Run `grep -rn "wireComponentAi\|wireAllInstalledComponents" packages/` and audit each caller for async-readiness.
2. **`reconcile.ts` shape.** Some reconcile entry points may be called from synchronous code (e.g., a settings setter); these need a small refactor or a parallel async variant.

### Size

- **M** (~half-day, ~400 LOC across 6-8 files, mostly mechanical async-ifying)

---

## 6. Bare-metal install — `eve birth`

### Symptom

`eve birth` is a "coming soon" stub. The North Star promised:

- USB autoinstall via Ventoy + Ubuntu autoinstall
- Ansible script alternative
- SAFE-by-default disk handling (interactive selection)
- WIPE option for unattended (serial-matched)

None of this exists.

### Why it matters

Without bare-metal install, "self-hosted product" still means "Linux operator." The team has to procure a server, install Ubuntu manually, harden it, then run Eve. That's two days of work for the first install. The North Star is "insert disk, get a sovereign pod by lunch."

### Where it lives

- **`packages/eve-cli/src/commands/birth.ts`** — current stub
- New: **`packages/@eve/birth/`** — sub-package for install scripts, disk-safety logic, USB image builder

### What's actually happening

The command is registered but its action is `console.log("eve birth — coming soon")` or similar. No image builder, no disk logic, no Ansible.

### What needs to happen

#### A — Ansible script first (faster delivery)

A rerunnable Ansible playbook that:

1. Checks Ubuntu version (24.04 LTS minimum)
2. Hardens SSH (disable root login, key-only auth)
3. Configures UFW (allow 22/80/443; deny everything else)
4. Installs Docker + Compose
5. Pulls Eve binary from a release URL
6. Runs `eve install --profile full` non-interactively
7. Captures full audit log to `/var/log/eve-install.log`

Ship this as `eve birth --target ansible <host>` which generates the playbook from current secrets and runs it via SSH.

#### B — USB image builder (next)

Ventoy-based image with Ubuntu autoinstall:

1. SAFE template — interactive disk selection at boot, asks operator before wiping
2. WIPE template — unattended, requires `--match-serial <s/n>` to ensure right disk
3. Both run the Ansible from (A) at first boot

Image builder is `eve birth build-image --template safe|wipe --output <path.iso>`.

### Investigation needed

1. **Existing tooling.** Is there a Coolify-style installer Eve can lean on? `coolify install` is referenced elsewhere — verify whether it's a usable subset.
2. **First-boot bootstrap.** What goes in `meta-data` / `user-data` for Ubuntu autoinstall? Standard but needs nailing down for SAFE vs WIPE.
3. **Disk safety story.** SAFE prompts; WIPE matches serial. Both need a clear "are you sure" prompt and a logged-confirmation file.

### Size

- (A) Ansible: **M** (~600 LOC playbook + ~200 LOC TypeScript wrapper + tests against a Vagrant target)
- (B) USB image: **L** (Ventoy build automation, autoinstall config, image hosting)

---

## 7. WhatsApp Cloud API CLI path

### Symptom

`eve arms messaging configure whatsapp` prints "use the Agents browser app for onboarding" and exits. There is no CLI path even for operators who use Meta's Cloud API (the official WhatsApp Business API, no QR-scan).

### Why it matters

WhatsApp is the most-used messaging platform for many teams. Forcing operators to leave the CLI to onboard it makes the CLI feel incomplete. Cloud API users have nothing requiring a browser — just a phoneNumberId, accessToken, and verifyToken. These are typed credentials, identical in shape to Telegram or Slack.

### Where it lives

- **`packages/@eve/dna/src/secrets-contract.ts:233-239`** — schema already supports `whatsapp.{phoneNumberId, accessToken, verifyToken}`
- **`packages/@eve/dna/src/channel-credentials.ts`** — `ChannelCredentialInput` discriminated union excludes whatsapp
- **`packages/@eve/dna/src/channel-validation.ts`** — currently no whatsapp branch
- **`packages/@eve/arms/src/commands/messaging.ts`** — the WhatsApp branch in `buildInput()` throws; the configure action prints the browser-app message

### What's actually happening

The CLI explicitly rejects WhatsApp because the historical pattern (Baileys QR-scan in the Agents browser app) requires the browser. Cloud API doesn't need a browser, but the CLI doesn't distinguish.

### What needs to happen

#### A — Extend the discriminated union

```ts
| { platform: 'whatsapp'; phoneNumberId: string; accessToken: string; verifyToken?: string }
```

#### B — Implement validation

Probe Meta's Graph API: `GET https://graph.facebook.com/v18.0/{phoneNumberId}` with `Authorization: Bearer {accessToken}`. 200 = valid; 401 = bad token; other = report.

#### C — Wire into messaging configure

Replace the WhatsApp early-return with a flag-driven branch:

```bash
eve arms messaging configure whatsapp \
  --phone-number-id 1234567890 \
  --access-token EAAB... \
  --verify-token <yourstring>
```

The Baileys QR-scan path remains via the Agents browser app — but no longer the only option.

#### D — Keep the browser stub for QR-scan users

If no flags are passed, still print the browser-app message. The CLI flow now branches on "did you give me Cloud API creds, or do you want browser-onboarded session?"

### Size

- **S** (~200 LOC + ~80 LOC tests, all in files Wave 1.B already owns)

---

## 8. Pod-side webhook receivers as alternative to Hermes long-polling

### Symptom

Hermes ingresses messaging via long-polling for Telegram, Discord gateway, Matrix sync, Slack RTM. There is no audit trail of inbound messages at the pod layer. If Hermes restarts, in-flight messages may be dropped depending on the platform's delivery semantics.

### Why it matters

For a single-team self-hosted deployment, long-polling is fine. For:

- Audit/compliance (regulated teams who need a trail of inbound messages)
- Multi-region (sharding ingest across pods)
- Replay (debugging "why didn't Hermes respond to that?")
- Graceful Hermes upgrades without dropping messages

…webhook ingress is materially better. Synap's pod has the right primitives (Hub Protocol REST, automations w/ webhook trigger type), but the receivers don't exist.

### Where it lives

- **synap-backend**, new file `packages/api/src/routers/hub-protocol/rest/channel-webhooks.ts`
- Each platform needs its own endpoint with its own verification:
  - Telegram: `POST /api/hub/channels/webhook/telegram` with the `webhookSecret` in path or header
  - Discord: `POST /api/hub/channels/webhook/discord` with Ed25519 signature verification
  - Slack: `POST /api/hub/channels/webhook/slack` with HMAC-SHA256 signing-secret verification

### What's actually happening

These endpoints don't exist. The schema fields (`webhookSecret`, `signingSecret`, `verifyToken`) are stored but unused.

### What needs to happen

#### A — Backend endpoints

Implement the three endpoints with proper verification. Each:

1. Verifies the platform-specific signature against the configured secret
2. Persists the inbound message as a Synap event (channel system V2)
3. Returns 200 immediately (don't block the platform's retry)
4. Triggers Hermes via Hub Protocol event (channel routing already lives in `channelRouting`)

#### B — Eve-side webhook URL registration

When `eve arms messaging configure telegram --webhook` (a new flag), call Telegram's `setWebhook` API with `https://<podPublicUrl>/api/hub/channels/webhook/telegram?token=<webhookSecret>`. Same idea for Discord (interactions endpoint URL set via PUT `applications/{app_id}` — though this requires Discord's manual verification step).

#### C — Routing toggle

`channelRouting.<platform>` already supports `'hermes'` (long-poll) vs `'openclaw'` (legacy). Add `'pod-webhook'` as a third option. Operator picks. Default stays `'hermes'` for backwards compat.

### Investigation needed

1. **Synap channel system V2.** Confirm the event shape for inbound messages and whether `channels.routing` already supports webhook semantics.
2. **Discord verification.** Their interactions endpoint requires a verification roundtrip when first set; figure out the UX.
3. **Public URL discovery.** Pod must have a stable public URL to give to platforms. Already managed by Traefik + domain config.

### Size

- (A) backend endpoints: **M-L** (~800 LOC across three platforms + signature verifiers + tests)
- (B) Eve-side registration: **S**
- (C) routing toggle: **XS**

---

## 9. Skills hot-reload

### Symptom

Hermes reads `~/.eve/skills/{synap,synap-schema,synap-ui}/SKILL.md` once at container startup via `EVE_SKILLS_DIR`. Updating a skill in Synap requires:

```bash
eve update hermes   # rebuilds env, restarts container
```

OpenClaw needs `synap skills install synap` run manually inside its container.

### Why it matters

Skills are the "documentation that LLMs read." Iterating on prompts/tool descriptions should be near-instant, not "restart a container." This is the difference between Eve feeling alive and Eve feeling like a deployment artifact.

### Where it lives

- **`packages/@eve/dna/src/builder-hub-wiring.ts:41-102`** — `ensureEveSkillsLayout()` writes skills to disk
- **Hermes daemon** (external project, in `nousresearch/hermes-agent` Docker image) — reads them at startup
- **OpenClaw** (separate service) — installs them via its CLI

### What's actually happening

The skills directory is bind-mounted read-only into Hermes (`-v ${skillsDir}:/opt/data/skills:ro`). Hermes loads them once. No file-watcher in Hermes; no reload signal.

### What needs to happen

#### A — Hermes reload signal

Investigate whether Hermes exposes a `/reload` admin endpoint or accepts a SIGHUP. If yes, add `eve hermes reload`. If no, file an upstream issue with Nous Research; in the meantime, do the workaround.

#### B — Inotify watcher (workaround if A is blocked)

Eve runs an inotify watcher on `~/.eve/skills/`; on change, calls a Hermes reload endpoint OR (worst case) does `docker kill -s SIGHUP eve-builder-hermes` to make Hermes' config-watch logic pick up the change.

#### C — OpenClaw auto-install

Eve update flow runs `docker exec openclaw openclaw skills install synap` after every successful skills regeneration.

### Investigation needed

1. **Hermes upstream.** Does `nousresearch/hermes-agent` v2 expose a reload endpoint? Read its config.yaml schema and admin API.
2. **OpenClaw.** Does its CLI `skills install` accept idempotent re-runs?

### Size

- (A) reload: **S** if endpoint exists; **M** if upstream needs work
- (B) inotify: **S** (~150 LOC)
- (C) OpenClaw: **XS**

---

## 10. Voice — `eve arms voice`

### Symptom

The subcommand is registered but its action is unimplemented. Voice memo capture pipeline doesn't exist.

### Why it matters

Voice notes are a primary capture surface for many users. The North Star calls for capture from "any chat app you already use" — voice memos are core to that promise on WhatsApp, Telegram, etc.

### Where it lives

- **`packages/@eve/arms/src/commands/voice.ts`** — current stub
- New: voice transcription pipeline (Whisper-based) wired into channel ingress

### What's actually happening

Voice memos sent in any messaging platform reach Hermes as audio file references. Hermes does not currently transcribe them.

### What needs to happen

#### A — Decide transcription engine

Whisper-large-v3 self-hosted (Ollama-style) vs API call out (OpenAI Whisper, Replicate). Self-hosted preferred for sovereignty, but Whisper-large is heavy.

#### B — Pipeline

Voice file → transcription → Synap memory entry (with both audio reference and transcript text) → optional summary → channel acknowledgement.

#### C — `eve arms voice` configures the pipeline

Choose engine, configure model size, opt-in per-channel.

### Size

- **M-L** depending on whether self-hosted Whisper is in scope

---

## 11. Intent event triggers

### Symptom

Background tasks (`eve intent record/list/update/pause/remove`) support cron-style triggers but the event-driven trigger plumbing has a TODO in code.

### Why it matters

The proactive-intelligence promise ("the morning briefing", "the weekly digest", "alert me when X happens") needs event triggers. Cron is half the story.

### Where it lives

- **`packages/@eve/builder/src/lib/intent-poll.ts`** (or similar) — TODO blocks
- **synap-backend** — Hub Protocol events / event chain (per memory: "P1-P4 done, IS query_recent_events tool remaining")

### What needs to happen

#### A — Event subscription

The Hermes daemon (or a sibling process) subscribes to Synap's event stream (already exists per the dual-pod-sync work). For each event matching an intent's filter, fires the intent's action.

#### B — Filter syntax

Define a small DSL for intent event filters: `event.type=entity.created AND event.profile=person`. Parse and match server-side or client-side.

#### C — Reliability

At-least-once delivery semantics. Ack offsets persisted.

### Size

- **M** (~500 LOC in builder + ~200 LOC in synap-backend if event-tool isn't ready)

---

## 12. Phase 7 verification + CI gates

### Symptom

Code quality gates from the original 8-phase plan:

- Zero `any` types
- No circular deps
- No `execSync` in `@eve/builder/src/lib/` (task path)
- `~/.local/share/hestia` → `~/.eve` state migration correct

…are believed to hold today, but no CI enforces them. New code can drift.

### Why it matters

Without enforcement, every refactor or contributor risks reintroducing problems we already solved. The cost of CI gates is low; the cost of regression is high.

### Where it lives

- **`.github/workflows/eve-cli.yml`** — exists, runs `pnpm test` and `pnpm run check:manifest`
- New: a `pnpm run check:quality` job that runs the gates

### What needs to happen

#### A — `tsc --strict --noUnusedParameters --noUnusedLocals` everywhere

Already enforced in some packages; verify all.

#### B — `eslint-plugin-import/no-cycle`

Add to root ESLint config; fail CI on circular deps.

#### C — Custom rule: ban `execSync` in specific paths

Use ESLint or a small TypeScript AST script to fail CI if `execSync` appears in `packages/@eve/builder/src/lib/{task-*,coder-*}.ts`.

#### D — State migration assertion

A test that simulates a `~/.local/share/hestia/state.json` and verifies it's migrated correctly to `~/.eve/state.json` on first boot.

### Size

- **S** (~half-day across all four)

---

## 13. End-to-end smoke test

### Symptom

There's no test that exercises the full chain:

```
install → configure Telegram → send message →
arrives in Synap (knowledge) → Hermes responds →
response visible in OpenWebUI chat
```

Most regressions in this chain are silent until an operator notices.

### Why it matters

Without an E2E test, every change to any layer (channel persistence, reconcile, OWUI sync, Hermes config, Hub Protocol) can break the chain without flagging. The team product hinges on this chain working.

### Where it lives

New: `packages/eve-cli/test/e2e/` directory, vitest + tmp Docker stack.

### What needs to happen

#### A — Self-contained E2E harness

A script that:

1. Spins up a fresh Docker stack (Synap + OWUI + Hermes + Pipelines + Ollama) on a temporary network
2. Runs `eve install --profile full` against it
3. Configures a mock Telegram bot (use a local stub HTTP server posing as `api.telegram.org`)
4. Sends a fake message
5. Asserts:
   - Synap has the inbound message stored
   - Hermes spawned a reply task
   - OWUI's user-side dropdown shows the configured providers
   - OWUI Prompts contains the three Synap skills
   - OWUI Knowledge collection exists
   - OWUI tool_server connections includes Synap Hub
6. Tears down

#### B — Mock services

Telegram, Discord, Slack mocks that record what Eve sent (`setWebhook`, getMe, etc.) and reply per fixtures. Reusable across CI and local dev.

#### C — Run on every PR

Add to CI; gate merges on it.

### Size

- **L** (~3 days of focused work + ongoing maintenance). Highest leverage of the remaining items — this single test would have caught the W2.A wire-ai.ts integration if any of it had broken.

---

## 14. Operator runbook + ADRs

### Symptom

The work this session captured 5 invariants in `eve-headless-config-plan-2026-05.md`:

1. Storage shape (channels)
2. Routing semantics (default to hermes)
3. Required-creds map symmetry between dashboard and CLI
4. Reconcile cascade (writeEveSecrets → reconcile → wire*)
5. WhatsApp ownership (browser-only Baileys QR-scan)

Plus structural rules from CLAUDE.md and various memory entries. Future contributors will reinvent these unless they're captured as ADRs.

### Why it matters

Decisions worth not relearning. Time to discovery for "why does Eve do X this way" should be a doc lookup, not a `git log` archaeology session.

### Where it lives

- **`hestia-cli/docs/adr/`** — new directory
- **`hestia-cli/docs/operator-runbook.md`** — new

### What needs to happen

#### A — ADR set (~10 files)

One per major decision:

1. ADR-001: secrets.json as single source of truth
2. ADR-002: agentType and intelligenceServiceId are orthogonal
3. ADR-003: Synap-exclusive memory for Hermes
4. ADR-004: Loopback transport for on-host CLI (not docker exec)
5. ADR-005: Reconcile cascade pattern
6. ADR-006: OpenWebUI two-layer config (env + admin API)
7. ADR-007: Hermes long-polling vs pod-side webhooks
8. ADR-008: WhatsApp browser-only (Baileys) for QR; Cloud API CLI-only
9. ADR-009: Per-agent Hub keys vs shared synap.apiKey legacy
10. ADR-010: Five-organ structure

#### B — Operator runbook

Single markdown file covering: install flow, common errors and recovery commands, doctor check interpretation, where logs live, how to reset to a known-good state.

### Size

- (A) ADRs: **M** (one afternoon to draft all)
- (B) runbook: **S**

---

## 15. Polish items

These are small but shouldn't be lost:

- **Empty knowledge collection** — `syncSynapKnowledgeToOpenwebui` creates a collection even when the namespace has zero entries. Add a "skip create when empty" branch. **XS**
- **`ai.fallbackProvider` is unused** — schema has it but no consumer. Either implement (per-component fallback when primary is unreachable) or delete. **S**
- **`secrets.inference.gatewayUrl/User/Pass`** — verified in use (`@eve/legs/inference-gateway.ts` writes them, `arms install` + `builder/openclaude` + `setup` read them). **No action.**
- **OWUI reconcile internal retries** — currently 12×5s = 60s. For `eve openwebui sync` (recovery command per item #1), allow override to 36×5s = 180s. **XS**
- **`channelRouting` UI affordance** — when not set, defaults to `'hermes'` silently. Dashboard channels panel should show the effective default explicitly. **XS**
- **Update log readability** — the operator's update log is dense and mixes successful steps with the one critical failure. Group by component, summarise critical failures at the top. **S**

---

## 16. What I need from you (decisions blocking progress)

Before I (or the next agent) starts any of items #2, #3, or #6, you need to land:

### A — For item #2 (per-user OWUI bootstrap)

> Should Synap workspace memberships map to OWUI user groups, or is OWUI single-flat for now?

The answer changes whether item #2's part (C) is in or out of scope.

### B — For item #3 (UI access to Synap directly)

> Which surface is canon — Synap-app, OpenWebUI, or Eve Dashboard?

The question is product, not technical. None of #3's implementation can start until you've picked.

### C — For item #6 (bare-metal install)

> Ansible script first, USB image later — confirm priority. Or both at once?

### D — For item #11 (intent event triggers)

> Cron triggers are fine for now — or is event-driven a hard requirement for the team-product launch?

---

## 17. Suggested ordering for "ship a perfect internal product"

If we get all of the above, in the right order, the timeline is roughly 2–3 weeks of focused work. The minimum viable subset:

| Week | Items |
|---|---|
| 1 | #1 (HERO — OWUI surfacing diagnosis + structured outcome + recovery command), #4 (dashboard parity panel) |
| 2 | #2 (per-user bootstrap, parts A+B), #3 (decision A + sidebar link from B), #5 (async cascade) |
| 3 | #7 (WhatsApp Cloud API), #9 (skills hot-reload A+B), #12 (CI gates), #13 (E2E smoke test scaffolding) |
| Stretch | #6 (bare metal), #8 (pod webhooks), #10 (voice), #11 (intent events), #14 (ADRs) |

The critical path is **#1 → #5 → #2 → #3**. Until #1 is fixed, nothing else in OpenWebUI matters because the surfaces are empty. Until #5 lands, #1's fix is invisible from one of the three call sites. Until #2 ships, the experience is "admin only."

---

## 18. ADRs already implicit in this session's work

Capture these now so they're not lost:

- **Channel persistence is idempotent and additive.** `configureChannel` merges into existing `secrets.channels.<platform>` rather than replacing — preserves fields the operator didn't pass on this invocation.
- **Validation is opt-out, not opt-in.** `eve arms messaging configure` validates by default; `--no-validate` for self-hosted edge cases.
- **`registerOpenwebuiAdminApi` returning false is non-fatal.** Sites that block on it still complete the env-file path; admin API failure produces a recoverable warning, not a failed update.
- **Doctor coherence checks degrade gracefully.** Remote probes return `skip` (not `fail`) when the target isn't reachable. `fail` is reserved for "thing is reachable and reports a definite problem."
- **OpenWebUI surfaces are best-effort by design.** Skills/knowledge/tools sync runs `Promise.allSettled` and reports per-surface outcomes. One failing surface doesn't prevent the others from updating.
