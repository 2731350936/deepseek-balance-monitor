import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Extract platform.deepseek.com cookies from Chrome/Edge browsers.
 *
 * Uses a separate Node.js script (scripts/extract-cookies.js) that runs under
 * the SYSTEM Node.js (not VS Code's built-in one) because it needs
 * `node:sqlite` which requires Node 22.5+.
 */
export async function extractDeepSeekCookie(): Promise<{ cookie: string; source: string } | null> {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'extract-cookies.js');

  if (!fs.existsSync(scriptPath)) {
    console.error(`[cookieExtractor] Script not found: ${scriptPath}`);
    return null;
  }

  return new Promise((resolve) => {
    // Find system Node.js
    const nodePaths = [
      '"C:\\Program Files\\nodejs\\node.exe"',
      'node',
    ];

    function tryNode(idx: number): void {
      if (idx >= nodePaths.length) {
        resolve(null);
        return;
      }

      execFile(
        nodePaths[idx],
        [scriptPath],
        {
          timeout: 20000,
          windowsHide: true,
          shell: true,
        },
        (err, stdout) => {
          if (err) { tryNode(idx + 1); return; }
          try {
            const result = JSON.parse(stdout.trim());
            if (result.cookie && result.source) {
              resolve({ cookie: result.cookie, source: result.source });
            } else {
              console.error(`[cookieExtractor] ${result.error || 'No cookies found'}`);
              // Don't try next node path — the script ran, just no data
            }
          } catch {
            tryNode(idx + 1);
          }
        }
      );
    }

    tryNode(0);
  });
}
