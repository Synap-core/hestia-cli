/**
 * Shared route-probing utilities used by `eve domain set`, `eve domain check`,
 * and `eve doctor`. Tests Traefik routing end-to-end with the right Host
 * header, plus DNS resolution per subdomain.
 */

import { execSync } from 'node:child_process';
import type { ServiceAccess } from '@eve/dna';
import { getServerIp } from '@eve/dna';

export interface RouteProbe {
  /** Service id (eve-dashboard, pod, openclaw, …). */
  id: string;
  /** Host header used (e.g. eve.hyperray.shop). */
  host: string;
  /** HTTP status code returned by Traefik via curl. 'timeout' if no response. */
  httpStatus: string;
  /** Resolved DNS A record (or null if unresolved). */
  dnsResolved: string | null;
  /** True when DNS resolves to this server's public IP. */
  dnsCorrect: boolean;
  /** High-level outcome: ok | upstream-down | not-routing | dns-missing | dns-wrong. */
  outcome: 'ok' | 'upstream-down' | 'not-routing' | 'dns-missing' | 'dns-wrong' | 'timeout';
}

/** Probe every route in `urls` end-to-end. Synchronous + fast (4s curl timeout). */
export function probeRoutes(urls: ServiceAccess[]): RouteProbe[] {
  const serverIp = getServerIp();
  const out: RouteProbe[] = [];

  for (const svc of urls) {
    if (!svc.domainUrl) continue;
    const host = svc.domainUrl.replace(/^https?:\/\//, '').split('/')[0];

    // 1. HTTP probe via Traefik on localhost:80
    let httpStatus = '???';
    try {
      httpStatus = execSync(
        `curl -s -o /dev/null -w "%{http_code}" --max-time 4 -H "Host: ${host}" http://localhost:80/`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
      ).trim();
    } catch { httpStatus = 'timeout'; }

    // 2. DNS resolution
    let dnsResolved: string | null = null;
    try {
      const out = execSync(`getent hosts ${host} 2>/dev/null | awk '{print $1}' | head -1`, {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      if (out) dnsResolved = out;
    } catch { /* ignore */ }
    if (!dnsResolved) {
      try {
        const out = execSync(`dig +short ${host} | head -1`, {
          encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        if (out) dnsResolved = out;
      } catch { /* ignore */ }
    }

    const dnsCorrect = !!serverIp && dnsResolved === serverIp;

    // 3. Classify outcome
    let outcome: RouteProbe['outcome'];
    if (!dnsResolved) {
      outcome = 'dns-missing';
    } else if (!dnsCorrect) {
      outcome = 'dns-wrong';
    } else if (httpStatus === 'timeout') {
      outcome = 'timeout';
    } else if (httpStatus === '404') {
      outcome = 'not-routing';
    } else if (httpStatus === '502' || httpStatus === '503' || httpStatus === '504') {
      outcome = 'upstream-down';
    } else {
      outcome = 'ok';
    }

    out.push({ id: svc.id, host, httpStatus, dnsResolved, dnsCorrect, outcome });
  }

  return out;
}

/** Human-readable summary line for one probe. */
export function probeSummary(p: RouteProbe): string {
  switch (p.outcome) {
    case 'ok':            return `${p.httpStatus} — reachable`;
    case 'upstream-down': return `${p.httpStatus} — route OK, upstream not responding`;
    case 'not-routing':   return `${p.httpStatus} — Traefik has no rule matching this host`;
    case 'dns-missing':   return `DNS not configured (no A record for ${p.host})`;
    case 'dns-wrong':     return `DNS points to ${p.dnsResolved} (expected this server)`;
    case 'timeout':       return `request timed out`;
  }
}

/** Aggregate verdict: ok | partial | broken. */
export function probeVerdict(probes: RouteProbe[]): 'ok' | 'partial' | 'broken' {
  if (probes.length === 0) return 'ok';
  const okCount = probes.filter(p => p.outcome === 'ok').length;
  if (okCount === probes.length) return 'ok';
  if (okCount === 0) return 'broken';
  return 'partial';
}
