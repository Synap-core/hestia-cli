# Stalwart Mail — Implementation Plan

> Build plan derived from `stalwart-mail-integration-strategy.md` + approved decisions.
> **Decisions:** direct host ports for TCP · reuse `MessagingConnector` · include Bulwark
> webmail · plan-then-build.
>
> Order: Phase 1 → 2 in **hestia-cli** (Eve), Phase 3 in **synap-backend**, Phase 4 wiring.
> Each phase has acceptance criteria. No phase is "done" until its criteria pass.

---

## Conventions discovered (must follow)

- `ServiceInfo` holds **one** HTTP port (`internalPort`/`hostPort`/`subdomain`). The
  registry `service` describes Stalwart's **JMAP+admin HTTP** surface only. The raw-TCP mail
  ports (25/465/587/465/993/143/995/4190) are bound directly in the **install recipe** via
  `docker run -p` — they are NOT registry fields. (Decision: direct host ports.)
- Registry is the single source of truth — never hardcode container names/ports elsewhere.
- `hostPort: null` + a `subdomain` = "routed by Traefik, not exposed on host" (like `nango`,
  `synap`). Stalwart's HTTP surface uses this; mail TCP ports are the exception, bound in the
  recipe.
- ESM imports use `.js` extensions. TypeScript strict. pnpm workspaces.

---

## Phase 1 — Eve components: Stalwart + Bulwark  (hestia-cli)

**Goal:** `eve install --components stalwart,bulwark` brings up a running mail server (admin +
JMAP at `mail.<domain>`, SMTP/IMAP on host ports) and a webmail UI at `webmail.<domain>`.

### 1a. `packages/@eve/dna/src/components.ts`
Add two `ComponentInfo` entries:

- **`stalwart`** — organ `mouth` (new comms organ), category `data`, requires `['traefik']`.
  `service`: containerName `eve-mouth-stalwart`, internalPort `8080`, hostPort `null`,
  subdomain `mail`, healthPath `/healthz`. `health: { kind: 'http', path: '/healthz' }`,
  `lifecycle: { restartStrategy: 'restart' }`, `doctor: { critical: false }`.
- **`bulwark`** — category `add-on`, requires `['stalwart']`. `service`: containerName
  `eve-mouth-bulwark`, internalPort `8080` (verify Bulwark's port), hostPort `null`,
  subdomain `webmail`, healthPath `/`. `health http`, `lifecycle restart`.

### 1b. `packages/@eve/dna/src/secrets-contract.ts`
Add to `SecretsSchema` + `EveSecrets`:
```ts
stalwart: z.object({
  domain: z.string().optional(),        // primary mail domain, e.g. mail.example.com
  adminPassword: z.string().optional(), // bootstrap admin pw (preseeded)
  jmapUrl: z.string().optional(),        // https://mail.<domain>/jmap
  bearerToken: z.string().optional(),    // token the Synap connector uses
  installedAt: z.string().optional(),
}).optional(),
```

### 1c. `packages/@eve/lifecycle/src/index.ts`
- Add `"stalwart"` and `"bulwark"` to `HAS_INSTALL_RECIPE`.
- `UPDATE_PLAN`: `stalwart: { imagePull: "stalwartlabs/stalwart:v0.16" }`,
  `bulwark: { imagePull: "bulwarkmail/webmail:latest" }` (verify tag).
- `runInstallRecipe()` cases:
  - **stalwart**: `docker run -d --name eve-mouth-stalwart --restart unless-stopped
    --network eve-network -p 25:25 -p 465:465 -p 587:587 -p 143:143 -p 993:993 -p 110:110
    -p 995:995 -p 4190:4190 -e STALWART_PUBLIC_URL=https://mail.<domain>
    [-e STALWART_RECOVERY_ADMIN=admin:<pw>] -v stalwart-etc:/etc/stalwart
    -v stalwart-data:/var/lib/stalwart stalwartlabs/stalwart:v0.16`. Port 8080 stays internal
    (Traefik upstream). Generate + store admin pw in secrets. Capture bootstrap pw from logs if
    not preseeded.
  - **bulwark**: `docker run -d --name eve-mouth-bulwark --network eve-network
    -e JMAP_URL=https://mail.<domain>/jmap bulwarkmail/webmail:latest`.

**Acceptance:**
- `eve install --components stalwart,bulwark --dry-run --json` lists both, deps resolved.
- `pnpm -r run build` (or `pnpm --filter @eve/dna --filter @eve/lifecycle build`) is clean.
- On a test host: containers run; `https://mail.<domain>/admin` reachable; ports 25/993 open;
  `https://webmail.<domain>` loads.

---

## Phase 2 — Eve provisioning + doctor + config panel  (hestia-cli)

**Goal:** create domains/accounts from the CLI/dashboard; `eve doctor` reports mail health.

### 2a. Provisioning helper — `packages/@eve/mouth/src/stalwart.ts` (new `@eve/mouth` package)
Thin wrapper over `stalwart-cli` (or JMAP admin) run inside the container via `docker exec`:
- `createDomain(name)`, `createAccount({ email, password, description })`, `listAccounts()`,
  `getDkimRecords(domain)`. Auth via env (`STALWART_URL/USER/PASSWORD`) from secrets.

### 2b. `packages/@eve/dna/src/doctor-state-coherence.ts`
Add `checkStalwart(secrets)` called from `runStateCoherenceChecks()`:
- warn if no `stalwart.domain`; check port 25 inbound reachability; check PTR + DKIM TXT
  presence (DNS lookups); surface "set PTR at your provider" as a non-automatable instruction.

### 2c. Dashboard config panel
- `packages/eve-dashboard/.../config-panels/stalwart-config.tsx` — domains + accounts CRUD,
  DKIM/SPF/DMARC record display with copy buttons, deliverability status badges.
- `packages/eve-dashboard/app/api/components/stalwart/{domains,accounts,dns}/route.ts` — call
  the `@eve/mouth` helper.
- Register in `component-surface.tsx` (`if (id === "stalwart") → StalwartConfigPanel`).

**Acceptance:** `eve doctor` shows a Mail group; panel lists/creates a domain + account and
shows DKIM records; deliverability badges reflect real DNS state.

---

## Phase 3 — Synap: StalwartConnector  (synap-backend)

**Goal:** Stalwart joins the existing channel → proposal → IS-tool pipeline as provider
`stalwart`. Reuse, don't rebuild.

### 3a. `packages/api/src/connectors/StalwartConnector.ts` (new) — `implements MessagingConnector`
Over JMAP (`Authorization: Bearer <token>`, session at `/.well-known/jmap`, POST `/jmap`):
- `getAccounts` → the configured mailbox identity.
- `getConversations` → `Email/query` grouped by `threadId`, newest first.
- `getMessages(threadId)` → `Email/get` (subject/from/to/textBody/htmlBody/bodyValues).
- `sendMessage(threadId, body)` → `Email/set` create `$draft` → `EmailSubmission/set`.
- `parseWebhook` → parse Stalwart push (RFC 8030) → `{ type: "message.created", provider:
  "stalwart", threadId, … }`.
- `ensureWebhooksRegistered(publicUrl)` → JMAP `PushSubscription/set` pointing at
  `<publicUrl>/webhooks/messaging`.

### 3b. Connector factory registration
- Map provider `"stalwart"` → `new StalwartConnector(creds)`.
- Credentials from vault via `upsertServiceSecret("stalwart-connector", userId, …)` =
  `{ jmapUrl, bearerToken }` (set by Eve / the connect flow).

### 3c. Proposal approval dispatch
- Verify `messaging.external.send` approval handler resolves a `stalwart` account and calls
  `connector.sendMessage()`. If the dispatch is provider-specific, add a `stalwart` case.

### 3d. (Reuse — verify only)
- `EXTERNAL` channel with `externalSource = "stalwart"` dedups on `(externalSource,
  externalId=<jmap threadId>)`.
- `send_message_external` IS tool already gates via `createProposal()` — no tool change
  required for v1. Optional `email_*` aliases deferred.

**Acceptance:** connect a Stalwart account → inbound email creates an `EXTERNAL` channel +
`messages` row → agent `send_message_external` returns `{ requiresApproval, proposalId }` →
approving the proposal sends via JMAP and the reply appears in the thread.

---

## Phase 4 — End-to-end + deliverability

- Publish DKIM/SPF/DMARC/MTA-STS (auto via DNS provider API or copy-paste from the panel).
- Set PTR at the VPS provider (manual — documented, doctor-checked).
- Verify port 25 inbound open (provider may block — escalate if so).
- Send a test email out (check it lands, not spam) and receive one in (agent sees it).
- `eve doctor` deliverability badges all green.

---

## Risk register (carry from strategy doc)

1. Deliverability (PTR, port 25, IP reputation) — operational, not code. **Highest risk.**
2. Stalwart pre-1.0 — pin `v0.16`, treat upgrades as migrations.
3. Bulwark maturity/port — verify image name, tag, and internal port before 1a.
4. Proposal approval dispatch may be Unipile-specific — verify in 3c.
5. JMAP push encryption (RFC 8291) — may need a simpler EventSource poller for v1 if push
   setup is heavy.

---

## Build order / tracking

P1 (1a→1b→1c) → P2 (2a→2b→2c) → P3 (3a→3b→3c→3d) → P4. Build + typecheck each repo after its
phases. Mirror these as the session task list.
