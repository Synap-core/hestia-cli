/**
 * gatherInstallConfig — single funnel for "what should I install and how
 * should it be exposed?"
 *
 * Every install entry point (`eve install`, `eve init`, `eve setup`, future
 * dashboard install API) calls this. Per-field resolution order is uniform:
 *
 *   1. Explicit CLI flag                        (source: 'flag')
 *   2. Environment variable                     (source: 'env')
 *   3. ~/.eve/secrets.json                      (source: 'secrets')
 *   4. discoverAndBackfillPodConfig()           (source: 'discovered')
 *   5. .eve/setup-profile.json                  (source: 'saved-profile')
 *   6. Interactive prompt (when interactive=true) (source: 'prompt')
 *   7. Typed default                            (source: 'default')
 *
 * In non-interactive mode (`-y`, `--json`, scripts) a missing required
 * field throws `InstallConfigError` with a structured `missing[]` list —
 * one error instead of three different `process.exit(1)` paths.
 *
 * Pure resolver: all IO is injected via `ResolverIO`, all prompts via
 * `PromptFns`. The default IO/prompts wire the production primitives
 * (`readEveSecrets`, `discoverAndBackfillPodConfig`, clack); tests
 * substitute fakes.
 */

import {
  readEveSecrets,
  discoverAndBackfillPodConfig,
  type EveSecrets,
} from "@eve/dna";
import {
  readSetupProfile,
  type SetupProfile,
} from "@eve/dna";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FieldSource =
  | "flag"
  | "env"
  | "secrets"
  | "discovered"
  | "saved-profile"
  | "prompt"
  | "default";

export type AiMode = "local" | "provider" | "hybrid";
export type AiProvider = "ollama" | "openrouter" | "anthropic" | "openai";
export type TunnelProvider = "pangolin" | "cloudflare";
export type InstallMode = "auto" | "from_image" | "from_source";
export type AdminBootstrapMode = "token" | "preseed";
export type Exposure = "local" | "public";

export interface ResolvedInstallConfig {
  components: string[];
  exposure: Exposure;
  domain: string;                 // 'localhost' | FQDN
  ssl: boolean;                   // Let's Encrypt-managed TLS
  email: string | undefined;      // required when ssl && !localhost
  adminBootstrapMode: AdminBootstrapMode;
  adminEmail: string | undefined;
  adminPassword: string | undefined;
  installMode: InstallMode;
  withOpenclaw: boolean;
  withRsshub: boolean;
  ai: {
    mode: AiMode;
    defaultProvider: AiProvider | undefined;
    fallbackProvider: AiProvider | undefined;
  };
  tunnel: {
    provider: TunnelProvider;
    domain: string | undefined;
    hostStrategy: "same_as_synap" | "custom" | undefined;
  } | undefined;
  /** Per-field provenance — useful for "Domain: pod.x.com (from secrets)" displays. */
  source: Partial<Record<keyof Omit<ResolvedInstallConfig, "source">, FieldSource>>;
}

export interface RawInstallFlags {
  components?: string[];
  domain?: string;
  email?: string;
  /** Explicit `--no-ssl` for "behind external HTTPS proxy" mode. */
  ssl?: boolean;
  adminEmail?: string;
  adminPassword?: string;
  adminBootstrapMode?: AdminBootstrapMode;
  installMode?: InstallMode;
  fromImage?: boolean;
  fromSource?: boolean;
  withOpenclaw?: boolean;
  withRsshub?: boolean;
  aiMode?: AiMode;
  aiProvider?: AiProvider;
  fallbackProvider?: AiProvider;
  tunnel?: TunnelProvider;
  tunnelDomain?: string;
  tunnelHostStrategy?: "same_as_synap" | "custom";
}

export interface ResolverIO {
  readSecrets: (cwd: string) => Promise<EveSecrets | null>;
  readSavedProfile: (cwd: string) => Promise<SetupProfile | null>;
  discover: (cwd: string) => Promise<{ domain?: string }>;
  /** Used to render `--no-tty` errors uniformly. */
  env: NodeJS.ProcessEnv;
}

/**
 * Prompt surface — one method per question. Each returns `undefined` when
 * the user cancels (e.g. Ctrl-C in clack), so the caller can decide whether
 * a cancel = abort or = "skip optional field". The resolver treats cancel
 * on a *required* field as `InstallConfigError(canceled)`.
 */
export interface PromptFns {
  componentSet: () => Promise<Record<string, boolean> | undefined>;
  exposure: (initial: Exposure) => Promise<Exposure | undefined>;
  domain: (initial: string) => Promise<string | undefined>;
  ssl: (initial: boolean, hasEmail: boolean) => Promise<boolean | undefined>;
  email: (initial: string | undefined) => Promise<string | undefined>;
  adminBootstrapMode: (initial: AdminBootstrapMode) => Promise<AdminBootstrapMode | undefined>;
  adminEmail: (initial: string | undefined) => Promise<string | undefined>;
  adminPassword: (initial: string | undefined) => Promise<string | undefined>;
  installMode: (initial: InstallMode) => Promise<InstallMode | undefined>;
  withOpenclaw: (initial: boolean, bootstrap: AdminBootstrapMode) => Promise<boolean | undefined>;
  withRsshub: (initial: boolean) => Promise<boolean | undefined>;
  tunnel: (initial: TunnelProvider | undefined) => Promise<TunnelProvider | "none" | undefined>;
  tunnelHostStrategy: (
    domainSuggestion: string,
  ) => Promise<"same_as_synap" | "custom" | undefined>;
  tunnelDomain: (initial: string | undefined) => Promise<string | undefined>;
}

export interface GatherInstallConfigOptions {
  cwd: string;
  flags: RawInstallFlags;
  /** false when -y / --json / scripted. */
  interactive: boolean;
  /** Honour .eve/setup-profile.json when present. `eve setup` passes true; `eve install` defaults false. */
  loadSavedProfile: boolean;
  /** Surface-specific seed — e.g. `eve setup` pre-resolves AI from the wizard. */
  seed?: Partial<ResolvedInstallConfig>;
  /** Inject for tests. Defaults wire `@eve/dna` primitives. */
  io?: Partial<ResolverIO>;
  /** Inject for tests. Defaults wire `install-config-prompts.ts`. */
  prompts?: Partial<PromptFns>;
}

export interface MissingField {
  field: string;
  reason: string;
}

export class InstallConfigError extends Error {
  constructor(public missing: MissingField[]) {
    super(
      `Install configuration incomplete:\n` +
        missing.map((m) => `  • ${m.field} — ${m.reason}`).join("\n") +
        `\n\nRe-run with the missing flags or drop --yes/--json to be prompted.`,
    );
    this.name = "InstallConfigError";
  }
}

// ---------------------------------------------------------------------------
// Defaults / IO wiring
// ---------------------------------------------------------------------------

const DEFAULT_IO: ResolverIO = {
  readSecrets: (cwd) => readEveSecrets(cwd).catch(() => null),
  readSavedProfile: (cwd) => readSetupProfile(cwd).catch(() => null),
  discover: async (cwd) => {
    const r = await discoverAndBackfillPodConfig(cwd, { backfill: false }).catch(
      () => ({ domain: undefined } as { domain?: string }),
    );
    return { domain: r.domain };
  },
  env: process.env,
};

// `traefik` is `alwaysInstall: true` in the registry. The resolver mirrors
// that here so callers don't need to know — same convention as the legacy
// install.ts.
const ALWAYS_ON_COMPONENTS = ["traefik"];

// ---------------------------------------------------------------------------
// Validators (shared with prompts so CLI-flag and prompt input have one rule)
// ---------------------------------------------------------------------------

const FQDN_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidDomain(s: string | undefined): boolean {
  if (!s || !s.trim()) return false;
  const v = s.trim();
  if (v === "localhost") return true;
  return v.includes(".") && FQDN_RE.test(v);
}

export function isValidEmail(s: string | undefined): boolean {
  return !!s && EMAIL_RE.test(s.trim());
}

/**
 * Strip the leading `pod.` routing prefix from a user-provided domain so
 * `secrets.domain.primary` always holds the BARE domain. Consumers add
 * their own subdomain (e.g. `eve.${primary}`, `pod.${primary}` via
 * `toPodFqdn`) — storing the prefixed form would yield `pod.pod.x.y`
 * after a second consumer prepends.
 *
 * Idempotent. Leaves `localhost`, IPv4 literals, and unprefixed domains
 * untouched.
 */
export function normalizeBareDomain(input: string | undefined): string | undefined {
  if (!input) return input;
  const trimmed = input.trim();
  if (!trimmed || trimmed === "localhost") return trimmed;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) return trimmed;
  return trimmed.startsWith("pod.") ? trimmed.slice(4) : trimmed;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function gatherInstallConfig(
  opts: GatherInstallConfigOptions,
): Promise<ResolvedInstallConfig> {
  const io: ResolverIO = { ...DEFAULT_IO, ...(opts.io ?? {}) };
  const prompts = opts.prompts ?? {};
  const seed = opts.seed ?? {};
  const flags = opts.flags;
  const interactive = opts.interactive;

  const secrets = await io.readSecrets(opts.cwd);
  const saved = opts.loadSavedProfile ? await io.readSavedProfile(opts.cwd) : null;
  const discovered = await io.discover(opts.cwd);

  const source: ResolvedInstallConfig["source"] = {};
  const missing: MissingField[] = [];

  // ---------- components ----------
  let components: string[];
  if (flags.components && flags.components.length > 0) {
    components = dedupe([...flags.components, ...ALWAYS_ON_COMPONENTS]);
    source.components = "flag";
  } else if (seed.components && seed.components.length > 0) {
    components = dedupe([...seed.components, ...ALWAYS_ON_COMPONENTS]);
    source.components = "saved-profile";
  } else if (interactive && prompts.componentSet) {
    const picked = await prompts.componentSet();
    if (!picked || Object.keys(picked).length === 0) {
      throw new InstallConfigError([{ field: "components", reason: "selection canceled" }]);
    }
    components = dedupe([
      ...Object.keys(picked).filter((k) => picked[k]),
      ...ALWAYS_ON_COMPONENTS,
    ]);
    source.components = "prompt";
  } else {
    // Non-interactive default: pod baseline
    components = ["traefik", "synap"];
    source.components = "default";
  }

  // ---------- domain / exposure ----------
  // Resolution chain: flag → secrets → discovered → saved → prompt → default('localhost').
  // All sources are normalised to the BARE domain (no leading `pod.`) so
  // downstream consumers can re-add their own routing prefix without
  // producing `pod.pod.x.y`.
  let domain: string | undefined;
  let domainSource: FieldSource | undefined;

  const flagDomain = normalizeBareDomain(flags.domain);
  const secretsDomain = normalizeBareDomain(secrets?.domain?.primary);
  const discoveredDomain = normalizeBareDomain(discovered.domain);
  const savedSynapHost = normalizeBareDomain(saved?.network?.synapHost);
  const savedHint = normalizeBareDomain(saved?.domainHint);

  if (flagDomain && flagDomain !== "localhost") {
    domain = flagDomain;
    domainSource = "flag";
  } else if (flagDomain === "localhost") {
    domain = "localhost";
    domainSource = "flag";
  } else if (secretsDomain) {
    domain = secretsDomain;
    domainSource = "secrets";
  } else if (discoveredDomain && discoveredDomain !== "localhost") {
    domain = discoveredDomain;
    domainSource = "discovered";
  } else if (savedSynapHost && savedSynapHost !== "localhost") {
    domain = savedSynapHost;
    domainSource = "saved-profile";
  } else if (savedHint && savedHint !== "localhost") {
    domain = savedHint;
    domainSource = "saved-profile";
  }

  // Exposure prompt (interactive only) — runs before domain text so the user
  // can pick "local only" without typing a hostname.
  let exposure: Exposure;
  if (interactive && prompts.exposure && !flags.domain) {
    const initial: Exposure = domain && domain !== "localhost" ? "public" : "local";
    const picked = await prompts.exposure(initial);
    if (!picked) throw new InstallConfigError([{ field: "exposure", reason: "canceled" }]);
    exposure = picked;
    if (exposure === "local") {
      domain = "localhost";
      domainSource = "prompt";
    } else {
      // Public exposure: ALWAYS show the domain prompt, even when a value
      // was discovered/saved/in-secrets. Pre-fill with the resolved value
      // so the user can press Enter to accept or edit. Silently using a
      // discovered domain felt like the resolver was skipping a question.
      if (prompts.domain) {
        const initialDomain = domain && domain !== "localhost" ? domain : "";
        const d = await prompts.domain(initialDomain);
        if (!d || !isValidDomain(d) || d === "localhost") {
          throw new InstallConfigError([{ field: "domain", reason: "public exposure requires FQDN" }]);
        }
        // Normalise so a user-typed "pod.x.y" lands as the bare "x.y" in
        // secrets — same convention as flag/secrets/discovered sources.
        const normalised = normalizeBareDomain(d) ?? d.trim();
        // Mark source as 'prompt' only when the user actually changed the
        // value; otherwise keep the originating source (secrets/discovered/saved)
        // so the recap shows where it came from.
        if (normalised !== domain) {
          domain = normalised;
          domainSource = "prompt";
        }
      } else {
        throw new InstallConfigError([{ field: "domain", reason: "public exposure but no domain prompt available" }]);
      }
    }
  } else if (!domain) {
    domain = "localhost";
    domainSource = "default";
    exposure = "local";
  } else {
    exposure = domain === "localhost" ? "local" : "public";
  }

  // After this point `domain` is guaranteed non-undefined.
  const resolvedDomain: string = domain;
  source.domain = domainSource ?? "default";
  source.exposure = source.domain;

  // ---------- ssl ----------
  // Default: ssl=true when public, false when local. Explicit --ssl flag
  // overrides. The "behind external proxy" prompt sets ssl=false explicitly.
  let ssl: boolean;
  let sslSource: FieldSource;
  if (typeof flags.ssl === "boolean") {
    ssl = flags.ssl;
    sslSource = "flag";
  } else if (typeof secrets?.domain?.ssl === "boolean" && exposure === "public") {
    ssl = secrets.domain.ssl;
    sslSource = "secrets";
  } else if (interactive && exposure === "public" && prompts.ssl) {
    const hasEmail = isValidEmail(
      flags.email ||
        io.env.LETSENCRYPT_EMAIL ||
        io.env.SYNAP_LETSENCRYPT_EMAIL ||
        secrets?.domain?.email,
    );
    const picked = await prompts.ssl(true, hasEmail);
    if (typeof picked !== "boolean") {
      throw new InstallConfigError([{ field: "ssl", reason: "canceled" }]);
    }
    ssl = picked;
    sslSource = "prompt";
  } else {
    ssl = exposure === "public";
    sslSource = "default";
  }
  source.ssl = sslSource;

  // ---------- email ----------
  // Required when ssl && exposure==='public'. Resolved from flag → env →
  // secrets → prompt. We deliberately do NOT discover from the pod's .env
  // file because that may hold a stale or wrong value.
  let email: string | undefined;
  let emailSource: FieldSource | undefined;
  const emailFromFlag = flags.email?.trim();
  const emailFromEnv =
    io.env.LETSENCRYPT_EMAIL?.trim() || io.env.SYNAP_LETSENCRYPT_EMAIL?.trim();
  const emailFromSecrets = secrets?.domain?.email?.trim();
  const emailFromSaved = saved?.synapInstall?.tlsEmail?.trim();

  if (emailFromFlag) { email = emailFromFlag; emailSource = "flag"; }
  else if (emailFromEnv) { email = emailFromEnv; emailSource = "env"; }
  else if (emailFromSecrets) { email = emailFromSecrets; emailSource = "secrets"; }
  else if (emailFromSaved) { email = emailFromSaved; emailSource = "saved-profile"; }

  if (ssl && exposure === "public" && !email) {
    if (interactive && prompts.email) {
      const picked = await prompts.email(undefined);
      if (!picked || !isValidEmail(picked)) {
        missing.push({ field: "email", reason: "Let's Encrypt requires a valid email" });
      } else {
        email = picked.trim();
        emailSource = "prompt";
      }
    } else {
      missing.push({
        field: "email",
        reason: "Let's Encrypt requires --email (or LETSENCRYPT_EMAIL, or `eve domain set --email`)",
      });
    }
  }
  if (email) source.email = emailSource;

  // ---------- admin bootstrap ----------
  let adminBootstrapMode: AdminBootstrapMode = "token";
  let abmSource: FieldSource = "default";
  if (flags.adminBootstrapMode) { adminBootstrapMode = flags.adminBootstrapMode; abmSource = "flag"; }
  else if (saved?.synapInstall?.adminBootstrapMode) {
    adminBootstrapMode = saved.synapInstall.adminBootstrapMode;
    abmSource = "saved-profile";
  } else if (interactive && prompts.adminBootstrapMode) {
    const picked = await prompts.adminBootstrapMode("token");
    if (!picked) throw new InstallConfigError([{ field: "adminBootstrapMode", reason: "canceled" }]);
    adminBootstrapMode = picked;
    abmSource = "prompt";
  }
  source.adminBootstrapMode = abmSource;

  let adminEmail: string | undefined =
    flags.adminEmail?.trim() ||
    io.env.ADMIN_EMAIL?.trim() ||
    saved?.synapInstall?.adminEmail?.trim() ||
    email;
  let adminEmailSource: FieldSource | undefined =
    flags.adminEmail?.trim() ? "flag"
    : io.env.ADMIN_EMAIL?.trim() ? "env"
    : saved?.synapInstall?.adminEmail?.trim() ? "saved-profile"
    : email ? emailSource
    : undefined;

  let adminPassword: string | undefined =
    flags.adminPassword?.trim() || io.env.ADMIN_PASSWORD?.trim();
  let adminPasswordSource: FieldSource | undefined =
    flags.adminPassword?.trim() ? "flag" : io.env.ADMIN_PASSWORD?.trim() ? "env" : undefined;

  if (adminBootstrapMode === "preseed") {
    if (!adminEmail) {
      if (interactive && prompts.adminEmail) {
        const picked = await prompts.adminEmail(undefined);
        if (!picked || !isValidEmail(picked)) {
          missing.push({ field: "adminEmail", reason: "preseed admin requires a valid email" });
        } else {
          adminEmail = picked.trim();
          adminEmailSource = "prompt";
        }
      } else {
        missing.push({ field: "adminEmail", reason: "preseed admin bootstrap requires --admin-email" });
      }
    }
    if (!adminPassword) {
      if (interactive && prompts.adminPassword) {
        const picked = await prompts.adminPassword(undefined);
        if (!picked) {
          missing.push({ field: "adminPassword", reason: "preseed admin requires a password" });
        } else {
          adminPassword = picked.trim();
          adminPasswordSource = "prompt";
        }
      } else {
        missing.push({
          field: "adminPassword",
          reason: "preseed admin bootstrap requires --admin-password",
        });
      }
    }
  }
  if (adminEmail) source.adminEmail = adminEmailSource;
  if (adminPassword) source.adminPassword = adminPasswordSource;

  // ---------- install mode ----------
  let installMode: InstallMode = "auto";
  let imSource: FieldSource = "default";
  if (flags.fromImage && flags.fromSource) {
    missing.push({ field: "installMode", reason: "--from-image and --from-source are mutually exclusive" });
  } else if (flags.fromImage) { installMode = "from_image"; imSource = "flag"; }
  else if (flags.fromSource) { installMode = "from_source"; imSource = "flag"; }
  else if (flags.installMode) { installMode = flags.installMode; imSource = "flag"; }
  else if (saved?.synapInstall?.mode) { installMode = saved.synapInstall.mode; imSource = "saved-profile"; }
  else if (interactive && prompts.installMode && components.includes("synap")) {
    const picked = await prompts.installMode("auto");
    if (picked) { installMode = picked; imSource = "prompt"; }
  }
  source.installMode = imSource;

  // ---------- openclaw / rsshub ----------
  // OpenClaw at install time is only meaningful with preseed bootstrap (workspace
  // exists). Token bootstrap delays the add-on; UI installs it post-bootstrap.
  let withOpenclaw = Boolean(
    flags.withOpenclaw ?? seed.withOpenclaw ?? components.includes("openclaw"),
  );
  let woSource: FieldSource =
    typeof flags.withOpenclaw === "boolean" ? "flag"
    : typeof seed.withOpenclaw === "boolean" ? "saved-profile"
    : "default";
  if (interactive && prompts.withOpenclaw && components.includes("synap")) {
    const picked = await prompts.withOpenclaw(withOpenclaw, adminBootstrapMode);
    if (typeof picked === "boolean") { withOpenclaw = picked; woSource = "prompt"; }
  }
  source.withOpenclaw = woSource;

  let withRsshub = Boolean(
    flags.withRsshub ?? seed.withRsshub ?? components.includes("rsshub"),
  );
  let wrSource: FieldSource =
    typeof flags.withRsshub === "boolean" ? "flag"
    : typeof seed.withRsshub === "boolean" ? "saved-profile"
    : "default";
  if (interactive && prompts.withRsshub && components.includes("synap")) {
    const picked = await prompts.withRsshub(withRsshub);
    if (typeof picked === "boolean") { withRsshub = picked; wrSource = "prompt"; }
  }
  source.withRsshub = wrSource;

  // ---------- AI ----------
  // AI is typically pre-resolved by `eve setup` (its own wizard layer) and
  // passed in via `seed`. `eve install` takes flags or defaults; the post-install
  // provider prompt remains in the install command itself.
  const ai = {
    mode: (flags.aiMode ?? seed.ai?.mode ?? "hybrid") as AiMode,
    defaultProvider: (flags.aiProvider ?? seed.ai?.defaultProvider) as AiProvider | undefined,
    fallbackProvider: (flags.fallbackProvider ?? seed.ai?.fallbackProvider) as AiProvider | undefined,
  };
  source.ai = flags.aiMode || flags.aiProvider || flags.fallbackProvider
    ? "flag"
    : seed.ai ? "saved-profile" : "default";

  // ---------- tunnel ----------
  let tunnel: ResolvedInstallConfig["tunnel"];
  let tunnelSource: FieldSource = "default";
  let provider: TunnelProvider | undefined = flags.tunnel ?? seed.tunnel?.provider;
  let tDomain: string | undefined = flags.tunnelDomain ?? seed.tunnel?.domain;
  let hostStrategy: "same_as_synap" | "custom" | undefined =
    flags.tunnelHostStrategy ?? seed.tunnel?.hostStrategy;

  if (!provider && interactive && prompts.tunnel) {
    const picked = await prompts.tunnel(undefined);
    if (picked && picked !== "none") {
      provider = picked;
      tunnelSource = "prompt";
    }
  } else if (provider) {
    tunnelSource = flags.tunnel ? "flag" : "saved-profile";
  }

  if (provider) {
    if (!tDomain) {
      if (interactive && prompts.tunnelHostStrategy && resolvedDomain !== "localhost") {
        const strat = await prompts.tunnelHostStrategy(resolvedDomain);
        hostStrategy = strat;
        if (strat === "same_as_synap") tDomain = resolvedDomain;
      } else if (resolvedDomain !== "localhost") {
        hostStrategy = hostStrategy ?? "same_as_synap";
        tDomain = tDomain ?? resolvedDomain;
      }
      if (!tDomain && interactive && prompts.tunnelDomain) {
        const d = await prompts.tunnelDomain(undefined);
        if (d && isValidDomain(d) && d !== "localhost") {
          tDomain = d.trim();
          hostStrategy = "custom";
        }
      }
    }
    tunnel = { provider, domain: tDomain, hostStrategy };
  }
  if (tunnel) source.tunnel = tunnelSource;

  if (missing.length > 0) {
    throw new InstallConfigError(missing);
  }

  return {
    components,
    exposure,
    domain: resolvedDomain,
    ssl,
    email,
    adminBootstrapMode,
    adminEmail,
    adminPassword,
    installMode,
    withOpenclaw,
    withRsshub,
    ai,
    tunnel,
    source,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs));
}
