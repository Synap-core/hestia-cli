# Eve setup profiles (`eve setup`)

This document is the **deep dive** for the three-path installer. The **high-level project overview** lives in [../README.md](../README.md).
Routing ownership and consolidation rules are defined in [AI_ROUTING_CONSOLIDATION_ADR.md](./AI_ROUTING_CONSOLIDATION_ADR.md).

## Order of operations (recommended)

1. **Secrets** — `eve setup` (or hand-written `.eve/secrets/secrets.json`) so Synap + Hub fields exist.
2. **Builder organ (hand)** — `eve builder init <name>` first: OpenCode + OpenClaude + Claude Code share one **Hub `.env`** + **skills** path. **Dokploy is optional** (`--with-dokploy`); many installs use **webhooks / static `eve builder stack`** only.
3. **Everything else** — Traefik / Pangolin Newt / RSSHub / OpenClaw / Outerbase — wire after the builder surface you care about.

## Design goals

- **Logical UX**: clack `select` / `confirm` steps describe outcomes (ports, stacks), not AI-generated advice.
- **No duplicate edge inside Synap**: the Data Pod keeps **Caddy** on **80/443**. Eve adds **Traefik** only for **sidecar** surfaces (inference gateway on **11435**, optional builder site on **9080**) so ports do not clash.
- **Recoverable & inspectable**: `.eve/setup-profile.json` records the chosen profile; `--dry-run` shows the plan without writing.

---

## Interactive flow (what the user sees)

1. **Optional manifest** — If `~/.eve/usb-profile.json`, `/opt/eve/profile.json`, or `EVE_SETUP_MANIFEST` exists, the CLI prints which profile was suggested (USB / install handoff).
2. **Profile** — Choose **inference only**, **Synap only** (Data Pod without Eve’s Ollama bundle), or **both** (unless `--profile` + `--yes`).
3. **Overwrite guard** — If `.eve/setup-profile.json` already exists, confirm before replacing (skipped with `--yes` or on `--dry-run`).
4. **Hardware (optional)** — Facts only: OS, CPU model, core count, RAM; optional `nvidia-smi` after explicit confirm. Skip with `--skip-hardware`.
5. **AI foundation first** — choose `--ai-mode local|provider|hybrid`, default provider (`openrouter|anthropic|openai|ollama`), and optional fallback provider (always proposed interactively). This config drives Eve-side provider routing for external tools.
6. **Persist** — Write `setup-profile.json` + merge `.eve/secrets/secrets.json`, then run installers (`runInferenceInit`, `runBrainInit`, or both in order for `full`).
7. **Tunnel (optional, `data_pod` / `full`)** — Wizard can run **Pangolin** or **Cloudflare** via `eve legs setup` after Synap install. Same choices can come from USB manifest (`tunnel_provider`, `tunnel_domain`) or flags `--tunnel` / `--tunnel-domain`.

Non-interactive (`--yes`): supply `--profile`; for `data_pod` / `full` supply `--synap-repo` or `SYNAP_REPO_ROOT`. AI defaults can be set with `--ai-mode`, `--ai-provider`, `--fallback-provider`. Use `--tunnel pangolin` (or `cloudflare`) when you want Legs setup without prompts. Use `--nvidia-smi` only if you want GPU lines in a scripted hardware block.

---

## Profiles (reference)

These are the **three paths** `eve setup` offers:

1. **Inference only** — local models + secured gateway; **no** Synap Data Pod (`inference_only`).
2. **Synap only** — the Data Pod stack via `synap install`; **no** Eve-managed Ollama bundle (`data_pod`). Use Eve later for legs/builder/arms only.
3. **Both** — install Synap first, then add Ollama on Docker network + same gateway (`full`).


| Profile          | What runs                                                 | Typical ports                                                                 |
| ---------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `inference_only` | Ollama (Docker) + Traefik gateway (Basic auth)            | Ollama **127.0.0.1:11434**, gateway **127.0.0.1:11435**                       |
| `data_pod`       | Official `synap install` via repo path                    | Caddy **80/443**, API **4000**, … (see `synap-backend/deploy`)                |
| `full`           | Data Pod, then Ollama **only on `eve-network`** + gateway | Same as Synap; gateway **11435**; **no** host publish on **11434** for Ollama |


---

## Commands

```bash
# Interactive
eve setup

# Plan without side effects
eve setup --dry-run --profile full

# JSON plan (machine-readable)
eve --json setup --dry-run --profile data_pod

# Non-interactive examples
eve setup --yes --profile inference_only --model llama3.1:8b

eve setup --yes --profile data_pod --synap-repo /path/to/synap-backend --domain localhost

eve setup --yes --profile full --synap-repo /path/to/synap-backend --domain localhost \
  --with-openclaw --with-rsshub --from-source

eve setup --yes --profile data_pod --synap-repo /path/to/synap-backend --domain pod.example.com \
  --ai-mode hybrid --ai-provider openrouter --fallback-provider ollama \
  --tunnel pangolin --tunnel-domain legs.pod.example.com
```

---

## State files


| Path                                  | Purpose                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**.eve/setup-profile.json**` (cwd)   | Canonical profile + metadata (`wizard` | `cli` | `usb_manifest`) + optional `aiMode` / `aiDefaultProvider` / `aiFallbackProvider` + `tunnelProvider` / `tunnelDomain`                                                                                                                                                                                            |
| `**~/.eve/usb-profile.json**`         | Written after successful `hestia usb create` (when `@eve/dna` available)                                                                                                                                                                                                                                                                                         |
| `**/opt/eve/profile.json**`           | Optional on server; same schema subset for `readUsbSetupManifest()` (may include `tunnel_provider` / `tunnel_domain`)                                                                                                                                                                                                                                            |
| `**EVE_SETUP_MANIFEST**`              | Absolute path to a JSON manifest file (CI / cloud-init)                                                                                                                                                                                                                                                                                                          |
| `**.eve/secrets/secrets.json**`       | Merged secrets (`EveSecrets` v1): `synap.apiUrl`, `**synap.apiKey**` (Hub Bearer), optional `**synap.hubBaseUrl**`, `inference.*`, `builder.*` (`codeEngine`, `dokployWebhookUrl`, `skillsDir`, …), `**arms.openclawSynapApiKey**` (same value as `synap.apiKey` when the pod is installed). This file owns Eve provider routing, not Synap internal IS routing. |
| `**.eve/secrets/ollama-gateway.txt**` | Generated user/password + `curl` example for the gateway                                                                                                                                                                                                                                                                                                         |
| `**~/.eve/skills/synap/SKILL.md**`    | Stub skill for Hub usage; Claude Code also gets `**.claude/skills/synap/**` on `eve builder init`                                                                                                                                                                                                                                                                |


---

## USB / boot handoff

1. Create USB (`hestia usb create` or `**eve birth usb**`). The shell script copies `**~/.eve/usb-profile.json**` onto the stick as `**eve/profile.json**` when it exists; otherwise it writes a minimal manifest (`target_profile` from `**EVE_USB_TARGET_PROFILE**`, default `full`).
2. During provisioning, copy `**eve/profile.json**` from the USB (or your CMDB) to `**/opt/eve/profile.json**` on the server if you want `**eve setup**` to read it before the wizard.
3. On first login, run `**eve setup**` — the manifest **pre-selects** the profile (and optional tunnel fields); CLI flags still override.

---

## Builder static site

```bash
eve builder stack up    # nginx → http://127.0.0.1:9080 ; files under .eve/builder-site/public
eve builder stack down
eve builder stack status
```

Expose on a hostname with `**eve legs**` / Traefik dynamic config (separate from Synap’s Caddyfile).

---

## Builder engines (OpenCode / OpenClaude / Claude Code)

- `**eve builder init <name> --engines opencode,openclaude,claudecode**` — default is `**all**`. Each engine you keep gets installed/configured; the project directory always receives `**.env**`. `**--with-dokploy**` opt-in — without it, `**eve builder deploy**` will tell you to use `**DOKPLOY_WEBHOOK_URL**` or re-init with Dokploy.
- **OpenClaude** — Ollama at `openclaudeUrl` / gateway; config also stores Hub fields for tooling.
- **Claude Code** — project `**.claude/settings.json`** `env` + `**.claude/skills/synap/**` (see [Skills](https://code.claude.com/docs/en/skills), [MCP](https://code.claude.com/docs/en/mcp), [Settings](https://code.claude.com/docs/en/settings)). Native install: [Advanced setup](https://code.claude.com/docs/en/setup).
- `**eve builder sandbox prepare|up|down**` — Node container, **only** `workspaceDir` mounted at `/workspace`, env from `.eve/sandbox.env`.

Env overrides: `BUILDER_CODE_ENGINE`, `DOKPLOY_WEBHOOK_URL`, `EVE_SKILLS_DIR`, `SYNAP_HUB_BASE_URL`.

To sync provider policy explicitly (no secrets) into Synap workspace settings:

```bash
eve ai sync --workspace <workspace-uuid>
eve ai sync --workspace <workspace-uuid> --check
```

---

## Pangolin Newt (site connector on `eve-network`)

```bash
eve legs newt init   # writes .eve/legs/newt.env template
# Edit PANGOLIN_ENDPOINT, NEWT_ID, NEWT_SECRET (from Pangolin dashboard)
eve legs newt up
eve legs newt down
```

Uses `**fosrl/newt:latest**` ([upstream compose](https://github.com/fosrl/newt/blob/main/docker-compose.yml)).

---

## Outerbase Studio (Postgres viewer)

```bash
eve eyes database init --database-url 'postgres://user:pass@host:5432/db' --user admin --pass secret
eve eyes database up --port 4005
eve eyes database down
```

Uses `**@outerbase/studio**` (see [npm](https://www.npmjs.com/package/@outerbase/studio)); the UI is an **iframe** to `studio.outerbase.com` — plan for outbound HTTPS and corporate allowlists.

---

## Quality checklist (for maintainers)

- `pnpm --filter @eve/cli test` passes (includes `setup --dry-run` and `--json`).
- `eve setup --help` shows extended “Why three paths” footer.
- Inference gateway: `openssl` and `docker` available on PATH.
- `full` profile: Synap stack up before Ollama so `eve-network` exists or is created consistently.

---

## Future improvements (not in CLI yet)

- TLS termination for **11435** (cert file or ACME alongside Caddy).
- **Whisper** (or other) container + optional gateway route.
- `**OLLAMA_API_KEY`** env support behind the same Traefik layer (when standardised).
- `**eve legs synap-note**`: print `synap health` / doc links when `SYNAP_REPO_ROOT` is set.
- Richer **CI** test: mock `synap` script + temp repo layout for `data_pod`.

