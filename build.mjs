// Build the extension with esbuild.
//
// `tsc --noEmit` still runs typecheck via `npm run typecheck`. esbuild here
// strips types and bundles each surface into one file: the GramJS dependency
// is a CommonJS+ESM mix that won't load through Chrome's bare-module loader,
// so bundling is required. See ADR-0011.

import { cp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';

const outdir = 'dist';

if (existsSync(outdir)) await rm(outdir, { recursive: true });
await mkdir(outdir, { recursive: true });

const shared = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120'],
  outdir,
  sourcemap: true,
  logLevel: 'info',
  mainFields: ['browser', 'module', 'main'],
  conditions: ['browser', 'import', 'default'],
  // GramJS pulls Node built-ins (fs, net, tls, stream, ...) in behind
  // environment checks that never fire in the browser/service worker. Alias
  // them all to an empty shim so esbuild resolves the imports without
  // dragging in Node modules. `util` gets a real (minimal) shim because
  // GramJS's TL class builder uses `util.inspect.custom` as a symbol key
  // at class-definition time — empty would crash the bundle at init.
  alias: {
    fs: './build-shims/empty.js',
    'graceful-fs': './build-shims/empty.js',
    net: './build-shims/empty.js',
    tls: './build-shims/empty.js',
    dns: './build-shims/empty.js',
    stream: './build-shims/empty.js',
    util: './build-shims/util.js',
    assert: './build-shims/empty.js',
    constants: './build-shims/empty.js',
    crypto: './build-shims/crypto.js',
    zlib: './build-shims/empty.js',
    path: './build-shims/empty.js',
    os: './build-shims/os.js',
    'fs/promises': './build-shims/empty.js',
    socks: './build-shims/empty.js',
    http: './build-shims/empty.js',
    https: './build-shims/empty.js',
    events: './build-shims/empty.js',
    'node-localstorage': './build-shims/empty.js',
    url: './build-shims/empty.js',
    querystring: './build-shims/empty.js',
  },
  // GramJS uses `Buffer` as a global (Node convention). Browsers don't
  // provide it; inject the `buffer` npm package's polyfill so every
  // reference resolves.
  inject: ['./build-shims/buffer-inject.js'],
};

// Service worker has `self` but no `window`. GramJS's browser detection
// (`typeof window !== "undefined"`) needs window to be defined so it picks
// the WebSocket transport. Prepend a tiny polyfill before any module init.
const swWindowPolyfill = `if (typeof globalThis.window === "undefined" && typeof globalThis.self !== "undefined") { globalThis.window = globalThis.self; }`;

await build({
  ...shared,
  entryPoints: { 'background/service-worker': 'src/background/service-worker.ts' },
  banner: { js: swWindowPolyfill },
});

await build({
  ...shared,
  entryPoints: {
    'sidepanel/sidepanel': 'src/sidepanel/sidepanel.ts',
    'options/options': 'src/options/options.ts',
  },
});

await cp('manifest.json', `${outdir}/manifest.json`);
await cp('src/sidepanel/sidepanel.html', `${outdir}/sidepanel.html`);
await cp('src/options/options.html', `${outdir}/options.html`);

console.log('build complete → dist/');
