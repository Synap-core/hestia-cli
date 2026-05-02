# Eve (Hestia CLI monorepo)

This repository is a **pnpm monorepo** that builds **`eve`**: a command-line installer and operator for a **self-hosted stack** around **Synap** (your Data Pod) and optional sidecars (local LLMs, tunnels, builder tooling, OpenClaw, RSSHub, Open WebUI, database UI).

It also ships a **web dashboard** — `eve.<your-domain>` — that's the front door to your stack. From there you can see what's running, jump into each component's UI, configure AI providers once and propagate the keys everywhere, inspect Traefik routes and DNS, and rotate the dashboard key.

If you only remember one thing: **Synap is the "heart" (data + Hub + governance). Eve is the "hands" (Docker sidecars + wiring + secrets + convenience). The Eve Dashboard is the "face" — the calm control panel sitting on top of both.** Eve does not replace Synap's server; it orchestrates what runs *next to* it.

---

## What Eve actually does

1. **Web dashboard** — A self-hosted Next.js app at `eve.<domain>` that gives you a live read on every component, a service launcher into their UIs, a single AI-provider config that propagates to every consumer, a writable networking page, a Doctor page that mirrors `eve doctor` with inline repair buttons, and per-component drawers with full lifecycle actions (install / start / stop / restart / update / remove), streaming logs, and component-specific config panels (RSSHub feeds, OpenClaw MCP / voice / messaging, Hermes daemon, Synap volume backups).
2. **Composable install** — `eve install` lets you pick which components to install (Synap, Ollama, Traefik, OpenClaw, RSSHub, Open WebUI, builder tools, dashboard). An interactive wizard or CLI flags (`--components`, `--ai-mode`, `--tunnel`, etc.) drive the flow.
3. **Legacy setup** — `eve setup` still works with three profiles (`inference_only`, `data_pod`, `full`) for backward compatibility with bootstrap scripts.
4. **Add / remove components** — `eve add <component>` and `eve remove <component>` let you grow or shrink your entity after the initial install.
5. **Entity health** — `eve status` shows organ and component tables; `eve doctor` runs diagnostics with fix suggestions.
6. **Centralized AI provider config** — Set provider keys once in `eve ai providers add` (or in the dashboard); Eve propagates them to Synap IS, OpenClaw, and Open WebUI on demand. No per-component duplication.
7. **Hub wiring for agents** — Builder flows write project `.env` and skill layout so coding agents can call Synap's **Hub** with an API key and skills.
8. **Explicit sync to Synap workspace settings** — `eve ai sync` pushes **non-secret** "provider routing" policy to the pod when your backend exposes the Hub route.

---

## Technology in this repo

| Layer                 | What we use                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| Language              | **TypeScript** (strict), **Node.js ≥ 18** (Node 20+ recommended for parity with `bootstrap.sh`) |
| Package manager       | **pnpm** workspaces                                                                             |
| CLI framework         | **Commander** + **@clack/prompts** (interactive), **execa** (subprocesses)                      |
| Build                 | **tsup** / **tsc** per package                                                                  |
| Tests                 | **Vitest** (`packages/eve-cli`)                                                                 |
| Runtime orchestration | **Docker** + **Docker Compose** (containers named with `eve-*` / gateway patterns in docs)      |

Synap itself (PostgreSQL, Redis, Caddy, API, etc.) lives in the **synap-backend** repository. Eve **calls** the official **`synap`** shell installer when you use `data_pod` / `full` via `eve brain init` (or `eve install --components synap`). Setup auto-detects an existing `synap-backend` checkout and can auto-clone when missing (default: `/opt/synap-backend`). You can still pin with `--synap-repo` or `SYNAP_REPO_ROOT`.

Reference repositories:
- Hestia/Eve CLI: [github.com/Synap-core/hestia-cli](https://github.com/Synap-core/hestia-cli)
- Synap CLI companion: [github.com/Synap-core/synap-cli](https://github.com/Synap-core/synap-cli)

---

## How the pieces connect (mental wiring)

```
┌──────────────────────────────────────────────────────────────────┐
│  Your server / VM                                                 │
│                                                                   │
│  Eve Dashboard (always)        ←── eve add eve-dashboard          │
│  • Container :3000 / :7979      ←── joins eve-network             │
│  • Routed at eve.<domain>       ←── via Traefik subdomain         │
│  • Reads /opt + ~/.local/share  ←── for secrets, state, registry  │
│                                                                   │
│  Traefik (always)               ←── eve install / always-on infra │
│  • :80 / :443 / :8080           ←── reverse proxy + SSL           │
│  • eve-network (Docker bridge)  ←── one network for all services  │
│                                                                   │
│  Synap Data Pod (optional)      ←── eve install --components synap│
│  • Caddy :80 / :443             ←── synap install (delegated)     │
│  • API :4000                    ←── synap.apiUrl in secrets       │
│  • Hub /api/hub                 ←── HUB_BASE_URL + synap.apiKey   │
│                                                                   │
│  Eve sidecars (optional)        ←── eve install / eve add         │
│  • Ollama (Docker network)      ←── eve add ollama                │
│  • OpenClaw / RSSHub / Open WebUI / Hermes                        │
│                                                                   │
│  Developer "hand" (optional)    ←── eve builder init              │
│  • OpenCode / OpenClaude / Claude Code + .env + ~/.eve/skills     │
└──────────────────────────────────────────────────────────────────┘
```

**Important split (avoid confusion):**

- **Synap internal routing** — which *Intelligence Service* instance the pod uses (`intelligenceServiceId`, etc.). Owned by Synap.
- **Eve "provider routing"** — which *model vendor* (Ollama, OpenRouter, Anthropic, OpenAI) your **local tooling** prefers. Stored in `.eve/secrets/secrets.json`; optionally synced into workspace JSON as `eveProviderRouting` via `eve ai sync`.

**State files you will see on disk:**

| Path                           | Role                                                                    |
| ------------------------------ | ----------------------------------------------------------------------- |
| `.eve/setup-profile.json`      | Last chosen profile + AI / tunnel hints                                 |
| `~/.local/share/eve/state.json`| v2 entity state: organ status + installed components (managedBy)        |
| `.eve/secrets/secrets.json`    | Merged secrets: `synap.*`, `ai.*`, `inference.*`, `builder.*`, `arms.*` |
| `~/.eve/skills/synap/SKILL.md` | Stub skill path for Hub usage                                           |

---

## Component registry

Eve's composable installer works with a registry of 12 components across 6 categories:

| Component             | Organ    | Category       | Always? | Prerequisites      |
| --------------------- | -------- | -------------- | ------- | ------------------ |
| Traefik               | Legs     | infrastructure | yes     | —                  |
| Eve Dashboard         | Legs     | infrastructure | yes     | traefik            |
| Synap Data Pod        | Brain    | data           | no      | traefik            |
| Ollama                | Brain    | data           | no      | traefik            |
| OpenClaw              | Arms     | agent          | no      | synap              |
| Hermes                | Builder  | builder        | no      | synap              |
| RSSHub                | Eyes     | perception     | no      | synap              |
| Open WebUI            | —        | add-on         | no      | synap              |
| Open WebUI Pipelines  | —        | add-on         | no      | openwebui, synap   |
| Dokploy               | Builder  | add-on         | no      | —                  |
| OpenCode              | Builder  | add-on         | no      | —                  |
| OpenClaude            | Builder  | add-on         | no      | —                  |

- **Always** components (Traefik, Eve Dashboard) are installed unconditionally — they're the platform itself.
- **Add-on** components are excluded from the default wizard selection and installed with `eve add <id>` or by selecting them in the wizard.

The full registry — including the human-readable `longDescription` shown in the dashboard's component detail drawer — lives in `packages/@eve/dna/src/components.ts`. That's the single source of truth for what Eve can install, route, and explain.

### Install presets (interactive wizard)

Every preset includes Traefik **and** the Eve Dashboard (always-on infrastructure).

| Preset           | Components on top of the platform       |
| ---------------- | --------------------------------------- |
| 🧠 Personal pod  | + Synap                                 |
| 🚀 Full stack    | + Synap + Ollama + OpenClaw             |
| 💬 AI chat server| + Synap + Open WebUI                    |
| 🏗️ Builder server| + Synap + OpenClaw + Hermes             |
| ⚡ Minimal       | (just the platform)                     |
| 🔧 Custom        | Pick each component individually        |

---

## Eve Dashboard (web UI)

Once `eve install` completes, you can reach the dashboard three ways:
- `http://localhost:7979` — direct, on the host itself.
- `http://<server-ip>:7979` — direct, from another machine on the LAN.
- `https://eve.<your-domain>` — via Traefik with SSL (after `eve domain set`).

You unlock it with the **dashboard key** generated during install (also shown by `eve ui` on the host).

### Page taxonomy

The dashboard is organized into six focused pages, each owning one mental model:

| Page         | Mental model                                  | What lives here                                                                                                            |
| ------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Home         | "Is my stack alive, and where do I go?"       | Setup checklist (only when something's missing) · stack pulse (organ chips, click to restart) · service launcher tiles     |
| Components   | "What's installed and what isn't?"            | Full catalog grouped by category, status / version / subdomain per row, click any row → detail drawer                      |
| AI Providers | "What model serves my agents?"                | Per-provider CRUD with API keys + default models · "Apply to components" · "Wired components" view                         |
| Networking   | "How is my stack reachable from the world?"   | Domain & SSL form (set/edit/reset) · subdomain map with live DNS check · read-only Traefik dynamic + static config preview |
| Doctor       | "What's broken and can you fix it for me?"    | Mirror of `eve doctor` (platform / network / containers / AI / wiring) with inline Repair buttons for fix-able issues       |
| Settings     | "Stuff about Eve itself, not my stack"        | Rotate dashboard key (one-shot reveal) · explicit theme picker · backup snippet · Eve version + hostname + init timestamp  |

### Component detail drawer

Click any row on the Components page → a side drawer slides in with everything about that component:
- **About** — multi-paragraph plain-language explanation: what it is, why a sovereign stack uses it, what it pairs with. Copy comes from `longDescription` on the registry.
- **Lifecycle actions** — real **Install / Start / Stop / Restart / Update / Remove** buttons (no more "copy this command and run it on the host"). Progress streams live over SSE; **Update** and **Remove** ask for confirmation. The dashboard and the CLI share the same code path via `@eve/lifecycle`.
- **Streaming logs** — Follow / Stop / Clear controls, replacing the old static last-50 snapshot.
- **Per-component config panels** — appear in the drawer when the component supports them:
  - **RSSHub** — feed CRUD persisted at `~/.eve/feeds.json`.
  - **OpenClaw** — MCP server list + 5 preset installers (filesystem / github / postgres / sqlite / puppeteer), voice config (Twilio / Signal / SIP), messaging config (Telegram / Signal / Matrix bot tokens).
  - **Hermes** — daemon settings (enabled, poll interval, max concurrent), an explainer about the "no UI by design" model, plus host CLI command cards.
  - **Synap** — pod identity, admin bootstrap state, deep link to the Synap dashboard, Docker volume list with one-click backup buttons (runs `docker run --rm alpine tar czf` against each volume into `$EVE_HOME/backups`) plus copy-cmd fallbacks.
- **Endpoints** — container name, image, ID, internal/host ports, subdomain.
- **Wiring** — "depends on" + "required by" chips so you can see ripple effects of removing something.

### Lifecycle (`eve ui` on the host)

The dashboard is a Docker container (`eve-dashboard`) joined to `eve-network` and routed by Traefik just like every other service. The `eve ui` family of commands manages it:

| Command                   | What it does                                                                  |
| ------------------------- | ----------------------------------------------------------------------------- |
| `eve ui`                  | Print the dashboard URL + key, optionally open the browser                    |
| `eve ui --rebuild`        | Rebuild the Docker image and restart the container                            |
| `eve ui --stop`           | Stop and remove the container (use `eve add eve-dashboard` to bring it back)  |
| `eve ui --status`         | Whether the container is running                                              |

### Design system

- **Fonts:** Fraunces (display/headings) + DM Sans (body) + JetBrains Mono (keys, container names, CLI snippets) — all loaded via `next/font`.
- **Colors:** emerald primary, warm slate neutrals, full HeroUI light + dark themes living in `tailwind.config.js`.
- **No shadows** — depth comes from 1px borders on `bg-content1` surfaces.
- **HeroUI components** are the default for inputs, buttons, chips, switches, drawers, dropdowns, toasts. Custom HTML only when HeroUI's outside-label slot doesn't fit.
- **Light + dark** with system-default detection via `next-themes`. Toggle in the rail and explicit picker in Settings.

### Auth model

Single dashboard key — a 32-byte hex secret stored in `.eve/secrets/secrets.json`. The login screen verifies the typed key against `secrets.dashboard.secret`, signs a 48h JWT with that secret, sets it as an httpOnly + SameSite=strict cookie. Middleware (`proxy.ts`) verifies the JWT on every request that isn't `/login` or `/api/auth/verify`. Rotating the key in Settings invalidates the current session.

---

## Packages in this monorepo

Only these workspaces are built and published from this tree:

| Package           | Role                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------- |
| `@eve/cli`        | `eve` binary — all user-facing commands                                                 |
| `@eve/dashboard`  | Next.js web dashboard — packaged as a Docker image, joins `eve-network`, routed at `eve.<domain>` |
| `@eve/dna`        | Component registry + shared schemas: secrets, setup profile, USB manifest, builder/Hub helpers, state manager, AI wiring |
| `@eve/brain`      | Synap delegation, `runBrainInit`, `runInferenceInit`, Ollama / Postgres / Redis helpers |
| `@eve/legs`       | Traefik, inference gateway, `eve legs newt` (Pangolin Newt), dashboard container lifecycle |
| `@eve/arms`       | OpenClaw install / wiring                                                               |
| `@eve/eyes`       | RSSHub + `eve eyes database` (Outerbase Studio runner)                                  |
| `@eve/builder`    | OpenCode, OpenClaude, Claude Code, Dokploy (optional), builder stack, sandbox           |
| `@eve/usb`        | USB / Ventoy helpers used by `eve birth`                                                |
| `@eve/install`    | Server install script assets                                                            |
| `@eve/cli-kit`    | Shared CLI flags / JSON output helpers                                                  |
| `types`, `utils`  | Small shared TS utilities                                                               |

---

## Every practical way to install and run `eve`

### 0) One-liner from GitHub (blank Debian/Ubuntu server)

`bootstrap.sh` installs **ca-certificates, curl, git** (via `apt` when needed), **Docker** (get.docker.com), **Node 20** (NodeSource), **pnpm 10**, clones **hestia-cli**, builds the workspace, then **runs `eve setup`** (interactive wizard unless you pass flags after `--`).

**Recommended (single copy-paste as root):** installs `curl` + `git`, then runs bootstrap.

```bash
DEBIAN_FRONTEND=noninteractive apt-get update -y && apt-get install -y ca-certificates curl git \
  && curl -fsSL "https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh" | bash -s -- \
  --repo "https://github.com/Synap-core/hestia-cli.git"
```

**If you already have `curl`:**

```bash
curl -fsSL "https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh" | bash -s -- \
  --repo "https://github.com/Synap-core/hestia-cli.git"
```

**Non-root** (has `curl` and `sudo`):

```bash
curl -fsSL "https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh" | sudo bash -s -- \
  --repo "https://github.com/Synap-core/hestia-cli.git"
```

**Non-interactive** (CI / cloud-init) — pass `eve setup` flags after `--`:

```bash
DEBIAN_FRONTEND=noninteractive apt-get update -y && apt-get install -y ca-certificates curl git \
  && curl -fsSL "https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh" | bash -s -- \
  --repo "https://github.com/Synap-core/hestia-cli.git" -- \
  --yes --profile inference_only
```

**Install only, no wizard** (you will run setup yourself):

```bash
DEBIAN_FRONTEND=noninteractive apt-get update -y && apt-get install -y ca-certificates curl git \
  && curl -fsSL "https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh" | bash -s -- \
  --repo "https://github.com/Synap-core/hestia-cli.git" --no-setup
```

**Custom install directory** (default is `/opt/eve`):

```bash
DEBIAN_FRONTEND=noninteractive apt-get update -y && apt-get install -y ca-certificates curl git \
  && curl -fsSL "https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh" | bash -s -- \
  --dir /srv/eve --repo "https://github.com/Synap-core/hestia-cli.git"
```

**Using environment variables** (as root; use `sudo -E` if non-root):

```bash
export EVE_BOOTSTRAP_REPO='https://github.com/Synap-core/hestia-cli.git'
export EVE_BOOTSTRAP_DIR='/opt/eve'
DEBIAN_FRONTEND=noninteractive apt-get update -y && apt-get install -y ca-certificates curl git \
  && curl -fsSL "https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh" | bash -s --
```

**TTY note:** piping through `curl | bash` can leave **stdin non-interactive**. For a full interactive `eve setup`, SSH into the server and run `cd /opt/eve && pnpm --filter @eve/cli exec eve setup` after a `--no-setup` bootstrap, or use a PTY (`ssh -t`). Non-interactive flows should use `--yes` / `--json` flags after `--` as above.

If bootstrap detects non-interactive stdin and no setup flags, it exits with a clear message instead of showing a prompt that immediately closes.

The script file is **[bootstrap.sh](bootstrap.sh)** at the repo root (same path on `raw.githubusercontent.com`).

### 0.1) Post-pull sync (important)

After a `git pull`, always rehydrate workspace state before launching Eve:

```bash
cd /opt/eve
pnpm install
pnpm --filter @eve/cli... run build
pnpm --filter @eve/cli exec eve --help
```

This avoids stale workspace/bin state and guarantees the `@eve/cli` binary is resolvable.

### 0.2) Prebuilt release bundle (no local build)

For tagged releases, CI publishes `eve-cli-bundle-<version>.tar.gz` assets in GitHub Releases.
This avoids compiling TypeScript on the target host.

```bash
# example (replace version)
VERSION=v0.1.0
curl -fsSL -o "eve-cli-bundle-${VERSION}.tar.gz" \
  "https://github.com/Synap-core/hestia-cli/releases/download/${VERSION}/eve-cli-bundle-${VERSION}.tar.gz"
mkdir -p /opt/eve && tar -xzf "eve-cli-bundle-${VERSION}.tar.gz" -C /opt/eve --strip-components=1
cd /opt/eve
node dist/index.js --help
node dist/index.js install
```

### 1) From source (developer / your laptop)

**Requirements:** Git, Node **18+** (20+ recommended), pnpm, Docker (for anything that pulls images).

```bash
git clone https://github.com/Synap-core/hestia-cli.git
cd hestia-cli
pnpm install
pnpm run build
```

Run the CLI **without** global install:

```bash
pnpm --filter @eve/cli exec eve --help
pnpm --filter @eve/cli exec eve install --dry-run
```

Optional: link globally from the workspace (pick one workflow your team uses):

```bash
pnpm --filter @eve/cli link --global
eve --help
```

### 2) Greenfield server when you already have the repo tarball / git mirror

If you copied **[bootstrap.sh](bootstrap.sh)** onto the machine (or cloned the repo out-of-band), run it **as root** from disk (`sudo` only if you are not root):

```bash
./bootstrap.sh --repo 'https://github.com/Synap-core/hestia-cli.git'
# optional: --no-setup then later: cd /opt/eve && pnpm --filter @eve/cli exec eve install
```

Same behavior as the curl one-liner in **§0**; only the script source differs.

### 3) Non-interactive / CI / cloud-init

Use **`--yes`**, **`--json`**, and explicit flags:

```bash
pnpm --filter @eve/cli exec eve --json install --dry-run --components traefik,synap,ollama
# Composable install (recommended):
pnpm --filter @eve/cli exec eve install --yes --components traefik,synap,ollama --ai-mode local
# Legacy profile (backward compat):
pnpm --filter @eve/cli exec eve setup --yes --profile data_pod
```

**Public exposure patterns (Pod + Legs):**

```bash
# Pattern A: shared hostname (Pod + Legs on same public host)
pnpm --filter @eve/cli exec eve install --yes --components traefik,synap \
  --domain pod.example.com --email ops@example.com \
  --tunnel pangolin --tunnel-domain pod.example.com

# Pattern B: separate hostname for Legs ingress
pnpm --filter @eve/cli exec eve install --yes --components traefik,synap \
  --domain pod.example.com --email ops@example.com \
  --tunnel pangolin --tunnel-domain eve.example.com
```

Use **Pattern A** when one public host is enough. Use **Pattern B** when you want a dedicated ingress hostname for Eve side routes.

### 4) Synap already installed; Eve only for sidecars

Point Eve at your checkout of **synap-backend**:

```bash
export SYNAP_REPO_ROOT=/path/to/synap-backend
pnpm --filter @eve/cli exec eve add synap --synap-repo "$SYNAP_REPO_ROOT"
# or install Ollama + gateway:
pnpm --filter @eve/cli exec eve add ollama
```

Use **`synap`** inside that repo for pod lifecycle; use **`eve`** for legs/builder/arms/eyes extras.

### 5) USB → bare metal

1. `eve birth usb` (see command help) — may write `~/.eve/usb-profile.json`.
2. After OS install, optionally place manifest at `/opt/eve/profile.json`.
3. On the server: `eve install` (manifest pre-selects profile where supported).

### 6) Verification script (`verify.sh`)

`pnpm run verify` runs **[verify.sh](verify.sh)**. It expects **bash 4+** (associative arrays). On macOS, system bash is often 3.2 — use a modern bash (Homebrew) or run verification on your **Linux VM**.

### 7) Catch build breaks before push (contributors)

GitHub already runs **`pnpm -r run build`** and **`check:manifest`** on PRs ([`.github/workflows/eve-cli.yml`](.github/workflows/eve-cli.yml)). To block a broken push **locally**, enable the repo hooks once:

```bash
cd hestia-cli   # repo root
pnpm run setup:hooks
```

Then every **`git push`** runs [`.githooks/pre-push`](.githooks/pre-push) (same checks as above). To run the same checks by hand: **`pnpm run prepush`**.

---

## Command reference

### Install & lifecycle

| Command                                        | Description                                              |
| ---------------------------------------------- | -------------------------------------------------------- |
| `eve install [options]`                        | Composable installer — pick components interactively or via flags |
| `eve setup [options]`                          | Legacy setup wizard with three profiles (backward compat) |
| `eve add <component> [options]`                | Add a component to an existing entity                    |
| `eve remove <component>`                       | Remove a component (stop containers, update state)       |
| `eve status`                                   | Show organ + component tables with completeness bar      |
| `eve doctor`                                   | Run diagnostics (Docker, network, entity state)          |
| `eve grow [options]`                           | Grow the entity — add organs or capabilities             |
| `eve backup`                                   | List Eve-related Docker volumes                          |
| `eve update`                                   | Print update guidance (delegates to synap-backend)       |
| `eve recreate`                                 | Dangerous: full cleanup + recreation (requires "recreate")|

### Web dashboard

| Command                                        | Description                                              |
| ---------------------------------------------- | -------------------------------------------------------- |
| `eve ui`                                       | Print the dashboard URL + login key, optionally open the browser |
| `eve ui --rebuild`                             | Rebuild the Docker image from source and restart the container |
| `eve ui --stop`                                | Stop and remove the dashboard container                  |
| `eve ui --status`                              | Show whether the dashboard container is running          |
| `eve add eve-dashboard`                        | (Re-)install the dashboard container — same path as any other component |
| `eve domain set <host> --ssl --email <email>`  | Configure the public domain — Traefik provisions the `eve.<host>` cert automatically |

### AI management

| Command                                              | Description                                        |
| ---------------------------------------------------- | -------------------------------------------------- |
| `eve ai status`                                      | Show current AI configuration                      |
| `eve ai providers list`                              | List configured providers                          |
| `eve ai providers add`                               | Add a new provider (OpenRouter, Anthropic, OpenAI) |
| `eve ai set-default <provider>`                      | Set default provider                               |
| `eve ai set-fallback <provider>`                     | Set fallback provider                              |
| `eve ai sync --workspace <uuid>`                     | Push provider routing policy to Synap workspace    |
| `eve ai models list`                                 | List available models                              |
| `eve ai pull <model>`                                | Pull an Ollama model                               |
| `eve ai chat`                                        | Interactive chat with configured AI provider       |

### Builder & organ commands

| Command                                     | Description                                        |
| ------------------------------------------- | -------------------------------------------------- |
| `eve builder init <name>`                   | Initialize builder organ (coding agents + .env)    |
| `eve builder stack up`                      | Start builder Docker stack                         |
| `eve brain init`                            | Initialize Synap Data Pod + optional Ollama        |
| `eve arms install`                          | Install OpenClaw                                   |
| `eve eyes database init/up`                 | Database UI (Outerbase Studio)                     |
| `eve legs setup`                            | Set up Traefik                                     |
| `eve legs newt up`                          | Start Pangolin Newt tunnel                         |

### Debug & maintenance

| Command                              | Description                                          |
| ------------------------------------ | ---------------------------------------------------- |
| `eve inspect`                        | Dump entity state + config path + Docker containers  |
| `eve logs [service]`                 | View Docker compose logs                             |
| `eve config path`                    | Show config file path                                |
| `eve config show`                    | Show config YAML                                     |
| `eve config dump`                    | Dump full config as JSON                             |
| `eve config set-entity-name <name>`  | Set entity name                                      |

### `eve install` options

```
eve install [options]

Components:  --components traefik,synap,ollama,openclaw,rsshub,openwebui
AI:          --ai-mode local|provider|hybrid --ai-provider ollama|openrouter|anthropic|openai
Tunnel:      --tunnel pangolin|cloudflare --tunnel-domain <host>
Synap:       --domain <host> --email <email> --admin-email <email> --admin-password <secret> --admin-bootstrap-mode token|preseed --from-image --from-source
Builder:     --with-openclaw --with-rsshub
Other:       --model <model> --dry-run --json --yes --synap-repo <path>
```

### Open WebUI (chat UI add-on)

Open WebUI is a self-hosted chat interface pre-wired to the Synap Intelligence Service (IS) and Ollama. It runs as a Docker Compose profile — no separate database required (SQLite by default).

**Install:**

```bash
eve install --components openwebui   # standalone
eve install                          # pick "AI chat server" preset in the wizard
```

**What `eve install openwebui` does:**
1. Writes `/opt/openwebui/.env` with `SYNAP_API_KEY`, `SYNAP_IS_URL`, and a generated `WEBUI_SECRET_KEY`.
2. Configures the container to use `${SYNAP_IS_URL}/v1` as its OpenAI-compat endpoint (model aliases: `synap/auto`, `synap/balanced`, `synap/advanced`, `synap/complex`, `synap/free`).
3. Sets `OLLAMA_BASE_URL=http://eve-brain-ollama:11434` as a local fallback.
4. Joins `eve-network` so it can reach the IS and Synap backend (for MCP calls to `POST /mcp`).

**Start/stop:**

```bash
docker compose --profile openwebui up -d    # start
docker compose --profile openwebui down     # stop
```

**Update:**

```bash
eve update --only openwebui
# equivalent to: docker pull ghcr.io/open-webui/open-webui:main && docker restart hestia-openwebui
```

**Logs:** `docker logs hestia-openwebui`  
**Port:** `3011` (mapped to container `8080`)

### `eve add <component>` options

```
eve add <component> [options]

Component IDs: traefik, eve-dashboard, synap, ollama, openclaw, rsshub, hermes, openwebui, openwebui-pipelines, dokploy, opencode, openclaude

Options:
  --synap-repo <path>   Path to synap-backend checkout (for synap component)
  --model <model>       Ollama model (for ollama component, default: llama3.1:8b)
```

---

## After install: typical command flow

The recommended workflow uses the **composable installer**:

| Step | Command                                        | Purpose                                            |
| ---- | ---------------------------------------------- | -------------------------------------------------- |
| 1    | `eve install`                                  | Interactive wizard or `--components` flag          |
| 2    | `eve status`                                   | Verify everything is ready                         |
| 3    | `eve add openclaw` / `eve add rsshub`          | Add agent layer, data perception                   |
| 4    | `eve builder init <name>`                      | Set up coding agents (Hermes, OpenCode, etc.)      |
| 5    | `eve ai sync --workspace <uuid>`               | Optional: push provider policy to Synap            |

**Legacy flow (still supported):**

| Step | Command                                                  | Purpose                                            |
| ---- | -------------------------------------------------------- | -------------------------------------------------- |
| 1    | `eve setup --profile full`                               | Full install with AI                               |
| 2    | `eve builder init <name>`                                | Hub `.env` + skills for coding agents              |
| 3    | `eve legs setup` / `eve legs newt up`                    | Traefik / Pangolin connector                       |
| 4    | `eve arms install`                                       | OpenClaw                                           |
| 5    | `eve eyes database init …` / `up`                        | Postgres UI (needs outbound HTTPS for embed)       |
| 6    | `eve ai sync --workspace <uuid>`                         | Optional: push non-secret provider policy to Synap |

**Dry run first:**

```bash
eve install --dry-run --components traefik,synap,ollama
```

**AI / Hub helpers:**

```bash
eve ai status
eve ai providers list
eve ai sync --workspace <workspace-uuid> --check
eve ai sync --workspace <workspace-uuid>
```

---

## Requirements

- **Always:** Docker (for profiles and organs that run containers).
- **Light profiles:** ~2 CPU / 4 GB RAM.
- **`data_pod` / `full`:** follow **synap-backend** deploy guidance; **full** benefits from more RAM (and GPU if you run large local models).

---

## Roadmap (not guaranteed in CLI yet)

- TLS on the inference gateway (today often HTTP + Basic auth on localhost).
- Optional sidecars (e.g. Whisper) on `eve-network`.
- Richer CI: mocked `synap` for `data_pod` integration tests.

### Recently shipped

- **Dashboard lifecycle actions** — Install / Start / Stop / Restart / Update / Remove run from the drawer with live SSE progress; the dashboard and the CLI share the same code path via `@eve/lifecycle`.
- **Open WebUI Pipelines sidecar** (`openwebui-pipelines`) — Python sidecar that hooks Open WebUI into Synap. Three reference pipelines ship by default at `packages/@eve/lifecycle/assets/pipelines/`: `synap_memory_filter.py` (pre-prompt context injection from Hub Protocol), `synap_channel_sync.py` (one-way OWUI → Synap channel mirror), `synap_hermes_dispatch.py` (slash commands `/scaffold` `/deploy` `/fix` `/build` `/migrate` `/test` → Hermes tasks).
- **Doctor page** in the dashboard — mirrors `eve doctor` with inline Repair buttons (`create-eve-network`, `start-container`, `rewire-openclaw`).
- **Per-component config panels** in the drawer — RSSHub feeds, OpenClaw MCP servers + voice + messaging, Hermes daemon settings, Synap volume backups.
- **Networking page is writable** — domain set / edit / reset is now a real form that calls `POST /api/networking/domain` (same `TraefikService.configureSubdomains` code path as `eve domain set`).

---

## License

MIT — see [LICENSE](LICENSE).
