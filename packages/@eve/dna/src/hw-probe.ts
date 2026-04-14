import { cpus, totalmem, platform, arch, hostname } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface HardwareFacts {
  hostname: string;
  platform: string;
  arch: string;
  cpuCores: number;
  cpuModel: string;
  totalMemoryBytes: number;
  totalMemoryGb: string;
  nvidiaSmi?: string;
}

export async function probeHardware(runNvidiaSmi: boolean): Promise<HardwareFacts> {
  const cpuList = cpus() ?? [];
  const facts: HardwareFacts = {
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    cpuCores: cpuList.length || 0,
    cpuModel: cpuList[0]?.model?.trim() ?? 'unknown',
    totalMemoryBytes: totalmem(),
    totalMemoryGb: (totalmem() / 1024 ** 3).toFixed(1),
  };

  if (runNvidiaSmi) {
    try {
      const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], {
        timeout: 10_000,
      });
      facts.nvidiaSmi = stdout.trim() || undefined;
    } catch {
      facts.nvidiaSmi = '(nvidia-smi not available or no GPU)';
    }
  }

  return facts;
}

export function formatHardwareReport(f: HardwareFacts): string {
  const lines = [
    `Hostname: ${f.hostname}`,
    `OS: ${f.platform} (${f.arch})`,
    `CPU: ${f.cpuModel} — ${f.cpuCores} logical cores`,
    `RAM: ${f.totalMemoryGb} GiB`,
  ];
  if (f.nvidiaSmi !== undefined) {
    lines.push(`GPU: ${f.nvidiaSmi}`);
  }
  return lines.join('\n');
}
