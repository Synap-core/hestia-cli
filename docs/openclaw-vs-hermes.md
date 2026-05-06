# OpenClaw vs Hermes — Full Feature Comparison & Eve Strategy

> **Status:** Decision document. Written after deep research on both projects.  
> **Bottom line up front:** Remove Eve-deployed OpenClaw as an agent component. Keep the Synap `SKILL.md` as a distribution channel for existing OpenClaw users. Hermes handles everything else.

---

## What Each Project Actually Is

### OpenClaw

A **messaging gateway runtime** written in TypeScript. One Node.js process that bridges 24+ messaging platforms (Telegram, Discord, WhatsApp, iMessage, Slack, Signal, Matrix, IRC, WeChat, and 16 more) into an AI agent loop. Skills are static Markdown files (`SKILL.md`) the user writes or installs from ClawHub. Memory is file-based Markdown with optional SQLite search. The agent uses a ReAct loop against any LLM.

Released November 2025 (originally "Clawdbot"), renamed twice due to trademark. Creator joined OpenAI in February 2026; governance transferred to a non-profit foundation. Currently ~369K GitHub stars — the most-starred repository in GitHub history at peak velocity.

**The one-sentence pitch:** Connect your own AI agent to every messaging app you already use, self-hosted, no subscription.

### Hermes Agent (NousResearch)

A **modular AI agent orchestration system** written in Python. Runs as a headless gateway, CLI, or terminal backend. The core innovation is a **plugin-based memory architecture** — exactly one external memory provider can be active, receiving 100% of memory syncs. Skills can be created autonomously by the agent, refined during use, and compounded across sessions. Multi-Agent Orchestration (MOA) coordinates specialized sub-agents. A `hermes claw migrate` command imports OpenClaw settings.

~135K GitHub stars. Active development by NousResearch (the team behind Hermes-3 model). Python-first, developer-target.

**The one-sentence pitch:** An agent that genuinely learns and grows with you across sessions, with deep extensibility at the framework level.

---

## Feature-by-Feature Comparison

### Messaging & Channels

| | OpenClaw | Hermes |
|---|---|---|
| **Supported platforms** | 24+ native (WhatsApp, Telegram, Discord, iMessage, Signal, Matrix, Slack, Teams, LINE, Twitch, Nostr, WeChat, QQ, IRC, Feishu, Mattermost, Nextcloud, Tlon, Zalo, Synology, WebChat…) | 20+ native (Telegram, Discord, WhatsApp, Signal, Matrix, Slack, Mattermost, Teams, IRC, Zulip, Rocket.Chat, SMS via Twilio, email, more) |
| **Group chat** | Supported (but documented security risk — secrets visible across users if misconfigured) | Supported with better isolation model |
| **Gateway port** | 18789 (REST + WebSocket + dashboard, all-in-one) | 8642 (OpenAI-compat API) + 9119 (dashboard) |
| **Voice** | Wake words (macOS/iOS), continuous recording (Android) | Voice mode via STT/TTS, configurable providers |
| **Multi-platform simultaneously** | Yes — one gateway process routes all channels | Yes — native platform plugins run concurrently |

**Verdict:** Near-parity on platform count. OpenClaw has iMessage/BlueBubbles; Hermes has SMS. OpenClaw is marginally ahead on breadth. Hermes wins on security and isolation.

---

### Agentic Capabilities & Task Handling

| | OpenClaw | Hermes |
|---|---|---|
| **Concurrency model** | Lane-aware FIFO queue. 4 lanes: `main` (cap 4), `cron`, `subagent` (cap 8), `nested`. Per-session serialization | Multi-agent: orchestrator spawns specialized sub-agents in parallel. No documented hard cap |
| **Long-running tasks** | Known unresponsiveness on very long tasks (GitHub #45102, marked "not planned") | Designed for persistent headless operation; gateway mode intended for long sessions |
| **Scheduled jobs (cron)** | Built-in cron scheduler. No retry on failure — silently disabled after first error | Built-in cron, persistent, retry on failure |
| **Subagent spawning** | `sessions_spawn` — creates child sessions, but still single-agent design in practice | True MOA — orchestrator delegates to specialized domain agents |
| **Shell / code execution** | Built-in, always available | 7 terminal backends: local, Docker, SSH, Daytona, Modal, Singularity, SGLang |
| **Browser automation** | Playwright-based headless browser, built-in | Playwright via toolset |
| **File system** | Read, write, edit, execute — built-in | Read, write, edit, execute — built-in |
| **Tool count** | 50+ built-in integrations (Gmail, GitHub, Obsidian, Spotify, smart home…) | 61 tools across 52 toolsets |
| **Self-improvement** | No — skills are static files the user writes | Yes — agent autonomously creates and refines skills during use via Curator background agent |
| **Concurrent task bug** | `maxConcurrent` doesn't propagate with multiple agents (GitHub #16055) | No known equivalent |

**Verdict:** Hermes wins decisively on agentic depth. True MOA, 7 terminal backends, self-improving skills, and no gateway-unresponsiveness problem. OpenClaw is fine for personal automation but brittle at scale.

---

### Skills System

| | OpenClaw | Hermes |
|---|---|---|
| **Format** | `SKILL.md` — YAML front matter + Markdown instructions | Python class or Markdown skill file |
| **Registry** | ClawHub (5,400+ community skills) | AgentSkills.io, Skills Hub |
| **Install** | `openclaw skills install <slug>` | `hermes skills install <name>` |
| **Security** | **Critical**: 12% of ClawHub uploads were malicious in Feb 2026. 1,400+ malicious skills identified. No vetting gate before publish | Curated; no comparable malicious-upload incident |
| **Gating** | `metadata.openclaw` — gate on OS, required bins, required env vars, required config | `get_config_schema()` — required fields declared in plugin code |
| **Token cost** | ~24 tokens per skill minimum | Depends on `system_prompt_block()` content |
| **Self-creation** | User writes skills manually | Agent creates skills autonomously from patterns observed during use |
| **Per-agent allowlist** | Yes — `skills` array in agent config (non-empty list replaces defaults entirely) | Yes — per-profile skill isolation |
| **Discovery** | 6-level directory hierarchy with file-watcher hot-reload | Plugin discovery at startup, file-watcher reload |
| **Command dispatch** | `command-dispatch: tool` bypasses model for direct tool call | `handle_tool_call()` equivalent |

**For Eve specifically:** The Synap `SKILL.md` at `synap-backend/skills/synap/SKILL.md` is a first-class OpenClaw skill. It exposes the Hub Protocol REST API to OpenClaw's agent loop. This is how Synap reaches OpenClaw users — not the other way around. Eve doesn't need to deploy OpenClaw to offer this. It's a distribution play.

**Verdict:** Hermes wins on security and agent-created skills. OpenClaw wins on community size and ease of SKILL.md authoring.

---

### Memory System

| | OpenClaw | Hermes |
|---|---|---|
| **Core storage** | File-based Markdown (`MEMORY.md`, `USER.md`, daily notes) + SQLite FTS | SQLite FTS5 over all session history + LLM summarization |
| **Cross-session compounding** | Opt-in (`DREAMS.md`) — promotes signals from short-term to long-term with score thresholds | Always on — sessions are indexed and searched automatically |
| **Search** | Hybrid: vector similarity + keyword (with embedding provider) or keyword-only (default) | FTS5 full-text, LLM summarization for semantic recall |
| **User modeling** | `USER.md` — user-editable profile file | Honcho dialectic layer — AI models user behavior across sessions automatically |
| **External provider swap** | 4 backends: Builtin, QMD, Honcho, LanceDB | 8 external providers (Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, Supermemory) + custom plugin |
| **Custom memory plugin** | No plugin architecture for memory — must fork or use one of the 4 backends | Full plugin architecture (`MemoryProvider` base class) — exactly 1 active at a time, 100% of syncs guaranteed |
| **Memory transparency** | Human-readable files — you can open and edit `MEMORY.md` directly | Config-file driven — less directly human-editable |
| **Session-end extraction** | `on_memory_write` mirror + compression flush | `on_session_end()` hook in plugin — explicit fact extraction |

**For Eve:** This is the decisive difference. Hermes has a native `MemoryProvider` plugin interface with a contractual guarantee that ONE provider receives 100% of memory syncs. OpenClaw has no equivalent plugin contract. We can write `synap_provider.py` and Hermes will route ALL memory there. OpenClaw can only approximate this via the `synap` skill (which requires the agent to explicitly call memory tools — not guaranteed on every turn).

**Verdict:** Hermes wins overwhelmingly for Synap memory integration. The plugin contract is exactly what we need.

---

### Model Routing & Quality

| | OpenClaw | Hermes |
|---|---|---|
| **Provider plugins** | 40+ (OpenAI, Anthropic, Google, OpenRouter, Ollama, LM Studio, vLLM, Groq, Cerebras, NVIDIA, 30+ more) | 18+ (Anthropic, OpenAI, Google, OpenRouter, Nous Portal, Ollama, vLLM, 11 more) |
| **OpenAI-compat** | Full support (`api: openai-completions`) | Full support (`base_url + api_key`) |
| **Per-request model override** | `x-openclaw-model` header | `model` field in request |
| **Key rotation** | Auto-rotates on 429/quota (comma-separated key lists) | Not documented |
| **Fallback chains** | Configurable with cooldown probes | Not documented |
| **Agent-as-model** | `GET /v1/models` returns agents as model IDs | Gateway exposes `API_SERVER_KEY`-protected `/v1/models` |
| **Quality** | Runtime only — quality = underlying LLM | Same. Plus: Hermes injects memory context into every call, improving relevance |
| **Retry bug** | Exponential backoff documented but not actually implemented | N/A |

**Verdict:** OpenClaw has broader provider coverage (40 vs 18). Hermes wins on contextual quality because memory is injected into every LLM call.

---

### MCP Integration

| | OpenClaw | Hermes |
|---|---|---|
| **As MCP server** | Yes — `openclaw mcp serve` exposes 7 tools: `conversations_list`, `messages_read`, `messages_send`, `events_poll`, `events_wait`, `attachments_fetch`, `permissions_respond` | Not a primary feature; no documented MCP server mode |
| **As MCP client** | Yes — manages `mcp.servers` for runtimes it launches | Not documented |
| **Claude Code integration** | Strong: Claude Code connects to OpenClaw gateway as MCP server, gets access to all channels and permissions | Weak: no MCP path; Claude Code would need to call gateway API directly |
| **Ecosystem** | 500+ community MCP servers compatible | No equivalent |

**Verdict:** OpenClaw wins decisively on MCP. This is its strongest differentiator. OpenClaw exposing its gateway as an MCP server means Claude Code (and any MCP client) can read/write messages across all 24 platforms through one tool interface.

---

### Security

| | OpenClaw | Hermes |
|---|---|---|
| **CVE history** | **138 CVEs in 5 months** — 12 super-critical, 21 high-risk | No comparable CVE record |
| **Critical vulnerabilities** | CVE-2026-25253: 1-click RCE via malicious link; CVE-2026-32922 (CVSS 9.9): pairing token → full admin + RCE | N/A |
| **Default exposure** | Default `0.0.0.0` binding exposed 230,000+ public instances; 87,800 leaking data | Requires explicit API_SERVER_ENABLED=true |
| **Skill ecosystem** | 12% malicious upload rate (Feb 2026), 1,400+ malicious skills; Cisco documented skill-based data exfiltration | Curated providers; no documented mass-malicious-plugin event |
| **Group chat** | Known secret exposure across users | Better isolation |
| **Sandboxing** | Optional Docker-backed sandbox (must opt-in) | SSH sandboxing built-in, audit logging |
| **Gov. bans** | Chinese state enterprises banned from using it (March 2026) | None |
| **Dedicated hardening guide** | Microsoft Security Blog published one | Not needed |

**Verdict:** Hermes wins by a wide margin. OpenClaw's security record is deeply concerning for a production self-hosted deployment. Running it as an Eve service that holds Synap API keys is a meaningful attack surface.

---

### Developer Experience & Maturity

| | OpenClaw | Hermes |
|---|---|---|
| **Language** | TypeScript | Python |
| **Stars** | ~369K | ~135K |
| **Setup** | <30 min with Docker | 2-4 hours full; ~30 min with Docker + pre-config |
| **Migration path** | — | `hermes claw migrate` imports OpenClaw settings, memories, and skills |
| **Self-hostable** | Yes | Yes |
| **Governance** | Non-profit foundation (creator left for OpenAI) | NousResearch (active, model-building team) |
| **Docs quality** | Comprehensive, developer-friendly | Good, developer-friendly |
| **Target user** | Broad (power-users to developers) | Developer-first |
| **Enterprise suitability** | Low (security record, no audit logging) | Medium-high (SSH sandboxing, better isolation) |

---

## What This Means for Eve

### How OpenClaw Currently Fits in Eve

There are **two distinct OpenClaw integrations** that must not be confused:

1. **Distribution channel (not Eve's problem):** The Synap `SKILL.md` at `synap-backend/skills/synap/SKILL.md`. Users who already have OpenClaw installed can `openclaw skill install synap` and connect their agent to their Synap pod. Eve doesn't deploy or manage this. It's a funnel for the existing OpenClaw user base (~369K potential installs). **This stays regardless of any Eve decision.**

2. **Eve-deployed component (`eve-arms-openclaw`):** Eve installs and manages an OpenClaw container as part of the Eve stack. Configured via `wireOpenclaw()`, gets its own Hub API key, wired to `eve-brain-synap:4000/v1`. **This is what's under question.**

### The Core Problem with Eve-Deployed OpenClaw

Running OpenClaw as an Eve component means:
- Exposing a container with 138 CVEs to the user's server
- Holding a `SYNAP_API_KEY` inside that container (full Hub Protocol access)
- The skill ecosystem (if the user installs ClawHub skills) runs inside the same trust boundary
- Gateway unresponsiveness on long tasks means Eve's "always-on AI" promise breaks

### What Hermes Gives Us That OpenClaw Can't

1. **`MemoryProvider` contract** — 100% of memory syncs guaranteed to reach Synap. No skill call, no explicit tool invocation needed. Every conversation turn lands in Synap automatically.
2. **Stateless Hermes, stateful Synap** — Hermes holds zero proprietary state. If the container dies, nothing is lost. Synap is the brain.
3. **Native messaging channels** — Telegram, Discord, WhatsApp, Signal, Matrix — all natively in Hermes. No MCP servers needed, no security risk from a plugin ecosystem.
4. **Python extensibility** — The plugin is Python. We can use `requests`, `httpx`, async IO, the full Python ecosystem. Not constrained by Node.js/TypeScript.
5. **Better security posture** — No equivalent CVE record. SSH sandboxing. No malicious plugin ecosystem (our plugin is generated by Eve, not installed from a registry).

### Where OpenClaw Has Unique Value We'd Lose

1. **MCP server mode** — OpenClaw exposing its gateway as MCP is genuinely useful for Claude Code integration. `messages_send`, `conversations_list`, `events_poll` — this lets AI coders interact with messaging channels programmatically. Hermes has no equivalent.
2. **24-platform breadth** — iMessage/BlueBubbles is OpenClaw-only among self-hosted agents.
3. **5,400+ community skills** — Large ecosystem, though security caveats apply.
4. **TypeScript codebase** — Accessible to the Eve team's existing stack.

---

## The Recommendation: Remove Eve-Deployed OpenClaw

**Drop `eve-arms-openclaw` as an Eve component. Replace it with Hermes for all agent functionality.**

### Reasoning

**Security alone is sufficient justification.** 138 CVEs in 5 months, CVSS 9.9 RCE in the pairing flow, 230K public instances exposed by default. Eve is a self-hosted sovereign stack — the security posture of its components matters. We cannot responsibly ship OpenClaw as an always-on Eve service holding a full Synap API key.

**Memory is the killer feature.** Synap's core value proposition is "never lose anything." The Hermes `MemoryProvider` plugin makes this literal — every conversation turn, every session end, every memory write mirrors to Synap automatically. OpenClaw requires the agent to explicitly call Hub Protocol tools. That's best-effort. The plugin contract is guaranteed.

**The MCP gap is not an Eve gap.** The one thing OpenClaw uniquely provides (MCP server mode for Claude Code) is addressable differently: Claude Code connects directly to Hermes' OpenAI-compat gateway (Solution B from the previous session), or via the Synap Hub Protocol skill (which doesn't require OpenClaw to be running). The channel messaging tools that OpenClaw's MCP exposes become Hermes native platform connections.

**The distribution channel stays.** Removing Eve-deployed OpenClaw doesn't remove the Synap skill from OpenClaw users. The `synap` skill is a package in `synap-backend/skills/synap/` — it stays there, independent of Eve. Users who already run OpenClaw keep their integration. We just stop deploying OpenClaw ourselves.

### The New Architecture

```
MESSAGING CHANNELS (Telegram, Discord, WhatsApp, Signal, Matrix)
          ↓  native platform plugins
    HERMES  (eve-builder-hermes, port 8642)
    ├── memory: synap_provider plugin → Hub Protocol → Synap
    ├── LLM: → eve-brain-synap:4000/v1
    └── tools: 61 built-in tools, 7 terminal backends

OPENCLAW  (distribution only — not Eve-deployed)
    └── synap SKILL.md → Hub Protocol → Synap
         (for existing OpenClaw users; Eve doesn't manage this)

AI CODERS (Claude Code, OpenCode, Coder agent)
    ├── Option A: → Synap Hub directly (current, SKILL.md)
    └── Option B: → Hermes gateway → memory-augmented → Synap IS
```

### Migration Path

1. Remove `eve-arms-openclaw` from `COMPONENTS` (mark deprecated, not deleted — existing installs keep working)
2. Remove `wireOpenclaw()` from `AI_CONSUMERS` and `AI_CONSUMERS_NEEDING_RECREATE`  
3. Remove messaging config from `secrets.arms.messaging` (move to `secrets.builder.hermes.messaging` if keeping Hermes messaging config)
4. Remove the messaging section we just added to the dashboard AI page (or repurpose for Hermes channels)
5. Add `eve-builder-hermes` compose service, `generateSynapPlugin()`, pre-config generation
6. Update dashboard to show Hermes as the messaging/agent component
7. Keep `synap-backend/skills/synap/SKILL.md` — do not touch

**Note:** The messaging API route (`/api/arms/messaging`) we just built can be repurposed: move to `/api/builder/hermes/channels` and write to Hermes' `config.yaml` instead of OpenClaw env vars. Same concept, different destination.

---

## Decision Matrix

| Scenario | Use OpenClaw | Use Hermes | Both |
|---|---|---|---|
| **Self-hosted Eve component** | ❌ Security risk, no memory guarantee | ✅ Plugin contract, stateless | — |
| **Messaging channels** | ❌ CVEs, secret exposure in groups | ✅ Native, better isolation | — |
| **Synap memory integration** | ❌ Best-effort (skill-based) | ✅ Guaranteed (plugin contract) | — |
| **Distribution / funnel** | ✅ SKILL.md — keep as-is | N/A | — |
| **Claude Code / MCP bridge** | ✅ MCP server mode | ❌ No MCP | Consider keeping for this only |
| **Autonomous long tasks** | ❌ Gateway unresponsiveness bug | ✅ Designed for persistent headless | — |
| **5,400+ community skills** | ✅ Large ecosystem | ❌ Smaller | Keep SKILL.md access |

**Only one scenario favors keeping Eve-deployed OpenClaw: MCP bridging for Claude Code.** This is solvable without OpenClaw (Hermes gateway as AI proxy, or direct Synap Hub skill for Claude Code — which already exists and works).

---

## Summary

| Dimension | Winner |
|---|---|
| Security | **Hermes** (by a wide margin) |
| Memory integration with Synap | **Hermes** (plugin contract vs. best-effort skill calls) |
| Messaging channel breadth | **Draw** (OpenClaw: iMessage; Hermes: SMS) |
| Agentic / multi-agent | **Hermes** (true MOA, 7 terminals, self-improving skills) |
| MCP integration | **OpenClaw** (first-class MCP server + 500+ servers) |
| Skills ecosystem size | **OpenClaw** (5,400+ vs smaller Hermes hub) |
| Model provider breadth | **OpenClaw** (40 vs 18 providers) |
| Memory quality | **Hermes** (compounding sessions vs file-based) |
| Production reliability | **Hermes** (no long-task freeze bug, no CVEs) |
| Synap distribution channel | **OpenClaw** (SKILL.md stays as funnel, independent) |

**Decision: Hermes for Eve. OpenClaw as a skill target, not a deployed component.**
