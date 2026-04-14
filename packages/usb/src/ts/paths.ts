import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/** Resolved from compiled `dist/paths.js` → package root is parent of `dist/` */
export function getCreateUsbScriptPath(): string {
  const distDir = dirname(fileURLToPath(import.meta.url));
  const packageRoot = join(distDir, '..');
  return join(packageRoot, 'src', 'create-usb.sh');
}
