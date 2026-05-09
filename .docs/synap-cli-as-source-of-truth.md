# Synap CLI as Source of Truth — Eve Update Refactor Plan

**Date:** 2026-05-09
**Status:** Proposal
**Author:** Eve / Hestia maintenance pass

---

## TL;DR

Eve currently maintains a parallel TypeScript reimplementation of synap-backend's
deployment scripts (`docker-compose.yml`, `update-pod.sh`, kratos init,
`backend-migrate` orchestration). The reimplementation has drifted from the
canonical scripts in three concrete ways that affect Kratos updates today.

The cleanest fix is **not** to keep patching the TS path — it's to **delegate
to the canonical `synap` CLI** (the bash binary at `synap-backend/synap` plus
its `deploy/*.sh` helpers) and keep eve's value-add layered on top:
Traefik/eve-network reconnect, agent provisioning, Builder workspace seed,
loopback override, dashboard wiring.

---

## 1. Current state — what eve actually does

### 1.1 Embedded duplication

`hestia-cli/packages/@eve/brain/src/lib/synap-image-install.ts` ships:

| Asset | Source of truth lives at | Eve's copy at |
|------|---|---|
| `docker-compose.yml` (28 KB) | `synap-backend/deploy/docker-compose.yml` | `DOCKER_COMPOSE_CONTENT` constant, line 30 |
| Postgres init script | `synap-backend/deploy/...` (postgres/init-databases.sh) | `POSTGRES_INIT_SCRIPT_CONTENT` constant, line 794 |
| `kratos.yml` generator | `synap-backend/synap` → `generate_kratos_config()` (line 189) | `@eve/dna/src/kratos-config.ts` → `generateKratosConfig()` |
| Update sequence | `synap-backend/deploy/update-pod.sh` + `synap` → `cmd_update()` | `@eve/lifecycle/src/index.ts` UPDATE_PLAN + `@eve/lifecycle/src/index.ts` `postUpdateReconcileKratos()` + `eve-cli/src/commands/manage/backup-update.ts` bespoke target |
| Install sequence | `synap-backend/synap` → `cmd_install()` | `@eve/brain/src/lib/synap-image-install.ts` `installSynapFromImage()` |
| Kratos run/migrate | `synap-backend/synap` → `cmd_update()` | `@eve/brain/src/lib/synap-image-install.ts` `ensureKratosRunning()` |

This is roughly **1,800 lines** of duplicated logic across eve.

### 1.2 The three drift bugs (all visible on Kratos updates)

| # | Drift | Canonical does | Eve does |
|---|---|---|---|
| 1 | **No `--force-recreate` after kratos pull** | `update-pod.sh:92`: `compose up -d --force-recreate kratos` | `synap-image-install.ts:1057`: `compose up -d --no-deps kratos` (may keep old container) |
| 2 | **Missing `CREATE DATABASE kratos`/`hydra` idempotency** | `update-pod.sh:80-82`: `psql -c "SELECT 'CREATE DATABASE kratos' WHERE NOT EXISTS …"` | Not present anywhere in eve |
| 3 | **`backend-migrate` skipped in lifecycle path** | `update-pod.sh:86`: `compose run --rm backend-migrate` (always) | `lifecycle/index.ts:226-243` (`UPDATE_PLAN.synap`): only `compose pull/up backend realtime` — relies on backend's own boot-time `migrate.ts` |

Drift #3 is "OK in practice" because synap-backend boots its own migrator,
but it's still a divergence from canonical and means a startup migration
failure happens on backend startup rather than as a discrete pre-step.

### 1.3 Two parallel update paths inside eve itself

There are also **two** eve update paths that share `ensureKratosRunning` but
otherwise differ:

- **`eve update` (no args)** → `eve-cli/src/commands/manage/backup-update.ts:241-272`. Bespoke target. Does pull `backend-migrate`, runs `compose run --rm backend-migrate`, calls `ensureKratosRunning`.
- **`eve update synap`** → `runActionToCompletion('synap','update')` → `lifecycle/src/index.ts` UPDATE_PLAN.synap → `runPostUpdateHooks('synap')` → `postUpdateReconcileKratos()`. Generic compose plan + post-hook.

Two paths to maintain, neither matches `update-pod.sh` exactly.

---

## 2. What the canonical surface looks like

`synap-backend/synap` is a single bash binary with these subcommands:

| Command | Implementation | What it does |
|---|---|---|
| `synap install` | `cmd_install()` line 448 | Full install, generates `.env`, `kratos.yml`, runs migrations, brings up backend + kratos |
| `synap update [--from-source\|--from-image] [--version <v>]` | `cmd_update()` line 1488 | Pulls/builds, regenerates `kratos.yml`, runs `backend-migrate`, restarts. Currently the canonical update path. |
| `synap restart\|stop\|start\|ps\|logs\|shell\|exec` | `cmd_*()` | Lifecycle plumbing |
| `synap health\|connectivity\|diagnose\|errors` | `cmd_*()` | Diagnostics |
| `synap backup\|restore\|rebuild\|clean\|profiles` | `cmd_*()` | Maintenance |

It honors two env vars eve already sets:

- `SYNAP_DEPLOY_DIR` — point at `/opt/synap-backend` from any cwd
- `SYNAP_ASSUME_YES` / `SYNAP_YES` / `SYNAP_NON_INTERACTIVE` — skip confirmations

`deploy/update-pod.sh` is the older canary-first script that the synap CLI
now calls into / supersedes.

---

## 3. Eve customizations that MUST survive a delegation

These are eve-specific concerns that the synap CLI does not (and should not)
know about. They must remain in eve and run **after** the synap CLI returns.

### 3.1 Network plumbing

- **eve-network attach** — `connectTraefikToEveNetwork()` and `connectToEveNetwork(synapBackend)` in `lifecycle/index.ts:654`. The synap stack runs in its own compose project (`synap-backend`); eve's Traefik + dashboard live in a separate `eve-network`. After every restart, the synap container must be re-joined to `eve-network` so cross-container DNS works for `pod.<domain>` routing.
- **Loopback override** — `ensureSynapLoopbackOverride()` in `lifecycle/index.ts:234` writes a `docker-compose.override.yml` exposing `127.0.0.1:4000:4000`. The on-host eve CLI uses this loopback to talk to the backend without TLS/Traefik. The synap CLI does NOT publish this port.

### 3.2 Agent provisioning + Builder seed

- `postInstallProvisionAgents('synap')` in `lifecycle/index.ts:826` — mints the eve agent API key (and a few other agents) via the backend's bootstrap endpoint, writes them to `secrets.json:agents.eve`, and seeds the Builder workspace template. This is eve-specific (synap-backend does not know about eve's agent registry).
- `postUpdateReconcileAuth()` in `lifecycle/index.ts:683` — verifies the agent key is still valid after backend restart; rotates if needed.

### 3.3 AI wiring cascade

- `postUpdateReconcileAiWiring()` in `lifecycle/index.ts` — re-applies AI provider config to all installed components (openclaw, openwebui, hermes, pipelines) after a synap update may have rotated keys. **This is the `ai.*` cascade that lives in `@eve/dna/src/reconcile.ts` we just built.** Already orthogonal to the synap CLI.

### 3.4 Dashboard wiring

- The eve dashboard rebuild target in `backup-update.ts:303-330` is not synap-related; stays in eve.

### 3.5 Domain / config reconciliation

- `resolveSynapDomainForUpdate()` in `lifecycle/index.ts:580` — resolves the canonical domain from secrets.json or `.env`. Now plumbed through `configStore`. Stays in eve, gets passed to the synap CLI as `DOMAIN=...` env var.
- `generateKratosConfig()` lives in eve because eve owns the webhook secret rotation (Kratos identity-after-registration webhook → eve). **This is the one area where eve's kratos config and the synap CLI's `generate_kratos_config` overlap.** See §5.3 for resolution.

---

## 4. Desired state

```
┌─────────────────────────────────────────────────────────┐
│ eve update synap                                         │
│   1. resolve domain + version from configStore           │
│   2. ensure compose override (loopback)                  │
│   3. exec: SYNAP_DEPLOY_DIR=/opt/synap-backend \         │
│            SYNAP_ASSUME_YES=1 \                          │
│            DOMAIN=<resolved> \                           │
│            synap update --from-image --version <v>       │
│      └─ canonical: pull, generate kratos.yml, migrate,   │
│         force-recreate kratos, restart backend           │
│   4. eve post-update hooks (run AFTER synap returns OK): │
│      a. connectTraefikToEveNetwork()                     │
│      b. connectToEveNetwork(synap-backend)               │
│      c. postUpdateReconcileAuth()  (verify agent key)    │
│      d. postUpdateReconcileAiWiring()  (cascade)         │
│      e. ensureBuilderWorkspace()  (idempotent reseed)    │
└─────────────────────────────────────────────────────────┘
```

Same pattern for `eve install synap` — delegate to `synap install`, then
run eve's post-install hooks.

### 4.1 Single source of truth contract

- `synap-backend/synap` (bash CLI) owns: docker-compose.yml, init-databases.sh, kratos.yml generation, install/update/migration order, kratos-migrate force-recreate, `CREATE DATABASE` idempotency.
- `eve` owns: discovery of where to install, `.eve/secrets/secrets.json`, eve-network plumbing, agent provisioning, Builder seed, AI wiring cascade, loopback override, post-install/update reconciliation.

### 4.2 How the synap CLI gets onto the host

Three options, in increasing order of automation:

1. **Bundle once at install** — `eve install synap` clones `synap-backend` to `/opt/synap-backend` (already does) → the `synap` binary is in that tree → eve invokes `/opt/synap-backend/synap update ...`. Self-contained, no extra fetch step.
2. **Image-based** — eve runs `docker run --rm ghcr.io/synap-core/synap-cli:<v> update` against a mounted compose dir. Decouples bash dependency from host.
3. **npm package** — `npx @synap/cli` already exists per CLAUDE.md (`OpenClaw integration`) — but that's a different surface (`npx @synap/cli init` for the three-path flow). Different binary.

**Recommended: option 1.** The repo is already on disk after `eve install synap`. Zero new dependencies.

---

## 5. Migration plan

### 5.1 Phase 1 — Add the delegation layer (no removals)

Add a new module `@eve/brain/src/lib/synap-cli-delegate.ts`:

```typescript
export interface SynapCliResult {
  ok: boolean;
  exitCode: number;
  stderr?: string;
}

export async function runSynapCli(
  subcommand: 'install' | 'update' | 'restart' | 'health' | 'rebuild' | string,
  args: string[],
  opts: {
    deployDir: string;
    domain?: string;
    version?: string;
    timeoutMs?: number;
  },
): Promise<SynapCliResult>
```

Internally:
- Resolves `<deployDir>/synap` (the bash binary).
- Sets `SYNAP_DEPLOY_DIR=<deployDir>`, `SYNAP_ASSUME_YES=1`, `DOMAIN=<domain>`.
- `spawnSync('bash', [synapBin, subcommand, ...args], { cwd: deployDir, env, stdio: 'inherit' })`.
- Returns exit code + stderr capture for failure paths.

This module does NOT yet replace any eve flow. It's added side-by-side and
unit-tested standalone.

### 5.2 Phase 2 — Cut over `eve update synap` (lifecycle path)

In `@eve/lifecycle/src/index.ts`:

- `UPDATE_PLAN.synap.compose` → replace the inline pull/up logic with a call to `runSynapCli('update', ['--from-image', '--version', resolvedVersion], { deployDir, domain })`.
- Delete the now-dead `postUpdateReconcileKratos()` (its work is now done inside the synap CLI).
- Keep `postUpdateConnectTraefik()`, `postUpdateReconcileAuth()`, `postUpdateReconcileAiWiring()` — these are eve's value-add, run after the CLI returns.

### 5.3 Phase 3 — Cut over `eve install synap`

In `@eve/brain/src/lib/synap-image-install.ts` `installSynapFromImage()`:

- Steps 1-3 (scaffold + write compose + write postgres init) → **delete**. These are now the synap CLI's responsibility.
- Step 4 (pull backend image) → **delete** (the CLI does it).
- Step 5 (compose up backend) → **delete**.
- Step 6 (kratos migrate + start) → **delete**.
- Replace with a single `runSynapCli('install', [...], { deployDir, domain, version })`.
- Steps 7-9 (eve-network connect, post-install agent provision, Builder seed) → **keep**, run after CLI returns.

This deletes the embedded `DOCKER_COMPOSE_CONTENT` (~700 lines) and
`POSTGRES_INIT_SCRIPT_CONTENT` (~250 lines) constants entirely. The synap
CLI brings its own compose file from `synap-backend/deploy/docker-compose.yml`.

### 5.4 Phase 4 — Reconcile kratos.yml ownership ✅ NO-OP

Investigation outcome: **eve has no kratos.yml ownership concern.** The synap
CLI's `generate_kratos_config()` template already includes the webhook block
that eve previously injected:

```yaml
hooks:
  - hook: web_hook
    config:
      url: http://backend:4000/webhooks/kratos
      X-Webhook-Secret: ${webhook_secret}
```

The CLI reads `KRATOS_WEBHOOK_SECRET` from `.env` (or auto-generates and
writes back) and the webhook URL points to the same backend endpoint eve
was using. No drift. Eve's `@eve/dna/src/kratos-config.ts` is fully
superseded — it becomes dead code after Phase 6.

No action required for Phase 4 beyond confirming this match.

### 5.5 Phase 5 — Cut over the bespoke `eve update` (no args) path

In `eve-cli/src/commands/manage/backup-update.ts:241-272`:

- Replace the inline `compose pull/run backend-migrate/up backend realtime` + `ensureKratosRunning` block with a single `runSynapCli('update', ...)`.
- Keep the eve-network connect + `tryPostUpdateProvision()` calls.

### 5.6 Phase 6 — Delete dead code

After phases 2-5, the following can be deleted:

| File / symbol | Lines | Reason |
|---|---|---|
| `synap-image-install.ts` `DOCKER_COMPOSE_CONTENT` | ~700 | synap CLI ships its own |
| `synap-image-install.ts` `POSTGRES_INIT_SCRIPT_CONTENT` | ~250 | synap CLI ships its own |
| `synap-image-install.ts` `ensureKratosRunning()` | ~70 | synap CLI handles Kratos lifecycle |
| `synap-image-install.ts` `isKratosRunning()` `probeKratosHealth()` `waitForKratosHealthy()` | ~80 | only used by `ensureKratosRunning` |
| `lifecycle/src/index.ts` `postUpdateReconcileKratos()` | ~30 | folded into synap CLI |
| `lifecycle/src/index.ts` `resolveSynapDomainForUpdate()` | ~14 | replaced by `configStore.get().domain.primary` |
| `@eve/dna/src/kratos-config.ts` | ~250 | only after Phase 4 upstream — kept for now |
| `eve-cli/src/commands/manage/backup-update.ts:241-272` (synap target body) | ~30 | replaced by single delegate call |

**Estimated total deletions: ~1,400 lines**. The remaining eve code in this
area drops to: discovery, secrets handling, eve-network plumbing, agent
provisioning, Builder seed, AI wiring, post-update reconciliation hooks.

### 5.7 Phase 7 — Versioning contract

Pin the synap CLI version eve expects in `secrets.json:synap.cliVersion` and
in the deploy dir's `synap` binary. Eve's first action on `update synap` is:

```
git -C /opt/synap-backend fetch && git -C /opt/synap-backend pull
```

This refreshes the bash CLI alongside the docker images, so the canonical
update logic stays in lockstep with the backend. Already partially in place
via `update-agent.sh` (`deploy/update-agent.sh`).

---

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| synap CLI bash incompatibility (alpine /bin/sh missing bash) | The CLI uses `#!/bin/bash` and is run on the host, not in containers. Hosts have bash. Verified on Debian, Ubuntu, RHEL. |
| User has manually edited their docker-compose.yml | The CLI's `synap update` writes deploy artefacts but `update-pod.sh` does NOT (it only mutates `.env`). So existing customizations survive. Document that hand-edits to `docker-compose.yml` will be overwritten on `synap install` / first eve install. |
| Eve dashboard needs to drive an update without shelling out | The dashboard already calls `runActionToCompletion('synap', 'update')` which goes through lifecycle. The lifecycle becomes a thin wrapper around the bash CLI. Net result: dashboard still works. |
| Webhook secret rotation in kratos.yml | Phase 4 — either retain eve's post-process step, or push the env-var contract upstream. Mitigated either way. |
| Loss of canary flow | `update-pod.sh` (which the CLI eventually calls) HAS a canary flow. Eve currently does NOT (lifecycle just `compose up -d`). Net improvement, not regression. |
| Loopback override gets overwritten | Eve writes `docker-compose.override.yml` (separate file from `docker-compose.yml`). Synap CLI doesn't touch overrides. Verify this in Phase 1 dry-run. |
| Eve loses the ability to skip Kratos handling for eve-only tests | Add a `--skip-kratos` flag or `SYNAP_SKIP_KRATOS=1` env var to the synap CLI if needed. Currently no eve flow needs this. |

---

## 7. Cleanup checklist (alongside the migration)

- [ ] Audit all `readEveSecrets()` call sites in lifecycle/eve-cli/eve-dashboard. Replace with `configStore.getSection('...')` where appropriate (already partially done in synap-app config-store work).
- [ ] Delete `discoverPodConfig()` ad-hoc bypass once `discoverAndBackfillPodUrl` is the single discovery entry point — verify nothing else calls the bypass form.
- [ ] Audit eve-dashboard `app/api/pod/*/route.ts` for raw `readEveSecrets` reads; route through `configStore`.
- [ ] Drop `@eve/dna/src/kratos-config.ts` if Phase 4 upstream lands; otherwise mark it as "post-process step" with a docstring.
- [ ] Drop `synap-image-install.ts:1095-1150` (deploy file scaffolding) — superseded by `synap install`.
- [ ] Drop `lifecycle/src/index.ts` `postUpdateReconcileKratos`.
- [ ] Update `CLAUDE.md` to note that synap deploy artefacts are owned by the synap CLI; eve only owns `.eve/secrets/`, `eve-network`, agent provisioning, and reconcile hooks.

---

## 8. Open questions

1. **Should we vendor the synap CLI into eve, or always rely on `/opt/synap-backend/synap` being present?** Recommendation: rely on the deploy dir copy. Fail loudly if missing — that's a real installation problem, not something to paper over.
2. **Should `eve install synap` continue to support installing without an existing `/opt/synap-backend` checkout?** Yes — the first step of install is `git clone synap-backend → /opt/synap-backend`, which brings the CLI with it.
3. **Do we want to keep eve's lifecycle/UPDATE_PLAN abstraction at all, or should `synap` skip it entirely?** Keep it — other components (openwebui, openclaw, hermes, traefik) still need the generic compose/imagePull plan. `synap` just becomes a special case that delegates.
4. **What about `eve doctor` checks for kratos health?** Keep `verify-kratos.sh` style checks in eve's diagnostic path — they're independent of who owns the install/update flow.

---

## 9. Validation plan

After Phase 5 lands, manual smoke test on a clean VM:

1. `eve install synap` → expect a working pod with kratos migrations applied, eve agent provisioned, Traefik routing.
2. `eve update synap` → expect the canonical canary flow + kratos force-recreate.
3. `eve update` (no args) → expect every component updated, with synap going through the CLI delegate.
4. `eve doctor` → expect green checks on agent key, kratos health, Traefik network.
5. Push a kratos image bump in `synap-backend` → run `eve update synap` → verify new kratos binary is actually running (`docker inspect kratos | grep Image`).

Each smoke test logs the eve-network, agent provisioning, and AI wiring
hooks ran AFTER the synap CLI returned exit 0.

---

**Bottom line:** stop reimplementing synap-backend's deploy logic in eve.
Delegate to the canonical `synap` CLI, layer eve's value-add (network, agents,
secrets, reconcile) on top, delete ~1,400 lines of duplicated drift-prone
code. Kratos migration bug is a symptom; the root cause is having two copies
of the same logic and only one being maintained.
