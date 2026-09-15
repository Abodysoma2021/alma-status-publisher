import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

/**
 * Bundles the Electron main process and preload with esbuild.
 * Our first-party code is bundled; node_modules stay external so native /
 * dynamic-require packages (open-wa, puppeteer) resolve normally at runtime.
 */
mkdirSync('dist-electron', { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: process.env.NODE_ENV !== 'production',
  logLevel: 'info',
  // Keep every dependency external (open-wa/puppeteer use dynamic requires).
  packages: 'external',
};

await build({
  entryPoints: ['electron/main.ts'],
  outfile: 'dist-electron/main.cjs',
  ...common,
});

await build({
  entryPoints: ['electron/preload.ts'],
  outfile: 'dist-electron/preload.cjs',
  ...common,
});
