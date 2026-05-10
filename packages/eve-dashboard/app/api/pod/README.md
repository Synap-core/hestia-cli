# `/api/pod/*` — Eve's USER channel proxy

This is the user-channel half of Eve's two-channel rule (see
[`eve-credentials.mdx`](../../../../../synap-team-docs/content/team/platform/eve-credentials.mdx)).

| Path on Eve | Forwards to | Auth attached |
|---|---|---|
| `/api/pod/<anything>` | `${pod.synap.apiUrl}/<anything>` | Inbound `ory_kratos_session` cookie (forwarded verbatim) |
| `/api/hub/*` | pod `/api/hub/*` | `Bearer agents.eve.hubApiKey` (service channel) |

## How the operator signs in

Cookie-only. The Kratos session cookie is set at `Domain=.<root>` by
any sibling Synap surface (pod-admin login, the in-dashboard
`PodPairDialog`, the `/setup/pair-pod` page) and is therefore visible
to `eve.<root>`, `pod-admin.<root>`, and `pod.<root>` simultaneously.
The proxy reads the inbound `ory_kratos_session` cookie and forwards
it untouched to the pod.

Eve persists nothing. There is no JWT-Bearer (RFC 7523) mint flow, no
`pod.userToken` slot, no JWKS to publish.

### Sign-in surfaces

1. **Pod-admin's native `/login`** — the canonical entry point. Kratos
   sets the parent-domain cookie; eve picks it up automatically.
2. **`POST /api/pod/kratos-auth`** — Eve's server-side proxy for the
   pod's Kratos `self-service/login` flow. Used by the in-dashboard
   `PodPairDialog` and the `/setup/pair-pod` page. On success the
   route writes the `ory_kratos_session` cookie at the parent domain
   on its own response, so subsequent `/api/pod/*` calls just work.

### Sign-out

`POST /api/auth/pod-signout` initiates a Kratos browser-flow logout on
the pod. The route returns the Kratos `logout_url` for the browser to
navigate to, AND clears the parent-domain cookie defensively from its
own response so the local UI flips immediately.

### Errors the dashboard might surface

| Status | Body shape | Meaning |
|---|---|---|
| 401 | `{ error: "no-pod-session", action: "sign-in-required" }` | No `ory_kratos_session` cookie was sent. The operator needs to sign in via pod-admin (or the in-dashboard `PodPairDialog`). |
| 503 | `{ error: "no-pod-url" }` | Pod URL not configured in `secrets.synap.apiUrl`. |
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
