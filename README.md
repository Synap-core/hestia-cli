# Eve (Hestia CLI monorepo)

This repository is a **pnpm monorepo** that builds **`eve`**: a command-line installer and operator for a **self-hosted stack** around **Synap** (your Data Pod) and optional sidecars (local LLMs, tunnels, builder tooling, OpenClaw, RSSHub, database UI).

If you only remember one thing: **Synap is the “heart” (data + Hub + governance). Eve is the “hands” (Docker sidecars + wiring + secrets + convenience).** Eve does not replace Synap’s server; it orchestrates what runs *next to* it.

---

## What Eve actually does

1. **Guided setup** — `eve setup` is organized around **three paths**: **inference only** (local models + gateway, no Synap; `inference_only`), **Synap only** — the Data Pod / “the rest” without Eve’s Ollama bundle (`data_pod`), or **both** (Synap then sidecar inference; `full`). It can persist **AI foundation** choices (local vs cloud providers, hybrid, fallback) into `.eve/secrets/secrets.json`.
2. **Organ commands** — “Brain / Arms / Eyes / Legs / Builder” map to real Docker flows and scripts (Ollama + gateway, Traefik, OpenClaw, RSSHub, OpenCode / OpenClaude / Claude Code, Dokploy optional, etc.).
3. **Hub wiring for agents** — Builder flows write project **`.env`** and skill layout so OpenCode / OpenClaude / Claude Code can call Synap’s **Hub** with an API key and skills (see [docs/EVE_SETUP_PROFILES.md](docs/EVE_SETUP_PROFILES.md)).
4. **Explicit sync to Synap workspace settings** — `eve ai sync` pushes **non-secret** “provider routing” policy to the pod when your backend exposes the Hub route (see [docs/AI_ROUTING_CONSOLIDATION_ADR.md](docs/AI_ROUTING_CONSOLIDATION_ADR.md)).

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


Synap itself (PostgreSQL, Redis, Caddy, API, etc.) lives in the **synap-backend** repository. Eve **calls** the official **`synap`** shell installer when you use `data_pod` / `full` with `--synap-repo` or `SYNAP_REPO_ROOT`.

---

## How the pieces connect (mental wiring)

```
┌─────────────────────────────────────────────────────────────────┐
│  Your server / VM                                                │
│                                                                  │
│  Synap Data Pod (optional)     ←── eve setup --profile data_pod  │
│  • Caddy :80 / :443            ←── synap install (delegated)     │
│  • API :4000                    ←── synap.apiUrl in secrets        │
│  • Hub /api/hub               ←── HUB_BASE_URL + synap.apiKey    │
│                                                                  │
│  Eve sidecars (optional)       ←── eve brain / legs / arms / …   │
│  • Traefik gateway :11435      ←── inference_only / full        │
│  • Ollama (Docker network)     ←── full / inference_only          │
│  • eve-network (Docker)      ←── shared bridge for sidecars     │
│                                                                  │
│  Developer “hand” (optional)   ←── eve builder init               │
│  • OpenCode / OpenClaude / Claude Code + .env + ~/.eve/skills    │
└─────────────────────────────────────────────────────────────────┘
```

**Important split (avoid confusion):**

- **Synap internal routing** — which *Intelligence Service* instance the pod uses (`intelligenceServiceId`, etc.). Owned by Synap.
- **Eve “provider routing”** — which *model vendor* (Ollama, OpenRouter, Anthropic, OpenAI) your **local tooling** prefers. Stored in `.eve/secrets/secrets.json`; optionally synced into workspace JSON as `**eveProviderRouting`** via `eve ai sync` (see ADR).

**State files you will see on disk:**


| Path                           | Role                                                                    |
| ------------------------------ | ----------------------------------------------------------------------- |
| `.eve/setup-profile.json`      | Last chosen `eve setup` profile + AI / tunnel hints                     |
| `.eve/secrets/secrets.json`    | Merged secrets: `synap.*`, `ai.*`, `inference.*`, `builder.*`, `arms.*` |
| `~/.eve/skills/synap/SKILL.md` | Stub skill path for Hub usage                                           |


---

## Packages in this monorepo

Only these workspaces are built and published from this tree:


| Package          | Role                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| `@eve/cli`       | `**eve`** binary — all user-facing commands                                             |
| `@eve/dna`       | Shared schemas: secrets, setup profile, USB manifest, builder/Hub helpers               |
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

`bootstrap.sh` installs **ca-certificates, curl, git**, **Docker** (get.docker.com), **Node 20** (NodeSource), **pnpm 10**, clones **hestia-cli**, builds the workspace, then **runs `eve setup`** (interactive wizard unless you pass flags after `--`).

Canonical repo: **[github.com/Synap-core/hestia-cli](https://github.com/Synap-core/hestia-cli)**. Pin `main` or another branch in the raw URL if you need a specific revision; forks can swap the org/repo in both URLs.

```bash
curl -fsSL "https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh" | sudo bash -s -- \
  --repo "https://github.com/Synap-core/hestia-cli.git"
```

**Non-interactive** (CI / cloud-init) — pass `eve setup` flags after `--`:

```bash
curl -fsSL "https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh" | sudo bash -s -- \
  --repo "https://github.com/Synap-core/hestia-cli.git" -- \
  --yes --profile inference_only
```

**Install only, no wizard** (you will run setup yourself):

```bash
curl -fsSL "https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh" | sudo bash -s -- \
  --repo "https://github.com/Synap-core/hestia-cli.git" --no-setup
```

**Custom install directory** (default is `/opt/eve`):

```bash
curl -fsSL "https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh" | sudo bash -s -- \
  --dir /srv/eve --repo "https://github.com/Synap-core/hestia-cli.git"
```

**Using environment variables** (works with `sudo -E` so the child sees them):

```bash
export EVE_BOOTSTRAP_REPO='https://github.com/Synap-core/hestia-cli.git'
export EVE_BOOTSTRAP_DIR='/opt/eve'
curl -fsSL "https://raw.githubusercontent.com/Synap-core/hestia-cli/main/bootstrap.sh" | sudo -E bash -s --
```

**TTY note:** piping through `curl | sudo bash` can leave **stdin non-interactive**. For a full interactive `eve setup`, SSH into the server and run `cd /opt/eve && pnpm exec eve setup` after a `--no-setup` bootstrap, or use a PTY (`ssh -t`). Non-interactive flows should use `--yes` / `--json` flags after `--` as above.

The script file is **[bootstrap.sh](bootstrap.sh)** at the repo root (same path on `raw.githubusercontent.com`).

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
pnpm exec eve --help
pnpm exec eve setup --dry-run --profile inference_only
```

Optional: link globally from the workspace (pick one workflow your team uses):

```bash
pnpm --filter @eve/cli link --global
eve --help
```

### 2) Greenfield server when you already have the repo tarball / git mirror

If you copied `**bootstrap.sh**` onto the machine (or cloned the repo out-of-band), run it as root from disk:

```bash
sudo ./bootstrap.sh --repo 'https://github.com/Synap-core/hestia-cli.git'
# optional: --no-setup then later: cd /opt/eve && pnpm exec eve setup
```

Same behavior as the curl one-liner in **§0**; only the script source differs.

### 3) Non-interactive / CI / cloud-init

Use `**--yes`**, `**--json**`, and explicit flags (see [docs/EVE_SETUP_PROFILES.md](docs/EVE_SETUP_PROFILES.md)):

```bash
pnpm exec eve --json setup --dry-run --profile data_pod
pnpm exec eve setup --yes --profile data_pod --synap-repo /path/to/synap-backend --domain pod.example.com
```

### 4) Synap already installed; Eve only for sidecars

Point Eve at your checkout of **synap-backend**:

```bash
export SYNAP_REPO_ROOT=/path/to/synap-backend
pnpm exec eve brain init --synap-repo "$SYNAP_REPO_ROOT"
# or use eve setup --profile data_pod with --synap-repo
```

Use `**synap**` inside that repo for pod lifecycle; use `**eve**` for legs/builder/arms/eyes extras.

### 5) USB → bare metal

1. `eve birth usb` (see command help) — may write `~/.eve/usb-profile.json`.
2. After OS install, optionally place manifest at `**/opt/eve/profile.json**`.
3. On the server: `eve setup` (manifest pre-selects profile where supported).

### 6) Verification script (`verify.sh`)

`pnpm run verify` runs `**verify.sh**`. It expects **bash 4+** (associative arrays). On macOS, system bash is often 3.2 — use a modern bash (Homebrew) or run verification on your **Linux VM**.

---

## After install: typical command flow


| Step | Command                                                  | Purpose                                            |
| ---- | -------------------------------------------------------- | -------------------------------------------------- |
| 1    | `eve setup`                                              | Profiles + AI foundation + secrets                 |
| 2    | `eve builder init <name> [--engines …] [--with-dokploy]` | Hub `.env` + skills for coding agents              |
| 3    | `eve legs setup` / `eve legs newt up`                    | Traefik / Pangolin connector                       |
| 4    | `eve arms install`                                       | OpenClaw                                           |
| 5    | `eve eyes database init …` / `up`                        | Postgres UI (needs outbound HTTPS for embed)       |
| 6    | `eve ai sync --workspace <uuid>`                         | Optional: push non-secret provider policy to Synap |


**Dry run first:**

```bash
eve setup --dry-run --profile full
```

**AI / Hub helpers:**

```bash
eve ai status
eve ai providers list
eve ai sync --workspace <workspace-uuid> --check
eve ai sync --workspace <workspace-uuid>
```

---

## `eve setup` profiles (short reference)

Same **three paths** as above, in one table:

| Path | Profile | You get |
|------|---------|---------|
| **Inference only** | `inference_only` | Ollama + Traefik gateway (e.g. `:11435`), no Synap |
| **Synap only** (Data Pod; no Eve Ollama bundle) | `data_pod` | Synap via `synap install` (Caddy on 80/443) |
| **Both** | `full` | Synap first, then Ollama on Docker network + gateway |


Full flags and examples: [docs/EVE_SETUP_PROFILES.md](docs/EVE_SETUP_PROFILES.md).

---

## Documentation map


| Doc                                                                          | Purpose                                       |
| ---------------------------------------------------------------------------- | --------------------------------------------- |
| **This README**                                                              | What Eve is, tech, wiring, install paths      |
| [docs/EVE_SETUP_PROFILES.md](docs/EVE_SETUP_PROFILES.md)                     | Profiles, ports, USB manifest, automation     |
| [docs/AI_ROUTING_CONSOLIDATION_ADR.md](docs/AI_ROUTING_CONSOLIDATION_ADR.md) | Synap IS routing vs Eve provider routing      |
| [commands.manifest.yaml](commands.manifest.yaml)                             | Command inventory (`pnpm run check:manifest`) |
| [ARCHITECTURE_CLEANUP_COMPLETE.md](ARCHITECTURE_CLEANUP_COMPLETE.md)         | Repo layout history                           |


---

## Requirements

- **Always:** Docker (for profiles and organs that run containers).
- **Light profiles:** ~2 CPU / 4 GB RAM.
- `**data_pod` / `full`:** follow **synap-backend** deploy guidance; **full** benefits from more RAM (and GPU if you run large local models).

---

## Roadmap (not guaranteed in CLI yet)

- TLS on the inference gateway (today often HTTP + Basic auth on localhost).
- Optional sidecars (e.g. Whisper) on `eve-network`.
- Richer CI: mocked `synap` for `data_pod` integration tests.

---

## License

MIT — see [LICENSE](LICENSE).