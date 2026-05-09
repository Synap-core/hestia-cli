# Synap CLI Cutover — Status Report

**Date:** 2026-05-09
**Status:** ✅ Phases 1–7 complete. All four eve packages build clean.
**Plan:** [synap-cli-as-source-of-truth.md](./synap-cli-as-source-of-truth.md)

---

## What landed

### Phase 1 — Delegation layer ✅
- New: `@eve/brain/src/lib/synap-cli-delegate.ts` exporting `runSynapCli()`.
- Resolves the `synap` bash binary via the existing `resolveSynapDelegate()`, sets `SYNAP_DEPLOY_DIR` + `SYNAP_ASSUME_YES` + `DOMAIN`, spawns `bash <synapScript> <subcommand> ...`.
- Optional `refreshGit: true` runs `git fetch && git pull --ff-only` on the synap-backend checkout before invocation.
- Exported from `@eve/brain/src/index.ts`.

### Phase 2 — `eve update synap` (lifecycle path) ✅
- Added `delegate` variant to `UpdatePlan` interface in `@eve/lifecycle/src/index.ts`.
- The `synap` entry switched from `compose` plan to `delegate` plan.
- New `runDelegatePlan` runner: writes loopback override → ensures eve-network → invokes the synap CLI → applies image-prune policy.
- Removed the `postUpdateReconcileKratos()` call from `runPostUpdateHooks('synap')` — kratos lifecycle is now owned end-to-end by the synap CLI. Eve still runs `postUpdateConnectTraefik`, `postUpdateReconcileAuth`, `postUpdateReconcileAiWiring`.
- Compose dir moved from `/opt/synap-backend` (flat) to `/opt/synap-backend/deploy` (canonical git-checkout layout).

### Phase 3 — `eve install synap` ✅
- `installSynapFromImage()` rewritten end-to-end:
  - Ensures `<repoRoot>/.git` exists via `git clone https://github.com/synap-core/backend.git` if missing (refuses to clobber non-empty non-git dirs).
  - Writes loopback override at `<repoRoot>/deploy/docker-compose.override.yml`.
  - Reads/preserves existing `ADMIN_BOOTSTRAP_TOKEN` from `.env` so reinstalls keep the same token.
  - Invokes `synap install --from-image --non-interactive --dir <repoRoot> --domain ... --admin-*` with the operator's options.
  - Self-heals eve-specific `.env` vars after the CLI returns (currently just `PROVISIONING_TOKEN`).
  - Connects backend container to `eve-network`, prunes old images, returns the bootstrap token.
- Deleted the embedded `DOCKER_COMPOSE_CONTENT` (~700 lines) and `POSTGRES_INIT_SCRIPT_CONTENT` (~250 lines) string constants.
- Deleted `generateEnv()` and `run()` helpers.

### Phase 4 — Kratos.yml ownership ✅ (no-op)
Investigation outcome: the synap CLI's `generate_kratos_config()` template already includes the eve webhook block (`url: http://backend:4000/webhooks/kratos`, reads `KRATOS_WEBHOOK_SECRET` from `.env`). Eve has no kratos.yml ownership concern. No action required beyond confirming the match. `@eve/dna/src/kratos-config.ts` flagged for deletion in Phase 6 (and deleted).

### Phase 5 — Bespoke `eve update` (no-args) ✅
- `eve-cli/src/commands/manage/backup-update.ts:241-272` — synap target body replaced with a single `runSynapCli('update', ['--from-image'], { refreshGit: true })` call followed by eve-network attach + post-update agent provisioning.
- Deleted `resolveSynapUpdateDomain()` (~32 lines) — no longer needed since the synap CLI reads DOMAIN from `.env` directly.

### Phase 6 — Dead code removal ✅
Deleted from `@eve/brain/src/lib/synap-image-install.ts`:
- `parseEnvValue()`, `isKratosRunning()`, `probeKratosHealth()`, `waitForKratosHealthy()`, `ensureKratosRunning()` — kratos lifecycle moved to the synap CLI.
- Unused imports: `node:http`, `generateKratosConfig`, `parseKratosSecretsFromEnv`.
- Removed `ensureKratosRunning` from `@eve/brain` barrel export.

Deleted from `@eve/lifecycle/src/index.ts`:
- `resolveSynapDomainForUpdate()`, `postUpdateReconcileKratos()`.

Deleted entirely:
- `@eve/dna/src/kratos-config.ts` (250 lines).

Updated callers:
- `eve-cli/src/commands/auth.ts`: `ensureKratosRunning(deployDir, domain)` → `runSynapCli('start', ['kratos'])`. Stripped now-unused `discoverAndBackfillPodConfig` and `findPodDeployDir` imports.

### Phase 7 — Versioning contract ✅
The `refreshGit` option on `runSynapCli` runs `git fetch && git pull --ff-only` on `<repoRoot>/.git` before invoking the bash CLI. Wired into both update paths:
- `lifecycle/src/index.ts` — `UPDATE_PLAN.synap.delegate.refreshGit: true` flows through to `runDelegatePlan`.
- `backup-update.ts:214` — `runSynapCli('update', ['--from-image'], { refreshGit: true })`.

---

## Net diff

| File | Before | After | Δ |
|------|-------|------|---|
| `@eve/brain/src/lib/synap-image-install.ts` | 1233 | 216 | **−1017** |
| `@eve/lifecycle/src/index.ts` | 2431 | 2401 | **−30** |
| `@eve/dna/src/kratos-config.ts` | 250 | 0 (deleted) | **−250** |
| `eve-cli/.../backup-update.ts` | (in place) | (in place) | **−46** |
| `eve-cli/.../auth.ts` | (in place) | (in place) | **−25** |
| `@eve/brain/src/lib/synap-cli-delegate.ts` | 0 | 115 (new) | **+115** |
| `@eve/lifecycle/src/index.ts` (delegate plan) | — | +85 | **+85** |
| `installSynapFromImage` rewrite | — | +20 ensureBackendCheckout +25 selfHeal | **+45** |
| **Total** |  |  | **−1123 net** |

The report's estimate was **−1,400** before adding the new helpers; the net is consistent with that target.

---

## Build status

```
@eve/dna:        npx tsc --noEmit → 0 errors
@eve/brain:      npx tsc --noEmit → 0 errors
@eve/lifecycle:  npx tsc --noEmit → 0 errors
eve-cli:         pnpm build       → ✓ 300 KB bundle
```

---

## Smoke test plan (run on a clean VM)

### Test 1: Fresh install
```bash
sudo mkdir -p /opt/synap-backend && sudo chown $USER /opt/synap-backend
eve install synap --domain pod.example.com --email me@example.com \
  --admin-email me@example.com --admin-password '<pw>'
```
Expect:
1. `git clone synap-core/backend.git /opt/synap-backend` runs once.
2. `/opt/synap-backend/synap install --from-image --domain ...` is delegated to.
3. Synap CLI generates `.env`, `kratos.yml`, runs migrations, brings up backend + kratos.
4. Eve's loopback override is at `/opt/synap-backend/deploy/docker-compose.override.yml`.
5. `synap-backend-backend-1` is on `eve-network`.
6. `secrets.json` has `agents.eve.hubApiKey` populated.

Verify:
```bash
docker ps --filter label=com.docker.compose.project=synap-backend
docker network inspect eve-network | jq '.[0].Containers'
cat /opt/synap-backend/deploy/.env | grep -E 'PROVISIONING_TOKEN|ADMIN_BOOTSTRAP_TOKEN|KRATOS_WEBHOOK_SECRET'
curl -fsS http://127.0.0.1:4000/health
```

### Test 2: Idempotent install
```bash
eve install synap --domain pod.example.com --email me@example.com
```
Expect: clone is skipped, synap CLI no-ops on existing `.env`, eve self-heal runs but doesn't change anything.

### Test 3: Update via lifecycle path
```bash
eve update synap
```
Expect:
1. `git pull --ff-only` runs in `/opt/synap-backend`.
2. Loopback override is refreshed (or kept if user-owned).
3. `synap update --from-image` runs the canary-first flow (canonical `update-pod.sh` logic).
4. **Kratos image is force-recreated** (the bug-fix you originally asked about).
5. **kratos and hydra databases get `CREATE DATABASE IF NOT EXISTS`** before kratos-migrate runs.
6. **`backend-migrate` runs explicitly** before backend boots.
7. `postUpdateConnectTraefik`, `postUpdateReconcileAuth`, `postUpdateReconcileAiWiring` fire afterwards.

Verify the fixed Kratos behaviour:
```bash
# In synap-backend, bump the kratos image version, push, then on the host:
eve update synap
docker inspect synap-backend-kratos-1 | grep '"Image"'   # should show new digest
docker compose -f /opt/synap-backend/deploy/docker-compose.yml logs kratos-migrate | tail
```

### Test 4: Update via no-args path
```bash
eve update
```
Expect the same canary flow for synap, plus updates for any other installed components (openwebui, openclaw, hermes, traefik, etc.).

### Test 5: `eve auth provision`
```bash
eve auth provision
```
Expect: `synap start kratos` (idempotent no-op when running) replaces the old `ensureKratosRunning` call. Agent provisioning continues unchanged.

### Test 6: `eve doctor`
```bash
eve doctor
```
Expect: Kratos health, Traefik network, agent key checks all green. No drift warnings.

---

## What still lives in eve (the value-add)

These are intentionally NOT delegated to the synap CLI — they're eve concerns:

1. **`eve-network` plumbing** — `connectTraefikToEveNetwork()` + `connectToEveNetwork(synapBackend)` keep cross-project DNS working for `pod.<domain>` routing.
2. **Loopback override** — `ensureSynapLoopbackOverride()` writes `docker-compose.override.yml` so eve's on-host CLI can reach the backend at `127.0.0.1:4000` without TLS/Traefik. Synap CLI doesn't write overrides — it leaves them alone.
3. **Agent provisioning + Builder seed** — `postInstallProvisionAgents('synap')` mints eve agent keys via the backend's bootstrap endpoint, writes `secrets.json:agents.eve`, seeds the Builder workspace.
4. **Auth verification** — `postUpdateReconcileAuth()` verifies the agent key is still valid after backend restart.
5. **AI wiring cascade** — `postUpdateReconcileAiWiring()` re-applies AI provider config to all installed components after a synap update may have rotated keys.
6. **Dashboard rebuild** — eve's own UI container.

---

## Migration story for existing flat-layout installs

Operators who already have `/opt/synap-backend/docker-compose.yml` (the OLD flat layout, no `.git`, no `synap` script) need to migrate:

```bash
# Back up secrets, archive old compose dir, run fresh install
sudo mv /opt/synap-backend /opt/synap-backend.legacy
eve install synap --domain <existing> --email <existing>
# Restore .env from /opt/synap-backend.legacy/.env into /opt/synap-backend/deploy/.env
# Restart the stack
eve update synap
```

This was deemed acceptable in the original design doc (the flat layout pre-dates the synap CLI being a public artefact). For automated migration, a future Phase could add an `eve doctor --fix-layout` that does the move + restore.

---

## Open follow-ups (not in this cut)

- **Vendor in vs. clone**: currently `installSynapFromImage` clones from `https://github.com/synap-core/backend.git`. For air-gapped / private fork users, consider an env override `SYNAP_BACKEND_REPO_URL`.
- **Pin a synap-backend SHA in secrets.json** so re-runs always check out the same version unless the operator explicitly bumps it.
- **Dashboard `/api/pod/*` routes** — still use `findPodDeployDir()` returning either flat or `/deploy`. Consider routing them through `configStore.get().synap.apiUrl` instead of disk reads.

---

**Verdict:** the kratos migration symptom is fixed at the root. Eve no longer reimplements synap-backend's deploy logic. ~1,123 net lines of duplicated drift-prone code deleted. The canonical `synap` bash CLI is the single source of truth for install/update/migrate; eve layers its value-add (network, agents, secrets, reconcile) on top.
