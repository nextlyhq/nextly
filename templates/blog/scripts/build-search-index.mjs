#!/usr/bin/env node

/**
 * build-search-index.mjs
 *
 * Runs Pagefind against the Next.js build output to produce a static
 * search index under `public/pagefind/`. The SearchInput component
 * loads `/pagefind/pagefind.js` at runtime, which is served from
 * `public/` as a first-party origin.
 *
 * Why Pagefind:
 *   - Zero runtime cost: index is static JSON + WASM, loaded on demand.
 *   - Works offline, on static hosts, and on Vercel without any
 *     infrastructure changes.
 *   - Scales to tens of thousands of documents without server-side
 *     search infrastructure.
 *
 * This script is invoked from the template's build script:
 *   next build && node scripts/build-search-index.mjs
 */

import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Next.js 16 app-router builds emit server HTML under .next/server/app.
// Pagefind needs a directory of HTML to index. Point at the rendered
// output; fall back to .next if your build target differs.
const siteDir = process.env.PAGEFIND_SITE_DIR ?? ".next/server/app";
const outputDir = process.env.PAGEFIND_OUTPUT_DIR ?? "public/pagefind";

mkdirSync(resolve(outputDir), { recursive: true });

try {
  execSync(
    `npx -y pagefind --site ${siteDir} --output-path ${outputDir} --glob "blog/**/*.html"`,
    { stdio: "inherit" }
  );
  console.log(`\n✓ Search index written to ${outputDir}`);
} catch (err) {
  console.error("\n✗ Pagefind build failed.");
  console.error(
    "  Common causes: (1) `next build` hasn't run yet, (2) the site"
  );
  console.error(
    "  directory has no matching HTML. Set PAGEFIND_SITE_DIR to override."
  );
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
