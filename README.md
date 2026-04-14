# Hestia CLI & Eve

**Hestia CLI** is a pnpm monorepo that ships **Eve** (`eve`): a logical, organ-based installer and operator for a sovereign stack. **Synap** (Data Pod) is the production-grade backend; Eve can **delegate** to the official `synap` bash CLI or run a **minimal local brain** for development.

This README is the **single overview**: packages, capabilities, user flows, how `eve setup` fits in, and what is planned next.

---

## Documentation map

| Doc | Purpose |
|-----|---------|
| **This README** | Project scope, flows, Synap vs Eve, roadmap |
| [docs/EVE_SETUP_PROFILES.md](docs/EVE_SETUP_PROFILES.md) | Three profiles, ports, USB manifest, automation flags |
| [docs/AI_ROUTING_CONSOLIDATION_ADR.md](docs/AI_ROUTING_CONSOLIDATION_ADR.md) | Canonical routing ownership: Synap IS routing vs Eve provider routing |
| [ARCHITECTURE_CLEANUP_COMPLETE.md](ARCHITECTURE_CLEANUP_COMPLETE.md) | Repo history / canonical layout |
| [commands.manifest.yaml](commands.manifest.yaml) | Command inventory (`pnpm run check:manifest`) |
| [docs/north-star.md](docs/north-star.md), [docs/service-reference.md](docs/service-reference.md), … | Deeper product / ADR style notes |

Older root `*.md` files may mention removed paths; prefer the table above.

---

## Packages (monorepo)

| Package | Role |
|---------|------|
| `@eve/cli` | **`eve`** entrypoint — lifecycle, organs, debug, `eve setup` |
| `@eve/brain` | Synap delegation, `runBrainInit`, `runInferenceInit`, Ollama/Postgres/Redis services |
| `@eve/legs` | Traefik, inference gateway, **`eve legs newt`** (Pangolin Newt on `eve-network`) |
| `@eve/arms`, `@eve/eyes`, `@eve/builder` | OpenClaw; RSSHub + **Outerbase Studio** (`eve eyes database`); OpenCode / OpenClaude / **Claude Code** + Dokploy + **`eve builder sandbox`** |
| `@eve/dna` | Entity state, setup profile JSON (`.eve/setup-profile.json`), USB manifest types, **hardware probe** |
| `@eve/usb`, `@eve/install` | USB creation wizard, server install scripts; **`hestia usb`** vs **`eve birth usb`** |

---

## User experience principles

1. **Logical guidance only** — prompts explain *what* you are choosing (profiles, ports), not LLM-style coaching.
2. **One front door for greenfield installs** — prefer **`eve setup`** for the three paths; use **`eve init` / `eve brain init`** for fine-grained or legacy flows.
3. **Delegation over duplication** — Data Pod installs go through **`synap install`** when `SYNAP_REPO_ROOT` or `--synap-repo` is set; Synap keeps **Caddy** on 80/443. Eve adds **Traefik** only where needed (e.g. Ollama gateway, extra sites).
4. **Re-runnable** — `eve setup --dry-run` plans without writing; existing `.eve/setup-profile.json` triggers a confirm before overwrite (interactive).
5. **Automation-friendly** — global **`--json`**, **`--yes`**, and profile-specific flags for CI or cloud-init.

---

## Three-path setup (`eve setup`) — shipped

| Profile | User intent | What runs |
|---------|-------------|-----------|
| **`inference_only`** | Local models + secured HTTP API | Ollama (Docker) + Traefik gateway (**`:11435`**, Basic auth). Credentials under `.eve/secrets/`. |
| **`data_pod`** | Full Synap stack only | `synap install` from repo path; **Caddy** edge unchanged. |
| **`full`** | Synap + local Ollama | Data Pod first, then Ollama **without** host `:11434` + same gateway on `:11435`. |

```bash
eve setup                              # interactive wizard
eve setup --dry-run --profile full     # plan only
eve setup --yes --profile data_pod --synap-repo /path/to/synap-backend --domain localhost
```

Details: [docs/EVE_SETUP_PROFILES.md](docs/EVE_SETUP_PROFILES.md).

---

## User flows (how pieces connect)

### Recommended order (central Builder organ first)

1. **AI + Secrets / Hub** — Run **`eve setup`** first to choose AI mode (`local|provider|hybrid`), provider + fallback, then persist **`synap.apiKey`** and optional **`DOKPLOY_WEBHOOK_URL`** before builder work. This is Eve-side **provider routing**, not Synap internal IS routing.
2. **Builder organ (one place for “hand”)** — **`eve builder init <name>`** wires **OpenCode**, **OpenClaude**, and/or **Claude Code** (see `--engines`). **Dokploy is off by default**; add **`--with-dokploy`** only if you really use it (often overkill vs webhook + static hosting).
3. **Then edge / other organs** — **`eve legs setup`**, **`eve legs newt up`**, **`eve builder stack up`**, **`eve arms install`**, **`eve eyes database …`**, in whatever order your topology needs.

### A. From zero on a server (recommended)

1. Install Docker + clone this repo + `pnpm install && pnpm run build` — or use **`bootstrap.sh`** (root of this repo) with **`EVE_BOOTSTRAP_REPO`** set to your clone URL for an opinionated apt + Docker + Node 20 + pnpm path.
2. Run **`eve setup`** and pick a profile (or use `--yes --profile …`). The wizard now starts with AI foundation choices (mode/provider/fallback). For **`data_pod`** / **`full`**, optionally choose **Pangolin** or **Cloudflare** for Legs, or pass **`--tunnel`** / **`--tunnel-domain`**.
3. **`eve builder init <project>`** — Hub **`.env`** + skills for OpenCode / OpenClaude / Claude Code; use **`--with-dokploy`** only if you want Dokploy.
4. Optional: **`eve builder stack up`** (static site `http://127.0.0.1:9080`) or **`eve builder sandbox up`** (Node + workspace-only mount for OpenCode).
5. **Pangolin site connector** — fill `.eve/legs/newt.env` then **`eve legs newt up`** (fosrl/newt on `eve-network`).
6. **Database UI** — **`eve eyes database init --database-url postgres://…`** then **`eve eyes database up`** (Outerbase Studio npm CLI; UI embeds `studio.outerbase.com` — needs outbound HTTPS).
7. Grow other organs: **`eve grow`**, **`eve arms install`**, etc., as needed.

**Hub wiring recap:** `.eve/secrets/secrets.json` now includes `ai.mode`, `ai.defaultProvider`, `ai.fallbackProvider`, and provider entries, plus **`synap.apiKey`** (same as OpenClaw when the pod is installed). Builder projects get **`.env`** with **`HUB_BASE_URL`**, **`EVE_SKILLS_DIR`**, **`DOKPLOY_WEBHOOK_URL`**. **Claude Code** uses **`.claude/settings.json`** + **`.claude/skills/`** ([skills](https://code.claude.com/docs/en/skills)). For consolidation rules, see [AI routing ADR](docs/AI_ROUTING_CONSOLIDATION_ADR.md).
When you want workspace-level sync, run **`eve ai sync --workspace <workspace-uuid>`** (explicit, non-secret provider policy only).

### B. USB → bare metal → Eve

1. **`hestia usb create`** (or `eve birth usb`) to build media; on success, **`~/.eve/usb-profile.json`** may be written.
2. After OS install, copy manifest to **`/opt/eve/profile.json`** (optional) so **`eve setup`** pre-suggests a profile.
3. Run **`eve setup`** on the server.

### C. Synap-only operator (no Eve brain containers)

Set **`SYNAP_REPO_ROOT`** (or pass **`--synap-repo`** to `eve brain init` / `eve setup`) so installs call the **`synap`** script in `synap-backend`. Use **`synap health`**, **`synap profiles`**, etc., for the pod; use Eve for **RSSHub, builder stack, legs** around it.

### D. Legacy / granular path

- **`eve init`** = **`eve brain init`** (Eve-managed Docker brain *or* delegated Synap via flags).
- **`eve doctor`**, **`eve status`**, organ subcommands unchanged.

---

## Synap vs Eve (mental model)

| Topic | Synap Data Pod | Eve (minimal / sidecar) |
|--------|----------------|-------------------------|
| Edge TLS | **Caddy** (compose) | Traefik for **optional** services (inference gateway, custom routes) |
| API / graph | Backend compose | Delegates to `synap` when configured |
| Local LLM | Not required | **Ollama** + gateway for `inference_only` / `full` |
| Source of truth for pod install | **`synap-backend/synap`** | Eve **calls** it; does not reimplement compose |

---

## Capabilities: shipped vs roadmap

**Shipped today**

- `eve setup` (three profiles, USB manifest hint, hardware prompts, `--dry-run` / `--json`).
- `runBrainInit` / `runInferenceInit`, inference Traefik container **`eve-inference-gateway`**.
- `eve builder stack up|down|status` (nginx + `.eve/builder-site/public`).
- USB create → **`~/.eve/usb-profile.json`**; `readUsbSetupManifest()` for `/opt/eve/profile.json` and **`EVE_SETUP_MANIFEST`**.
- Delegation: OpenClaw / RSSHub aware of Synap repo when env set (see package changelogs).

**Roadmap / future-hardening** (not promised in the CLI yet)

- **TLS** on the inference gateway (currently HTTP + Basic auth on localhost).
- **Whisper** (or other sidecar) on `eve-network` + optional route through gateway.
- **Deeper Dokploy / OpenCode** in Docker (today: CLI + static site stack; Dokploy remains discovery-oriented).
- **`eve legs synap-note`** (or similar): print `synap health` hint when `SYNAP_REPO_ROOT` is set.
- **CI**: mocked `synap` + fake repo tree for `data_pod` integration tests.

---

## Quick start (development)

```bash
git clone <repo-url>
cd hestia-cli
pnpm install
pnpm run build

# Recommended first run
pnpm exec eve setup --dry-run --profile inference_only

# Or full Synap path (requires synap-backend checkout)
pnpm exec eve setup --yes --profile data_pod --synap-repo /path/to/synap-backend --domain localhost
```

Global install: use your package link / publish flow; binary is **`eve`** from `@eve/cli`.

---

## Organ anatomy (conceptual)

```
Entity (Eve)
├── Brain    — Synap Data Pod and/or Ollama + data stores
├── Arms     — OpenClaw, MCP
├── Builder  — OpenCode, OpenClaude, Dokploy, builder stack (nginx)
├── Eyes     — RSSHub (or Synap profile when delegated)
└── Legs     — Traefik, tunnels, inference gateway
```

Shared Docker network: **`eve-network`** (create-on-demand where used).

---

## Core commands (cheat sheet)

```bash
eve setup --help           # three paths + extended help
eve init / eve brain init  # brain only (see --synap-repo)
eve status / eve doctor
eve grow
eve birth usb              # bootable USB script
eve builder stack up       # static site :9080
eve legs … / eve eyes … / eve arms …
```

---

## Technology stack

Docker, Commander, clack (prompts), pnpm workspaces. Synap stack: PostgreSQL, Redis, Caddy, etc. (see **synap-backend** repo).

---

## Requirements

- **Minimum**: Docker, 2 CPU, 4 GB RAM (light profiles).
- **Data Pod / full**: follow **synap-backend** deploy docs; **full** + local models benefits from more RAM/GPU.

---

## License

MIT — see [LICENSE](LICENSE).
