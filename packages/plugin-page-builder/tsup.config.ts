import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";

import { defineConfig } from "tsup";

/**
 * Publishable entries, kept separate so `"use client"` never leaks into the node-safe
 * (`.`) or server-first (`./render`) bundles:
 *   - src/index.ts        → "."       (isomorphic core: types, tree, registry, compiler)
 *   - src/render/index.ts → "./render" (server-first renderer; NO getNextly import)
 *   - src/admin/index.ts  → "./admin"  ("use client" editor)
 *
 * `src/render/ErrorBoundary.tsx` is its OWN entry: it is the single client island inside
 * the otherwise-server-first renderer (a class component with `getDerivedStateFromError`).
 * Isolating it as an entry keeps the block renderers server-side, while the `onSuccess`
 * step stamps `"use client"` back onto just that file — esbuild strips source directives,
 * so a server component importing it would otherwise fail Next's RSC boundary check.
 *
 * Peers (nextly, admin, react, …) are external by default (tsup externalizes node_modules).
 */
/** Marker unique to the client island (the error-boundary class component). */
const CLIENT_ISLAND_MARKER = "getDerivedStateFromError";

/** Recursively list every emitted .js file under dist/. */
function distJsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...distJsFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/admin/index.ts",
    "src/render/index.ts",
    "src/render/ErrorBoundary.tsx",
  ],
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
    // Re-add the `"use client"` directive esbuild strips — onto every emitted file that
    // carries the client island (the entry file AND the shared chunk it lands in), so a
    // Server Component importing the renderer passes Next's RSC boundary check.
    const distDir = join(process.cwd(), "dist");
    for (const file of distJsFiles(distDir)) {
      const content = readFileSync(file, "utf8");
      if (
        content.includes(CLIENT_ISLAND_MARKER) &&
        !content.startsWith('"use client"')
      ) {
        writeFileSync(file, `"use client";\n${content}`);
      }
    }
  },
});
