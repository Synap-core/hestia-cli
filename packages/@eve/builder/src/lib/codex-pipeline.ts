import { T3CodeClient } from './t3code-client.js';

export type CodePhase = 'executing' | 'verifying' | 'debugging';

const PHASE_NEXT_STATUS: Record<CodePhase, string> = {
  executing: 'verifying',
  verifying: 'awaiting_review',
  debugging: 'verifying',
};

const PHASE_TIMEOUT_MS: Record<CodePhase, number> = {
  executing: 45 * 60_000,
  verifying: 15 * 60_000,
  debugging: 45 * 60_000,
};

export interface CodexPipelineConfig {
  t3codeUrl: string;
  t3codeApiKey?: string;
  hubBaseUrl: string;
  apiKey: string;
}

interface FeatureEntity {
  id: string;
  title?: string | null;
  properties: unknown;
}

/**
 * Executes DevPlane pipeline code phases (executing / verifying / debugging)
 * using T3 Code as the Codex backend for real file-system operations.
 *
 * Phase responsibilities:
 *   executing  — implement the approved plan in the repo
 *   verifying  — run tests / types / lint and report PASS | FAIL
 *   debugging  — fix issues found during verification
 *
 * On completion each phase updates agent_status → next state and persists
 * the T3 Code resumeCursor for session continuity across daemon restarts.
 */
export class CodexPipeline {
  private readonly client: T3CodeClient;
  private readonly hubBaseUrl: string;
  private readonly apiKey: string;

  constructor(config: CodexPipelineConfig) {
    this.client = new T3CodeClient({ url: config.t3codeUrl, apiKey: config.t3codeApiKey });
    this.hubBaseUrl = config.hubBaseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  async runPhase(featureId: string, phase: CodePhase): Promise<void> {
    let feature: FeatureEntity;
    try {
      feature = await this.fetchFeature(featureId);
    } catch (err) {
      console.error(`[CodexPipeline] Failed to fetch feature ${featureId}:`, err);
      return;
    }

    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const cwd = props.t3code_cwd as string | undefined;

    if (!cwd) {
      console.error(
        `[CodexPipeline] Feature ${featureId} has no t3code_cwd — cannot run ${phase}`,
      );
      await this.updateFeature(featureId, {
        agent_status: 'error',
        error_reason: 't3code_cwd_missing',
      });
      return;
    }

    console.log(`[CodexPipeline] ${phase} → feature ${featureId} (cwd: ${cwd})`);

    const prompt = buildPrompt(phase, feature.title ?? 'Untitled', props);
    const resumeCursor = props.t3code_resume_cursor as string | undefined;

    let result: { resumeCursor: string; output: unknown[] };
    try {
      result = await this.client.runTurn({
        cwd,
        messages: [{ role: 'user', content: prompt }],
        resumeCursor,
        timeoutMs: PHASE_TIMEOUT_MS[phase],
        onProgress: () => process.stdout.write('.'),
      });
      process.stdout.write('\n');
    } catch (err) {
      console.error(`[CodexPipeline] ${phase} failed for feature ${featureId}:`, err);
      await this.updateFeature(featureId, {
        agent_status: 'error',
        error_reason: `${phase}_failed`,
        error_detail: (err as Error).message,
      });
      return;
    }

    const summary = extractSummary(result.output);
    const updates: Record<string, unknown> = {
      agent_status: PHASE_NEXT_STATUS[phase],
      t3code_resume_cursor: result.resumeCursor,
    };
    if (phase === 'executing') updates.execution_summary = summary;
    if (phase === 'verifying') updates.verification_report = summary;
    if (phase === 'debugging') updates.debug_summary = summary;

    await this.updateFeature(featureId, updates);
    console.log(`[CodexPipeline] ${phase} complete → ${PHASE_NEXT_STATUS[phase]}`);

    const channelId = props.entityChannelId as string | undefined;
    if (channelId) {
      await this.postToChannel(channelId, `**${phase}** complete:\n${summary.slice(0, 500)}`);
    }
  }

  private async fetchFeature(id: string): Promise<FeatureEntity> {
    const res = await fetch(`${this.hubBaseUrl}/entities/${id}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<FeatureEntity>;
  }

  private async updateFeature(id: string, properties: Record<string, unknown>): Promise<void> {
    await fetch(`${this.hubBaseUrl}/entities/${id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    }).catch((err) => console.warn('[CodexPipeline] Update failed:', err));
  }

  private async postToChannel(channelId: string, content: string): Promise<void> {
    await fetch(`${this.hubBaseUrl}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    }).catch(() => {}); // best-effort
  }
}

function buildPrompt(
  phase: CodePhase,
  title: string,
  props: Record<string, unknown>,
): string {
  const lines: string[] = [`## Feature: ${title}`];

  if (phase === 'executing') {
    if (props.description) lines.push('', '### Description', '', String(props.description));
    if (props.acceptance_criteria)
      lines.push('', '### Acceptance Criteria', '', String(props.acceptance_criteria));
    if (props.plan) lines.push('', '### Implementation Plan', '', String(props.plan));
    lines.push(
      '',
      'Execute every step of the implementation plan exactly as written.',
      'Do not add scope beyond what is specified.',
      'Write tests for new functionality. Run them before finishing.',
      'When done, provide a concise execution summary listing files changed.',
    );
  }

  if (phase === 'verifying') {
    if (props.acceptance_criteria)
      lines.push('', '### Acceptance Criteria', '', String(props.acceptance_criteria));
    if (props.execution_summary)
      lines.push('', '### Execution Summary', '', String(props.execution_summary));
    lines.push(
      '',
      'Run the full quality suite: tests, type checker, linter.',
      'Report results with a clear PASS or FAIL verdict.',
      'Include details of any failures: file, line number, error message.',
      'Do NOT fix anything — only report.',
    );
  }

  if (phase === 'debugging') {
    if (props.verification_report)
      lines.push('', '### Verification Report (issues to fix)', '', String(props.verification_report));
    if (props.execution_summary)
      lines.push('', '### Previous Execution Summary', '', String(props.execution_summary));
    lines.push(
      '',
      'Fix each issue listed in the verification report. Be surgical — only touch what is broken.',
      'Do not refactor or improve unrelated code.',
      'When done, list what was fixed and why.',
    );
  }

  return lines.join('\n');
}

function extractSummary(output: unknown[]): string {
  const texts = (output as Array<{ type?: string; text?: string; content?: string }>)
    .map((item) => item?.text ?? item?.content ?? '')
    .filter(Boolean);
  return texts.join('\n').trim() || 'Phase completed';
}
