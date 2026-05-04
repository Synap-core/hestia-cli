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

### Synap auth — per-agent Hub Protocol keys

Eve provisions a **separate** Hub Protocol API key for each consumer
that talks to Synap (Eve itself, OpenClaw, Hermes, OpenWebUI Pipelines).
Each one has its own pod-side user, audit trail, and revocation handle.
Keys are minted via `POST /api/hub/setup/agent` using the pod's
`PROVISIONING_TOKEN` (read from the pod's `deploy/.env`).

| Command | What it does |
|---|---|
| `eve auth status` | Table of every agent: key prefix, pod user, scopes, age, failure reason if any. |
| `eve auth status --agent <slug>` | Detail view for one agent (eve, openclaw, hermes, openwebui-pipelines). |
| `eve auth whoami [--agent <slug>]` | Tight one-liner. Defaults to the `eve` agent. |
| `eve auth provision` | Mint missing agent keys. Idempotent — skips agents that already have one. |
| `eve auth provision --agent <slug>` | Mint just one. |
| `eve auth renew --agent <slug>` | Rotate a single agent's key. |
| `eve auth renew --all` | Rotate every registered agent's key in one pass. |

How it's stored:

```json
{
  "synap": { "apiUrl": "https://pod.example.com", "apiKey": "<eve-key, mirrored>" },
  "agents": {
    "eve":                 { "hubApiKey": "...", "agentUserId": "...", "workspaceId": "..." },
    "openclaw":            { "hubApiKey": "...", "agentUserId": "...", "workspaceId": "..." },
    "hermes":              { "hubApiKey": "...", "agentUserId": "...", "workspaceId": "..." },
    "openwebui-pipelines": { "hubApiKey": "...", "agentUserId": "...", "workspaceId": "..." }
  }
}
```

The legacy `synap.apiKey` field is mirrored from the `eve` agent's key
for one-release back-compat — older readers keep working until they
move to `secrets.agents[<slug>]`.

When does Eve mint keys?

- **Fresh install** — every component install runs a post-hook that
  mints its agent's key (e.g. `eve add openclaw` mints
  `agents.openclaw`). Synap install also mints the always-on `eve`
  agent.
- **Post-update reconcile** — `eve update synap` checks the eve agent
  key and auto-renews on `key_revoked`/`expired`. Detects un-migrated
  installs and runs the legacy migration automatically.
- **Manual** — `eve auth provision` / `renew` whenever you want.

If a renew fails with `PROVISIONING_TOKEN unavailable`, set
`EVE_PROVISIONING_TOKEN=<token>` (the value from your pod's
`deploy/.env`) and retry, or run from the pod host so Eve can read
`deploy/.env` directly.

### Domain & networking

| Command | What it does |
|---|---|
| `eve domain set <host>` | Set the public hostname. With `--ssl --email <email>` Traefik provisions Let's Encrypt certs. |
| `eve domain repair` | Re-render Traefik config from secrets and reload the proxy. |
| `eve domain status` | Show domain, SSL state, exposed services. |

### How the CLI reaches the pod

Every Eve command that touches Synap (`auth provision`, `doctor`, the
update post-hooks, the builder workspace seeder) needs an HTTP base URL
for the pod. There are two of them, picked automatically:

| Where you run `eve` | URL the CLI hits | Why |
|---|---|---|
| **On the pod host** (synap-backend container detected, port 14000 reachable) | `http://127.0.0.1:14000` — the loopback published by Eve's `docker-compose.override.yml` | Same-host, sub-millisecond, doesn't depend on DNS or TLS. Works during install before any cert is minted. |
| **Off the pod host** (laptop, remote management) | `https://pod.<domain>` — the public Traefik route from `domain.primary` in `secrets.json` | Only path that traverses the network. Requires DNS + cert + Traefik routing to be healthy. |

The transport is plain `fetch` in both cases — same HTTP semantics,
same retry/timeout knobs. The choice is purely a URL question; there
is no separate "docker-exec" code path in the happy flow. (The
`DockerExecRunner` is still exported as a `eve doctor` break-glass
diagnostic for the rare "the host port is bound but the public URL
fails" case.)

The 14000 port mapping is loopback-only (`127.0.0.1:14000:4000` in
Compose terms) — the host firewall, the Docker bridge, and the public
network see nothing on that port. Anyone with access to the host
already has root-equivalent on `/opt/synap-backend`, so this isn't a
new attack surface.

If you have your own `docker-compose.override.yml` for the synap
deploy, Eve's `ensureSynapLoopbackOverride` won't clobber it (it looks
for a magic marker comment) — the CLI silently falls back to the
public URL. Drop the marker line in if you want both your overrides
and Eve's loopback port. Full design:
[`team/devops/eve-cli-transports.mdx`](https://github.com/synap-app/synap-team-docs/blob/main/content/team/devops/eve-cli-transports.mdx).

### Image pruning on update

`eve update synap` and the from-image install path keep the **last 3
versions** of every image they pull (`ghcr.io/synap-core/backend`,
`ghcr.io/synap-core/pod-agent`, etc.) and remove older tags. The
in-flight image is always protected — Docker refuses `rmi` on an
image that has a running container, and the prune step runs *after*
the new container is up. Skipped images (still in use by another
container) are reported but never abort the update.

This solves the "pod host runs out of disk after a year of weekly
updates" failure mode without anyone needing to run `docker rmi`
manually. The keep-count is fixed at 3 (giving you 2 rollback steps
plus the live image); change it via the `pruneImages.keep` field on a
component's `UpdatePlan` in `@eve/lifecycle/src/index.ts`.

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
