/**
 * Single orchestration path for the Builder organ (OpenCode, OpenClaude, Claude Code, Hermes).
 * Edge stack (Traefik, Pangolin Newt, Dokploy, …) is intentionally separate — wire after this.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeBuilderProjectEnv } from '@eve/dna';
import { OpenCodeService } from './opencode.js';
import { OpenClaudeService } from './openclaude.js';
import { ClaudeCodeService } from './claudecode.js';
import { DokployService } from './dokploy.js';
import { HermesDaemon } from './hermes-daemon.js';
import { scaffoldNonOpencodeProject } from './project-paths.js';

export type BuilderEngine = 'opencode' | 'openclaude' | 'claudecode';

export type RunBuilderOrganOptions = {
  name: string;
  cwd?: string;
  engines: Set<BuilderEngine>;
  template?: string;
  brainUrl?: string;
  /** Dokploy is optional — many pods use static deploy or webhooks only */
  withDokploy?: boolean;
};

export type RunBuilderOrganResult = {
  projectDir: string;
  engines: BuilderEngine[];
  dokployUsed: boolean;
};

export async function runBuilderOrganSetup(opts: RunBuilderOrganOptions): Promise<RunBuilderOrganResult> {
  const cwd = opts.cwd ?? process.cwd();
  const { name, engines, template, brainUrl, withDokploy = false } = opts;

  const opencode = new OpenCodeService();
  const openclaude = new OpenClaudeService();
  const claudecode = new ClaudeCodeService();
  const dokploy = new DokployService();

  if (withDokploy) {
    await dokploy.install();
  }
  if (engines.has('opencode')) await opencode.install();
  if (engines.has('openclaude')) await openclaude.install();
  if (engines.has('claudecode')) await claudecode.install();

  let projectDir: string;
  if (engines.has('opencode')) {
    await opencode.initProject(name, template);
    projectDir = opencode.getProjectPath()!;
  } else {
    projectDir = await scaffoldNonOpencodeProject(name, cwd);
  }

  if (engines.has('openclaude')) {
    await openclaude.configure(brainUrl || '');
    await openclaude.start();
    const rootCfg = join(cwd, '.eve', 'openclaude.json');
    const projEve = join(projectDir, '.eve');
    if (existsSync(rootCfg)) {
      mkdirSync(projEve, { recursive: true });
      copyFileSync(rootCfg, join(projEve, 'openclaude.json'));
    }
  }

  await writeBuilderProjectEnv(projectDir, cwd);

  if (engines.has('claudecode')) {
    await claudecode.configureProject(projectDir, cwd);
  }

  if (withDokploy) {
    await dokploy.createProject(name);
  }

  const eveDir = join(cwd, '.eve');
  if (!existsSync(eveDir)) {
    mkdirSync(eveDir, { recursive: true });
  }

  const entityState = {
    type: 'builder_project',
    name,
    template: template || 'default',
    engines: [...engines],
    brainUrl: brainUrl || openclaude.getConfig()?.brainUrl || null,
    components: {
      opencode: { selected: engines.has('opencode'), projectPath: engines.has('opencode') ? projectDir : null },
      openclaude: { selected: engines.has('openclaude'), configured: openclaude.isConfigured() },
      claudecode: { selected: engines.has('claudecode') },
      dokploy: withDokploy
        ? { enabled: true, installed: true, projectName: name }
        : { enabled: false, skipped: true },
    },
    projectPath: projectDir,
    createdAt: new Date().toISOString(),
    status: 'initialized',
  };

  writeFileSync(join(eveDir, 'builder-state.json'), JSON.stringify(entityState, null, 2));

  return {
    projectDir,
    engines: [...engines],
    dokployUsed: withDokploy,
  };
}

export interface RunHermesOrganOptions {
  /** Synap API URL (e.g. http://localhost:4000) */
  apiUrl: string;
  /** Synap API key for authentication */
  apiKey: string;
  /** Workspace directory for task artifacts */
  workspaceDir: string;
  /** Poll interval in ms (default: 30000) */
  pollIntervalMs?: number;
  /** Max concurrent tasks (default: 1) */
  maxConcurrentTasks?: number;
}

/**
 * Initialize Hermes for the Builder organ — write config and state.
 * Does NOT start the daemon (that's done via `eve builder hermes start`).
 * Returns the path to the generated state file.
 */
export function runHermesOrganSetup(opts: RunHermesOrganOptions): string {
  const { apiUrl, apiKey, workspaceDir, pollIntervalMs = 30_000, maxConcurrentTasks = 1 } = opts;

  const eveDir = join(workspaceDir, '.eve');
  if (!existsSync(eveDir)) {
    mkdirSync(eveDir, { recursive: true });
  }

  const hermesState = {
    type: 'hermes_daemon',
    status: 'configured',
    apiUrl,
    workspaceDir,
    components: {
      daemon: { enabled: true, pollIntervalMs, maxConcurrentTasks },
    },
    createdAt: new Date().toISOString(),
  };

  writeFileSync(join(eveDir, 'hermes-state.json'), JSON.stringify(hermesState, null, 2));

  return join(eveDir, 'hermes-state.json');
}
