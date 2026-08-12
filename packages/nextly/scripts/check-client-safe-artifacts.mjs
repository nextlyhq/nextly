#!/usr/bin/env node
/**
 * Client-safe entry points reach no Node built-in, checked against the BUILT output.
 *
 * `packages/admin` imports several `nextly` subpaths from `"use client"` components. A Node
 * built-in anywhere in what those subpaths pull in is not a heavier bundle — it is a module the
 * browser build cannot resolve, so the failure is a broken admin panel rather than a slow one.
 *
 * Nothing enforced this before. `dist/config.mjs` has been free of built-ins and 60-odd client
 * components have depended on that, but `verify-exports.ts` and `verify-dts.ts` sit in this
 * directory referenced by nothing — not `package.json`, not CI — and `verify-exports` snapshots
 * export NAMES in any case, saying nothing about what they import. The property was true and
 * unguarded, which means it was true until someone edited an import.
 *
 * ## Why the artifact and not the source
 *
 * A source scan has to predict the bundler: which specifier a bare import resolves to, whether a
 * type-only import is erased, whether a re-export is dropped, which modules are folded into a
 * shared chunk. `dist` has already decided all of it. Reading the built graph asks the question
 * the browser will actually ask.
 *
 * Following chunks is the part that cannot be skipped. tsup hoists shared code into
 * `chunk-*.mjs`, so an entry file is usually a few re-exports and imports; checking the entry
 * alone reports clean while a chunk it pulls carries the built-in. Every entry here currently
 * reaches four chunks.
 *
 * ## What this does NOT check
 *
 * A bundled-IN third-party dependency leaves no specifier at all, so this cannot see one, and the
 * bundler metafile would be needed for that question. It is sound for the question it does ask:
 * a Node built-in can never be inlined, because there is nothing to inline — it always survives as
 * a `node:` specifier, in the entry or in a chunk.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const dist = join(pkgRoot, "dist");

/**
 * Entry points a browser bundle may reach, by their export-map path.
 *
 * Kept as export-map keys rather than dist filenames so the list is checkable against
 * `package.json`: an entry named here that the map does not export is a typo, and this refuses to
 * run rather than reporting a pass for a file it never opened.
 */
const CLIENT_SAFE_EXPORTS = ["./config", "./next", "./field-group-type"];

const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));

/** Every relative specifier in a built module, ignoring bare and `node:` ones. */
const SPECIFIER = /from\s*["']([^"']+)["']|import\s*["']([^"']+)["']/g;

function walk(entryFile) {
  const seen = new Set();
  const builtins = [];
  const stack = [entryFile];

  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    if (!existsSync(file)) {
      throw new Error(
        `check-client-safe-artifacts: ${relative(pkgRoot, file)} does not exist. ` +
          `Build before running this.`
      );
    }
    seen.add(file);

    const src = readFileSync(file, "utf8");
    SPECIFIER.lastIndex = 0;
    let match;
    while ((match = SPECIFIER.exec(src)) !== null) {
      const spec = match[1] ?? match[2];
      if (!spec) continue;
      if (spec.startsWith("node:")) {
        builtins.push({ file: relative(pkgRoot, file), spec });
        continue;
      }
      // Bare specifiers are external dependencies; a browser bundler resolves those itself, and
      // whether a given package is browser-safe is that package's contract rather than this one's.
      if (!spec.startsWith(".")) continue;
      stack.push(normalize(join(dirname(file), spec)));
    }
  }

  return { modules: seen, builtins };
}

let failures = 0;

// Vacuity control. An empty or mistyped list makes every check below vacuous, and a scan with
// nothing to scan exits 0 — indistinguishable from a clean run. Fail loudly instead.
if (CLIENT_SAFE_EXPORTS.length === 0) {
  console.error("✗ no client-safe entry points declared — nothing was checked");
  process.exit(1);
}

for (const exportKey of CLIENT_SAFE_EXPORTS) {
  const entry = pkg.exports?.[exportKey]?.import;
  if (!entry) {
    console.error(
      `✗ ${exportKey} is not exported by package.json — this list is out of date`
    );
    failures++;
    continue;
  }

  const entryFile = join(pkgRoot, entry);
  const { modules, builtins } = walk(entryFile);

  // Second vacuity control, and the one that matters in practice: an entry that resolved to a file
  // with no imports at all would report clean without ever reaching the code it re-exports. Every
  // real entry here pulls at least one chunk.
  if (modules.size < 2) {
    console.error(
      `✗ ${exportKey} reached only ${modules.size} built module(s) — ` +
        `expected the entry plus at least one chunk, so this check read less than it should`
    );
    failures++;
    continue;
  }

  if (builtins.length > 0) {
    failures++;
    console.error(`✗ ${exportKey} reaches Node built-ins:`);
    for (const { file, spec } of builtins) {
      console.error(`    ${spec}  in ${file}`);
    }
  } else {
    console.log(`✓ ${exportKey} (${modules.size} built modules, no node: built-ins)`);
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} client-safe entry point(s) reach Node built-ins.\n` +
      `A "use client" component importing one of these gets a module the browser build cannot ` +
      `resolve. Move the Node-dependent code behind a server-only entry point.`
  );
  process.exit(1);
}
console.log("\nClient-safe artifact check passed.");
