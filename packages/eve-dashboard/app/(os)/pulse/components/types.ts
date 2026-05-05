/**
 * Shared types for the Pulse page surfaces.
 *
 * Mirrors the response shapes from:
 *   - GET /api/components             (ComponentRow)
 *   - GET /api/secrets-summary        (SecretsSummary)
 *   - GET /api/networking             (NetworkingInfo)
 *   - GET /api/components/synap/info  (PodInfo)
 *   - GET /api/doctor                 (DoctorReport)
 *
 * Kept in one place so the section components can rely on identical
 * shapes without each importing from a different route file.
 */

// ─── /api/components ─────────────────────────────────────────────────────────

export interface ComponentRow {
  id: string;
  label: string;
  emoji: string;
  description: string;
  category: string;
  organ: string | null;
  installed: boolean;
  containerRunning: boolean | null;
  containerName: string | null;
  internalPort: number | null;
  hostPort: number | null;
  subdomain: string | null;
  domainUrl: string | null;
  state: string | null;
  version: string | null;
  requiredBy: string[];
  requires: string[];
  alwaysInstall: boolean;
}

// ─── /api/secrets-summary ────────────────────────────────────────────────────

export interface SecretsSummary {
  ai: {
    mode?: string;
    defaultProvider?: string;
    providers: Array<{ id: string; configured: boolean; hasKey: boolean }>;
  };
  synap: {
    configured: boolean;
    hasApiKey: boolean;
    apiUrl?: string;
  };
  arms: {
    openclaw: { configured: boolean };
    messaging: { configured: boolean };
  };
}

// ─── /api/networking ─────────────────────────────────────────────────────────

export interface NetworkingInfo {
  domain: { primary?: string; ssl?: boolean } | null;
  traefik: {
    dynamicConfigPath: string;
    dynamicConfig: string | null;
    staticConfigPath: string;
    staticConfig: string | null;
    containerRunning: boolean;
  };
}

// ─── /api/components/synap/info ──────────────────────────────────────────────

export interface PodInfo {
  podUrl?: string;
  hubBaseUrl: string | null;
  apiKeyPresent: boolean;
  domain: string | null;
  ssl: boolean;
  adminEmail: string | null;
  adminBootstrapMode: string | null;
  state: string | null;
  version: string | null;
  volumes: Array<{ name: string; driver: string; size: string | null }>;
}

// ─── /api/doctor ─────────────────────────────────────────────────────────────

export type CheckStatus = "pass" | "fail" | "warn";

export type RepairKind =
  | "create-eve-network"
  | "start-container"
  | "rewire-openclaw";

export interface CheckResult {
  group: string;
  name: string;
  status: CheckStatus;
  message: string;
  fix?: string;
  componentId?: string;
  repair?: { kind: RepairKind; label: string };
  integrationId?: string;
}

export interface DoctorReport {
  checks: CheckResult[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
    total: number;
  };
}
