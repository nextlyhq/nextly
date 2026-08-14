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
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

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

/**
 * Records which entries THIS script created inside the output directory.
 *
 * The cleanup below has to remove a previous index without removing anything
 * else, and neither the path nor a marker file can establish that. A marker
 * proves Pagefind wrote *something* here; it does not prove the directory is
 * exclusively Pagefind's — point `PAGEFIND_OUTPUT_DIR` at `public`, build once
 * with posts, and Pagefind writes its marker among the site's own assets. A
 * later empty build would then read the marker as permission to delete them.
 *
 * So ownership is recorded rather than inferred: the entries present before a
 * run are compared with those after it, and only the difference is ever
 * removed. Anything that was already there is not this script's to delete.
 */
const MANIFEST = ".nextly-search-index.json";

/** Top-level entry names in `dir`, or an empty list when it does not exist. */
function entriesOf(dir) {
  try {
    return readdirSync(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/** Record the entries a successful run added, so a later run can remove them. */
function recordCreatedEntries(dir, before) {
  const added = entriesOf(dir).filter(
    entry => !before.includes(entry) && entry !== MANIFEST
  );
  try {
    writeFileSync(
      join(dir, MANIFEST),
      `${JSON.stringify({ entries: added }, null, 2)}\n`,
      "utf-8"
    );
  } catch (err) {
    console.warn(
      `  (could not record the index manifest: ${err instanceof Error ? err.message : String(err)})`
    );
  }
}

/**
 * Remove exactly the entries a previous run created, and nothing else.
 *
 * Returns true when something was removed. Without a manifest nothing is
 * touched: an index written before this script recorded its output cannot be
 * distinguished from a directory of unrelated files, and guessing there is what
 * deletes a user's assets.
 */
function removePreviousIndex(dir) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, MANIFEST), "utf-8"));
  } catch {
    if (entriesOf(dir).length > 0) {
      console.log(
        `\n• ${dir} has no ${MANIFEST}, so this script cannot tell which files ` +
          "it created — leaving them untouched rather than guessing."
      );
    }
    return false;
  }

  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const root = resolve(dir);
  for (const entry of entries) {
    // Each path is confined to the output directory, so a manifest carrying
    // `..` or an absolute path cannot reach outside it.
    const target = resolve(root, entry);
    if (target !== root && !target.startsWith(root + sep)) continue;
    rmSync(target, { recursive: true, force: true });
  }
  rmSync(join(root, MANIFEST), { force: true });

  // The directory itself goes only when this script's entries were all of it.
  if (entriesOf(root).length === 0) rmSync(root, { recursive: true, force: true });
  return entries.length > 0;
}

/**
 * Where the search page looks to tell an EXPECTED empty index from a missing
 * build. Without it the two are indistinguishable at runtime — both leave
 * `/pagefind/pagefind.js` absent — and the page tells a user who just ran a
 * successful build to run the build, which can never produce an index until a
 * post exists.
 *
 * Written outside the Pagefind output directory, because that directory is
 * removed when the index is empty.
 */
const STATUS_PATH = process.env.PAGEFIND_STATUS_FILE ?? "public/search-status.json";

function writeStatus(state) {
  try {
    mkdirSync(dirname(resolve(STATUS_PATH)), { recursive: true });
    writeFileSync(
      resolve(STATUS_PATH),
      `${JSON.stringify({ state }, null, 2)}\n`,
      "utf-8"
    );
  } catch (err) {
    // The status file is a nicety for the empty state, not part of the build's
    // contract, so a failure to write it must not fail an otherwise good build.
    console.warn(
      `  (could not write ${STATUS_PATH}: ${err instanceof Error ? err.message : String(err)})`
    );
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
  // A previous build's index is removed rather than left in place: keeping it
  // would serve results for content that no longer exists, so unpublishing the
  // last post would leave the deployed /search still listing it with excerpts.
  const removed = removePreviousIndex(resolve(outputDir));
  writeStatus("empty");
  console.log(
    `\n• No pages matched ${glob} under ${siteDir} — nothing to index.` +
      (removed ? " Removed the previous index." : "")
  );
  console.log("  Publish a post and build again to generate one.");
  process.exit(0);
}

// Captured BEFORE the run so the manifest records only what this run adds. In a
// directory that already holds unrelated files, that difference is the whole of
// what may later be removed.
const entriesBefore = entriesOf(resolve(outputDir));

try {
  execSync(
    `npx -y pagefind --site ${siteDir} --output-path ${outputDir} --glob "${glob}"`,
    { stdio: "inherit" }
  );
  recordCreatedEntries(resolve(outputDir), entriesBefore);
  writeStatus("built");
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
