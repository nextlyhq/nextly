#!/usr/bin/env node

/**
 * Fast in-process CSS build for the admin dev loop.
 *
 * Same semantics as scripts/build-css.mjs (Tailwind v4 compile +
 * .nextly-admin scoping post-process) but runs everything in-process —
 * no `npx` spawn, no separate `--minify` pass — and reuses the
 * postcss processor across calls so Tailwind v4's content-scan
 * caches stick between rebuilds.
 *
 *   cold start: ~250ms
 *   hot rebuild: ~50ms
 *   spawn-based path it replaces in dev: 16-40s
 *
 * Production builds continue to use scripts/build-css.mjs (which adds
 * the explicit minify pass). The dist/styles/globals.css written here
 * is a *source asset* for the playground bundle; Next.js minifies its
 * CSS bundle in production builds, so dropping the standalone minify
 * step in dev only affects the bytes-on-disk size of the dist file
 * (~260 KB unminified vs ~235 KB minified).
 *
 * Importable: `import { buildCssFast } from "./build-css-fast.mjs"`
 * Or run directly: `node scripts/build-css-fast.mjs`
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

// Scoping lives in @nextlyhq/admin-css so this build and the plugin-facing
// CLI share one implementation and cannot drift. The release build
// (build-css.mjs) resolves it the same way.
import { findUnscopedRules, scopeCss } from "@nextlyhq/admin-css";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const inputFile = path.join(rootDir, "src/styles/globals.css");
const outputDir = path.join(rootDir, "dist/styles");
const outputFile = path.join(outputDir, "globals.css");

// Reuse the processor across calls — Tailwind v4's content-scan caches
// live inside the plugin instance and amortise across rebuilds.
const processor = postcss([tailwindcss()]);

export async function buildCssFast() {
  const start = performance.now();
  const inputCss = await fs.readFile(inputFile, "utf-8");
  const result = await processor.process(inputCss, {
    from: inputFile,
    to: outputFile,
  });
  const scoped = scopeCss(result.css);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputFile, scoped);
  const ms = Math.round(performance.now() - start);
  const sizeKB = (Buffer.byteLength(scoped) / 1024).toFixed(1);
  // Reported, not thrown: the production build fails on a leak, but killing a
  // watcher mid-session would cost more than the warning is worth. Surfacing
  // it here means a leak is seen when it is introduced rather than at release.
  const unscoped = findUnscopedRules(scoped);
  return { ms, sizeKB, outputFile, unscoped };
}

// Direct CLI invocation: `node scripts/build-css-fast.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { ms, sizeKB, outputFile: out } = await buildCssFast();
  console.log(`[admin:css] ${sizeKB} KB in ${ms}ms → ${out}`);
}
