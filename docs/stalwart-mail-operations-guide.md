# Self-Hosted Mail — Operations & Deliverability Guide

> The hard part of self-hosting email is **not** the software — Stalwart is solid. It's
> **deliverability and operations**: getting your mail accepted by Gmail/Outlook, not getting
> blocklisted, and not losing data. This guide is the field manual for the Stalwart + Eve +
> Synap setup. Read it before you point real mail at the server.

---

## 0. The one-paragraph reality check

Outbound self-hosted mail is guilty until proven innocent. A brand-new IP with no reputation,
no PTR, and no authentication records will land in spam — or be rejected outright. You fix
that with **five DNS records + one provider-side PTR + slow warmup**. Inbound is easier but
needs **port 25 reachable** (many VPS providers block it). Budget a day for DNS propagation and
reputation, not five minutes.

---

## 1. Pre-flight checklist (do this before sending a single real email)

| ✓ | Item | Where | Automatable? |
|---|------|-------|--------------|
| ☐ | Outbound **port 25 not blocked** by your VPS provider | provider support/docs | no — ask them |
| ☐ | **PTR / reverse DNS** → `mail.<domain>` for the server's public IP | VPS provider control panel | **no** (provider-side) |
| ☐ | **A/AAAA** `mail.<domain>` → server IP | DNS | yes |
| ☐ | **MX** `<domain>` → `mail.<domain>` | DNS | yes |
| ☐ | **SPF** TXT `v=spf1 a:mail.<domain> -all` | DNS | Stalwart generates |
| ☐ | **DKIM** TXT `<selector>._domainkey.<domain>` | DNS | Stalwart generates the key + record |
| ☐ | **DMARC** TXT `_dmarc.<domain>` `v=DMARC1; p=quarantine; rua=...` | DNS | Stalwart generates |
| ☐ | **MTA-STS** + TLS-RPT (optional but recommended) | DNS + `/.well-known/` | Stalwart serves the policy |
| ☐ | Forward + reverse DNS **match** (FCrDNS) | both | partial |
| ☐ | TLS cert valid on `mail.<domain>` (Traefik/Let's Encrypt) | Eve/Traefik | yes |

`eve doctor` checks SPF, DKIM, DMARC, MX, SMTP-port reachability, and reminds you about PTR.
It **cannot** verify PTR or port-25 egress for you — those are provider-side.

---

## 2. The failure modes, ranked by how often they bite

### 2.1 Provider blocks outbound port 25 (most common blocker)
Hetzner (on request), OVH, AWS, GCP, Azure, DigitalOcean, Vultr, Oracle — most block or
rate-limit **outbound** :25 by default to fight spam. Symptom: inbound mail works, outbound
hangs/times out connecting to recipients' MX.
- **Check:** from the host, `nc -zv gmail-smtp-in.l.google.com 25`. Timeout = blocked.
- **Fix:** request an unblock (Hetzner/OVH will, after account age/verification), pick a
  provider that allows :25, or relay outbound through a smarthost (see §5).

### 2.2 Missing/incorrect PTR (reverse DNS)
The #1 reason Gmail/Outlook reject or spam-folder you. Most big receivers **reject** mail from
IPs with no PTR or a generic one (`1-2-3-4.static.isp.net`).
- **Fix:** set PTR for the public IP → `mail.<domain>` in the VPS panel. Must resolve forward
  too (A record `mail.<domain>` → same IP) = **FCrDNS**.
- Cannot be automated — it lives at the IP owner (your provider).

### 2.3 Authentication records wrong or absent (SPF/DKIM/DMARC)
- **SPF too broad or `+all`** → treated as spam. Use `-all` (hard fail) once you're sure all
  senders are listed.
- **DKIM selector mismatch** → signature fails. Publish the **exact** record Stalwart shows
  (admin console → Domains → DKIM). `eve doctor` checks the `stalwart._domainkey` selector by
  default; if you changed the selector, the doctor warn is a false negative — verify manually.
- **DMARC `p=reject` too early** → your own legit mail bounces while you're still fixing SPF/
  DKIM. Start `p=none` (monitor via `rua=`), move to `quarantine`, then `reject`.

### 2.4 IP reputation / blocklists
A fresh IP has no reputation; a recycled IP may carry a **prior tenant's** bad history.
- **Check the IP before committing:** Spamhaus, Barracuda, SORBS, and Google Postmaster Tools.
- **If listed:** request delisting (most have self-service forms) — but if it's deeply
  burned, ask your provider for a different IP.
- **Warmup:** don't blast. Send low volume to engaged recipients first; ramp over 2–4 weeks.
  Sudden volume from a cold IP = spam signal.

### 2.5 TLS / MTA-STS posture
- Inbound: Stalwart should offer STARTTLS on :25 and implicit TLS on 465/993/995. Behind Eve,
  Traefik terminates TLS for the **HTTP/JMAP** surface only; the **SMTP/IMAP TLS is Stalwart's
  own** (it has built-in ACME, or uses the mounted cert). Confirm Stalwart has a valid cert for
  `mail.<domain>` for the mail protocols — this is separate from Traefik's web cert.
- Publish **MTA-STS** so senders enforce TLS to you; publish **TLS-RPT** to get failure
  reports. Stalwart serves the `/.well-known/mta-sts.txt` policy automatically.

### 2.6 Greylisting / rate limits on the receiving side
First delivery attempts may be deferred (greylisting). This is normal — Stalwart retries.
Don't interpret a `4xx` deferral as a hard failure.

---

## 3. Eve/Stalwart-specific operational notes

### 3.1 Port exposure (by design in this setup)
Eve publishes mail ports **directly on the host** (Traefik is HTTP-only):
- **Public (0.0.0.0):** 25 (MX), 465/587 (submission), 993 (IMAPS), 995 (POP3S).
- **Loopback only (127.0.0.1):** 143 (cleartext IMAP), 110 (cleartext POP3), 4190 (ManageSieve).
- **Action:** put a host firewall (ufw/nftables) in front. Allow the 5 public mail ports +
  443; deny the rest from the internet. Never expose 143/110 cleartext publicly.

### 3.2 The recovery admin credential
Install preseeds `STALWART_RECOVERY_ADMIN=admin:<pw>` via a 0600 env-file (kept out of `ps`/
shell history) and stores the password at `secrets.stalwart.adminPassword`. It is still
visible in `docker inspect`. **Hardening:** after first login, create a real admin principal,
then rotate/clear the recovery var (recreate the container without it). The recovery admin is a
break-glass credential, not a daily one. *(Tracked as a Phase-2 hardening task.)*

### 3.3 The Synap connector token (least privilege)
Synap's email channel authenticates to Stalwart over JMAP with a **dedicated, scoped token**
(`secrets.stalwart.bearerToken`) — mailbox read + submit only. **Never** hand the admin
password to the connector. Outbound sends from the AI agent are **proposal-gated**: the agent
drafts, you approve at `/proposals/{id}`, and only then does `EmailSubmission/set` fire.

### 3.4 Upgrades (Stalwart is pre-1.0)
The image is pinned to `stalwartlabs/stalwart:v0.16`. Pre-1.0 means **config/data-schema
breaks are possible** between minor versions. Before any bump: read the release notes, **back
up the volumes** (§4), and test on a throwaway instance if you can.

### 3.5 Bulwark webmail
Bulwark stores credential-encryption state keyed by `SESSION_SECRET` (persisted in eve
secrets) and admin config in the `bulwark-data` volume. If you ever rotate the session secret,
saved logins reset — expected.

---

## 4. Backups (do not skip — this is your mail)

Two Docker volumes hold everything:
- `stalwart-etc` → `/etc/stalwart` (config, **DKIM private keys** — losing these breaks
  signing until you republish).
- `stalwart-data` → `/var/lib/stalwart` (mailboxes, message store).

- **Back up both** on a schedule (the `backup` Ansible role / `eve backup` lists volumes).
- Snapshot **before every upgrade**.
- Test a **restore** at least once — an untested backup is a hope, not a backup.
- Losing `POSTGRES_PASSWORD`-style index secrets is catastrophic for Synap; the equivalent for
  mail is the DKIM keys + the message store. Treat them as tier-1.

---

## 5. When pure self-hosting isn't viable: hybrid relay

If your provider hard-blocks :25 or your IP reputation is unsalvageable, keep Stalwart as the
**store + JMAP + inbound** server and relay **outbound** through an authenticated smarthost
(SES, Postmark, Mailgun, your ISP's relay). You still own the mailbox and the data; you borrow
someone else's reputable IP for the last hop. Configure the smarthost in Stalwart's outbound
queue/route. This is the pragmatic 80/20 for most homelab/VPS setups.

---

## 6. Quick triage table

| Symptom | Likely cause | First check |
|---|---|---|
| Outbound to Gmail times out | provider blocks :25 | `nc -zv gmail-smtp-in.l.google.com 25` |
| Mail lands in spam | PTR missing / SPF-DKIM-DMARC | Gmail "show original" → SPF/DKIM/DMARC = pass? |
| Recipients reject outright | no PTR / IP on blocklist | check PTR + Spamhaus |
| Inbound never arrives | MX wrong / :25 inbound firewalled | `dig MX <domain>` + firewall |
| DKIM fails | selector/record mismatch | compare published TXT vs admin console |
| TLS warnings to senders | mail-protocol cert invalid | check Stalwart cert for `mail.<domain>` (not just Traefik) |
| Agent "sent" but nothing went out | proposal not approved | check `/proposals/{id}` |
| `eve doctor` mail warns | see the `fix:` line on each check | run `eve doctor` |

---

## 7. Reference

- Stalwart DNS setup: https://stalw.art/docs/install/dns/
- Stalwart DKIM: https://stalw.art/docs/mta/authentication/dkim/sign
- Stalwart MTA-STS: https://stalw.art/docs/mta/transport-security/mta-sts
- Google sender guidelines: https://support.google.com/mail/answer/81126
- Spamhaus IP check: https://check.spamhaus.org
- Google Postmaster Tools: https://postmaster.google.com
- This setup's design: `stalwart-mail-integration-strategy.md`, `stalwart-mail-implementation-plan.md`
