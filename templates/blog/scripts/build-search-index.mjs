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
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// Next.js 16 app-router builds emit server HTML under .next/server/app, named by
// route with any route group stripped, so a post at /blog/[slug] lands at
// blog/<slug>.html.
const siteDir = process.env.PAGEFIND_SITE_DIR ?? ".next/server/app";
const outputDir = process.env.PAGEFIND_OUTPUT_DIR ?? "public/pagefind";

// Declared once and used both to invoke Pagefind and to decide whether there is
// anything for it to read, so the two can never disagree about which pages are
// meant to be indexed.
const glob = "blog/**/*.html";
// The fixed prefix of the glob, i.e. every leading segment before the first
// wildcard. This is the directory Pagefind will search, derived from the pattern
// rather than restated beside it, so editing the glob moves the check with it.
const globSegments = glob.split("/");
const firstWildcard = globSegments.findIndex(segment => segment.includes("*"));
const globRoot = globSegments
  .slice(0, firstWildcard === -1 ? globSegments.length - 1 : firstWildcard)
  .join("/");

/**
 * Whether any `.html` exists beneath `dir`.
 *
 * Only a missing directory counts as "nothing to index". Every other failure —
 * a permissions problem, a path that is not a directory — is rethrown, because
 * "there are no posts" and "I could not look" are different answers and
 * collapsing them would report a broken build output as an empty blog.
 */
function containsHtml(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
  return entries.some(entry =>
    entry.isDirectory()
      ? containsHtml(join(dir, entry.name))
      : entry.name.endsWith(".html")
  );
}

// The site root is validated separately from the blog subtree. A missing blog/
// means no posts; a missing or unreadable SITE root means the build output is
// not where this script was told to look, which is a failure rather than an
// empty index.
function assertSiteDirUsable(dir) {
  let stats;
  try {
    stats = statSync(dir);
  } catch (err) {
    const hint =
      err.code === "ENOENT"
        ? "it does not exist — run `next build` first, or set PAGEFIND_SITE_DIR"
        : err.message;
    console.error(`\n✗ Cannot read the site directory ${dir}: ${hint}`);
    process.exit(1);
  }
  if (!stats.isDirectory()) {
    console.error(`\n✗ The site path ${dir} is not a directory.`);
    process.exit(1);
  }
}

assertSiteDirUsable(resolve(siteDir));
mkdirSync(resolve(outputDir), { recursive: true });

// A newly scaffolded project has no posts, so nothing renders under blog/ and
// Pagefind exits non-zero for an empty index. Failing the build there would mean
// a fresh project cannot build until someone publishes a post, so the empty case
// is reported and skipped while a genuine Pagefind failure below still stops the
// build.
if (!containsHtml(resolve(siteDir, globRoot))) {
  // The previous build's index is removed rather than left in place. Keeping it
  // would serve results for content that no longer exists — unpublishing the
  // last post would leave the deployed /search still listing it, with excerpts.
  rmSync(resolve(outputDir), { recursive: true, force: true });
  console.log(
    `\n• No pages matched ${glob} under ${siteDir} — removed any previous index.`
  );
  console.log(
    "  Publish a post and build again to generate it; /search reports that the"
  );
  console.log("  index is missing until then.");
  process.exit(0);
}

try {
  execSync(
    `npx -y pagefind --site ${siteDir} --output-path ${outputDir} --glob "${glob}"`,
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
