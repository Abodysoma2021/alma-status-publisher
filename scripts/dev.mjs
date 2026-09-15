#!/usr/bin/env node
/**
 * Dev orchestrator:
 *   1. esbuild --watch bundles electron main + preload (rebuilds on change)
 *   2. next dev serves the renderer on :3000
 *   3. once both are up, launches Electron; restarts it on main-process rebuild
 */
import { spawn } from 'node:child_process';
import * as net from 'node:net';
import { build, context } from 'esbuild';

/** Picks a free localhost port so stale servers can never collide with us. */
async function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const children = [];
let electronProcess = null;
let electronReady = false;
let pendingRestart = false;

function run(name, command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: 'pipe',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });
  const tag = `[${name}]`;
  child.stdout.on('data', (d) => process.stdout.write(`${tag} ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`${tag} ${d}`));
  child.on('exit', (code) => {
    if (name !== 'electron') {
      console.log(`${tag} exited (${code})`);
      cleanup();
      process.exit(code ?? 0);
    }
  });
  children.push(child);
  return child;
}

function launchElectron(devUrl) {
  if (electronProcess) return;
  electronReady = true;
  console.log(`[electron] starting… (renderer: ${devUrl})`);
  electronProcess = run('electron', 'npx', ['electron', 'dist-electron/main.cjs'], {
    ALMA_DEV: '1',
    ALMA_DEV_URL: devUrl,
    ELECTRON_ENABLE_LOGGING: '1',
  });
}

function restartElectron() {
  if (!electronReady) return;
  if (electronProcess) {
    console.log('[dev] main process changed — restarting electron…');
    electronProcess.kill();
    children.splice(children.indexOf(electronProcess), 1);
    electronProcess = null;
  }
  setTimeout(launchElectron, 300);
}

function cleanup() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* noop */
    }
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

async function main() {
  // Initial electron build, then keep watching.
  const mainCtx = await context({
    entryPoints: ['electron/main.ts'],
    outfile: 'dist-electron/main.cjs',
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: true,
    logLevel: 'silent',
    packages: 'external',
  });
  const preloadCtx = await context({
    entryPoints: ['electron/preload.ts'],
    outfile: 'dist-electron/preload.cjs',
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: true,
    logLevel: 'silent',
    packages: 'external',
  });

  await Promise.all([mainCtx.rebuild(), preloadCtx.rebuild()]);
  console.log('[esbuild] electron bundle ready');

  mainCtx.watch(() => restartElectron());
  preloadCtx.watch(() => restartElectron());

  const port = await pickFreePort();
  run('next', 'npx', ['next', 'dev', '-p', String(port)]);
  const devUrl = `http://127.0.0.1:${port}`;

  // Electron must not navigate before the dev server answers — otherwise the
  // window shows Chromium's "This page couldn't load" error page. We also pin
  // the EXACT verified URL (IPv4) via ALMA_DEV_URL so the renderer cannot
  // resolve `localhost` to ::1 and miss an IPv4-only server.
  console.log(`[dev] waiting for Next.js on ${devUrl}…`);
  const ready = await waitFor(devUrl, 120_000);
  if (!ready) {
    console.error('[dev] Next.js did not start within 120s — launching Electron anyway.');
  }
  launchElectron(devUrl);
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return true; // server is up
    } catch {
      /* not ready yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

await main();
