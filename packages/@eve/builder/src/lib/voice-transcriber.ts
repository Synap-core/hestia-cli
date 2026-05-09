import { createWriteStream, mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export type TranscriptionEngine = 'whisper-local' | 'openai' | 'deepgram';
export type WhisperModelSize = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';

export interface TranscriptionConfig {
  engine: TranscriptionEngine;
  modelSize?: WhisperModelSize;
  apiKey?: string;
  language?: string;
}

export interface TranscriptionResult {
  transcript: string;
  engine: TranscriptionEngine;
  durationMs: number;
}

export class VoiceTranscriber {
  async transcribe(audioUrl: string, config: TranscriptionConfig): Promise<TranscriptionResult> {
    const start = Date.now();
    const tmpDir = mkdtempSync(join(tmpdir(), 'eve-voice-'));
    try {
      const ext = extname(new URL(audioUrl).pathname) || '.ogg';
      const audioPath = join(tmpDir, `audio${ext}`);
      await this._downloadFile(audioUrl, audioPath);

      let transcript: string;
      switch (config.engine) {
        case 'whisper-local':
          transcript = await this._transcribeWhisperLocal(audioPath, config, tmpDir);
          break;
        case 'openai':
          transcript = await this._transcribeOpenAI(audioPath, config);
          break;
        case 'deepgram':
          transcript = await this._transcribeDeepgram(audioPath, config);
          break;
        default:
          throw new Error(`Unknown transcription engine: ${config.engine}`);
      }

      return { transcript: transcript.trim(), engine: config.engine, durationMs: Date.now() - start };
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore cleanup errors */ }
    }
  }

  private async _downloadFile(url: string, destPath: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Audio download failed: HTTP ${res.status}`);
    if (!res.body) throw new Error('Audio download returned empty body');
    const dest = createWriteStream(destPath);
    await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), dest);
  }

  private async _transcribeWhisperLocal(audioPath: string, config: TranscriptionConfig, tmpDir: string): Promise<string> {
    const model = config.modelSize ?? 'base';
    const args = [audioPath, '--model', model, '--output_format', 'txt', '--output_dir', tmpDir];
    if (config.language) args.push('--language', config.language);

    return new Promise<string>((resolve, reject) => {
      const proc = spawn('whisper', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`whisper exited ${code}: ${stderr.slice(-300)}`));
          return;
        }
        const files = readdirSync(tmpDir).filter((f: string) => f.endsWith('.txt'));
        if (files.length === 0) { reject(new Error('whisper produced no .txt output')); return; }
        resolve(readFileSync(join(tmpDir, files[0]), 'utf8'));
      });
      proc.on('error', (err) => reject(new Error(`Failed to spawn whisper: ${err.message}. Install with: pip install openai-whisper`)));
    });
  }

  private async _transcribeOpenAI(audioPath: string, config: TranscriptionConfig): Promise<string> {
    if (!config.apiKey) throw new Error('openai engine requires apiKey');
    const audioBytes = readFileSync(audioPath);
    const ext = extname(audioPath).replace('.', '') || 'ogg';

    const formData = new FormData();
    formData.append('file', new Blob([audioBytes], { type: `audio/${ext}` }), `audio.${ext}`);
    formData.append('model', 'whisper-1');
    if (config.language) formData.append('language', config.language);

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: formData,
    });
    if (!res.ok) throw new Error(`OpenAI Whisper API error: ${res.status} ${await res.text()}`);
    const data = await res.json() as { text: string };
    return data.text;
  }

  private async _transcribeDeepgram(audioPath: string, config: TranscriptionConfig): Promise<string> {
    if (!config.apiKey) throw new Error('deepgram engine requires apiKey');
    const audioBytes = readFileSync(audioPath);

    const url = new URL('https://api.deepgram.com/v1/listen');
    if (config.language) url.searchParams.set('language', config.language);
    url.searchParams.set('smart_format', 'true');

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Token ${config.apiKey}`,
        'Content-Type': 'audio/*',
      },
      body: audioBytes,
    });
    if (!res.ok) throw new Error(`Deepgram API error: ${res.status} ${await res.text()}`);
    const data = await res.json() as { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } };
    return data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
  }
}

export const voiceTranscriber = new VoiceTranscriber();
