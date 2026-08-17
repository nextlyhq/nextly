import { cpSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

import { defineConfig } from "tsup";

/**
 * Publishable entries, kept separate so `"use client"` never leaks into the
 * node-safe (`.`) bundle:
 *   - src/index.ts        → "."        (isomorphic: the field, plugin, collections)
 *   - src/blocks/index.ts → "./blocks" (the registry a plugin contributes through)
 *   - src/admin/index.ts  → "./admin"  ("use client"; the blocks field's summary)
 *
 * There was a `./render` entry, and a separate one for its error boundary — the
 * single client island inside an otherwise server-first renderer. Both are gone
 * with the renderer itself: blocks draw through `@nextlyhq/blocks-react`, which
 * owns that boundary now, so this package emits no renderer to isolate.
 *
 * Peers (nextly, admin, react, …) are external by default (tsup externalizes
 * node_modules).
 */
// The removed renderer's error boundary was the one client island whose
// `"use client"` directive did not survive the build, so `onSuccess` re-applied
// it by searching the output for that class's marker method. Nothing carries the
// marker now, and the remaining client entry keeps its directive through the
// build unaided — verified on the emitted `dist/admin/index.js` rather than
// assumed, since a stripped directive fails only when a Server Component
// imports it.

export default defineConfig({
  // Two entries, where there were five. The editor and the renderer were this
  // package's own, built beside `@nextlyhq/builder` and `@nextlyhq/blocks-react`
  // rather than on them; the editor is now the former and blocks draw through
  // the latter, so neither has a bundle here to emit.
  entry: ["src/index.ts", "src/blocks/index.ts", "src/admin/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
  async onSuccess() {
    // Copy the editor stylesheet.
    const src = join(process.cwd(), "src/styles");
    const dist = join(process.cwd(), "dist/styles");
    if (existsSync(src)) {
      mkdirSync(dist, { recursive: true });
      cpSync(src, dist, { recursive: true });
    }
  },
});
