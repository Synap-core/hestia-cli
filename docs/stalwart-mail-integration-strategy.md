# Stalwart Mail — Integration Strategy

> Knowledge dossier for integrating the [Stalwart](https://stalw.art) self-hosted mail
> server as a sovereign email layer across **Eve** (hestia-cli) and **Synap backend**.
> Status: **research complete, awaiting approval to plan/implement.** No code written yet.

---

## 0. TL;DR — the one insight that reshapes the plan

The naive plan was "build an email channel + agent tools + proposal gating in Synap." But
the research shows **Synap already has the entire agentic-email machinery** — it is just
wired to **Unipile** (a cloud email/messaging aggregator) instead of a self-hosted mailbox:

- `EXTERNAL` channel type keyed on `(externalSource, externalId)` — already supports `gmail`.
- `MessagingConnector` interface (`getConversations` / `getMessages` / `sendMessage` /
  `parseWebhook` / `ensureWebhooksRegistered`) — provider-agnostic.
- Inbound webhook handler `POST /webhooks/messaging` — provider-agnostic (upserts channel +
  message rows on `message.created`).
- IS tool `send_message_external` — already creates a **proposal** (`proposalType:
  "messaging.external.send"`) instead of sending directly. Governance gate already exists.
- Inbox UI, unread counts, proposal review at `/proposals/{id}` — already exist.

**Consequence:** the Synap-side work collapses from "build a channel + tools + proposals"
down to **"implement one `MessagingConnector` for JMAP/Stalwart and register a `stalwart`
provider type."** Stalwart then drops into the exact same channel → proposal → tool pipeline
that Gmail-via-Unipile uses today. We own the mailbox instead of renting it through Unipile.

So the project is really two clean pieces:

1. **Eve component** (hestia-cli) — run + wire + provision the Stalwart container. _New work._
2. **JMAP connector** (synap-backend) — one class implementing the existing interface. _Reuse._

The only genuinely novel infra piece is **raw-TCP mail ports** (25/465/587/993), which the
current Traefik setup does not handle.

---

## 1. Validated architecture

Maps onto Hestia's own model: **Synap = heart (data + governance), Eve = hands (sidecars +
wiring), Eve Dashboard = face.**

```
                       ┌─────────────────────────────────────────────┐
   inbound email  ───▶ │  Stalwart container (Docker, on eve-network) │
   (SMTP :25)          │  • SMTP/IMAP/JMAP/admin in one Rust binary   │
                       │  • DKIM/SPF/DMARC auto-generated             │
                       └───────────────┬─────────────────────────────┘
                          JMAP (HTTP)  │  push (RFC 8030) → webhook
                                       ▼
                       ┌─────────────────────────────────────────────┐
   Eve component  ───▶ │  StalwartConnector implements                │
   (lifecycle, keys)   │  MessagingConnector  (synap-backend)         │
                       └───────────────┬─────────────────────────────┘
                                       ▼
                       EXTERNAL channel  (externalSource="stalwart")
                                       ▼
                       send_message_external IS tool  → createProposal()
                                       ▼
                       user approves at /proposals/{id}  →  JMAP EmailSubmission/set
```

**Layer ownership:**

| Concern | Home | New or reuse |
|---|---|---|
| Stalwart container lifecycle, routing, secrets, doctor, provisioning | **hestia-cli** | New (copy existing component pattern) |
| Bulwark webmail (optional human UI) | **hestia-cli** | New (trivial HTTP component) |
| Email channel, inbound webhook, proposal-gated send, inbox UI | **synap-backend** | **Reuse — already exists** |
| JMAP ↔ Synap glue | **synap-backend** | New — one connector class |
| DNS / PTR / deliverability checks | **hestia-cli** (`eve doctor`) | New — diagnose + instruct |

---

## 2. Stalwart facts that drive the design

- **Image:** `stalwartlabs/stalwart:v0.16` (current `v0.16.7`, May 2026). Pre-1.0 → **expect
  breaking config/data-schema changes on upgrade**. Pin the tag; plan migration on bumps.
- **License:** AGPL-3.0 (community) / SELv1 (enterprise: clustering, k8s). AGPL is fine for
  self-host; only matters if we redistribute Stalwart as a hosted service.
- **Config:** TOML at `/etc/stalwart`; data at `/var/lib/stalwart`. Runs as UID 2000
  (`chown 2000:2000` bind mounts). First boot prints a random admin password to stderr
  (`docker logs … | grep 'bootstrap mode'`); or preseed `STALWART_RECOVERY_ADMIN=admin:pw`.
- **Ports:** one HTTP listener serves **JMAP + admin + WebDAV/CalDAV/CardDAV** (8080 plain /
  443 TLS) — L7-proxyable. SMTP 25/465/587, IMAP 143/993, POP3 110/995, ManageSieve 4190 are
  **raw TCP** — _not_ L7-proxyable.
- **Provisioning:** `stalwart-cli` (npm `@stalwartlabs/cli` or installer script) with env auth
  (`STALWART_URL/USER/PASSWORD` or `STALWART_TOKEN`). Self-documenting via `describe`/`apply`:
  - `stalwart-cli create domain --field name=example.com`
  - `stalwart-cli create account/user --field name=alice@ex.com --field secret=pw`
  - `stalwart-cli apply < accounts.json` (bulk)
  - No traditional REST CRUD for domains/accounts — use CLI or WebUI; `/api/schema` exposes
    the JSON Schema of every object.
- **JMAP for the agent:** session at `/.well-known/jmap`, calls POST `/jmap`. Methods:
  `Mailbox/get`, `Email/query` (filter `inMailbox`), `Email/get` (subject/from/bodyValues),
  `Email/set` (create `$draft`), **`EmailSubmission/set`** (send). New-mail push via
  `PushSubscription/set` (RFC 8030 web push to a webhook) or `GET /jmap/eventsource/`.
  Auth: `Authorization: Bearer <oauth2>` or Basic.
- **Deliverability — what Stalwart does vs us:**
  | Record | Stalwart | Operator |
  |---|---|---|
  | DKIM / SPF / DMARC / MTA-STS / TLS-RPT | generates, can auto-publish via DNS-provider API, shows records in WebUI | publish (auto or copy-paste) |
  | **PTR / reverse DNS** | **never** | **set at VPS/provider — cannot be automated** |
  - Inbound **port 25 is blocked by many VPS providers** → must verify reachability.

---

## 3. Eve side (hestia-cli) — exact file checklist

Component system is **data-driven**: a registry entry auto-wires Traefik routing, doctor
container checks, state, and (optionally) a Hub agent key. Files to touch:

| # | File | Change |
|---|---|---|
| 1 | `packages/@eve/dna/src/components.ts` | Add `stalwart` `ComponentInfo` (service=admin/JMAP HTTP port, `health`, `lifecycle`, `doctor`) |
| 2 | `packages/@eve/dna/src/secrets-contract.ts` | Add `stalwart` section to `SecretsSchema` (adminPassword, domain, installedAt) |
| 3 | `packages/@eve/dna/src/agents.ts` | Add `{ agentType:"stalwart", componentId:"stalwart" }` **only if** Stalwart needs a Hub key (it likely does NOT — the connector lives in the backend) |
| 4 | `packages/@eve/lifecycle/src/index.ts` | `case "stalwart"` in `runInstallRecipe()`; add to `HAS_INSTALL_RECIPE`; add `UPDATE_PLAN` entry |
| 5 | `packages/@eve/legs/src/lib/traefik.ts` | **TCP support (the novel bit)** — see §4 |
| 6 | `packages/@eve/dna/src/doctor-state-coherence.ts` | `checkStalwart()` — domain set? port 25 reachable? PTR/DKIM present? |
| 7 | `packages/eve-dashboard/.../component-surface.tsx` | Import + `if (id==="stalwart")` → `StalwartConfigPanel` |
| 8 | `packages/eve-dashboard/.../config-panels/stalwart-config.tsx` | New panel: domains + accounts CRUD |
| 9 | `packages/eve-dashboard/app/api/components/stalwart/{domains,accounts}/route.ts` | New API routes (shell out to `stalwart-cli` or JMAP admin) |

- **Minimum viable (HTTP/JMAP only, mail ports on host):** files 1, 4, 7, 8, 9.
- **Full:** all of the above + §4.

The admin/JMAP HTTP surface (port 8080→443) routes through Traefik automatically via the
registry `service.subdomain` (e.g. `mail.<domain>`) — no extra code.

---

## 4. The one novel infra decision: raw-TCP mail ports

Current Traefik config declares only `web:80` / `websecure:443` entrypoints and binds only
`-p 80 -p 443 -p 8080`. There is **no `tcp:` section** anywhere. SMTP/IMAP need raw TCP.
Two options:

**Option A — Traefik TCP entrypoints** (3 edits in `traefik.ts`): add `smtp/465/587/993`
entrypoints to `buildStaticConfig()`, add `-p` bindings in `installStandalone()` +
`recreateTraefikContainer()`, add a `tcp:` routers/services block in `configureSubdomains()`.
Traefik does raw TCP natively (unlike Caddy, which needs `caddy-l4`).

**Option B — direct host ports, bypass Traefik for TCP** (recommended for v1): the Stalwart
container binds `-p 25:25 -p 465 -p 587 -p 993` directly; only the HTTP/JMAP/admin surface
goes through Traefik. Matches how `rsshub` (1200) and `ollama` (11434) already expose host
ports. **Bonus: better deliverability** — no proxy between the internet and SMTP means
Stalwart sees the real client IP for SPF/DMARC, avoiding Proxy-Protocol-v2 setup.

> Recommendation: **Option B** for v1 (simpler, fewer moving parts, correct client IP),
> revisit Option A only if we later need TLS-SNI fan-out across multiple mail hosts.

---

## 5. Synap side (synap-backend) — reuse, don't rebuild

Implement a `StalwartConnector implements MessagingConnector` and register provider type
`stalwart` (or `jmap`). Everything downstream is already provider-agnostic.

| # | File | Change |
|---|---|---|
| 1 | `packages/api/src/connectors/StalwartConnector.ts` | **New** — implement the interface over JMAP: `getConversations`→`Email/query`+thread group, `getMessages`→`Email/get`, `sendMessage`→`Email/set`(draft)+`EmailSubmission/set`, `parseWebhook`→parse Stalwart push, `ensureWebhooksRegistered`→`PushSubscription/set` |
| 2 | `packages/api/src/connectors/<factory>` | Register `stalwart` provider → return `StalwartConnector`; credentials from vault (`upsertServiceSecret`) = `{ jmapUrl, bearerToken }` instead of Unipile DSN |
| 3 | `packages/database/.../channels.ts` | None — `externalSource` is free-text; use `"stalwart"`. Existing `(externalSource, externalId)` unique index dedups threads |
| 4 | `packages/api/.../webhooks-inbound.ts` | None if the connector's `parseWebhook` returns the standard `WebhookEvent`; the `message.created` path is generic |
| 5 | `packages/api/.../hub-protocol/rest/proposals.ts` | Ensure the `messaging.external.send` approval handler resolves a `stalwart` account and calls `connector.sendMessage()` (verify the existing dispatch is provider-agnostic; add a case if not) |
| 6 | IS tools | **None** — `send_message_external` already gates via `createProposal()`. Optionally add thin `email_*` aliases for nicer LLM ergonomics, but not required |
| 7 | `permission-check.ts` | None — `…send` is not in `DEFAULT_AUTO_APPROVE`, so sends propose by default ✅. (Optionally decide whether `email.read` should be gated.) |

**Net new Synap code = one connector class + a factory registration + a verified approval
dispatch case.** The channel, inbound webhook, proposal, IS tool, and review UI are reused.

> Note: Unipile already maps `GMAIL → "gmail"`. If the goal is _sovereign_ mail, the Stalwart
> connector is the point — it replaces renting Gmail-through-Unipile with owning the mailbox.

---

## 6. Risks & open questions

1. **Deliverability is the real cost, not code.** Port 25 inbound (VPS blocks), PTR
   (provider-side, manual), warming IP reputation. `eve doctor` can diagnose + instruct but
   cannot fully automate. _This is the make-or-break operational item._
2. **Stalwart pre-1.0** — breaking schema/config changes expected. Pin `v0.16`; treat upgrades
   as migrations.
3. **TCP routing decision** (§4) — recommend Option B (direct host ports).
4. **Connector reuse vs new tools** (§5) — recommend reuse `MessagingConnector` +
   `send_message_external`; add `email_*` aliases only if LLM ergonomics demand.
5. **Webmail UI** — ship Bulwark as a second Eve component, or rely on the agent + Synap inbox
   only for v1?
6. **AGPL** — fine for self-host; revisit only if Synap ever offers hosted Stalwart.

---

## 7. Source index

**Stalwart:** install/docker · server/listener · server/reverse-proxy(+caddy) ·
development/api · management/cli · http/jmap(+push) · install/dns · mta/authentication/dkim ·
mta/transport-security/mta-sts · faq — all under https://stalw.art/docs/ · repo
https://github.com/stalwartlabs/stalwart

**Eve (hestia-cli):** `@eve/dna/src/{components,operational,secrets-contract,agents,
doctor-state-coherence}.ts` · `@eve/lifecycle/src/{index,auth,doctor}.ts` ·
`@eve/legs/src/lib/traefik.ts` · `eve-dashboard/app/(os)/settings/components/*`

**Synap backend:** `database/src/schema/{channels,channel-connections,messages,inbox-items}.ts`
· `api/src/connectors/{MessagingConnector,UnipileConnector}.ts` ·
`api/src/routers/{webhooks-inbound,hub-protocol-rest}.ts` ·
`api/src/routers/hub-protocol/rest/{messaging,proactive,proposals}.ts` ·
`api/src/utils/permission-check.ts` · IS `apps/intelligence-hub/src/tools/{base/tool,
tool-registry,actions/*}.ts`
