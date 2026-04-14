# Eve setup profiles (`eve setup`)

This document is the **deep dive** for the three-path installer. The **high-level project overview** lives in [../README.md](../README.md).

## Design goals

- **Logical UX**: clack `select` / `confirm` steps describe outcomes (ports, stacks), not AI-generated advice.
- **No duplicate edge inside Synap**: the Data Pod keeps **Caddy** on **80/443**. Eve adds **Traefik** only for **sidecar** surfaces (inference gateway on **11435**, optional builder site on **9080**) so ports do not clash.
- **Recoverable & inspectable**: `.eve/setup-profile.json` records the chosen profile; `--dry-run` shows the plan without writing.

---

## Interactive flow (what the user sees)

1. **Optional manifest** — If `~/.eve/usb-profile.json`, `/opt/eve/profile.json`, or `EVE_SETUP_MANIFEST` exists, the CLI prints which profile was suggested (USB / install handoff).
2. **Profile** — Choose *Ollama + gateway*, *Synap Data Pod only*, or *both* (unless `--profile` + `--yes`).
3. **Overwrite guard** — If `.eve/setup-profile.json` already exists, confirm before replacing (skipped with `--yes` or on `--dry-run`).
4. **Hardware (optional)** — Facts only: OS, CPU model, core count, RAM; optional `nvidia-smi` after explicit confirm. Skip with `--skip-hardware`.
5. **Persist** — Write `setup-profile.json` + merge `.eve/secrets/secrets.json`, then run installers (`runInferenceInit`, `runBrainInit`, or both in order for `full`).
6. **Tunnel (optional, `data_pod` / `full`)** — Wizard can run **Pangolin** or **Cloudflare** via `eve legs setup` after Synap install. Same choices can come from USB manifest (`tunnel_provider`, `tunnel_domain`) or flags `--tunnel` / `--tunnel-domain`.

Non-interactive (`--yes`): supply `--profile`; for `data_pod` / `full` supply `--synap-repo` or `SYNAP_REPO_ROOT`. Use `--tunnel pangolin` (or `cloudflare`) when you want Legs setup without prompts. Use `--nvidia-smi` only if you want GPU lines in a scripted hardware block.

---

## Profiles (reference)

| Profile | What runs | Typical ports |
|---------|-----------|----------------|
| `inference_only` | Ollama (Docker) + Traefik gateway (Basic auth) | Ollama **127.0.0.1:11434**, gateway **127.0.0.1:11435** |
| `data_pod` | Official `synap install` via repo path | Caddy **80/443**, API **4000**, … (see `synap-backend/deploy`) |
| `full` | Data Pod, then Ollama **only on `eve-network`** + gateway | Same as Synap; gateway **11435**; **no** host publish on **11434** for Ollama |

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
  --tunnel pangolin --tunnel-domain legs.pod.example.com
```

---

## State files

| Path | Purpose |
|------|---------|
| **`.eve/setup-profile.json`** (cwd) | Canonical profile + metadata (`wizard` \| `cli` \| `usb_manifest`) + optional `tunnelProvider` / `tunnelDomain` |
| **`~/.eve/usb-profile.json`** | Written after successful `hestia usb create` (when `@eve/dna` available) |
| **`/opt/eve/profile.json`** | Optional on server; same schema subset for `readUsbSetupManifest()` (may include `tunnel_provider` / `tunnel_domain`) |
| **`EVE_SETUP_MANIFEST`** | Absolute path to a JSON manifest file (CI / cloud-init) |
| **`.eve/secrets/secrets.json`** | Merged secrets for Synap API, inference gateway, Dokploy, OpenClaw (`@eve/dna` `EveSecrets` v1) |
| **`.eve/secrets/ollama-gateway.txt`** | Generated user/password + `curl` example for the gateway |

---

## USB / boot handoff

1. Create USB (`hestia usb create` or **`eve birth usb`**). The shell script copies **`~/.eve/usb-profile.json`** onto the stick as **`eve/profile.json`** when it exists; otherwise it writes a minimal manifest (`target_profile` from **`EVE_USB_TARGET_PROFILE`**, default `full`).
2. During provisioning, copy **`eve/profile.json`** from the USB (or your CMDB) to **`/opt/eve/profile.json`** on the server if you want **`eve setup`** to read it before the wizard.
3. On first login, run **`eve setup`** — the manifest **pre-selects** the profile (and optional tunnel fields); CLI flags still override.

---

## Builder static site

```bash
eve builder stack up    # nginx → http://127.0.0.1:9080 ; files under .eve/builder-site/public
eve builder stack down
eve builder stack status
```

Expose on a hostname with **`eve legs`** / Traefik dynamic config (separate from Synap’s Caddyfile).

---

## Quality checklist (for maintainers)

- [ ] `pnpm --filter @eve/cli test` passes (includes `setup --dry-run` and `--json`).
- [ ] `eve setup --help` shows extended “Why three paths” footer.
- [ ] Inference gateway: `openssl` and `docker` available on PATH.
- [ ] `full` profile: Synap stack up before Ollama so `eve-network` exists or is created consistently.

---

## Future improvements (not in CLI yet)

- TLS termination for **11435** (cert file or ACME alongside Caddy).
- **Whisper** (or other) container + optional gateway route.
- **`OLLAMA_API_KEY`** env support behind the same Traefik layer (when standardised).
- **`eve legs synap-note`**: print `synap health` / doc links when `SYNAP_REPO_ROOT` is set.
- Richer **CI** test: mock `synap` script + temp repo layout for `data_pod`.
