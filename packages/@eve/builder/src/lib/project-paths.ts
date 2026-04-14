import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readEveSecrets, writeBuilderProjectEnv } from '@eve/dna';

/** Workspace project directory (same layout as OpenCodeService.initProject). */
export async function resolveBuilderProjectDir(name: string, cwd: string = process.cwd()): Promise<string> {
  const secrets = await readEveSecrets(cwd);
  const workspaceRoot = secrets?.builder?.workspaceDir ?? join(homedir(), '.eve', 'workspace');
  mkdirSync(workspaceRoot, { recursive: true });
  const projectDir = join(workspaceRoot, name);
  if (!existsSync(projectDir)) {
    mkdirSync(projectDir, { recursive: true });
  }
  return projectDir;
}

/** Minimal tree when OpenCode is not selected. */
export async function scaffoldNonOpencodeProject(name: string, cwd: string = process.cwd()): Promise<string> {
  const projectDir = await resolveBuilderProjectDir(name, cwd);
  await writeBuilderProjectEnv(projectDir, cwd);
  const readme = join(projectDir, 'README.md');
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      `# ${name}\n\nEve builder project (OpenCode not selected). Use Claude Code or OpenClaude in this directory.\n`,
      'utf-8',
    );
  }
  return projectDir;
}
