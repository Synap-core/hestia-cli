# Eve (Hestia CLI monorepo)

This repository is a **pnpm monorepo** that builds **`eve`**: a command-line installer and operator for a **self-hosted stack** around **Synap** (your Data Pod) and optional sidecars (local LLMs, tunnels, builder tooling, OpenClaw, RSSHub, database UI).

If you only remember one thing: **Synap is the "heart" (data + Hub + governance). Eve is the "hands" (Docker sidecars + wiring + secrets + convenience).** Eve does not replace Synap's server; it orchestrates what runs *next to* it.

---

## What Eve actually does

1. **Composable install** — `eve install` lets you pick which components to install (Synap, Ollama, Traefik, OpenClaw, RSSHub, builder tools). An interactive wizard or CLI flags (`--components`, `--ai-mode`, `--tunnel`, etc.) drive the flow.
2. **Legacy setup** — `eve setup` still works with three profiles (`inference_only`, `data_pod`, `full`) for backward compatibility with bootstrap scripts.
3. **Add / remove components** — `eve add <component>` and `eve remove <component>` let you grow or shrink your entity after the initial install.
4. **Entity health** — `eve status` shows organ and component tables; `eve doctor` runs diagnostics with fix suggestions.
5. **Hub wiring for agents** — Builder flows write project `.env` and skill layout so coding agents can call Synap's **Hub** with an API key and skills.
6. **Explicit sync to Synap workspace settings** — `eve ai sync` pushes **non-secret** "provider routing" policy to the pod when your backend exposes the Hub route.

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
┌─────────────────────────────────────────────────────────────────┐
│  Your server / VM                                                │
│                                                                  │
│  Synap Data Pod (optional)     ←── eve install --components synap │
│  • Caddy :80 / :443            ←── synap install (delegated)     │
│  • API :4000                    ←── synap.apiUrl in secrets        │
│  • Hub /api/hub               ←── HUB_BASE_URL + synap.apiKey    │
│                                                                  │
│  Eve sidecars (optional)       ←── eve install / eve add          │
│  • Traefik gateway :11435      ←── always installed              │
│  • Ollama (Docker network)     ←── eve install --components ollama│
│  • eve-network (Docker)      ←── shared bridge for sidecars     │
│                                                                  │
│  Developer "hand" (optional)   ←── eve builder init               │
│  • OpenCode / OpenClaude / Claude Code + .env + ~/.eve/skills    │
└─────────────────────────────────────────────────────────────────┘
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

Eve's composable installer works with a registry of 9 components across 6 categories:

| Component        | Organ    | Category       | Always? | Prerequisites  |
| ---------------- | ---------|----------------|---------|----------------|
| Traefik          | Legs     | infrastructure | yes     | —              |
| Ollama           | Brain    | data           | no      | traefik        |
| Synap Data Pod   | Brain    | data           | no      | traefik        |
| OpenClaw         | Arms     | agent          | no      | synap          |
| Hermes           | Builder  | builder        | no      | synap          |
| RSSHub           | Eyes     | perception     | no      | synap          |
| Dokploy          | Builder  | add-on         | no      | —              |
| OpenCode         | Builder  | add-on         | no      | —              |
| OpenClaude       | Builder  | add-on         | no      | —              |

- **Always** components (Traefik) are installed unconditionally.
- **Add-on** components are excluded from the default wizard selection and installed manually.

---

## Packages in this monorepo

Only these workspaces are built and published from this tree:

| Package          | Role                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| `@eve/cli`       | `eve` binary — all user-facing commands                                                 |
| `@eve/dna`       | Shared schemas: secrets, setup profile, USB manifest, builder/Hub helpers, state manager |
| `@eve/brain`     | Synap delegation, `runBrainInit`, `runInferenceInit`, Ollama / Postgres / Redis helpers |
| `@eve/legs`      | Traefik, inference gateway, `eve legs newt` (Pangolin Newt)                             |
| `@eve/arms`      | OpenClaw install / wiring                                                               |
| `@eve/eyes`      | RSSHub + `eve eyes database` (Outerbase Studio runner)                                  |
| `@eve/builder`   | OpenCode, OpenClaude, Claude Code, Dokploy (optional), builder stack, sandbox           |
| `@eve/usb`       | USB / Ventoy helpers used by `eve birth`                                                |
| `@eve/install`   | Server install script assets                                                            |
| `@eve/cli-kit`   | Shared CLI flags / JSON output helpers                                                  |
| `types`, `utils` | Small shared TS utilities                                                               |

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

Components:  --components traefik,synap,ollama,openclaw,rsshub
AI:          --ai-mode local|provider|hybrid --ai-provider ollama|openrouter|anthropic|openai
Tunnel:      --tunnel pangolin|cloudflare --tunnel-domain <host>
Synap:       --domain <host> --email <email> --admin-email <email> --admin-password <secret> --admin-bootstrap-mode token|preseed --from-image --from-source
Builder:     --with-openclaw --with-rsshub
Other:       --model <model> --dry-run --json --yes --synap-repo <path>
```

### `eve add <component>` options

```
eve add <component> [options]

Component IDs: traefik, synap, ollama, openclaw, rsshub, hermes, dokploy, opencode, openclaude

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

---

## License

MIT — see [LICENSE](LICENSE).
