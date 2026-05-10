/**
 * Default `PromptFns` implementation for `gatherInstallConfig`.
 *
 * Wraps `@clack/prompts` so the resolver stays IO-pure and tests can
 * substitute fakes without spawning a TTY. Each function returns
 * `undefined` on cancel — the resolver decides whether that's an abort
 * or a "skip optional".
 */

import {
  confirm,
  isCancel,
  multiselect,
  select,
  text,
} from "@clack/prompts";
import { COMPONENTS } from "@eve/dna";
import {
  isValidDomain,
  isValidEmail,
  type AdminBootstrapMode,
  type Exposure,
  type InstallMode,
  type PromptFns,
  type TunnelProvider,
} from "./install-config.js";

const PRESETS = [
  { value: "personal", label: "🧠  Personal AI pod", hint: "Synap + Traefik", ids: ["traefik", "synap"] },
  { value: "full",     label: "🚀  Full stack",      hint: "Synap + Ollama + OpenClaw + Traefik", ids: ["traefik", "synap", "ollama", "openclaw"] },
  { value: "chat",     label: "💬  AI chat server",  hint: "Synap + Open WebUI + Traefik", ids: ["traefik", "synap", "openwebui"] },
  { value: "builder",  label: "🏗️  Builder server",  hint: "Synap + Hermes + OpenClaw + Traefik", ids: ["traefik", "synap", "openclaw", "hermes"] },
  { value: "minimal",  label: "⚡  Minimal",         hint: "Traefik only — add later", ids: ["traefik"] },
  { value: "custom",   label: "🔧  Custom",          hint: "Pick each component", ids: [] as string[] },
] as const;

function ok<T>(v: T | symbol): T | undefined {
  return isCancel(v) ? undefined : (v as T);
}

export const defaultPrompts: PromptFns = {
  async componentSet() {
    const preset = await select({
      message: "What do you want to install?",
      options: PRESETS as unknown as { value: string; label: string; hint: string }[],
      initialValue: "personal",
    });
    if (isCancel(preset)) return undefined;

    const selectable = COMPONENTS.filter((c) => !c.alwaysInstall);
    const presetIds = preset === "custom"
      ? selectable.filter((c) => c.category !== "add-on").map((c) => c.id)
      : (PRESETS.find((p) => p.value === preset)?.ids.filter((id) => id !== "traefik") ?? []);

    if (preset === "minimal") {
      return { traefik: true };
    }

    const finalIds = await multiselect({
      message: preset === "custom" ? "Select components" : "Adjust selection (space to toggle)",
      options: selectable.map((c) => ({
        value: c.id,
        label: `${c.emoji}  ${c.label}`,
        hint: c.description.split(".")[0],
      })),
      initialValues: presetIds,
      required: false,
    });
    if (isCancel(finalIds)) return undefined;

    const result: Record<string, boolean> = { traefik: true };
    for (const id of finalIds as string[]) result[id] = true;
    // Resolve `requires` deps so the caller doesn't have to.
    for (const id of Object.keys(result)) {
      const comp = COMPONENTS.find((c) => c.id === id);
      for (const req of comp?.requires ?? []) result[req] = true;
    }
    return result;
  },

  async exposure(initial) {
    return ok<Exposure>(
      await select({
        message: "How will this Data Pod be reached?",
        options: [
          { value: "local", label: "Local only (this machine / private network)", hint: "Sets domain to localhost" },
          { value: "public", label: "Public domain (internet-accessible)", hint: "Caddy/Traefik handle external traffic" },
        ],
        initialValue: initial,
      }),
    );
  },

  async domain(initial) {
    return ok<string>(
      await text({
        message: "Public hostname for the pod (e.g. pod.example.com)",
        initialValue: initial,
        placeholder: "pod.example.com",
        validate: (v: string) =>
          isValidDomain(v) && v !== "localhost" ? undefined : "Use a public FQDN (not localhost)",
      }),
    );
  },

  async ssl(initial, hasEmail) {
    const message = hasEmail
      ? "Manage TLS via Let's Encrypt? (recommended — disable if you sit behind an HTTPS-terminating proxy)"
      : "Manage TLS via Let's Encrypt? (you'll be asked for an email; disable if behind an HTTPS proxy)";
    const v = await confirm({ message, initialValue: initial });
    return ok<boolean>(v);
  },

  async email(initial) {
    return ok<string>(
      await text({
        message: "Let's Encrypt contact email (used for cert renewal alerts)",
        initialValue: initial ?? "",
        placeholder: "you@example.com",
        validate: (v: string) => (isValidEmail(v) ? undefined : "Enter a valid email"),
      }),
    );
  },

  async adminBootstrapMode(initial) {
    return ok<AdminBootstrapMode>(
      await select({
        message: "Admin bootstrap mode",
        options: [
          { value: "token",   label: "Token (recommended)",   hint: "One-time token; create first admin in the UI" },
          { value: "preseed", label: "Preseed admin now",     hint: "Create admin during install — needs email + password" },
        ],
        initialValue: initial,
      }),
    );
  },

  async adminEmail(initial) {
    return ok<string>(
      await text({
        message: "Admin email for the first account",
        initialValue: initial ?? "",
        placeholder: "admin@example.com",
        validate: (v: string) => (isValidEmail(v) ? undefined : "Enter a valid email"),
      }),
    );
  },

  async adminPassword(initial) {
    return ok<string>(
      await text({
        message: "Admin password (preseed bootstrap)",
        initialValue: initial ?? "",
        placeholder: "Choose a strong password",
        validate: (v: string) => (v && v.length >= 8 ? undefined : "Use at least 8 characters"),
      }),
    );
  },

  async installMode(initial) {
    return ok<InstallMode>(
      await select({
        message: "Install Synap from",
        options: [
          { value: "auto",        label: "Auto",        hint: "Image when no checkout, source when --synap-repo is set" },
          { value: "from_image",  label: "From image",  hint: "Pull prebuilt GHCR image" },
          { value: "from_source", label: "From source", hint: "Build locally from a synap-backend checkout" },
        ],
        initialValue: initial,
      }),
    );
  },

  async withOpenclaw(initial, bootstrap) {
    const message =
      bootstrap === "preseed"
        ? "Install OpenClaw during this install? (preseed has a workspace, add-on can provision now)"
        : "Enable OpenClaw? (token bootstrap delays add-on; admin UI can install it post-bootstrap)";
    return ok<boolean>(await confirm({ message, initialValue: bootstrap === "preseed" ? initial : false }));
  },

  async withRsshub(initial) {
    return ok<boolean>(
      await confirm({ message: "Enable RSSHub during install?", initialValue: initial }),
    );
  },

  async tunnel(_initial) {
    const v = await select({
      message: "Expose Eve services through a tunnel?",
      options: [
        { value: "none",       label: "No tunnel",   hint: "Localhost / manual Traefik" },
        { value: "pangolin",   label: "Pangolin",    hint: "Self-hosted tunnel" },
        { value: "cloudflare", label: "Cloudflare",  hint: "cloudflared ingress" },
      ],
      initialValue: "none",
    });
    return ok<TunnelProvider | "none">(v as TunnelProvider | "none" | symbol);
  },

  async tunnelHostStrategy(domainSuggestion) {
    const v = await select({
      message: "Tunnel hostname",
      options: [
        { value: "same_as_synap", label: `Reuse pod hostname (${domainSuggestion})`, hint: "No extra DNS record needed" },
        { value: "custom",        label: "Use a different hostname",                  hint: "Example: eve.example.com" },
      ],
      initialValue: "same_as_synap",
    });
    return ok<"same_as_synap" | "custom">(v as "same_as_synap" | "custom" | symbol);
  },

  async tunnelDomain(initial) {
    return ok<string>(
      await text({
        message: "Tunnel hostname (e.g. eve.example.com)",
        initialValue: initial ?? "",
        placeholder: "eve.example.com",
        validate: (v: string) =>
          isValidDomain(v) && v !== "localhost" ? undefined : "Use a public FQDN (not localhost)",
      }),
    );
  },
};
