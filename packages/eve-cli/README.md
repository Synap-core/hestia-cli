# @eve/cli

The `eve` command — the entry point to every operation on the Eve
sovereign stack. Installs components, configures the AI fabric, manages
domains, drives the dashboard, repairs broken setups.

```bash
npm install -g @eve/cli
eve --help
```

This package is thin: the actual logic lives in the organ packages
(`@eve/brain`, `@eve/arms`, `@eve/eyes`, `@eve/legs`, `@eve/builder`)
and `@eve/dna`. The CLI wires them into a single Commander program.

---

## Command surface

```
eve --version
eve --help
```

### Lifecycle — get a stack running

| Command | What it does |
|---|---|
| `eve install` / `eve init` | Composable installer. Interactive wizard or `--components <list>` flag. Brings up Traefik, the dashboard, and whatever else you pick. |
| `eve setup` | Platform prerequisites (Docker / Compose / Node sanity checks). |
| `eve add <component>` | Install a single component. IDs: `traefik`, `eve-dashboard`, `synap`, `ollama`, `openclaw`, `rsshub`, `hermes`, `openwebui`, `openwebui-pipelines`, `dokploy`, `opencode`, `openclaude`. Delegates to `@eve/lifecycle` — same code path the dashboard uses, so install/remove/update behavior is identical from either surface. |
| `eve remove <component>` | Stop + remove a component (data volumes are kept by default). |
| `eve birth <name>` | Bootstrap a new "entity" (named workspace inside Synap). |
| `eve grow` | Pull updates and reconcile the running stack against the registry. |
| `eve status` | What's installed, what's running, what's missing. |

### Web dashboard

| Command | What it does |
|---|---|
| `eve ui` | Print the dashboard URL + login key, optionally open the browser. |
| `eve ui --rebuild` | Rebuild the Docker image from source and restart the container. |
| `eve ui --stop` | Stop and remove the dashboard container. |
| `eve ui --status` | Show whether the dashboard container is running. |
| `eve add eve-dashboard` | (Re-)install the dashboard container — same path as any other component. |

The dashboard is a separate package: see [`@eve/dashboard`](../eve-dashboard/README.md).

### AI fabric

| Command | What it does |
|---|---|
| `eve ai status` | Show configured providers and routing defaults. |
| `eve ai add <provider>` | Configure OpenAI / Anthropic / OpenRouter / Ollama. Stores key in `~/.eve/secrets.json`. |
| `eve ai wire` | Push the provider policy to wired components (e.g. OpenClaw `auth-profiles.json`). |
| `eve ai sync --workspace <uuid>` | Push provider policy to a Synap workspace. |

### Domain & networking

| Command | What it does |
|---|---|
| `eve domain set <host>` | Set the public hostname. With `--ssl --email <email>` Traefik provisions Let's Encrypt certs. |
| `eve domain repair` | Re-render Traefik config from secrets and reload the proxy. |
| `eve domain status` | Show domain, SSL state, exposed services. |

### Debug & repair

| Command | What it does |
|---|---|
| `eve doctor` | End-to-end diagnostic — Docker, network, secrets, registry consistency. |
| `eve logs <component>` | Stream `docker logs` for a component. |
| `eve inspect <component>` | Pretty-print the registry + live container state for a component. |

### Organs (advanced)

The CLI exposes each organ as a sub-program for fine-grained ops:

| Group | Owns |
|---|---|
| `eve brain …` | Synap, data stores, optional Ollama |
| `eve arms …` | OpenClaw (agent messaging layer) |
| `eve eyes …` | RSSHub (perception) |
| `eve legs …` | Traefik, domains, the dashboard container |
| `eve builder …` | OpenCode, OpenClaude, Dokploy, Hermes |

Each group has its own `--help`. These are mostly used internally by
the top-level commands above; the public API for day-to-day use is
`install / add / remove / status / doctor / ui`.

### Management

| Command | What it does |
|---|---|
| `eve config get <key>` / `eve config set <key> <value>` | Read / write `~/.eve/secrets.json` and registry settings. |
| `eve backup` / `eve update` | Snapshot + upgrade Synap data. |
| `eve purge` | Tear down the stack and (optionally) wipe data volumes. |

### Global flags

```
--json       Machine-readable output where supported
-y, --yes    Non-interactive / assume confirm
--verbose    Verbose logs
```

---

## Architecture

```
@eve/cli (this package)
└── thin Commander shell — registers commands, parses flags, dispatches

Depends on:
├── @eve/cli-kit    — colors, prompts, banners, global flag store
├── @eve/dna        — registry, secrets contract, entity state
├── @eve/lifecycle  — install / remove / update / start / stop primitives (shared with the dashboard); returns AsyncIterable<LifecycleEvent> the CLI consumes via spinners, the dashboard via SSE
├── @eve/brain      — Synap / data stores / Ollama
├── @eve/arms       — OpenClaw
├── @eve/eyes       — RSSHub
├── @eve/legs       — Traefik, domains, dashboard container
└── @eve/builder    — OpenCode / OpenClaude / Dokploy / Hermes
```

Each organ package exports a `register*Commands(program)` function that
attaches its sub-commands to a Commander program. The CLI's only job is
to wire them together and provide the lifecycle commands
(`install`, `add`, `remove`, `status`, `doctor`, `ui`, `domain`).

---

## Build

```bash
pnpm --filter @eve/cli build         # tsup → dist/index.js
pnpm --filter @eve/cli typecheck
pnpm --filter @eve/cli test          # vitest
```

The `bin` field maps `eve` → `dist/index.js`. After `pnpm build`, the
binary is available either via `pnpm exec eve` from the workspace root
or globally if you `npm link` / `pnpm install -g`.

---

## See also

- Root: [`hestia-cli/README.md`](../../README.md) — the full Eve product overview.
- Dashboard: [`packages/eve-dashboard/README.md`](../eve-dashboard/README.md) — the web UI counterpart.
- DNA: [`packages/@eve/dna`](../@eve/dna) — the registry + secrets contract every command reads from.
