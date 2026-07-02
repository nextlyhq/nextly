import { cpSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

import { defineConfig } from "tsup";

/**
 * Four publishable entries, kept separate so `"use client"` never leaks into the
 * node-safe (`.`) or server-first (`./render`) bundles:
 *   - src/index.ts        → "."       (isomorphic core: types, tree, registry, compiler)
 *   - src/render/index.ts → "./render" (server-first renderer; NO getNextly import)
 *   - src/admin/index.ts  → "./admin"  ("use client" editor)
 * Peers (nextly, admin, react, …) are external by default (tsup externalizes node_modules).
 */
export default defineConfig({
  entry: ["src/index.ts", "src/admin/index.ts", "src/render/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
  async onSuccess() {
    const src = join(process.cwd(), "src/styles");
    const dist = join(process.cwd(), "dist/styles");
    if (existsSync(src)) {
      mkdirSync(dist, { recursive: true });
      cpSync(src, dist, { recursive: true });
    }
  },
});
