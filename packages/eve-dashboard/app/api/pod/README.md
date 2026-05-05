# `/api/pod/*` — Eve's USER channel proxy

This is the user-channel half of Eve's two-channel rule (see
[`eve-credentials.mdx`](../../../../../synap-team-docs/content/team/platform/eve-credentials.mdx)).

| Path on Eve | Forwards to | Auth attached |
|---|---|---|
| `/api/pod/<anything>` | `${pod.synap.apiUrl}/<anything>` | `Bearer pod.userToken` |
| `/api/hub/*` | pod `/api/hub/*` | `Bearer agents.eve.hubApiKey` (service channel) |

## How the operator signs in

The proxy auto-mints a fresh `pod.userToken` on demand whenever the
cached one is missing or expired. To do that, it needs to know the
operator's email — that's persisted alongside the token at
`secrets.pod.userEmail`. The first time you ever sign in there's no
cached email, so a single explicit POST gets you bootstrapped.

### First-time signin

```sh
# 1. Sign into the local Eve dashboard (sets the eve-session cookie).
#    Either use the UI or hit /api/auth/verify with your dashboard secret:
curl -X POST http://localhost:7979/api/auth/verify \
  -H 'Content-Type: application/json' \
  --cookie-jar cookies.txt \
  -d '{"secret":"<your eve dashboard secret>"}'

# 2. Mint the pod user-session token (RFC 7523 JWT-Bearer exchange).
curl -X POST http://localhost:7979/api/auth/pod-signin \
  -H 'Content-Type: application/json' \
  --cookie cookies.txt \
  -d '{"email":"alice@example.com"}'

# Response:
#   { "ok": true, "expiresAt": "...", "user": { "id":"...", "email":"...", "name":"..." } }
```

After that returns 200, the catch-all proxy will silently re-mint
whenever the token nears expiry (60s buffer). No further explicit
signin is needed for the lifetime of the cached email.

### Pre-flight: trusted issuer registration

The pod's `/api/hub/auth/exchange` endpoint refuses to mint a session
unless Eve is registered in the pod's `trusted_issuers` table with
`status: 'approved'` and `allowed_scopes: ["auth:exchange-user"]`.

For self-hosted single-machine installs the bootstrap path
auto-approves Eve's registration when the first admin is created
(see Phase 5). For managed pods or admin-installed Eve instances the
operator approves the registration once via the pod's admin UI.

The pod fetches Eve's JWKS at:

```
GET ${eve_external_url}/.well-known/jwks.json
```

`eve_external_url` resolution (in order):

1. `secrets.dashboard.publicUrl` (when explicitly stored — not set by
   default).
2. `https://eve.${secrets.domain.primary}` (the standard install).
3. `http://localhost:${secrets.dashboard.port ?? 7979}` (loopback dev
   only — the pod must be on the same host for JWKS to resolve).

### Errors the dashboard might surface

| Status | Body shape | Meaning |
|---|---|---|
| 401 | `{ error: "no-pod-session", action: "sign-in-required" }` | First-time signin not done — call `/api/auth/pod-signin`. |
| 401 | `{ error: "invalid_client" }` | Trusted-issuer not approved on the pod. |
| 401 | `{ error: "user_not_found" }` | The email doesn't match a pod human user. Run bootstrap or invite first. |
| 403 | `{ error: "insufficient_scope" }` | Trusted-issuer registration is missing `auth:exchange-user`. |
| 503 | `{ error: "no-pod-url" }` | Pod URL not configured in `secrets.synap.apiUrl`. |
| 503 | `{ error: "no-eve-url" }` | Eve has no resolvable external URL — set domain or `dashboard.publicUrl`. |
| 502 | `{ error: "pod_unreachable" }` | Network error reaching the pod. |

## Two-channel rule (do NOT cross channels)

| Operation | Channel | Why |
|---|---|---|
| Read inbox / approve / reject proposals | `/api/pod/*` | Operator action — user identity in the audit log. |
| Edit profile / invite teammate / settings | `/api/pod/*` | Operator action. |
| Submit a proposal as an agent | `/api/hub/*` | Service action — the agent is the actor. |
| Post a proactive nudge | `/api/hub/*` | Service action. |
| OpenClaw skill round-trips | `/api/hub/*` | Service action. |

Routing the wrong channel pollutes audit logs, gives human actions the
elevated RBAC scopes of agents, and locks future per-agent scope
tightening out. The proxy attaches the credential — pages don't pick
credentials, they pick a path.
