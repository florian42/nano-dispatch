import { cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const outdir = 'dist';

if (existsSync(outdir)) await rm(outdir, { recursive: true });

const tsc = spawnSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

await cp('manifest.json', `${outdir}/manifest.json`);
await cp('src/sidepanel/sidepanel.html', `${outdir}/sidepanel.html`);
await cp('src/options/options.html', `${outdir}/options.html`);

console.log('build complete → dist/');
