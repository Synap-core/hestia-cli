# AI Provider Model

## Overview

Eve uses a **single source of truth** for AI providers: the `providers[]` array in `secrets.json` (`~/.eve/secrets/secrets.json`). Every component that consumes AI derives its configuration from this list via the central wiring system in `@eve/dna`.

## Provider schema

Each provider entry has the following shape:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier. Built-in IDs: `ollama`, `openrouter`, `anthropic`, `openai`. Custom IDs: any string prefixed with `custom-` (auto-generated). |
| `name` | string | No | Display name. Defaults to built-in name map for known IDs; falls back to ID itself. |
| `enabled` | boolean | No | Whether this provider is active. Disabled providers are skipped during resolution. |
| `apiKey` | string | Varies | API key. Required for built-in cloud providers (`anthropic`, `openai`, `openrouter`). Not required for Ollama or custom providers without keys. Masked in API responses. |
| `baseUrl` | string | No | OpenAI-compatible endpoint. Required for custom providers. Built-in cloud providers omit this (they use hardcoded upstream endpoints). |
| `defaultModel` | string | No | Model string to use when no per-service override exists. |
| `isCustom` | boolean | Derived | `id.startsWith('custom-')`. Determined at read time, never stored. |

## Provider resolution order

When a component needs a provider, Eve resolves it in this order:

1. **Per-service override** — `secrets.ai.serviceProviders[componentId]` overrides the global default for that component
2. **Global default** — `secrets.ai.defaultProvider` is used
3. **First enabled** — first `enabled: true` provider in the list
4. **First present** — if no providers are enabled, the first provider in the list

Per-service model overrides work the same way via `secrets.ai.serviceModels[componentId]`.

## Components

The following components consume AI providers (source of truth: `AI_CONSUMERS` set in `@eve/dna/wire-ai.ts`):

| Component | Needs recreate? | How it uses providers |
|-----------|-----------------|----------------------|
| `synap` (IS) | No | Holds upstream keys directly. Proxies requests to Anthropic/OpenAI/OpenRouter. |
| `openclaw` | Yes | Wired to use Synap IS as OpenAI-compat backend. Env vars baked at container start. |
| `openwebui` | No | Config files written on-wire; containers reload without full restart. |
| `hermes` | Yes | Reads providers from config YAML + environment. Needs recreate to pick up env changes. |

Components needing recreate (`AI_CONSUMERS_NEEDING_RECREATE`) get a full `docker stop + docker run` with refreshed env vars. Components that don't need recreate get a wire-only restart.

## Configuration flow

```
User action (UI)
  → API route (POST/PATCH /api/ai/...)
    → writeEveSecrets() → updates secrets.json
    → mergeProviderLists() → idempotent migration helper (runs on first write if legacy field detected)
    → autoApply()
      → readEveSecrets() → fresh read
      → wireAllInstalledComponents() → writes config files / restarts containers
      → for AI_CONSUMERS_NEEDING_RECREATE: runActionToCompletion(id, "recreate")
    → returns results per component
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ai` | Returns providers list, default/fallback provider, service overrides, model list, consumer IDs |
| PATCH | `/api/ai` | Updates default/fallback provider, mode, service overrides, service model overrides |
| POST | `/api/ai/providers` | Add or update any provider (built-in or custom) |
| DELETE | `/api/ai/providers?id=...` | Remove a provider |
| POST | `/api/ai/test` | Live connectivity test — pings provider's model endpoint, returns model count + latency |
| POST | `/api/ai/apply` | Manually re-apply current config to all installed components |

## Doctor / health checks

The doctor report (`GET /api/doctor`) includes per-provider connectivity probes:

- For Ollama: fetches `{baseUrl}/api/tags`
- For all others: fetches `{baseUrl}/v1/models`
- Results: pass (model count + latency), fail (HTTP status or network error)
- Disabled providers are skipped
- Providers without a baseUrl get a warning (Ollama: informational; cloud: fail)

The `IntegrationChecklist` component filters doctor checks by `integrationId` for per-component views (Hermes, OpenClaw, OpenWebUI panels).

## Migration from legacy model

Prior to this consolidation, Eve maintained two parallel lists:

- `providers[]` — built-in enum providers (`ollama` | `openrouter` | `anthropic` | `openai`)
- `customProviders[]` — arbitrary OpenAI-compatible endpoints

The `mergeProviderLists()` helper in `writeEveSecrets()` runs on every write:
1. Detects `customProviders` field (legacy) or `custom-` prefixed IDs
2. Merges both into a unified `providers[]`
3. Strips the `customProviders` field
4. Idempotent — safe to run multiple times

## Key files

- `@eve/dna/src/secrets-contract.ts` — Zod schema + secrets read/write + migration helper
- `@eve/dna/src/wire-ai.ts` — Provider resolution (`pickPrimaryProvider`), per-component wiring, consumer sets
- `@eve/dna/src/index.ts` — Barrel exports
- `app/api/ai/route.ts` — Config endpoints (GET/PATCH)
- `app/api/ai/providers/route.ts` — Provider CRUD endpoints
- `app/api/ai/test/route.ts` — Connectivity test endpoint
- `lib/doctor.ts` — Health check probes
- `app/(os)/settings/ai/page.tsx` — Settings UI
