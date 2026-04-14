import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readEveSecrets,
  copySynapSkillIntoClaudeProject,
  writeClaudeCodeSettings,
  defaultSkillsDir,
} from '@eve/dna';

/**
 * Anthropic Claude Code CLI — native install preferred; npm fallback.
 * Skills: https://code.claude.com/docs/en/skills (project `.claude/skills/`).
 */
export class ClaudeCodeService {
  private installed = false;

  async install(): Promise<void> {
    try {
      execSync('which claude', { stdio: 'ignore' });
      this.installed = true;
      console.log('Claude Code (claude) already on PATH');
      return;
    } catch {
      /* continue */
    }
    try {
      console.log('Installing Claude Code via npm (@anthropic-ai/claude-code)…');
      console.log('Tip: for native install see https://code.claude.com/docs/en/setup');
      execSync('npm install -g @anthropic-ai/claude-code', { stdio: 'inherit' });
      this.installed = true;
    } catch (e) {
      console.warn('Claude Code install failed:', e instanceof Error ? e.message : e);
      throw e;
    }
  }

  /**
   * Writes `.claude/settings.json` (env for Hub) + copies synap skill into `.claude/skills/synap/`.
   * See: https://code.claude.com/docs/en/settings
   */
  async configureProject(projectDir: string, cwd: string = process.cwd()): Promise<void> {
    if (!this.installed) await this.install();
    const secrets = await readEveSecrets(cwd);
    const skillsDir = secrets?.builder?.skillsDir ?? defaultSkillsDir();
    await writeClaudeCodeSettings(projectDir, cwd);
    copySynapSkillIntoClaudeProject(projectDir, skillsDir);

    const readme = join(projectDir, '.claude', 'README.eve.md');
    mkdirSync(join(projectDir, '.claude'), { recursive: true });
    writeFileSync(
      readme,
      [
        '# Eve + Claude Code',
        '',
        '- Session commands: `/skills`, `/mcp`, `/context` (see Claude Code docs).',
        '- Hub env is in `settings.json` → `env` (SYNAP_API_URL, SYNAP_API_KEY, HUB_BASE_URL).',
        '- Add MCP: `claude mcp add --transport http …` (see https://code.claude.com/docs/en/mcp ).',
        '',
      ].join('\n'),
      'utf-8',
    );
    console.log('Claude Code project wiring: .claude/settings.json + .claude/skills/synap/');
  }
}
