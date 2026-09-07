#!/usr/bin/env node
/**
 * A module that runs in a browser must not be able to reach the database driver.
 *
 * The admin is a hybrid package: most of it renders on the server and may import anything, while a
 * `"use client"` module is compiled into a browser bundle. `nextly` publishes both kinds of entry —
 * `nextly/runtime` legitimately reaches the ORM, `nextly/config` legitimately does not — so the rule
 * cannot be "the admin must not import the ORM". It is narrower and exact.
 *
 * ## The boundary is the whole closure, not the directive line
 *
 * 🔴 In the App Router a `"use client"` file is where client code BEGINS, not where it ends:
 * everything it imports, and everything those import, is compiled into the same bundle. Checking
 * only the specifiers written in files carrying the directive misses every module one hop further
 * out, which is most of them — measured here at 836 files in the closure against 425 carrying the
 * directive. So this walks the closure, crossing into workspace packages by resolving their export
 * maps back to source, and reports the import chain that reached a database package.
 *
 * ## Source, not `dist`
 *
 * 🔴 A bundler is free to split a leak into a chunk that only loads under a condition, so a built
 * artefact can hide an import the source plainly has; and a check that reads `dist` passes whenever
 * `dist` is stale, which is the state a lint step is usually in. Source has neither failure mode and
 * needs nothing built.
 *
 * ## Parsed, not matched
 *
 * 🔴 Specifiers come from the TypeScript AST rather than a regular expression. A pattern over source
 * text cannot tell an import from a string that contains one, and this repository has a module whose
 * job is to PRINT `import { getNextly } from "nextly"` as example code for a reader — which a
 * regular expression reports as a violation of the very rule below. The same parse is what makes
 * `import type` disappear (erased before anything runs, so it cannot put code in a bundle) while
 * `import { a, type B }` stays, and what sees a dynamic `import()` at all.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

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

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

/**
 * Every specifier a module loads at runtime, plus whether it opens a client bundle.
 *
 * One parse answers both, so the two cannot disagree about what the file is.
 */
export function parseModule(source, fileName = "module.tsx") {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const specifiers = [];
  const visit = node => {
    if (ts.isImportDeclaration(node)) {
      // `import type { X } from "y"` is erased; `import { a, type B }` is not.
      if (!node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
    } else if (ts.isExportDeclaration(node)) {
      if (
        !node.isTypeOnly &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        specifiers.push(node.moduleSpecifier.text);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // 🔴 The directive must be the first STATEMENT, which is not the first line: a file may open with
  // a licence header or a doc comment and still be a client module. The parser settles this without
  // a comment-stripping pass of our own.
  const first = sourceFile.statements[0];
  const isClient = Boolean(
    first &&
      ts.isExpressionStatement(first) &&
      ts.isStringLiteral(first.expression) &&
      first.expression.text === "use client"
  );

  return { specifiers, isClient };
}

/**
 * The first of a module's candidate spellings that exists on disk.
 *
 * 🔴 A specifier ending `.js` is not a built file to look for. Under TypeScript's NodeNext
 * resolution the author writes the extension the OUTPUT will have while the source beside it is
 * `.ts`, and packages here do exactly that. Treating those as missing stops the walk at the first
 * such module and leaves everything past it unexamined.
 */
export function resolveFile(base, exists) {
  const stems = [base];
  const rewritten = base.replace(/\.(js|mjs|cjs)$/, "");
  if (rewritten !== base) stems.push(rewritten);

  const candidates = stems.flatMap(stem => [
    ...SOURCE_EXTENSIONS.map(extension => `${stem}${extension}`),
    join(stem, `index.ts`),
    join(stem, `index.tsx`),
  ]);
  // The bare path last: a directory named `x` must not win over a file `x.ts` beside it.
  candidates.push(base);
  return candidates.find(candidate => exists(candidate)) ?? null;
}

/**
 * Map a published subpath to the source behind it.
 *
 * The export map names built artefacts and this rule reads source, so the two are related by the
 * build's own layout: `dist/a/b.mjs` is emitted from `src/a/b.ts`.
 */
export function pickImportTarget(target) {
  if (typeof target === "string") return target;
  if (target === null || typeof target !== "object") return null;
  // Conditions nest, and packages here use both shapes: `{ types, import }` and
  // `{ import: { types, default } }`. Reading only the first level resolves one and reports the
  // other as unresolvable, which fails the run for a reason that is not the rule.
  for (const condition of ["import", "module", "default"]) {
    if (condition in target) {
      const resolved = pickImportTarget(target[condition]);
      if (resolved !== null) return resolved;
    }
  }
  return null;
}

export function sourceForSubpath(packageJson, packageDir, subpath, exists) {
  const distPath = pickImportTarget(packageJson.exports?.[subpath]);
  if (typeof distPath !== "string") return null;
  // A stylesheet or other asset ends the walk: it carries no imports and cannot reach a driver.
  if (!/\.(mjs|js|cjs)$/.test(distPath)) return { asset: true };
  const base = join(
    packageDir,
    distPath.replace(/^\.\//, "").replace(/^dist\//, "src/").replace(/\.(mjs|js)$/, "")
  );
  return resolveFile(base, exists);
}

/** Every workspace package, by the name other packages import it as. */
export function buildWorkspaceIndex(packagesDir, io) {
  const index = new Map();
  for (const name of io.readdir(packagesDir)) {
    const dir = join(packagesDir, name);
    const manifest = join(dir, "package.json");
    if (!io.isDirectory(dir) || !io.exists(manifest)) continue;
    const json = JSON.parse(io.read(manifest));
    if (json.name) index.set(json.name, { dir, json });
  }
  return index;
}

/**
 * Turn one specifier into the next thing to walk.
 *
 * `external` ends the walk and is what the rule is asked about; `unresolved` is neither, and a
 * caller must fail on it. An unresolved import is an unwalked subtree, and calling it clean is how a
 * guard passes over the very thing it exists to find.
 */
export function makeResolver({ adminSrc, workspace, exists }) {
  return (fromFile, specifier) => {
    if (specifier.startsWith(".")) {
      const file = resolveFile(resolve(dirname(fromFile), specifier), exists);
      return file ? { kind: "file", file } : { kind: "unresolved", specifier };
    }
    if (specifier.startsWith("@admin/")) {
      const file = resolveFile(join(adminSrc, specifier.slice("@admin/".length)), exists);
      return file ? { kind: "file", file } : { kind: "unresolved", specifier };
    }

    // Longest package name first, so `@nextlyhq/adapter-drizzle/types` is not read as a subpath of
    // some shorter neighbour.
    const owner = [...workspace.keys()]
      .filter(name => specifier === name || specifier.startsWith(`${name}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (owner === undefined) return { kind: "external", name: specifier };

    // A workspace package that can reach a database is the answer itself; there is nothing to gain
    // by walking into it, and its own manifest is the honest source for that.
    if (DATABASE_PACKAGE_PATTERN.test(specifier)) return { kind: "external", name: specifier };

    const { dir, json } = workspace.get(owner);
    const subpath = specifier === owner ? "." : `.${specifier.slice(owner.length)}`;
    const resolved = sourceForSubpath(json, dir, subpath, exists);
    if (resolved === null) return { kind: "unresolved", specifier };
    if (resolved.asset === true) return { kind: "asset", specifier };
    return { kind: "file", file: resolved };
  };
}

/**
 * Walk everything a set of client entries pulls into a browser bundle.
 *
 * Returns the chain that reached each database package, because "something in the admin reaches
 * drizzle" is not actionable and "this file, through these seven, does" is.
 */
export function walkClientClosure({ entries, resolveSpecifier, read }) {
  const parent = new Map();
  const visited = new Set();
  const unresolved = [];
  const violations = [];

  const chainTo = file => {
    const chain = [];
    for (let current = file; current !== undefined; current = parent.get(current)) {
      chain.push(current);
    }
    return chain;
  };

  const walk = file => {
    if (visited.has(file)) return;
    visited.add(file);
    let source;
    try {
      source = read(file);
    } catch {
      unresolved.push({ from: file, specifier: "(unreadable)" });
      return;
    }
    for (const specifier of parseModule(source, file).specifiers) {
      const next = resolveSpecifier(file, specifier);
      if (next.kind === "unresolved") {
        unresolved.push({ from: file, specifier });
        continue;
      }
      if (next.kind === "asset") continue;
      if (next.kind === "external") {
        if (DATABASE_PACKAGE_PATTERN.test(next.name)) {
          violations.push({ package: next.name, chain: chainTo(file) });
        }
        continue;
      }
      if (!parent.has(next.file)) parent.set(next.file, file);
      walk(next.file);
    }
  };

  for (const entry of entries) {
    if (!parent.has(entry)) parent.set(entry, undefined);
    walk(entry);
  }

  return { visited, violations, unresolved };
}

/**
 * One chain per database package, the shortest that reaches it.
 *
 * 🔴 A report is only useful if it is read. One leaked entry point reaches hundreds of modules
 * across a handful of drivers, and printing every path buries the one fact that matters — which
 * import to change — under repetitions of it. The shortest chain is also the one closest to the
 * edit that caused it.
 */
export function summariseViolations(violations) {
  const shortest = new Map();
  for (const violation of violations) {
    const existing = shortest.get(violation.package);
    if (existing === undefined || violation.chain.length < existing.chain.length) {
      shortest.set(violation.package, violation);
    }
  }
  return [...shortest.values()].sort((a, b) => a.package.localeCompare(b.package));
}

/** Every source file under a directory. */
export function sourceFilesUnder(dir, io) {
  const found = [];
  const walk = current => {
    for (const name of io.readdir(current)) {
      const full = join(current, name);
      if (io.isDirectory(full)) {
        if (name !== "node_modules" && name !== "dist") walk(full);
        continue;
      }
      if (SOURCE_EXTENSIONS.some(extension => name.endsWith(extension))) found.push(full);
    }
  };
  walk(dir);
  return found;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const io = {
  read: file => readFileSync(file, "utf8"),
  exists: file => existsSync(file) && statSync(file).isFile(),
  readdir: dir => readdirSync(dir),
  isDirectory: path => existsSync(path) && statSync(path).isDirectory(),
};

export function run() {
  const adminSrc = join(repoRoot, "packages/admin/src");
  const workspace = buildWorkspaceIndex(join(repoRoot, "packages"), io);
  const resolveSpecifier = makeResolver({ adminSrc, workspace, exists: io.exists });

  const all = sourceFilesUnder(adminSrc, io);
  const entries = all.filter(file => parseModule(io.read(file), file).isClient);

  const { visited, violations, unresolved } = walkClientClosure({
    entries,
    resolveSpecifier,
    read: io.read,
  });

  if (unresolved.length > 0) {
    console.error(
      `client entry graph: ${unresolved.length} import(s) could not be resolved, so this run ` +
        `proves nothing about what they reach:\n` +
        unresolved
          .slice(0, 20)
          .map(item => `  ${relative(repoRoot, item.from)} -> ${item.specifier}`)
          .join("\n")
    );
    process.exit(1);
  }

  if (violations.length === 0) {
    console.log(
      `client entry graph: ${entries.length} "use client" entr(ies) reaching ${visited.size} ` +
        `module(s), none of which can reach a database package.`
    );
    process.exit(0);
  }

  const summary = summariseViolations(violations);
  console.error(
    `\nclient entry graph: ${summary.length} database package(s) reachable from a browser bundle, ` +
      `over ${violations.length} path(s). The shortest path to each:\n`
  );
  for (const violation of summary) {
    const chain = violation.chain.map(file => relative(repoRoot, file));
    console.error(`  ${violation.package} is reachable from a browser bundle:`);
    console.error(`    ${chain[0]}`);
    for (const step of chain.slice(1)) console.error(`      imported by ${step}`);
    console.error("");
  }
  console.error(
    `A "use client" module begins a browser bundle, and everything it imports transitively ends up ` +
      `in that bundle. Either import a subpath that reaches no database package, or split the part ` +
      `the client needs into one that does not.\n`
  );
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
