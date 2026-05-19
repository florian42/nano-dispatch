import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

const entryPoints = {
  'service-worker': 'src/background/service-worker.ts',
  'selection-stream': 'src/content/selection-stream.ts',
  capture: 'src/content/capture-script.ts',
  sidepanel: 'src/sidepanel/sidepanel.ts',
  options: 'src/options/options.ts',
};

const shared = {
  bundle: true,
  format: 'esm',
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

async function buildOnce() {
  await clean();
  await Promise.all(
    Object.entries(entryPoints).map(([name, entry]) =>
      esbuild.build({
        ...shared,
        entryPoints: [entry],
        outfile: path.join(outdir, `${name}.js`),
      }),
    ),
  );
  await copyStatic();
}

if (watch) {
  await clean();
  await copyStatic();
  const contexts = await Promise.all(
    Object.entries(entryPoints).map(([name, entry]) =>
      esbuild.context({
        ...shared,
        entryPoints: [entry],
        outfile: path.join(outdir, `${name}.js`),
      }),
    ),
  );
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('watching…');
} else {
  await buildOnce();
  console.log('build complete → dist/');
}
