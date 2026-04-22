import { spawn } from 'child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export function execa(
  command: string,
  args: string[],
  options?: { stdio?: 'inherit' | 'pipe'; cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options?.stdio === 'inherit' ? 'inherit' : 'pipe',
      cwd: options?.cwd,
      env: options?.env,
    });

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    }

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

/** Ensure the 'eve-network' Docker network exists. */
export async function ensureNetwork(): Promise<void> {
  try {
    const { stdout } = await execa('docker', ['network', 'ls', '--format', '{{.Name}}']);
    if (!stdout.includes('eve-network')) {
      console.log('Creating eve-network...');
      await execa('docker', ['network', 'create', 'eve-network']);
    }
  } catch (error) {
    console.warn('Could not ensure Docker network:', error);
  }
}
