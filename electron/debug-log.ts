import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Persistent lifecycle log for debugging "window shows an error page" reports.
 * Written to <userData>/alma-debug.log AND mirrored to stdout.
 */
let logFilePath = '';

export function initDebugLog(userDataDir: string): void {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    logFilePath = path.join(userDataDir, 'alma-debug.log');
    // Keep the file bounded — it only holds recent sessions.
    const stat = fs.existsSync(logFilePath) ? fs.statSync(logFilePath) : null;
    if (stat && stat.size > 512 * 1024) fs.writeFileSync(logFilePath, '');
    debugLog('boot', `--- session start (pid ${process.pid}) ---`);
    debugLog('boot', `userData: ${userDataDir}`);
  } catch {
    logFilePath = '';
  }
}

export function debugLogPath(): string {
  return logFilePath;
}

export function debugLog(kind: string, message: string): void {
  const line = `[${new Date().toISOString()}] [${kind}] ${message}`;
  // stdout so `npm run dev` shows it in the terminal too.
  console.log(`[alma] ${line}`);
  if (!logFilePath) return;
  try {
    fs.appendFileSync(logFilePath, `${line}\n`);
  } catch {
    /* never let logging break the app */
  }
}
