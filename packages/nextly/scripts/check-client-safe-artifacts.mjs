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

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
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
const CLIENT_SAFE_EXPORTS = [
  "./config",
  "./next",
  "./field-group-type",
  // Imported by the admin field pickers from "use client" components. It was already an
  // established client surface before this check existed, which is exactly why it belongs here:
  // an entry nobody is currently worried about is the one that regresses unnoticed.
  "./field-catalog",
];

const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));

/**
 * Whether a specifier names a Node built-in, in EITHER form it can appear in.
 *
 * 🔴 Checking only the `node:` prefix is what a source-level intuition suggests and it does not
 * survive bundling: tsup rewrites `node:crypto` to a bare `crypto`, so a check for the prefix finds
 * nothing in `dist` and reports every entry clean — including ones that genuinely pull half the
 * standard library. The prefixed form is still matched because an external or unbundled module can
 * preserve it.
 */
function isNodeBuiltin(spec) {
  if (spec.startsWith("node:")) return true;
  return builtinModules.includes(spec);
}

/** Every relative specifier in a built module, ignoring bare and `node:` ones. */
const SPECIFIER =
  /from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']|\b_{0,2}require\(\s*["']([^"']+)["']\s*\)/g;

function walk(entryFile) {
  const seen = new Set();
  const builtins = [];
  const missing = [];
  const stack = [entryFile];

  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    if (!existsSync(file)) {
      // Reported rather than thrown: a missing artifact is a verdict this check can state, and
      // routing it through the same failure path keeps every outcome one exit code.
      missing.push(relative(pkgRoot, file));
      continue;
    }
    seen.add(file);

    const src = readFileSync(file, "utf8");
    SPECIFIER.lastIndex = 0;
    let match;
    while ((match = SPECIFIER.exec(src)) !== null) {
      const spec = match[1] ?? match[2] ?? match[3] ?? match[4];
      if (!spec) continue;
      if (isNodeBuiltin(spec)) {
        builtins.push({ file: relative(pkgRoot, file), spec });
        continue;
      }
      // Bare specifiers are external dependencies; a browser bundler resolves those itself, and
      // whether a given package is browser-safe is that package's contract rather than this one's.
      // A relative path reached through require() is not followed either: esbuild emits those for
      // bundled CommonJS interop, where the target is already in this same output.
      if (!spec.startsWith(".") || match[4] !== undefined) continue;
      stack.push(normalize(join(dirname(file), spec)));
    }
  }

  return { modules: seen, builtins, missing };
}

/**
 * The scanner is exercised on a fixture it MUST reject, before it is trusted on real output.
 *
 * 🔴 This exists because the first version of this check was vacuous and passed everything. It
 * tested `spec.startsWith("node:")`, and tsup rewrites `node:crypto` to a bare `crypto` — there are
 * no `node:` specifiers anywhere in `dist`, so the check was hunting a string the bundler never
 * emits. It reported every entry clean and the failure was invisible, because a scan that matches
 * nothing and a codebase that is clean produce identical output.
 *
 * A vacuity control over the INPUT would not have caught it: there was plenty of input and it was
 * all read. What was missing was an input with a known answer that is not "nothing". Each form
 * below is one the bundler can actually emit, and the fixture is checked on every run, so a
 * scanner that stops recognising a form fails loudly instead of quietly certifying everything.
 */
function selfCheck() {
  const dir = mkdtempSync(join(tmpdir(), "nextly-artifact-gate-"));
  const forms = {
    "prefixed bare import": 'import "node:fs";\n',
    "prefixed from-specifier": 'export { x } from "node:path";\n',
    "stripped bare specifier": 'import { createHash } from "crypto";\n',
    "literal dynamic import": 'const f = await import("node:fs");\n',
    "esbuild CommonJS interop": 'const f = __require("node:fs");\n',
    "plain require call": 'const p = require("path");\n',
  };

  const problems = [];
  for (const [label, body] of Object.entries(forms)) {
    // Written as entry -> chunk so the fixture also proves the walk follows chunks: an entry-only
    // scan reports clean while the chunk carries the reference, which is the real output shape.
    const chunk = join(dir, `chunk-${problems.length}.mjs`);
    const entry = join(dir, `entry-${problems.length}.mjs`);
    writeFileSync(chunk, body);
    writeFileSync(entry, `import "./${chunk.split("/").pop()}";\n`);
    const { builtins } = walk(entry);
    if (builtins.length === 0) problems.push(label);
  }
  rmSync(dir, { recursive: true, force: true });

  if (problems.length > 0) {
    console.error(
      "✗ the scanner failed its own fixture — it cannot see these forms, so a pass below " +
        "would mean nothing:"
    );
    for (const label of problems) console.error(`    ${label}`);
    process.exit(1);
  }
  console.log(`✓ scanner fixture: ${Object.keys(forms).length} reference forms detected`);
}

let failures = 0;

selfCheck();


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
  const { modules, builtins, missing } = walk(entryFile);

  if (missing.length > 0) {
    failures++;
    console.error(`✗ ${exportKey} names built files that do not exist:`);
    for (const f of missing) console.error(`    ${f}`);
    console.error("    Build before running this check.");
    continue;
  }

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
  // Deliberately does not name a cause: this path is reached by a missing artifact and by a
  // Node built-in alike, and a summary that asserts the wrong one sends the reader to the wrong
  // question. The per-entry lines above say which.
  console.error(
    `\n${failures} client-safe entry point(s) failed the check. See the lines above.\n` +
      `Where a Node built-in is reported, a "use client" component importing that entry gets a ` +
      `module the browser build cannot resolve; move the Node-dependent code behind a ` +
      `server-only entry point.`
  );
  process.exit(1);
}
console.log("\nClient-safe artifact check passed.");
