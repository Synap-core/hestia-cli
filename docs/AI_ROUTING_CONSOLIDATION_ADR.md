# AI Routing Consolidation ADR

Status: proposed (ready to implement)

## Context

Eve and Synap both touch "AI routing," but they solve different problems:

- Synap routes **intelligence services** internally (which service instance executes capabilities).
- Eve routes **model providers** for external and sidecar tools (OpenCode, OpenClaude, Claude Code, OpenClaw).

Without explicit boundaries, naming and configuration overlap can create confusing and redundant behavior.

## Decision

Keep two routing domains, with one owner each:

1. **Synap internal routing (Heart runtime)** remains the source of truth for intelligence-service selection inside the Data Pod.
2. **Eve provider routing (foundation layer)** remains the source of truth for model provider choice and fallback for external tooling around Synap.

Do not merge these two concerns into one setting block or one resolver.

## Glossary

- **Heart**: Synap Data Pod (state, memory, channels, governance, internal service routing).
- **Brain (inference layer)**: local or cloud model providers used by Eve-managed clients and tools.
- **IS routing**: Synap intelligence-service routing (`intelligenceServiceId` and overrides).
- **Provider routing**: Eve AI mode/provider/fallback (`ai.mode`, `ai.defaultProvider`, `ai.fallbackProvider`, `ai.providers[]`).

## Ownership Matrix

- **Synap backend owns**
  - Intelligence service resolution for pod capabilities.
  - Workspace governance and proposal policy.
  - Workspace-level policy persistence when synchronized intentionally.
- **Eve CLI owns**
  - AI foundation UX (`local|provider|hybrid`).
  - Provider credentials and fallback defaults in `.eve/secrets/secrets.json`.
  - Builder/client environment wiring (`HUB_BASE_URL`, `SYNAP_API_KEY`, skills path).
- **Shared contract**
  - Hub API key + skill files are the stable integration surface for clients.
  - Optional explicit "sync policy to workspace settings" action (never implicit mutation every run).

## Precedence Rules

For Eve-managed clients:

1. Project-level explicit env/config (if set).
2. Eve secrets provider routing (`ai.*`).
3. Safe defaults from setup profile.

For Synap internal capabilities:

1. Synap workspace/user/service overrides (internal logic).
2. Synap environment fallback.

No cross-domain implicit fallback from one resolver into the other.

## Do / Don't Rules

- **Do** keep naming explicit: "IS routing" vs "provider routing."
- **Do** keep Hub + skills as the canonical interop contract for external clients.
- **Do** sync from Eve to Synap only through explicit command/flag (`eve ai sync --workspace <id>`).
- **Don't** store provider secrets in Synap workspace settings by default.
- **Don't** let Eve override Synap internal service selection automatically.
- **Don't** reuse one JSON field for both provider and intelligence-service concerns.

## Migration Checklist

1. Keep setup/profile/docs language aligned to two-domain routing.
2. Ensure CLI help text and command descriptions say "provider routing" for Eve.
3. Ensure Synap docs and code references keep "intelligence service routing" naming.
4. Add explicit sync command/flow before writing any provider policy to workspace settings.
5. Validate tests for `eve setup --dry-run` and `eve ai` provider commands after wording changes.

## Consequences

- Clear mental model: Synap as Heart, inference/provider layer as Brain.
- Less accidental coupling between pod internals and external tooling.
- Easier future evolution: internal service upgrades in Synap, provider abstraction changes in Eve.
