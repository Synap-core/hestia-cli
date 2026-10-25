# Eve architecture

> Verified against code on 2026-10-20 (hestia-cli@c63846f, with the backend
> side checked in Synap-core/backend@cc4b2d81).

Eve (`eve`, this repository) installs and operates a self-hosted stack around
a Synap pod: the pod itself, an edge proxy, local models, agents, chat UIs,
feeds and builder tools, plus a web dashboard. The pod
([Synap-core/backend](https://github.com/Synap-core/backend)) owns data, the
Hub Protocol and governance; Eve owns the containers next to it and the
wiring between them. The [README](../README.md) is the user-facing overview.

## Packages

| Package (path)                                                                                             | Holds                                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `@synap-core/eve` (`packages/eve-cli`)                                                                     | the `eve` binary: Commander commands in `src/commands/`                                                    |
| `@eve/dna` (`packages/@eve/dna`)                                                                           | the component registry, secrets contract, agent registry, URL resolution, Compose overrides, image pruning |
| `@eve/lifecycle`                                                                                           | install, update and remove plans per component                                                             |
| `@eve/brain`                                                                                               | the Synap pod (delegating to the backend's `synap` CLI), Ollama, inference gateway                         |
| `@eve/legs`                                                                                                | Traefik, domains, tunnels (`eve legs`)                                                                     |
| `@eve/arms`                                                                                                | OpenClaw (`eve arms`)                                                                                      |
| `@eve/eyes`                                                                                                | RSSHub (`eve eyes`)                                                                                        |
| `@eve/builder`                                                                                             | coding engines, Hermes commands, Dokploy, sandbox (`eve builder`)                                          |
| `@eve/mouth`                                                                                               | the mail organ (Stalwart)                                                                                  |
| `packages/eve-dashboard`                                                                                   | the web dashboard                                                                                          |
| `@eve/cli-kit`, `@eve/types`, `@eve/utils`, `@eve/install`, `@eve/usb`                                     | shared CLI output and flags, types, utilities, server install assets, USB media                            |
| `@eve/fields`, `@eve/profile-renderer`, `@eve/view-renderer`, `@eve/vault`, `packages/@synap-core/chat-ui` | UI building blocks for Eve OS apps                                                                         |

## Components

`COMPONENTS` in `packages/@eve/dna/src/components.ts` is the single registry:
each entry has an organ, a category, prerequisites, its container, ports and
subdomain, health check and lifecycle rules. Commands, the dashboard and the
doctor all read it.

| Component                                                    | Organ | Container                                   | Subdomain   | Notes                                           |
| ------------------------------------------------------------ | ----- | ------------------------------------------- | ----------- | ----------------------------------------------- |
| `traefik`                                                    | legs  | `eve-legs-traefik`                          | none        | always installed; the edge proxy                |
| `eve-dashboard`                                              |       | `eve-dashboard` (host 7979, container 3000) | `eve`       | always installed                                |
| `synap`                                                      | brain | `eve-brain-synap` (4000, no host port)      | `pod`       | requires traefik                                |
| `pod-admin`                                                  | brain | `eve-brain-pod-admin`                       | `pod-admin` | requires synap                                  |
| `ollama`                                                     | brain | `eve-brain-ollama` (11434)                  | `ai`        |                                                 |
| `hermes`                                                     | arms  | `eve-builder-hermes` (8642)                 | `hermes`    | recommended agent                               |
| `openclaw`                                                   | arms  | `eve-arms-openclaw` (18789)                 | `openclaw`  | deprecated in favour of Hermes, still supported |
| `rsshub`                                                     | eyes  | `eve-eyes-rsshub` (1200)                    | `feeds`     |                                                 |
| `openwebui`                                                  |       |                                             |             | add-on, requires synap                          |
| `stalwart`, `bulwark`                                        | mouth |                                             |             | mail                                            |
| `nango`, `postiz`                                            | arms  |                                             |             | connectors, social posting                      |
| `freellmapi`, `omniroute`                                    | brain |                                             |             | model gateways (add-ons)                        |
| `opencode`, `openclaude`, `claude-code`, `t3code`, `dokploy` |       |                                             |             | builder add-ons                                 |

Read the registry for the current list; this table is a snapshot.

## Edge and routing

On an Eve host, **Traefik (`eve-legs-traefik`) is the only edge proxy** on 80
and 443, on the Docker network `eve-network`. With a domain set, each service is
reachable at `<subdomain>.<domain>` (the pod at `pod.<domain>`) and Traefik
obtains certificates for them. When Eve runs the backend's installer it sets
`SYNAP_SKIP_EDGE=1`, so the pod's own Caddy does not start and does not compete
for port 80 (`packages/@eve/brain/src/lib/synap-cli-delegate.ts`).

Tunnels (`packages/@eve/legs/src/lib/tunnel.ts`) support `pangolin` and
`cloudflare`; `eve legs newt` manages a Pangolin site connector. `eve legs
domain`, `proxy-mode`, `restart` and `status` manage the rest.

## The pod, through the backend's CLI

Eve does not reimplement the pod's install or update. It calls the backend's
`synap` script (`<repo>/synap`, the repository found through `SYNAP_REPO_ROOT`
or `/opt/synap-backend`) with `cwd` and `SYNAP_DEPLOY_DIR` set to the
repository's `deploy/` directory, and layers Eve's concerns on top: the
`eve-network`, agent keys, AI wiring and the Kratos webhook. `eve update synap`
runs `synap update` for a published release, which backs up, canaries and
rolls back on its own, and keeps the previous release's images for rollback,
so Eve does not prune the pod's images.

Eve passes the pod's full hostname (`pod.<domain>`) to the installer: the
backend's Kratos configuration uses the domain it is given as is.

### The Compose override

Eve writes `docker-compose.override.yml` next to the pod's Compose file
(`ensureSynapLoopbackOverride`, `packages/@eve/dna/src/synap-overrides.ts`),
regenerated on install and on `eve update synap`, before the synap CLI runs
(so the update's `compose up` applies it). It adds:

- a host port bound to loopback only, `127.0.0.1:14000` to the backend's 4000
  (`SYNAP_HOST_LOOPBACK_PORT`), for the on-host CLI;
- membership of `eve-network` for the backend (alias `eve-brain-synap`),
  pod-admin, realtime and minio (alias `eve-brain-minio`), so Traefik and other
  containers reach them by name, across container recreates.

Traefik's routes (`eve-routes.yml`, `packages/@eve/legs/src/lib/traefik.ts`)
send `pod.<domain>/<bucket>/*` to minio:9000 for GET, HEAD, PUT and OPTIONS,
Host kept and with the pod Caddyfile's sandbox CSP: the download and upload
links the backend signs on the pod origin. A higher-priority router answers 403
to the request shapes of MinIO's unsigned-trailer CVEs, as the Caddyfile does.
The routes are regenerated, all through the one `traefik-routes` materializer
(the installed components and the saved domain settings), by `eve domain set` /
`eve domain apply` / `eve domain repair`, when a component is added or removed,
and after every component update (`eve update [component]`, the dashboard's
update button): a route a new Eve release adds reaches the pod on its next
update. Traefik is restarted only when the generated files changed. With no
domain configured, the update says so and leaves Traefik alone. `eve update eve`
alone does not regenerate them: that process still runs the previous Eve code.

An update (and `eve synap deploy`) never changes which hostnames are public: it
regenerates only the hosts the current `eve-routes.yml` already routes, with
their path routes (e.g. the storage route on the pod host) and the custom
routes, and names each installed component it left unrouted ("not exposed:
openclaw, nango — run `eve domain apply` to publish them"). Publishing a host
stays explicit: `eve domain set|apply`, `eve add`. With no routes file yet
(first install), every installed component is routed.

Eve reads its settings from `EVE_HOME`, else the current directory, so a host
can hold two `.eve/` homes on different domains. When the live `eve-routes.yml`
was generated for another primary domain than the settings in use (its
`# Domain:` header), every regeneration except `eve domain set` and the
dashboard's domain form leaves it alone and names both domains and the settings
path: run eve from the Eve home, or set `EVE_HOME`.

The file carries the marker `eve-managed:synap-loopback-override:v4` (older
`v1` to `v3` markers are still recognised). Delete the marker line to keep a
hand-written override; Eve then leaves the file alone, the CLI falls back to the
public URL, and Traefik routing to the pod stops working.

### Which URL the CLI uses

- `resolveSynapUrl(secrets)` (`components.ts`) is a pure derivation: a stored
  non-loopback `synap.apiUrl` wins; otherwise `pod.<domain>` from
  `domain.primary` (https only when `domain.ssl` is true); otherwise a stored
  loopback URL; otherwise empty, so callers report "run eve setup".
- `resolveSynapUrlOnHost(secrets)` (`loopback-probe.ts`) is for CLI runtime:
  it probes `127.0.0.1:14000` (200 ms, cached per process) and uses it when it
  answers, else falls back to `resolveSynapUrl`.
- Containers on `eve-network` use `SYNAP_BACKEND_INTERNAL_URL`,
  `http://eve-brain-synap:4000`.
- `buildPodRunner()` (`packages/eve-cli/src/lib/doctor-runners.ts`) always
  returns the fetch runner. `DockerExecRunner` exists only as an `eve doctor`
  diagnostic.

## Agents and keys

Each consumer of the pod is its own agent with its own key, user, scopes and
audit trail. `packages/@eve/dna/src/agents.ts` lists them (`eve`, `openclaw`,
`hermes`, `openwebui`, `coder`); `eve auth provision` mints missing keys with
`POST /api/hub/setup/agent` using the pod's provisioning token
(`EVE_PROVISIONING_TOKEN` overrides), and `eve auth status` / `renew` inspect
and rotate them. Keys live in `secrets.json` under `agents.<slug>`. On a pod
with more than one human the pod requires the human the agent acts for, and
the CLI accepts a `linkedUserId`.

Agents keep no long-term state of their own: conversations, memory and results
go to the pod through the Hub Protocol. Hermes does this with a Synap plugin Eve
generates into its plugin directory (prefetch before a reply, sync after it,
facts at session end).

## State on disk

| Path                                                                    | Role                                                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `.eve/secrets/secrets.json` (under `EVE_HOME` or the working directory) | secrets: `synap.*`, `agents.*`, `ai.*`, `domain.*`, `builder.*`, ... |
| `.eve/setup-profile.json`                                               | the last setup choices                                               |
| `~/.local/share/eve/state.json` (`EVE_STATE_HOME`)                      | installed components and their state                                 |
| `/opt/synap-backend/deploy`                                             | the pod's Compose project, owned by the backend's CLI                |

Eve's AI provider settings (which model vendor local tools prefer) are its own
and live in `secrets.json`; which Intelligence Service a pod uses is the pod's
setting. `eve ai sync` copies the non-secret routing policy into workspace
settings.

## History

- 2026-04: the Synap pod's Caddy owned 80 and 443 and Traefik only fronted
  sidecars; the loopback port was 4000 with marker `v1`; Eve pruned the pod's
  images itself (keep 3); Hermes was described as a Builder component that
  polled tasks and spawned coding engines as subprocesses, and OpenClaw as the
  primary agent. Those details changed as listed above.
- 2026-10-14: the pod removed its OpenClaw-specific surfaces and treats every
  agent the same way. Eve's OpenClaw component remains, marked deprecated, and
  reaches the pod as an ordinary agent.
