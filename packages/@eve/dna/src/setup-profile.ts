import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';

export const SetupProfileKindSchema = z.enum(['inference_only', 'data_pod', 'full']);
export type SetupProfileKind = z.infer<typeof SetupProfileKindSchema>;

const TunnelProviderSchema = z.enum(['pangolin', 'cloudflare']);
export const BuilderEngineSchema = z.enum(['opencode', 'openclaude', 'claudecode']);
export const AiModeSchema = z.enum(['local', 'provider', 'hybrid']);
export const AiProviderSchema = z.enum(['ollama', 'openrouter', 'anthropic', 'openai']);
export type BuilderEngine = z.infer<typeof BuilderEngineSchema>;

export const SetupProfileSchema = z.object({
  version: z.literal('1'),
  profile: SetupProfileKindSchema,
  updatedAt: z.string(),
  domainHint: z.string().optional(),
  hearthName: z.string().optional(),
  source: z.enum(['wizard', 'usb_manifest', 'cli']).optional(),
  /** If set, `eve setup` runs `eve legs setup` with this tunnel after Data Pod / full stack steps. */
  tunnelProvider: TunnelProviderSchema.optional(),
  tunnelDomain: z.string().optional(),
  /** Default builder codegen surface for `eve builder init` */
  builderEngine: BuilderEngineSchema.optional(),
  /** AI foundation mode selected during setup */
  aiMode: AiModeSchema.optional(),
  aiDefaultProvider: AiProviderSchema.optional(),
  aiFallbackProvider: AiProviderSchema.optional(),
  /** Canonical network intent selected during setup. */
  network: z
    .object({
      exposureMode: z.enum(['local', 'public']),
      synapHost: z.string(),
      legs: z
        .object({
          tunnelProvider: TunnelProviderSchema.optional(),
          hostStrategy: z.enum(['same_as_synap', 'custom']).optional(),
          host: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  /** Non-secret Synap install preferences used to resume setup after interruption. */
  synapInstall: z
    .object({
      mode: z.enum(['auto', 'from_image', 'from_source']).optional(),
      tlsEmail: z.string().optional(),
      withOpenclaw: z.boolean().optional(),
      withRsshub: z.boolean().optional(),
      adminBootstrapMode: z.enum(['token', 'preseed']).optional(),
      adminEmail: z.string().optional(),
    })
    .optional(),
});

export type SetupProfile = z.infer<typeof SetupProfileSchema>;

const USB_MANIFEST_PATHS = [
  '/opt/eve/profile.json',
  join(homedir(), '.eve', 'usb-profile.json'),
];

function eveDir(cwd: string): string {
  return join(cwd, '.eve');
}

export function getSetupProfilePath(cwd: string = process.cwd()): string {
  return join(eveDir(cwd), 'setup-profile.json');
}

export async function readSetupProfile(cwd: string = process.cwd()): Promise<SetupProfile | null> {
  const path = getSetupProfilePath(cwd);
  try {
    await access(path);
    const raw = JSON.parse(await readFile(path, 'utf-8')) as unknown;
    return SetupProfileSchema.parse(raw);
  } catch {
    return null;
  }
}

/** Boot / USB handoff manifest (subset of setup profile). */
export const UsbSetupManifestSchema = z.object({
  version: z.literal('1'),
  target_profile: SetupProfileKindSchema,
  hearth_name: z.string().optional(),
  domain_hint: z.string().optional(),
  tunnel_provider: TunnelProviderSchema.optional(),
  tunnel_domain: z.string().optional(),
});

export type UsbSetupManifest = z.infer<typeof UsbSetupManifestSchema>;

export async function readUsbSetupManifest(): Promise<UsbSetupManifest | null> {
  const envPath = process.env.EVE_SETUP_MANIFEST?.trim();
  const paths = envPath ? [envPath, ...USB_MANIFEST_PATHS] : [...USB_MANIFEST_PATHS];

  for (const p of paths) {
    if (!p) continue;
    try {
      await access(p);
      const raw = JSON.parse(await readFile(p, 'utf-8')) as unknown;
      return UsbSetupManifestSchema.parse(raw);
    } catch {
      continue;
    }
  }
  return null;
}

export async function writeSetupProfile(
  profile: Omit<SetupProfile, 'version' | 'updatedAt'> & { version?: '1'; updatedAt?: string },
  cwd: string = process.cwd(),
): Promise<void> {
  const dir = eveDir(cwd);
  await mkdir(dir, { recursive: true });
  const full: SetupProfile = {
    version: '1',
    updatedAt: new Date().toISOString(),
    ...profile,
  };
  const parsed = SetupProfileSchema.parse(full);
  await writeFile(getSetupProfilePath(cwd), JSON.stringify(parsed, null, 2), 'utf-8');
}

export async function writeUsbSetupManifest(manifest: UsbSetupManifest, outputPath: string): Promise<void> {
  const parsed = UsbSetupManifestSchema.parse(manifest);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(parsed, null, 2), 'utf-8');
}
