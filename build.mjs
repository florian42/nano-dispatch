import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

// Service worker runs as MV3 module; side-panel + options pages load their
// scripts via <script type="module">. Content scripts are classic-script-loaded
// (manifest content_scripts entry or executeScript files-injection), so they
// must be IIFE-bundled.
const surfaces = [
  { name: 'service-worker', entry: 'src/background/service-worker.ts', format: 'esm' },
  { name: 'selection-stream', entry: 'src/content/selection-stream.ts', format: 'iife' },
  { name: 'capture', entry: 'src/content/capture-script.ts', format: 'iife' },
  { name: 'sidepanel', entry: 'src/sidepanel/sidepanel.ts', format: 'esm' },
  { name: 'options', entry: 'src/options/options.ts', format: 'esm' },
];

const shared = {
  bundle: true,
  target: 'chrome120',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
};

async function clean() {
  if (existsSync(outdir)) await rm(outdir, { recursive: true });
  await mkdir(outdir, { recursive: true });
}

async function copyStatic() {
  await cp('manifest.json', path.join(outdir, 'manifest.json'));
  await cp('src/sidepanel/sidepanel.html', path.join(outdir, 'sidepanel.html'));
  await cp('src/options/options.html', path.join(outdir, 'options.html'));
  if (existsSync('icons')) await cp('icons', path.join(outdir, 'icons'), { recursive: true });
}

function configFor({ name, entry, format }) {
  return {
    ...shared,
    entryPoints: [entry],
    outfile: path.join(outdir, `${name}.js`),
    format,
  };
}

async function buildOnce() {
  await clean();
  await Promise.all(surfaces.map((s) => esbuild.build(configFor(s))));
  await copyStatic();
}

if (watch) {
  await clean();
  await copyStatic();
  const contexts = await Promise.all(surfaces.map((s) => esbuild.context(configFor(s))));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('watching…');
} else {
  await buildOnce();
  console.log('build complete → dist/');
}
