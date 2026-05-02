# @eve/dashboard

The Eve web dashboard — a Next.js 16 app that gives the sovereign stack a
visual control surface. It is the same control plane the `eve` CLI exposes,
just rendered in a browser.

It runs as a Docker container (`eve-dashboard` on `eve-network`) installed
the same way as any other Eve component: `eve add eve-dashboard`.

```
host
└─ eve-dashboard (this package)
   ├─ reads  → ~/.eve/secrets.json   (mounted at /eve)
   ├─ reads  → /var/run/docker.sock  (live container state)
   └─ shells → docker exec / restart  (actions like restart container)
```

---

## What it does

Six pages, each backed by its own API route under `app/api/`. The
dashboard never reaches the host directly — every server action goes
through a Next.js Route Handler that consults `@eve/dna` (registry,
secrets, entity state), invokes `@eve/lifecycle` for install/remove/
update/start/stop, or shells out to the Docker CLI.

| Page | Purpose | API |
|------|---------|-----|
| `/dashboard` (Home) | Single-screen launcher: domain status, quick links, install checklist | `app/api/state/route.ts` |
| `/dashboard/components` | The full component catalog grouped by category. Click a row to open a side drawer with monitoring + actions + per-component config | `app/api/components/route.ts`, `app/api/components/[id]/route.ts` |
| `/dashboard/ai` | Provider configuration (OpenAI / Anthropic / OpenRouter / Ollama), model defaults, wired components | `app/api/ai/route.ts` |
| `/dashboard/networking` | Domain set/edit/reset form, SSL email, exposed services, Traefik health | `app/api/networking/route.ts`, `app/api/networking/domain/route.ts` |
| `/dashboard/doctor` | Mirror of `eve doctor` (platform / network / containers / AI / wiring) with inline Repair buttons | `app/api/doctor/route.ts`, `app/api/doctor/repair/route.ts` |
| `/dashboard/settings` | Stack identity, Synap admin bootstrap mode, raw secrets summary | `app/api/settings/route.ts`, `app/api/secrets-summary/route.ts` |

### Component detail drawer

Clicking any row on the Components page opens a slide-in drawer
(HeroUI `<Drawer>`) with:

- **About** — `longDescription` + `homepage` from the registry
- **Wiring** — what this component requires + what depends on it
- **Endpoints** — internal port, host port, subdomain, full domain URL
- **Lifecycle actions** — `Install`, `Start`, `Stop`, `Restart`, `Update`, `Remove`. All routed through `@eve/lifecycle` so the dashboard and the CLI share one code path. Progress streams live over SSE; `Update` and `Remove` ask for confirmation. Install-from-dashboard now works for most components — the CLI is no longer the only entry point.
- **Monitoring** — live `docker inspect` (status, image, restart count, started/finished timestamps).
- **Streaming logs** — `Follow` / `Stop` / `Clear` controls reading from `GET /api/components/[id]/logs?stream=1` (SSE). Replaces the old static last-50 snapshot.
- **Per-component config panels** — appear when the component supports them:
  - **RSSHub** — feed CRUD persisted at `~/.eve/feeds.json`.
  - **OpenClaw** — MCP server list + 5 preset installers (filesystem / github / postgres / sqlite / puppeteer); voice config (Twilio / Signal / SIP); messaging config (Telegram / Signal / Matrix bot tokens).
  - **Hermes** — daemon settings (enabled, poll interval, max concurrent), explainer about the "no UI by design" model, host CLI command cards.
  - **Synap** — pod identity, admin bootstrap state, deep link to the Synap dashboard, Docker volume list with one-click backup buttons (runs `docker run --rm alpine tar czf` against each volume into `$EVE_HOME/backups`) plus copy-cmd fallbacks.

### API surface

| Route | Method | What it does |
|---|---|---|
| `/api/components/[id]` | `POST` | `{action: "install" \| "start" \| "stop" \| "restart" \| "update" \| "remove"}`. Pass `?stream=1` for SSE progress. |
| `/api/components/[id]/logs` | `GET` | `?stream=1` for SSE follow stream; otherwise last-N snapshot. |
| `/api/components/rsshub/feeds` | `GET` / `POST` | List + add feeds. |
| `/api/components/rsshub/feeds/[name]` | `DELETE` | Remove a feed. |
| `/api/components/openclaw/mcp` | `GET` / `POST` | List + add MCP servers. |
| `/api/components/openclaw/mcp/[name]` | `DELETE` | Remove an MCP server. |
| `/api/components/openclaw/voice` | `GET` / `PUT` | Voice config (Twilio / Signal / SIP). |
| `/api/components/openclaw/messaging` | `GET` / `PUT` | Messaging config (Telegram / Signal / Matrix). |
| `/api/components/hermes/config` | `GET` / `PUT` | Daemon settings. |
| `/api/components/synap/info` | `GET` | Pod identity + admin bootstrap state + volumes. |
| `/api/components/synap/backup` | `POST` | SSE stream of `docker run --rm alpine tar czf` progress. |
| `/api/networking/domain` | `POST` / `DELETE` | Set or reset the public domain. Calls `TraefikService.configureSubdomains`. |
| `/api/doctor` | `GET` | Run all checks. |
| `/api/doctor/repair` | `POST` | Run a single repair (`create-eve-network`, `start-container`, `rewire-openclaw`). |

---

## Architecture

```
app/
├─ layout.tsx                 # Sticky rail nav + ThemeProvider + ToastProvider
├─ providers.tsx              # HeroUI + next-themes
├─ globals.css                # Tailwind base + design tokens
├─ login/page.tsx             # 1-field login (the dashboard secret) → JWT cookie
├─ dashboard/
│  ├─ page.tsx                # Home
│  ├─ components/
│  │  ├─ page.tsx             # Catalog, grouped by category
│  │  └─ component-detail-drawer.tsx
│  ├─ ai/page.tsx
│  ├─ networking/page.tsx
│  ├─ doctor/page.tsx         # eve doctor mirror with inline Repair buttons
│  └─ settings/page.tsx
└─ api/                       # Server-side routes; only place that touches host
   ├─ auth/                   # POST /verify (key → JWT cookie)
   ├─ state/                  # GET   — what the home screen needs
   ├─ components/             # GET list + POST /[id] (lifecycle) + per-component config (rsshub/openclaw/hermes/synap)
   ├─ ai/                     # GET/POST provider config
   ├─ networking/             # GET — Traefik + domain; POST/DELETE /domain — write through to TraefikService
   ├─ doctor/                 # GET — run checks; POST /repair — apply a single fix
   ├─ settings/               # GET/POST — stack identity, admin bootstrap
   ├─ secrets-summary/        # GET   — redacted secrets surface
   ├─ access/                 # GET   — preauth check
   └─ actions/                # POST  — host-side actions (e.g. trigger eve grow)
proxy.ts                      # Edge proxy: cookie + JWT verify, redirects to /login
lib/                          # auth helpers (sign / verify, env-aware)
```

### Auth model

- One secret per stack (`secrets.json` → `dashboard.secret`), generated by `eve ui` on first run.
- Login posts that secret to `POST /api/auth/verify`. Server signs a 48h JWT with the same secret and sets it as `eve-session` (`httpOnly; SameSite=strict`).
- `proxy.ts` runs on every non-public path: missing cookie → `/login`, invalid signature → `/login`.
- The container never gets the secret bundled in — `eve ui` injects it as `EVE_DASHBOARD_SECRET` at start.

### Why a separate process (and not part of `eve`)

A long-running web UI on the host is a different shape from a CLI tool:
it needs to survive reboots, be reachable on a port, log to docker, and
restart on crash. Running it as just another container on `eve-network`
means Traefik can route to it (`https://eve.<your-domain>`), the same
healthchecks watch it, and the CLI can manage it like every other
component (`eve ui --rebuild` / `--stop` / `--status`).

---

## Design system

A small, deliberate set of tokens — there is no shadcn / no theme
library on top. Just HeroUI primitives wrapped in two CSS variables
worth of theming.

- **Fonts** — Fraunces (display), DM Sans (body), JetBrains Mono (code), all via `next/font/google`.
- **Colors** — emerald primary, warm slate neutrals. Light + dark via `next-themes`.
- **No shadows.** Depth comes from 1px `border-divider` and `bg-content1` / `bg-content2` layering.
- **Components** — always use HeroUI: `<Button>`, `<Input variant="bordered" labelPlacement="outside">`, `<Chip>`, `<Drawer>`, `<Spinner>`, `<Switch>`. Never roll your own.
- **Layout** — sticky rail nav (`position: sticky; top-0; h-screen`), 12-col grid, `space-y-10` between sections.

---

## Running it

### As part of an Eve install (production)

```bash
# 1. Install the dashboard alongside whatever else you need
eve install --components traefik,eve-dashboard,synap

# 2. Open it
eve ui                  # prints URL + login key, opens browser
eve ui --status         # is the container running?
eve ui --rebuild        # rebuild the image from source and restart
eve ui --stop           # stop and remove the container
```

The `eve add eve-dashboard` flow:

1. Builds the Docker image (see `Dockerfile`) — multi-stage, ships only Next.js standalone output (~120 MB).
2. Generates a 32-byte hex secret and persists it to `~/.eve/secrets.json`.
3. Starts the container on `eve-network` with `~/.eve` mounted at `/eve` and `/var/run/docker.sock` mounted in.
4. If a domain is set, Traefik routes `https://eve.<your-domain>` → this container automatically.

### Local development

```bash
# In one terminal — backing services on the host (so the dashboard can `docker inspect`)
eve install --components traefik,synap

# In another — run Next dev against the host's secrets file
cd packages/eve-dashboard
EVE_HOME=$HOME/.eve pnpm dev
# → http://localhost:7979
```

The `EVE_HOME` env var is the override `secrets-contract.ts` checks before
falling back to the in-container `/eve` mount. This is what makes it
possible to run `pnpm dev` against the same secrets the production
container would see.

---

## Build

```bash
pnpm --filter @eve/dashboard build       # next build --webpack → .next/standalone
pnpm --filter @eve/dashboard type-check
```

Webpack (not Turbopack) is intentional — Turbopack still has rough
edges with monorepo workspace links to `@eve/dna`, and the standalone
output we ship in Docker requires Webpack.

---

## See also

- Root: [`hestia-cli/README.md`](../../README.md) — the full Eve product overview.
- CLI: [`packages/eve-cli/README.md`](../eve-cli/README.md) — every `eve` command.
- DNA: [`packages/@eve/dna`](../@eve/dna) — registry + secrets contract the dashboard reads.
