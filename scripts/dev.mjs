#!/usr/bin/env node
/**
 * Dev orchestrator:
 *   1. esbuild --watch bundles electron main + preload (rebuilds on change)
 *   2. next dev serves the renderer on :3000
 *   3. once both are up, launches Electron; restarts it on main-process rebuild
 */
import { spawn } from 'node:child_process';
import { build, context } from 'esbuild';

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

function launchElectron() {
  if (electronProcess) return;
  electronReady = true;
  console.log('[electron] starting…');
  electronProcess = run('electron', 'npx', ['electron', 'dist-electron/main.cjs'], {
    ALMA_DEV: '1',
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

  run('next', 'npx', ['next', 'dev', '-p', '3000']);
  launchElectron();
}

await main();
