# ADR-0011: Add esbuild for bundling

Status: Accepted
Date: 2026-05-19

## Context

The original build (`tsc -p tsconfig.build.json` + `cp`) emitted one
`.js` per `.ts` and let Chrome's MV3 ES-module loader resolve imports
at runtime. PRD §Build (line 100) noted: "No bundler. No minification —
readable output is more valuable than a smaller bundle."

With ADR-0008's switch to MTProto, the dispatcher path imports GramJS
(`telegram` on npm). GramJS is shipped as a mix of CommonJS and ESM,
re-exports through `index.js` files, and conditionally imports Node
built-ins (`fs`, `net`, `tls`, `stream`, etc.) behind environment
checks. None of that loads through Chrome's bare-specifier ESM resolver.

## Decision

Add `esbuild` and bundle each surface (service worker, side panel,
options page) into a single `.js` per entrypoint. `tsc --noEmit` is
retained for typechecking via `npm run typecheck`.

`build.mjs`:

- Aliases Node built-ins to `build-shims/empty.js`. They appear in
  GramJS source but never execute on the browser code paths.
- Injects the `buffer` npm polyfill so GramJS's pervasive `Buffer.*`
  references resolve. (GramJS treats `Buffer` as a global, Node
  convention.)
- Targets `chrome120` (matches the MV3 surface we depend on; modern
  enough to skip transforms).
- Emits sourcemaps. No minification — readability in the bundle is
  still useful when debugging MV3 service worker issues.

## Consequences

- PRD §Build line 100 ("no bundler") is reversed. The PRD is updated
  in the same commit as this ADR.
- Bundle size: service worker and options page bundles are ~1.3 MB
  each (GramJS + buffer polyfill, unminified). Side panel is ~70 KB
  (Buffer polyfill injected because something it imports references
  Buffer transitively; could be split later if it matters).
- The Node-built-in shim list is closed: `fs`, `graceful-fs`, `net`,
  `tls`, `dns`, `stream`, `util`, `assert`, `constants`, `crypto`,
  `zlib`, `path`, `os`, `fs/promises`, `socks`, `http`, `https`,
  `events`, `node-localstorage`, `url`, `querystring`. If a new
  GramJS release adds another Node-only dep, the build fails loudly
  with `Could not resolve "<name>"` and the list grows by one line.
  **Three of these (`util`, `os`, `crypto`) are not empty shims but
  real polyfills — see [ADR-0012](./0012-browser-polyfill-architecture.md)
  for which Node surfaces actually run on browser paths and how each
  is shimmed.**
- `dist/` layout (`background/service-worker.js`,
  `sidepanel/sidepanel.js`, `options/options.js`) matches the
  `manifest.json` paths unchanged.

## Alternatives considered

- **Webpack.** Heavier config, slower builds, more plugins. esbuild
  does the same job in tens of milliseconds with a one-file config.
- **Vite.** Designed around a dev server we don't need (the extension
  is loaded unpacked from `dist/`). Vite uses esbuild under the hood
  anyway.
- **Stick with `tsc + cp` and ship GramJS as an ES module.** GramJS
  doesn't publish a single-file browser ESM bundle; this would
  require either patching the package or maintaining a fork.
- **Bundle only the GramJS-importing surfaces.** Considered. Net
  savings would be the side-panel bundle staying small (~8 KB
  instead of ~70 KB). Tradeoff is two build configurations vs. one.
  Deferred until bundle size actually matters.
