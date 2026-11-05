import { cpSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

import { defineConfig } from "tsdown";

/**
 * Publishable entries, kept separate so `"use client"` never leaks into the
 * node-safe (`.`) bundle:
 *   - src/index.ts        → "."        (isomorphic: the field, plugin, collections)
 *   - src/blocks/index.ts → "./blocks" (the registry a plugin contributes through)
 *   - src/admin/index.ts  → "./admin"  ("use client"; the blocks field's summary)
 *   - src/canvas/index.tsx → "./canvas" ("use client"; the site's canvas route page)
 *
 * There was a `./render` entry, and a separate one for its error boundary — the
 * single client island inside an otherwise server-first renderer. Both are gone
 * with the renderer itself: blocks draw through `@nextlyhq/blocks-react`, which
 * owns that boundary now, so this package emits no renderer to isolate.
 *
 * Peers (nextly, admin, react, …) are external by default (tsdown externalizes
 * dependencies and peer dependencies).
 */
// The removed renderer's error boundary was the one client island whose
// `"use client"` directive did not survive the build, so `onSuccess` re-applied
// it by searching the output for that class's marker method. Nothing carries the
// marker now, and the remaining client entry keeps its directive through the
// build unaided — verified on the emitted `dist/admin/index.js` rather than
// assumed, since a stripped directive fails only when a Server Component
// imports it.

export default defineConfig({
  // Four entries, where there were five. The renderer and its error boundary
  // were this package's own, built beside `@nextlyhq/blocks-react` rather than
  // on it, so neither has a bundle here to emit. `./admin` survives carrying one
  // component — the blocks field's summary — where it used to carry the editor.
  // `./canvas` is the one entry a site's own route imports: the page its canvas
  // route serves, a client component small enough to load in front of the
  // site's layout without the editor.
  entry: [
    "src/index.ts",
    "src/blocks/index.ts",
    "src/admin/index.ts",
    "src/canvas/index.tsx",
  ],
  format: ["esm"],
  // `.js` and `.d.ts`, the names the exports map already publishes.
  fixedExtension: false,
  // Declarations without a type check: `check-types` is the type check.
  // oxc writes the declarations from the source's own annotations
  // (`isolatedDeclarations` in tsconfig.json). Named rather than left to the
  // plugin's choice, which picks `tsc` (or `tsgo` under TypeScript 7) without
  // saying so when the flag is off.
  dts: { generator: "oxc", sourcemap: false },
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
  /*
   * Stylesheets stay as imports. They are copied into `dist/styles` below, not
   * bundled, so the admin entry's `import "../styles/editor.css"` has to reach
   * the host's bundler as written — which then loads the copied file, resolving
   * its `@import` of the builder's sheet as an app's own import of it would.
   */
  external: [/\.css$/],
  onSuccess() {
    // Copy the editor stylesheet.
    const src = join(process.cwd(), "src/styles");
    const dist = join(process.cwd(), "dist/styles");
    if (existsSync(src)) {
      mkdirSync(dist, { recursive: true });
      cpSync(src, dist, { recursive: true });
    }
  },
});
