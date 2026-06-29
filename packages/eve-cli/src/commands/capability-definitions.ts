/**
 * Vendored CapabilityDefinition seed payloads for `eve capabilities sync`.
 *
 * These are the source-of-truth seed templates from
 * `synap-backend/templates/capabilities/*.capability.json`, vendored INTO eve as
 * a TS literal so tsup bundles them (eve must not reach across repos at runtime).
 * `eve capabilities sync` POSTs each to /api/hub/capabilities/templates; the DB
 * is the source of truth POST-sync. To edit a template: edit the backend JSON,
 * re-vendor here, and re-run `eve capabilities sync`.
 *
 * Generated from the backend JSONs — keep field names VERBATIM with the backend
 * CapabilityDefinition contract.
 */

import type { CapabilityDefinition } from "./capabilities.js";

export const CAPABILITY_DEFINITIONS: Record<string, CapabilityDefinition> = {
  "generic-apikey": {
    "key": "generic-apikey",
    "name": "Generic API-Key Connector",
    "description": "Provider-neutral demonstration of the capability-template shape: stores one API key in the vault, registers one HTTP API tool that authenticates with it, and seeds one code skill that fetches from the provider and proposes the results as entities. Customize via the {{baseUrl}}, {{apiKey}}, and {{entityProfile}} params — no provider is hardcoded.",
    "params": [
      {
        "name": "apiKey",
        "label": "API key",
        "type": "text",
        "required": true,
        "description": "The bearer API key for the provider. Stored server-encrypted in the vault; never persisted in the template."
      },
      {
        "name": "baseUrl",
        "label": "Base URL",
        "type": "text",
        "required": true,
        "description": "The provider's API base URL, e.g. https://api.example.com/v1"
      },
      {
        "name": "entityProfile",
        "label": "Target entity profile",
        "type": "text",
        "required": false,
        "default": "note",
        "description": "The profileSlug the skill proposes fetched records as."
      }
    ],
    "vault": [
      {
        "ref": "apiKeySecret",
        "name": "{{name}} API key",
        "value": "{{apiKey}}",
        "type": "api_key",
        "description": "API key for the generic-apikey connector."
      }
    ],
    "tools": [
      {
        "name": "generic_api",
        "kind": "api",
        "description": "Authenticated HTTP access to the provider API.",
        "credentialRef": "apiKeySecret",
        "executor": "is-agent",
        "config": {
          "baseUrl": "{{baseUrl}}",
          "auth": {
            "in": "header",
            "name": "Authorization",
            "prefix": "Bearer "
          }
        }
      }
    ],
    "skills": [
      {
        "name": "{{name}} fetch-and-propose",
        "kind": "code",
        "scope": "pod",
        "description": "Fetches records from the provider API and proposes each as an entity (proposal-gated). Calls the required tool by name via callProvider('generic_api', ...).",
        "requires": [
          "generic_api"
        ],
        "executionMode": "async",
        "timeoutSeconds": 60,
        "parameters": {
          "path": "string?",
          "entityProfile": "string?"
        },
        "code": "// Generic fetch -> propose loop. The skill body is a STATEMENT body (no `export\n// default`); the executor wraps it as (async function(args, context){ <code> }).\n// callProvider is POSITIONAL: callProvider(provider, method, path, body?) where\n// `provider` is the required tool's NAME ('generic_api') — the dispatcher resolves\n// it to the tool's credentialRef server-side and injects the vaulted API key. No\n// providerRef arg needed. propose.entity REQUIRES `title` (not `name`) and routes\n// the write through checkPermissionOrPropose.\nconst path = args.path || '/records';\nconst profileSlug = args.entityProfile || 'note';\nconst res = await callProvider('generic_api', 'GET', path);\nconst data = res && res.body !== undefined ? res.body : res;\nconst records = Array.isArray(data)\n  ? data\n  : (data && Array.isArray(data.data) ? data.data : (data && data.records) || []);\nlet proposed = 0;\nfor (const record of records) {\n  await propose.entity({\n    profileSlug,\n    title: String((record && (record.name || record.title || record.id)) || 'record'),\n    properties: record,\n  });\n  proposed++;\n}\nreturn { proposed };\n"
      }
    ]
  },
  "unipile-linkedin": {
    "key": "unipile-linkedin",
    "name": "Unipile — LinkedIn",
    "description": "LinkedIn outreach via Unipile (API-key connector). Stores the Unipile API key in the vault, registers one HTTP API tool that authenticates with Unipile's X-API-KEY header against the account's DSN, and seeds two proposal-gated code skills: search LinkedIn profiles (proposed as `person` entities) and send a connection invitation (the result noted as a `note`). Grounded in synap-backend's UnipileConnector (X-API-KEY auth, /api/v1 base) and the Unipile v1 LinkedIn API. PRECONDITION: a Unipile account with a connected LinkedIn account; pass that account_id as the skill `accountId` arg. The applier remaps the tool credentialRef to a runtime vault://<id>; the skills call the tool by NAME via callProvider('unipile_linkedin', ...), so the dispatcher resolves the credentialRef and injects the vaulted X-API-KEY server-side — no providerRef arg needed.",
    "params": [
      {
        "name": "unipileApiKey",
        "label": "Unipile API key",
        "type": "text",
        "required": true,
        "description": "The Unipile X-API-KEY. Stored server-encrypted in the vault; never persisted in the template."
      },
      {
        "name": "unipileBaseUrl",
        "label": "Unipile DSN base URL",
        "type": "text",
        "required": true,
        "description": "Your Unipile DSN with the /api/v1 prefix, e.g. https://api6.unipile.com:13670/api/v1 — the same DSN UnipileConnector uses. Includes the host and port assigned to your Unipile account."
      },
      {
        "name": "unipileAccountId",
        "label": "Unipile LinkedIn account id",
        "type": "text",
        "required": true,
        "description": "The Unipile account_id of the connected LinkedIn account that performs the search and sends invitations (from GET /api/v1/accounts). Used as the default skill accountId."
      },
      {
        "name": "entityProfile",
        "label": "Target person profile",
        "type": "text",
        "required": false,
        "default": "person",
        "description": "The profileSlug found LinkedIn profiles are proposed as."
      }
    ],
    "vault": [
      {
        "ref": "unipileApiKeySecret",
        "name": "{{name}} Unipile API key",
        "value": "{{unipileApiKey}}",
        "type": "api_key",
        "description": "Unipile X-API-KEY for the LinkedIn connector."
      }
    ],
    "tools": [
      {
        "name": "unipile_linkedin",
        "kind": "api",
        "description": "Authenticated HTTP access to the Unipile v1 API (LinkedIn). The applier injects the vaulted API key into the X-API-KEY header; its credentialRef is remapped to the runtime vault://<id> at apply time.",
        "credentialRef": "unipileApiKeySecret",
        "executor": "is-agent",
        "config": {
          "baseUrl": "{{unipileBaseUrl}}",
          "auth": {
            "in": "header",
            "name": "X-API-KEY",
            "prefix": ""
          }
        }
      }
    ],
    "skills": [
      {
        "name": "linkedin_search_profile",
        "kind": "code",
        "scope": "pod",
        "description": "Searches LinkedIn profiles via Unipile and proposes each match as a person entity (proposal-gated). Args: { keywords: string, accountId?: string, limit?: number }. Calls the tool by name via callProvider('unipile_linkedin', ...).",
        "requires": [
          "unipile_linkedin"
        ],
        "executionMode": "async",
        "timeoutSeconds": 60,
        "parameters": {
          "keywords": "string",
          "accountId": "string?",
          "limit": "number?"
        },
        "code": "// LinkedIn people search via Unipile, proposed as person entities.\n// Executor wraps this body as (async function(args, context){ <code> }); use args\n// directly and `return` the result. callProvider(provider, method, path, body?)\n// runs the required tool through the dispatcher — pass the tool NAME\n// ('unipile_linkedin') and the dispatcher resolves its credentialRef, injects the\n// vaulted X-API-KEY, and uses the tool's config.baseUrl = DSN + /api/v1. No\n// providerRef arg needed.\nconst accountId = String(args?.accountId ?? '{{unipileAccountId}}');\nconst keywords = String(args?.keywords ?? '').trim();\nconst limit = Number(args?.limit ?? 10);\nif (!keywords) throw new Error('linkedin_search_profile: keywords is required');\n\n// Unipile v1 LinkedIn search (category people).\nconst qs = new URLSearchParams({ account_id: accountId, keywords, limit: String(limit) });\nconst res = await callProvider('unipile_linkedin', 'GET', `/linkedin/search?${qs.toString()}`);\nconst payload = res?.body ?? res;\nconst items = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : []);\n\nconst profileSlug = '{{entityProfile}}' || 'person';\nlet proposed = 0;\nfor (const p of items.slice(0, limit)) {\n  const name = String(p?.name ?? [p?.first_name, p?.last_name].filter(Boolean).join(' ') ?? 'LinkedIn profile').trim() || 'LinkedIn profile';\n  await propose.entity({\n    profileSlug,\n    title: name,\n    properties: {\n      headline: p?.headline ?? null,\n      company: p?.current_company ?? p?.company ?? null,\n      location: p?.location ?? null,\n      linkedinProviderId: p?.provider_id ?? p?.id ?? null,\n      publicIdentifier: p?.public_identifier ?? p?.public_id ?? null,\n      profileUrl: p?.profile_url ?? null,\n      source: 'unipile-linkedin'\n    },\n    reasoning: `LinkedIn profile matched search \"${keywords}\" via Unipile.`\n  });\n  proposed += 1;\n}\nreturn { proposed, keywords };\n"
      },
      {
        "name": "linkedin_send_invite",
        "kind": "code",
        "scope": "pod",
        "description": "Sends a LinkedIn connection invitation via Unipile, then notes the action as a note entity (proposal-gated). Args: { providerId: string (target LinkedIn provider_id), accountId?: string, message?: string }. Calls the tool by name via callProvider('unipile_linkedin', ...).",
        "requires": [
          "unipile_linkedin"
        ],
        "executionMode": "async",
        "timeoutSeconds": 60,
        "parameters": {
          "providerId": "string",
          "accountId": "string?",
          "message": "string?"
        },
        "code": "// Send a LinkedIn connection request via Unipile, then record a note.\n// Executor wraps this body as (async function(args, context){ <code> }); use args\n// directly and `return`. callProvider runs the unipile_linkedin tool through the\n// dispatcher by NAME — the dispatcher resolves its credentialRef and injects the\n// X-API-KEY server-side from the vault; propose.entity routes the write through\n// governance. No providerRef arg needed.\nconst accountId = String(args?.accountId ?? '{{unipileAccountId}}');\nconst providerId = String(args?.providerId ?? '').trim();\nconst message = typeof args?.message === 'string' ? args.message : undefined;\nif (!providerId) throw new Error('linkedin_send_invite: providerId (the target LinkedIn provider_id) is required');\n\n// Unipile v1 connection-request endpoint.\nconst body = { account_id: accountId, provider_id: providerId };\nif (message) body.message = message;\nconst res = await callProvider('unipile_linkedin', 'POST', '/users/invite', body);\nconst ok = res?.status ? res.status >= 200 && res.status < 300 : true;\n\nawait propose.entity({\n  profileSlug: 'note',\n  title: `LinkedIn invitation ${ok ? 'sent' : 'attempted'} -> ${providerId}`,\n  properties: {\n    action: 'linkedin_send_invite',\n    providerId,\n    message: message ?? null,\n    status: res?.status ?? null,\n    success: ok,\n    source: 'unipile-linkedin'\n  },\n  reasoning: 'Recorded the outbound LinkedIn connection request for the activity timeline.'\n});\nreturn { success: ok, providerId, status: res?.status ?? null };\n"
      }
    ]
  },
  "nango-gmail": {
    "key": "nango-gmail",
    "name": "Nango — Gmail",
    "description": "Send follow-up email via Gmail through Nango OAuth. Registers one provider tool whose credentialRef is the stable nango://gmail ref (Nango holds the OAuth credential — no vault secret), and seeds one proposal-gated code skill that sends an email via the Gmail API (users.messages.send) and notes the send as a `note`. Grounded in synap-backend's NangoConnector.proxyRequest (Connection-Id + Provider-Config-Key, host/proxy<path>) and external-dispatch's nango:// handler. PRECONDITION: a Nango integration with providerConfigKey 'gmail' must already exist and the acting user must have connected their Google account via Settings -> Connectors; the dispatcher resolves the user's most-recent gmail connection automatically.",
    "params": [],
    "vault": [],
    "tools": [
      {
        "name": "gmail",
        "kind": "provider",
        "description": "Gmail access through Nango. credentialRef nango://gmail resolves the user's Google connection (Connection-Id + Provider-Config-Key) and proxies the request to the Gmail API.",
        "credentialRef": "nango://gmail",
        "executor": "is-agent",
        "config": {
          "providerConfigKey": "gmail"
        }
      }
    ],
    "skills": [
      {
        "name": "gmail_send",
        "kind": "code",
        "scope": "pod",
        "description": "Sends an email via Gmail (Nango OAuth) and notes the send as a note entity (proposal-gated). Args: { to: string, subject: string, body: string }.",
        "requires": [
          "gmail"
        ],
        "executionMode": "async",
        "timeoutSeconds": 60,
        "parameters": {
          "to": "string",
          "subject": "string",
          "body": "string"
        },
        "code": "// Send a Gmail message via Nango OAuth, then record a note.\n// Executor wraps this body as (async function(args, context){ <code> }); use args\n// directly and `return`. callProvider('gmail', 'POST',\n// '/gmail/v1/users/me/messages/send', { raw }) goes through the dispatcher by\n// tool NAME ('gmail'): the dispatcher resolves the tool's credentialRef\n// (nango://gmail), the nango:// handler resolves the user's Google connection and\n// proxies to the Gmail API. (Passing the raw credentialRef 'nango://gmail' still\n// works too — back-compat.)\nconst to = String(args?.to ?? '').trim();\nconst subject = String(args?.subject ?? '').trim();\nconst bodyText = String(args?.body ?? '');\nif (!to) throw new Error('gmail_send: to is required');\nif (!subject) throw new Error('gmail_send: subject is required');\n\n// Build an RFC 2822 message and base64url-encode it (Gmail raw field).\n// No Buffer/btoa in the isolate, so encode UTF-8 -> base64 manually.\nconst mime = [\n  'To: ' + to,\n  'Subject: ' + subject,\n  'MIME-Version: 1.0',\n  'Content-Type: text/plain; charset=\"UTF-8\"',\n  '',\n  bodyText\n].join('\\r\\n');\n\nconst B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';\nconst utf8Bytes = (str) => {\n  const out = [];\n  for (let i = 0; i < str.length; i++) {\n    let c = str.charCodeAt(i);\n    if (c < 0x80) out.push(c);\n    else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }\n    else if (c >= 0xd800 && c <= 0xdbff) {\n      const c2 = str.charCodeAt(++i);\n      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);\n      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));\n    } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }\n  }\n  return out;\n};\nconst base64 = (bytes) => {\n  let s = '';\n  for (let i = 0; i < bytes.length; i += 3) {\n    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];\n    s += B64[b0 >> 2];\n    s += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];\n    s += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];\n    s += b2 === undefined ? '=' : B64[b2 & 63];\n  }\n  return s;\n};\nconst raw = base64(utf8Bytes(mime)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');\n\nconst res = await callProvider('gmail', 'POST', '/gmail/v1/users/me/messages/send', { raw });\nconst ok = res?.status ? res.status >= 200 && res.status < 300 : true;\nconst messageId = res?.body?.id ?? null;\n\nawait propose.entity({\n  profileSlug: 'note',\n  title: 'Email ' + (ok ? 'sent' : 'attempted') + ' -> ' + to + ': ' + subject,\n  properties: {\n    action: 'gmail_send',\n    to,\n    subject,\n    gmailMessageId: messageId,\n    status: res?.status ?? null,\n    success: ok,\n    source: 'nango-gmail'\n  },\n  reasoning: 'Recorded the outbound follow-up email for the activity timeline.'\n});\nreturn { success: ok, to, subject, gmailMessageId: messageId, status: res?.status ?? null };\n"
      }
    ]
  },
  "discord-bot": {
    "key": "discord-bot",
    "name": "Discord Bot",
    "description": "Post messages to a Discord channel via a Discord bot (API-key style auth). Stores the bot token in the vault, registers one HTTP API tool that authenticates with Discord's `Authorization: Bot <token>` header against the Discord v10 API, and seeds one proposal-gated code skill that sends a channel message and records it as a note. Rides on the shipped `vault://` executor: the applier remaps the tool's template-local vault ref to a runtime `vault://<id>`, and the dispatcher resolves the tool by NAME server-side and injects the vaulted token. PRECONDITION: a Discord application with a Bot user, the bot invited to the target server with the Send Messages permission and the Message Content intent enabled. Pass the bot token as `discordBotToken` and (optionally) a default `channelId`.",
    "params": [
      {
        "name": "discordBotToken",
        "label": "Discord bot token",
        "type": "text",
        "required": true,
        "description": "The Discord bot token (Developer Portal -> Bot -> Token). Stored server-encrypted in the vault; never persisted in the template."
      },
      {
        "name": "channelId",
        "label": "Default Discord channel id",
        "type": "text",
        "required": false,
        "description": "Optional default channel id the bot posts to when a skill call omits channelId. The numeric snowflake id of the target channel."
      }
    ],
    "vault": [
      {
        "ref": "discordBotTokenSecret",
        "name": "{{name}} Discord bot token",
        "value": "{{discordBotToken}}",
        "type": "api_key",
        "description": "Discord bot token for the discord_bot connector."
      }
    ],
    "tools": [
      {
        "name": "discord_bot",
        "kind": "api",
        "description": "Authenticated HTTP access to the Discord v10 API. The applier injects the vaulted bot token into the Authorization header as `Bot <token>`; its credentialRef is remapped to the runtime vault://<id> at apply time.",
        "credentialRef": "discordBotTokenSecret",
        "executor": "is-agent",
        "config": {
          "baseUrl": "https://discord.com/api/v10",
          "auth": {
            "in": "header",
            "name": "Authorization",
            "prefix": "Bot "
          }
        }
      }
    ],
    "skills": [
      {
        "name": "discord_send_message",
        "kind": "code",
        "scope": "pod",
        "description": "Sends a message to a Discord channel via the bot, then records the post as a note entity (proposal-gated). Args: { content: string, channelId?: string }. The bot token is injected server-side from the vault; the dispatcher resolves the discord_bot tool by name.",
        "requires": [
          "discord_bot"
        ],
        "executionMode": "async",
        "timeoutSeconds": 60,
        "parameters": {
          "content": "string",
          "channelId": "string?"
        },
        "code": "// Post a message to a Discord channel via the bot, then record a note.\n// Executor wraps this body as (async (args, context) => { <code> }); use args\n// directly and `return` the result. callProvider(tool, method, path, body?)\n// runs the required tool through the dispatcher (resolves the tool by NAME\n// 'discord_bot', injects the vaulted bot token as Authorization: Bot <token>,\n// uses the tool's config.baseUrl = https://discord.com/api/v10).\nconst content = String(args?.content ?? '').trim();\nif (!content) throw new Error('discord_send_message: content is required');\nconst channelId = String(args?.channelId ?? '{{channelId}}').trim();\nif (!channelId) throw new Error('discord_send_message: channelId is required (pass it or set a default in the template)');\n\n// Discord v10 create-message endpoint.\nconst res = await callProvider('discord_bot', 'POST', '/channels/' + encodeURIComponent(channelId) + '/messages', { content });\nconst ok = res?.status ? res.status >= 200 && res.status < 300 : true;\nconst payload = res?.body ?? res;\nconst messageId = payload?.id ?? null;\n\nawait propose.entity({\n  profileSlug: 'note',\n  title: 'Discord message ' + (ok ? 'sent' : 'attempted') + ' -> #' + channelId,\n  properties: {\n    action: 'discord_send_message',\n    channelId: channelId,\n    content: content,\n    messageId: messageId,\n    status: res?.status ?? null,\n    success: ok,\n    source: 'discord-bot'\n  },\n  reasoning: 'Recorded the outbound Discord message for the activity timeline.'\n});\nreturn { success: ok, channelId: channelId, messageId: messageId, status: res?.status ?? null };\n"
      }
    ]
  }
};
