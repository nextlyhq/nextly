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

import { realpathSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

/**
 * This file's directory, with symlinks resolved. ONE definition, shared by the
 * guard import and by the CSS paths below, which have to agree about where
 * this script lives.
 *
 * From `realpathSync`, because under `--preserve-symlinks-main`
 * `import.meta.url` is the SYMLINK. Resolving only the import and leaving the
 * paths on the preserved URL is the worse half-fix: the guard then runs the
 * CLI block and the build reads `src/styles/globals.css` beside the link,
 * failing with `ENOENT` for a reason that names the wrong file.
 */
const __dirname = path.dirname(realpathSync(fileURLToPath(import.meta.url)));

const { isCliEntry } = await import(
  pathToFileURL(
    path.join(__dirname, "..", "..", "..", "scripts", "cli-entry.mjs")
  ).href
);

// Scoping lives in @nextlyhq/admin-css so this build and the plugin-facing
// CLI share one implementation and cannot drift. The release build
// (build-css.mjs) resolves it the same way.
import {
  confineVariantClasses,
  findUnconfinedVariants,
  findUnscopedRules,
  scopeCss,
} from "@nextlyhq/admin-css";

import { cssPaths } from "./css-paths.mjs";

const rootDir = path.resolve(__dirname, "..");
const { inputFile, outputDir, outputFile } = cssPaths(rootDir);

// Reuse the processor across calls — Tailwind v4's content-scan caches
// live inside the plugin instance and amortise across rebuilds.
const processor = postcss([tailwindcss()]);

/**
 * Build the admin sheet in-process.
 *
 * `inputCss`/`outputFile` override the real entry points, for tests of this
 * pipeline's report: the report has to be exercised over a sheet chosen to
 * contain what it should catch, not the real one, which contains none.
 */
export async function buildCssFast(
  { inputCss, outputFile: out = outputFile } = {}
) {
  const start = performance.now();
  const source = inputCss ?? (await fs.readFile(inputFile, "utf-8"));
  const result = await processor.process(source, {
    from: inputFile,
    to: out,
  });
  // Same order as the release build: scope every rule, then confine the
  // variant ancestor references (`.dark`, `.group`, `.peer`) to the wrapper.
  const scoped = confineVariantClasses(scopeCss(result.css));
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, scoped);
  const ms = Math.round(performance.now() - start);
  const sizeKB = (Buffer.byteLength(scoped) / 1024).toFixed(1);
  // Reported, not thrown: the production build fails on a leak, but killing a
  // watcher mid-session would cost more than the warning is worth. Surfacing
  // it here means a leak is seen when it is introduced rather than at release.
  const unscoped = findUnscopedRules(scoped);
  const unconfinedVariants = findUnconfinedVariants(scoped);
  return { ms, sizeKB, outputFile: out, unscoped, unconfinedVariants };
}

// Direct CLI invocation: `node scripts/build-css-fast.mjs`
if (isCliEntry(import.meta.url)) {
  const { ms, sizeKB, outputFile: out } = await buildCssFast();
  console.log(`[admin:css] ${sizeKB} KB in ${ms}ms → ${out}`);
}
