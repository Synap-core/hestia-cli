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
