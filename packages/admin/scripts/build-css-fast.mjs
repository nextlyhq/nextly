#!/usr/bin/env node

/**
 * Fast in-process CSS build for the admin dev loop.
 *
 * Same semantics as scripts/build-css.mjs (Tailwind v4 compile +
 * .adminapp scoping post-process) but runs everything in-process —
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const inputFile = path.join(rootDir, "src/styles/globals.css");
const outputDir = path.join(rootDir, "dist/styles");
const outputFile = path.join(outputDir, "globals.css");

// Reuse the processor across calls — Tailwind v4's content-scan caches
// live inside the plugin instance and amortise across rebuilds.
const processor = postcss([tailwindcss()]);

// .adminapp scoping — same logic as scripts/build-css.mjs. Duplicated
// here on purpose so the dev and production build pipelines can evolve
// independently if we ever need different isolation behaviour. If/when
// they stabilise, this can be hoisted into a shared module.
const ALREADY_SCOPED = [
  /^\.adminapp/,
  /^\.dark\s*\.adminapp/,
  /^\.adminapp\.dark/,
  /^:root/,
  /^\*/,
  /^html/,
  /^body/,
  /^@keyframes/,
  /^@font-face/,
  /^@media/,
  /^@supports/,
  /^@layer/,
  /^@property/,
];

function scopeSelector(selector) {
  selector = selector.trim();
  for (const p of ALREADY_SCOPED) {
    if (p.test(selector)) return selector;
  }
  if (selector.startsWith("@")) return selector;
  if (selector === ":root") return ".adminapp";
  if (selector === "*" || selector === "*::before" || selector === "*::after") {
    return `.adminapp ${selector}`;
  }
  if (selector.includes(",")) {
    return selector
      .split(",")
      .map(s => scopeSelector(s.trim()))
      .join(", ");
  }
  return `.adminapp ${selector}`;
}

function scopeCss(css) {
  const lines = css.split("\n");
  const out = [];
  let inKeyframes = false;
  let braceCount = 0;

  for (const line of lines) {
    if (line.includes("@keyframes")) {
      inKeyframes = true;
      out.push(line);
      continue;
    }
    if (inKeyframes) {
      braceCount += (line.match(/{/g) || []).length;
      braceCount -= (line.match(/}/g) || []).length;
      if (braceCount <= 0) {
        inKeyframes = false;
        braceCount = 0;
      }
      out.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (
      trimmed.startsWith("@media") ||
      trimmed.startsWith("@supports") ||
      trimmed.startsWith("@layer") ||
      trimmed.startsWith("@font-face") ||
      trimmed.startsWith("@property")
    ) {
      out.push(line);
      continue;
    }
    if (line.includes("{") && !trimmed.startsWith("@")) {
      const [selector, ...rest] = line.split("{");
      if (selector.includes(".adminapp") || selector.trim().startsWith("--")) {
        out.push(line);
        continue;
      }
      out.push(`${scopeSelector(selector)}{${rest.join("{")}`);
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

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
  return { ms, sizeKB, outputFile };
}

// Direct CLI invocation: `node scripts/build-css-fast.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { ms, sizeKB, outputFile: out } = await buildCssFast();
  console.log(`[admin:css] ${sizeKB} KB in ${ms}ms → ${out}`);
}
