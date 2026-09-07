#!/usr/bin/env node
/**
 * A module that runs in a browser must not be able to reach the database driver.
 *
 * The admin is a hybrid package: most of it renders on the server and may import anything, while a
 * `"use client"` module is compiled into a browser bundle. `nextly` publishes both kinds of entry —
 * `nextly/runtime` legitimately reaches the ORM, `nextly/config` legitimately does not — so the rule
 * cannot be "the admin must not import the ORM". It is narrower and exact: whatever a `"use client"`
 * module imports must itself reach no database package.
 *
 * 🔴 The graph is read from SOURCE, not from a build. A bundler is free to split a leak into a
 * chunk that only loads under a condition, so a built artefact can hide an import the source
 * plainly has; and a check that reads `dist` passes whenever `dist` is stale, which is the state a
 * lint step is usually in. Source has neither failure mode and needs nothing built.
 *
 * 🔴 Type-only imports are erased before anything runs, so they are stripped before the graph is
 * walked. Counting them would flag every entry that merely names a database type, which is most of
 * them, and a rule that fires on correct code stops being read.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Packages that mean "this can talk to a database".
 *
 * The driver names are the ones the three adapter packages actually declare, read from their
 * manifests rather than recalled, so the list cannot quietly fall behind a dialect the repository
 * gained. Each is anchored whole or at a subpath boundary: `pg` must not match `pg-boss` and
 * `postgres` must not match `postgres-array`, both of which are ordinary libraries.
 */
export const DATABASE_PACKAGE_PATTERN =
  /^(?:drizzle-orm(?:\/|$)|@nextlyhq\/adapter-|(?:pg|postgres|mysql2|better-sqlite3)(?:\/|$))/;

/**
 * Drop the imports and exports that carry no value at runtime.
 *
 * `import { sql, type SQL } from "x"` still loads `x` and is deliberately kept: only a statement
 * whose `type` keyword governs the WHOLE clause disappears.
 */
export function stripTypeOnly(source) {
  return source
    .replace(/^\s*import\s+type\s[\s\S]*?from\s*["'][^"']+["']\s*;?/gm, "")
    .replace(/^\s*export\s+type\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["']\s*;?/gm, "");
}

/** Every specifier a module loads at runtime, in source order. */
export function parseValueImports(source) {
  const text = stripTypeOnly(source);
  const specifiers = [];
  const pattern =
    /(?:^|\n)\s*(?:import|export)[^"';]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    specifiers.push(match[1] ?? match[2]);
  }
  return specifiers;
}

/**
 * Turn a relative specifier into the file it names.
 *
 * Returns null when nothing resolves. A caller must treat that as a failure to answer rather than
 * as "reaches nothing": an unresolved import is an unwalked subtree, and reporting it as clean is
 * how a guard passes over the very thing it exists to find.
 */
export function resolveRelative(fromFile, specifier, exists) {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (exists(candidate) && !candidate.endsWith("/")) return candidate;
  }
  return null;
}

/**
 * Every external package an entry reaches, following relative imports transitively.
 *
 * `unresolved` is returned beside the packages rather than logged, so a caller can fail on it. A
 * silent skip here would make the answer depend on how well this resolver happens to match the
 * compiler's.
 */
export function traceExternals(entryFile, { read, exists }) {
  const visited = new Set();
  const externals = new Set();
  const unresolved = [];

  const walk = file => {
    if (visited.has(file)) return;
    visited.add(file);
    let source;
    try {
      source = read(file);
    } catch {
      unresolved.push(file);
      return;
    }
    for (const specifier of parseValueImports(source)) {
      if (!specifier.startsWith(".")) {
        externals.add(specifier);
        continue;
      }
      const target = resolveRelative(file, specifier, exists);
      if (target === null) unresolved.push(`${file} -> ${specifier}`);
      else walk(target);
    }
  };

  walk(entryFile);
  return { externals, unresolved, visited };
}

/** The database packages an entry can reach, empty when it is safe for a browser. */
export function databaseReach(externals) {
  return [...externals].filter(name => DATABASE_PACKAGE_PATTERN.test(name)).sort();
}

/**
 * Map a published subpath to the source file behind it.
 *
 * The export map names built artefacts, and this rule reads source, so the two are related by the
 * build's own layout: `dist/a/b.mjs` is emitted from `src/a/b.ts`. The mapping is asserted rather
 * than assumed — a subpath whose source cannot be found is reported, never skipped.
 */
export function sourceFileForExport(distPath, packageDir, exists) {
  const candidate = join(
    packageDir,
    distPath.replace(/^\.\//, "").replace(/^dist\//, "src/").replace(/\.mjs$/, ".ts")
  );
  return exists(candidate) ? candidate : null;
}

/** Which published subpaths a browser may import, and which it may not. */
export function classifyEntries(packageJson, packageDir, io) {
  const safe = new Map();
  const unsafe = new Map();
  const unmapped = [];

  for (const [subpath, target] of Object.entries(packageJson.exports ?? {})) {
    const distPath = typeof target === "object" && target !== null ? target.import : null;
    if (typeof distPath !== "string") continue;
    const specifier = subpath === "." ? "nextly" : `nextly${subpath.slice(1)}`;

    const sourceFile = sourceFileForExport(distPath, packageDir, io.exists);
    if (sourceFile === null) {
      unmapped.push(specifier);
      continue;
    }
    const { externals, unresolved } = traceExternals(sourceFile, io);
    if (unresolved.length > 0) unmapped.push(`${specifier} (unresolved: ${unresolved[0]})`);
    const reach = databaseReach(externals);
    if (reach.length > 0) unsafe.set(specifier, reach);
    else safe.set(specifier, sourceFile);
  }

  return { safe, unsafe, unmapped };
}

/**
 * Whether a module carries the client directive.
 *
 * 🔴 The directive must be the first STATEMENT, which is not the same as the first line: a file may
 * open with a licence header or a doc comment and still be a client module. Anchoring on byte zero
 * silently skips those, and a guard that skips files reports a clean tree it never read.
 */
export function declaresUseClient(source) {
  let rest = source;
  for (;;) {
    const trimmed = rest.replace(/^[\s\uFEFF]+/, "");
    if (trimmed.startsWith("//")) {
      rest = trimmed.slice(trimmed.indexOf("\n") + 1);
      continue;
    }
    if (trimmed.startsWith("/*")) {
      const end = trimmed.indexOf("*/");
      if (end === -1) return false;
      rest = trimmed.slice(end + 2);
      continue;
    }
    return /^["']use client["']/.test(trimmed);
  }
}

/** Every client module under a directory. */
export function clientFiles(dir, io) {
  const found = [];
  const walk = current => {
    for (const name of io.readdir(current)) {
      const full = join(current, name);
      if (io.isDirectory(full)) {
        if (name !== "node_modules" && name !== "dist") walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name)) continue;
      const source = io.read(full);
      if (declaresUseClient(source)) found.push([full, source]);
    }
  };
  walk(dir);
  return found;
}

/** Where a browser bundle imports something that can reach a database. */
export function findViolations(files, unsafeEntries) {
  const violations = [];
  let importSites = 0;
  for (const [file, source] of files) {
    for (const specifier of parseValueImports(source)) {
      if (specifier !== "nextly" && !specifier.startsWith("nextly/")) continue;
      importSites += 1;
      const reach = unsafeEntries.get(specifier);
      if (reach) violations.push({ file, specifier, reach });
    }
  }
  return { violations, importSites };
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const io = {
  read: file => readFileSync(file, "utf8"),
  exists: file => existsSync(file) && statSync(file).isFile(),
  readdir: dir => readdirSync(dir),
  isDirectory: path => statSync(path).isDirectory(),
};

export function run() {
  const packageDir = join(repoRoot, "packages/nextly");
  const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const { safe, unsafe, unmapped } = classifyEntries(packageJson, packageDir, io);
  const files = clientFiles(join(repoRoot, "packages/admin/src"), io);
  const { violations, importSites } = findViolations(files, unsafe);

  if (unmapped.length > 0) {
    console.error(
      `client entry graph: ${unmapped.length} published subpath(s) could not be read, so this run ` +
        `proves nothing about them:\n` +
        unmapped.map(name => `  ${name}`).join("\n")
    );
    process.exit(1);
  }

  if (violations.length === 0) {
    console.log(
      `client entry graph: ${files.length} "use client" file(s), ${importSites} nextly import(s), ` +
        `none reaching a database package. ${safe.size} browser-safe subpath(s), ` +
        `${unsafe.size} server-only.`
    );
    process.exit(0);
  }

  console.error(`\nclient entry graph: ${violations.length} violation(s)\n`);
  for (const { file, specifier, reach } of violations) {
    console.error(`  ${relative(repoRoot, file)}`);
    console.error(`    imports ${specifier}, which reaches ${reach.join(", ")}`);
  }
  console.error(
    `\nA "use client" module is compiled into a browser bundle, so everything it imports ships to ` +
      `the browser. Either import a subpath that reaches no database package, or split the part ` +
      `the client needs into one that does not.\n`
  );
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
