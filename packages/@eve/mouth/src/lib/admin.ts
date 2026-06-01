/**
 * Stalwart management REST API client (the "mouth" organ's provisioning arm).
 *
 * Talks to Stalwart's `/api/principal` surface with HTTP Basic auth using the
 * bootstrap admin credentials. Used by the Eve dashboard's mail config panel
 * to create domains + mailboxes and read back account state.
 *
 * Base URL defaults to the in-Docker-network address so the dashboard
 * container (also on `eve-network`) reaches Stalwart directly, bypassing
 * Traefik/TLS for these server-to-server calls.
 *
 * @see https://stalw.art/docs/api/management/endpoints/  (POST/GET /api/principal)
 */

export const STALWART_INTERNAL_URL = 'http://eve-mouth-stalwart:8080';

export interface StalwartAdminConfig {
  /** Base URL of the Stalwart HTTP surface. Defaults to the eve-network address. */
  baseUrl?: string;
  /** Admin username (defaults to "admin", the preseeded recovery admin). */
  adminUser?: string;
  /** Admin password (stalwart.adminPassword from Eve secrets). */
  adminPassword: string;
}

export interface CreateAccountInput {
  /** Login + primary email, e.g. alice@example.com. */
  email: string;
  /** Initial password for the mailbox. */
  password: string;
  /** Optional human-readable description. */
  description?: string;
}

export interface StalwartPrincipal {
  name: string;
  type: string;
  emails?: string[];
  description?: string;
}

export class StalwartAdmin {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: StalwartAdminConfig) {
    this.baseUrl = (config.baseUrl ?? STALWART_INTERNAL_URL).replace(/\/$/, '');
    const user = config.adminUser ?? 'admin';
    this.authHeader =
      'Basic ' + Buffer.from(`${user}:${config.adminPassword}`).toString('base64');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Stalwart API ${method} ${path} → ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json().catch(() => undefined)) as T;
  }

  /** True if Stalwart's liveness endpoint responds 2xx. */
  async isLive(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/healthz/live`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Create a local domain (idempotent on the caller's side — 409 surfaces as an error). */
  async createDomain(name: string): Promise<void> {
    await this.request('POST', '/api/principal', { type: 'domain', name });
  }

  /** Create an individual mailbox account. */
  async createAccount(input: CreateAccountInput): Promise<void> {
    await this.request('POST', '/api/principal', {
      type: 'individual',
      name: input.email,
      secrets: [input.password],
      emails: [input.email],
      ...(input.description ? { description: input.description } : {}),
    });
  }

  /** List principals, optionally filtered by type ("individual" | "domain" | …). */
  async listPrincipals(type?: string): Promise<StalwartPrincipal[]> {
    const qs = type ? `?type=${encodeURIComponent(type)}` : '';
    const data = await this.request<{ items?: StalwartPrincipal[] } | StalwartPrincipal[]>(
      'GET',
      `/api/principal${qs}`,
    );
    if (Array.isArray(data)) return data;
    return data?.items ?? [];
  }
}
