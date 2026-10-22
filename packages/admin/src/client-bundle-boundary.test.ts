/**
 * Nothing a browser loads may be able to reach server-only code.
 *
 * Server-only code is three kinds, and each is refused wherever a browser bundle starts: a Node
 * built-in, a database package, and a module marked with the `server-only` package. A bundle starts
 * at two kinds of place: every admin module carrying `"use client"`, and every entry `nextly` lists
 * as client-safe in its `tsup.config.js` (`nextly/config` among them, which a site's config file and
 * the admin's browser code both import).
 *
 * The admin is a hybrid package: most of it renders on the server and may import anything, while a
 * `"use client"` module is compiled into a browser bundle. `nextly` publishes both kinds of entry —
 * `nextly/runtime` legitimately reaches the ORM, `nextly/config` legitimately does not — so the rule
 * cannot be "the admin must not import the ORM". It is narrower, and it is about a graph.
 *
 * ## The boundary is the closure, not the directive line
 *
 * 🔴 In the App Router a `"use client"` file is where client code BEGINS, not where it ends:
 * everything it imports, and everything those import, is compiled into the same bundle. Checking
 * only the specifiers written in files carrying the directive misses every module one hop further
 * out, which is most of them — measured here at 1038 modules in the closure against the 425
 * carrying the directive. So this walks the closure, crossing into workspace packages by resolving
 * their export maps back to source.
 *
 * ## Source, not `dist`
 *
 * 🔴 A bundler can split a leak into a chunk that only loads under a condition, so a built artefact
 * can hide an import the source plainly has; and a check that reads `dist` passes whenever `dist`
 * is stale, which is what a test run usually finds it. Neither failure mode exists here, and
 * nothing needs building first. The complementary question — what a bundler INLINED, where the
 * specifier survives nowhere — is answered by reading artefacts, which
 * `packages/ui/scripts/check-server-safe-artifacts.ts` does deliberately separately.
 *
 * ## Runtime references only, from the one reader
 *
 * Specifiers come from `@nextlyhq/module-specifiers`, which is the repository's single answer to
 * "what does this file load" and already covers the forms a hand-written visitor forgets:
 * `require`, `import x = require`, `typeof import`, JSDoc `@import`, triple-slash references, and a
 * dynamic target it cannot read.
 *
 * 🔴 Filtered to the references that survive to runtime, and the filter is the whole reason that
 * reader reports a kind. An erased reference cannot put code in a bundle, so counting one fails
 * this rule over correct code: unfiltered, the same walk reports 2072 modules and ten reachable
 * database packages, every one of them behind an `import type`. A gate that fails on correct code
 * stops being read.
 *
 * @module client-bundle-boundary
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { posix, resolve as resolveNative } from "node:path";

import {
  moduleSpecifierRefs,
  UNRESOLVABLE_SPECIFIER,
} from "@nextlyhq/module-specifiers";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { publishedEntries } from "../../ui/scripts/published-entries";

// Paths are walked in `/` form on every platform, so the real tree and the
// `/repo/...` trees the rule's own tests build resolve the same way. Windows
// reads a `/` path as readily as its own, and `posix.join` keeps a drive
// letter where `posix.resolve` would treat it as a relative path.
const { dirname, join } = posix;
const REPO_ROOT = resolveNative(__dirname, "../../..").replaceAll("\\", "/");
const ADMIN_SRC = join(REPO_ROOT, "packages/admin/src");
const NEXTLY_ROOT = join(REPO_ROOT, "packages/nextly");
const PACKAGES = join(REPO_ROOT, "packages");

/**
 * The path aliases a module may import through, by the package it lives in.
 *
 * `@admin/` in the admin and `@nextly/` in core both map onto their package's `src`; core's
 * tsconfig spells each `@nextly/x` as `src/x`, which `resolveSourceFile` completes to a file or an
 * `index.ts`. An alias left out here is an unresolved import, which fails the run below rather than
 * passing an unwalked subtree.
 */
const ALIASES: ReadonlyMap<string, string> = new Map([
  ["@admin/", ADMIN_SRC],
  ["@nextly/", join(NEXTLY_ROOT, "src")],
]);

/**
 * Packages that mean "this can talk to a database".
 *
 * The driver names are the ones the three adapter packages actually declare, asserted below against
 * their manifests rather than recalled, so the list cannot quietly fall behind a dialect the
 * repository gained. Each is anchored whole or at a subpath boundary: `pg` must not match `pg-boss`
 * and `postgres` must not match `postgres-array`, both ordinary libraries.
 */
const DATABASE_PACKAGE =
  /^(?:drizzle-orm(?:\/|$)|@nextlyhq\/adapter-|(?:pg|postgres|mysql2|better-sqlite3)(?:\/|$))/;

const NODE_BUILTINS: ReadonlySet<string> = new Set(builtinModules);

/**
 * What kind of server-only code a specifier names, or `null` when it names none.
 *
 * - A Node built-in, spelled `node:x` or bare (`fs`, and `fs/promises` through its first segment),
 *   read from Node's own list rather than recalled.
 * - A database package, as `DATABASE_PACKAGE` anchors it.
 * - The `server-only` package itself: importing it is how a module marks itself, as
 *   `packages/nextly/src/services/lib/permissions.ts` does, so reaching the import is reaching the
 *   module that carries it.
 */
export function serverOnlyKind(specifier: string): string | null {
  if (DATABASE_PACKAGE.test(specifier)) return "database package";
  if (
    specifier.startsWith("node:") ||
    NODE_BUILTINS.has(specifier.split("/")[0])
  ) {
    return "Node built-in";
  }
  if (specifier === "server-only") return "server-only module";
  return null;
}

/**
 * The third-party imports nextly's client-safe entries may reach, each reviewed as safe in a
 * browser, as `specifier@version`.
 *
 * 🔴 The walk stops at a third-party package: it cannot read what a published package imports in
 * turn, and walking into `node_modules` would read the Node build where a bundler takes the
 * `browser` one. So the boundary for those entries is this list, and an approval covers exactly
 * the subpath and the version that were read: another entry point of the same package, or an
 * upgrade, is a different import and fails the run until it is reviewed and added with its reason.
 * An entry no longer reached fails too, so the list never vouches for more than is used. Reviewed
 * 2026-10-15:
 */
const REVIEWED_BROWSER_PACKAGES: readonly string[] = [
  // Through `@nextlyhq/blocks-engine`. These two subpaths walk 79 files that import no package and
  // never reach `lib/data.js` or `lib/version.js`, the only files using Node's `module`, which the
  // package's `browser` field swaps for prebuilt `dist/` files anyway.
  "css-tree/parser@2.3.1",
  "css-tree/walker@2.3.1",
  // Through `@nextlyhq/blocks-engine`. It imports no Node built-in, and reads `process.platform`
  // only behind a `typeof process` guard.
  "picomatch@4.0.5",
  // Validation with no runtime dependencies, written to run in browsers.
  "zod@4.6.2",
];

/**
 * How the packages a walk reached differ from a reviewed list: reached but not listed, and listed
 * but not reached.
 */
export function packagesOffList(
  result: ClosureResult,
  reviewed: readonly string[]
): { unreviewed: string[]; unused: string[] } {
  return {
    unreviewed: [...result.packages]
      .filter(name => !reviewed.includes(name))
      .sort(),
    unused: reviewed.filter(name => !result.packages.has(name)),
  };
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

interface Io {
  readonly read: (file: string) => string;
  readonly exists: (file: string) => boolean;
}

/**
 * The first of a module's candidate spellings that exists.
 *
 * 🔴 A specifier ending `.js` is not a built file to look for. Under NodeNext the author writes the
 * extension the OUTPUT will have while the source beside it is `.ts`, and packages here do exactly
 * that. Treating those as missing stops the walk at the first such module and leaves everything
 * past it unexamined.
 */
export function resolveSourceFile(base: string, io: Io): string | null {
  const stems = [base];
  const withoutJs = base.replace(/\.(js|mjs|cjs)$/, "");
  if (withoutJs !== base) stems.push(withoutJs);

  for (const stem of stems) {
    for (const candidate of [
      ...SOURCE_EXTENSIONS.map(extension => `${stem}${extension}`),
      join(stem, "index.ts"),
      join(stem, "index.tsx"),
    ]) {
      if (io.exists(candidate)) return candidate;
    }
  }
  // The bare path last: a directory `x` must not win over a file `x.ts` beside it.
  return io.exists(base) ? base : null;
}

/**
 * Which built file a published subpath names.
 *
 * Conditions nest, and packages here use both shapes: `{ types, import }` and
 * `{ import: { types, default } }`. Reading only the first level resolves one and reports the other
 * as unreadable, which fails a run for a reason that is not this rule.
 */
export function pickImportCondition(target: unknown): string | null {
  if (typeof target === "string") return target;
  if (target === null || typeof target !== "object") return null;
  for (const condition of ["import", "module", "default"]) {
    if (condition in (target as Record<string, unknown>)) {
      const resolved = pickImportCondition(
        (target as Record<string, unknown>)[condition]
      );
      if (resolved !== null) return resolved;
    }
  }
  return null;
}

interface WorkspacePackage {
  readonly dir: string;
  readonly manifest: { name?: string; exports?: Record<string, unknown> };
  /**
   * The source each published subpath is built from, by its export key, for a
   * package that declares that itself. Absent, a subpath's source is found by
   * the name convention: `dist/x.mjs` is built from `src/x`.
   */
  readonly entrySources?: ReadonlyMap<string, string>;
}

/**
 * The packages that publish a subpath from a source the name convention does
 * not lead to, each read from the table its own build reads.
 *
 * `@nextlyhq/ui` builds `./color` from `src/lib/color/index.ts`, and declares
 * every entry's source in `scripts/published-entries.ts`, which its build and
 * its surface checks read. Reading the same table keeps this resolver from
 * holding a third copy, and from needing a file at `src/color.ts` that exists
 * only so a name convention finds it. A package with such a layout and no
 * table here stays unresolved, and fails, rather than going unwalked.
 */
const ENTRY_SOURCE_TABLES: ReadonlyMap<
  string,
  () => ReadonlyMap<string, string>
> = new Map([
  [
    "@nextlyhq/ui",
    () =>
      new Map(publishedEntries().map(entry => [entry.subpath, entry.source])),
  ],
]);

/** Every workspace package, by the name other packages import it as. */
export function readWorkspace(
  packagesDir: string,
  io: Io
): Map<string, WorkspacePackage> {
  const index = new Map<string, WorkspacePackage>();
  for (const name of readdirSync(packagesDir)) {
    const dir = join(packagesDir, name);
    const manifestPath = join(dir, "package.json");
    if (!io.exists(manifestPath)) continue;
    const manifest = JSON.parse(io.read(manifestPath));
    if (typeof manifest.name !== "string") continue;
    const entrySources = ENTRY_SOURCE_TABLES.get(manifest.name)?.();
    index.set(manifest.name, {
      dir,
      manifest,
      ...(entrySources === undefined ? {} : { entrySources }),
    });
  }
  return index;
}

type Resolution =
  | { kind: "file"; file: string }
  | { kind: "external"; name: string }
  | { kind: "asset" }
  | { kind: "unresolved"; specifier: string };

/**
 * Turn one specifier into the next thing to walk.
 *
 * `unresolved` is neither an answer nor nothing, and a caller must fail on it: an unresolved import
 * is an unwalked subtree, and calling it clean is how a guard passes over the thing it exists to
 * find.
 */
const asFile = (file: string | null, specifier: string): Resolution =>
  file ? { kind: "file", file } : { kind: "unresolved", specifier };

/** The workspace package a specifier belongs to, longest name first. */
function ownerOf(
  specifier: string,
  workspace: Map<string, WorkspacePackage>
): string | undefined {
  // Longest first, so `@nextlyhq/adapter-drizzle/types` is not read as a subpath of some shorter
  // neighbour.
  return [...workspace.keys()]
    .filter(name => specifier === name || specifier.startsWith(`${name}/`))
    .sort((a, b) => b.length - a.length)[0];
}

/** Where a workspace subpath's source lives, or why it could not be found. */
function resolveWorkspaceSubpath(
  specifier: string,
  owner: string,
  workspace: Map<string, WorkspacePackage>,
  io: Io
): Resolution {
  const { dir, manifest, entrySources } = workspace.get(owner)!;
  const subpath =
    specifier === owner ? "." : `.${specifier.slice(owner.length)}`;
  const distPath = pickImportCondition(manifest.exports?.[subpath]);
  if (typeof distPath !== "string") return { kind: "unresolved", specifier };
  // A stylesheet or other asset ends the walk: it carries no imports and reaches no driver.
  if (!/\.(mjs|js|cjs)$/.test(distPath)) return { kind: "asset" };

  // The package's own word for where this subpath is built from, first.
  const declared = entrySources?.get(subpath);
  if (declared !== undefined) {
    return asFile(resolveSourceFile(join(dir, declared), io), specifier);
  }

  const relativeSource = distPath
    .replace(/^\.\//, "")
    .replace(/^dist\//, "src/")
    .replace(/\.(mjs|js|cjs)$/, "");
  return asFile(resolveSourceFile(join(dir, relativeSource), io), specifier);
}

export function makeResolver(
  aliases: ReadonlyMap<string, string>,
  workspace: Map<string, WorkspacePackage>,
  io: Io
) {
  return (fromFile: string, specifier: string): Resolution => {
    if (specifier === UNRESOLVABLE_SPECIFIER) {
      return { kind: "unresolved", specifier };
    }
    if (specifier.startsWith(".")) {
      return asFile(
        resolveSourceFile(join(dirname(fromFile), specifier), io),
        specifier
      );
    }
    for (const [prefix, dir] of aliases) {
      if (specifier.startsWith(prefix)) {
        const base = join(dir, specifier.slice(prefix.length));
        return asFile(resolveSourceFile(base, io), specifier);
      }
    }
    // Server-only code is the answer wherever it lives; walking into it adds nothing.
    if (serverOnlyKind(specifier) !== null)
      return { kind: "external", name: specifier };

    const owner = ownerOf(specifier, workspace);
    if (owner === undefined) return { kind: "external", name: specifier };
    return resolveWorkspaceSubpath(specifier, owner, workspace, io);
  };
}

export interface ClosureResult {
  readonly visited: Set<string>;
  readonly violations: { package: string; kind: string; chain: string[] }[];
  readonly unresolved: { from: string; specifier: string }[];
  /**
   * The third-party imports reached, each as `specifier@version`: the subpath imported and the
   * version installed where it is imported from (`unknown` when none is). The walk stops at each
   * one, so what a package imports in turn is not seen here; a walk that must vouch for those holds
   * this set to imports reviewed as safe for its kind of bundle, and a new subpath or an upgrade is
   * a new import to review.
   */
  readonly packages: Set<string>;
}

/**
 * The version of a package installed where `fromFile` would load it: the first
 * `node_modules/<name>/package.json` found walking up from the file's directory, as Node and
 * pnpm's links resolve it.
 */
export function installedVersion(
  specifier: string,
  fromFile: string,
  io: Io
): string {
  const name = packageNameOf(specifier);
  for (let dir = dirname(fromFile); ; dir = dirname(dir)) {
    const manifest = join(dir, "node_modules", name, "package.json");
    if (io.exists(manifest)) {
      const version: unknown = JSON.parse(io.read(manifest)).version;
      return typeof version === "string" ? version : "unknown";
    }
    if (dirname(dir) === dir) return "unknown";
  }
}

/** The package a bare specifier belongs to: `@scope/name` or `name`, without a subpath. */
export function packageNameOf(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
}

/**
 * Walk everything a set of client entries pulls into a browser bundle.
 *
 * Returns the chain that reached each piece of server-only code, because "something in the admin reaches
 * drizzle" is not actionable and "this file, through these seven, does" is.
 */
export function walkClientClosure(
  entries: string[],
  resolveSpecifier: (from: string, specifier: string) => Resolution,
  io: Io
): ClosureResult {
  const parent = new Map<string, string | undefined>();
  const visited = new Set<string>();
  const unresolved: { from: string; specifier: string }[] = [];
  const violations: { package: string; kind: string; chain: string[] }[] = [];
  const packages = new Set<string>();

  const chainTo = (file: string): string[] => {
    const chain: string[] = [];
    for (
      let current: string | undefined = file;
      current !== undefined;
      current = parent.get(current)
    ) {
      chain.push(current);
    }
    return chain;
  };

  /** Record what one specifier means, and answer the file to walk next if there is one. */
  const consider = (file: string, specifier: string): string | null => {
    const next = resolveSpecifier(file, specifier);
    if (next.kind === "asset") return null;
    if (next.kind === "unresolved") {
      unresolved.push({ from: file, specifier });
      return null;
    }
    if (next.kind === "external") {
      const kind = serverOnlyKind(next.name);
      if (kind !== null) {
        violations.push({ package: next.name, kind, chain: chainTo(file) });
      } else {
        packages.add(`${next.name}@${installedVersion(next.name, file, io)}`);
      }
      return null;
    }
    if (!parent.has(next.file)) parent.set(next.file, file);
    return next.file;
  };

  const walk = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);
    let source: string;
    try {
      source = io.read(file);
    } catch {
      unresolved.push({ from: file, specifier: "(unreadable)" });
      return;
    }
    for (const ref of moduleSpecifierRefs(source, file)) {
      // Erased before anything runs, so it cannot put code in a bundle.
      if (ref.typeOnly) continue;
      const next = consider(file, ref.specifier);
      if (next !== null) walk(next);
    }
  };

  for (const entry of entries) {
    if (!parent.has(entry)) parent.set(entry, undefined);
    walk(entry);
  }

  return { visited, violations, unresolved, packages };
}

/**
 * Whether a module opens a browser bundle.
 *
 * 🔴 The directive must be the first STATEMENT, which is not the first line: a file may open with a
 * licence header or a doc comment and still be a client module. Anchoring on the first byte silently
 * skips those, and a guard that skips files reports a clean tree it never read.
 */
export function declaresUseClient(source: string, fileName: string): boolean {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const first = parsed.statements[0];
  return Boolean(
    first &&
      ts.isExpressionStatement(first) &&
      ts.isStringLiteral(first.expression) &&
      first.expression.text === "use client"
  );
}

const realIo: Io = {
  read: file => readFileSync(file, "utf8"),
  exists: file => existsSync(file) && statSync(file).isFile(),
};

const sourceFilesUnder = (dir: string): string[] => {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) {
        if (name !== "node_modules" && name !== "dist") walk(full);
        continue;
      }
      if (SOURCE_EXTENSIONS.some(extension => name.endsWith(extension)))
        found.push(full);
    }
  };
  walk(dir);
  return found;
};

/** A path under the repository, named from its root for a message. */
const fromRepo = (file: string): string =>
  file.startsWith(`${REPO_ROOT}/`) ? file.slice(REPO_ROOT.length + 1) : file;

const describeChain = (chain: string[]): string =>
  chain.map(fromRepo).join("\n      imported by ");

describe("what a browser bundle can reach", () => {
  const workspace = readWorkspace(PACKAGES, realIo);
  const resolveSpecifier = makeResolver(ALIASES, workspace, realIo);
  const entries = sourceFilesUnder(ADMIN_SRC).filter(file =>
    declaresUseClient(realIo.read(file), file)
  );
  const result = walkClientClosure(entries, resolveSpecifier, realIo);

  it("names the drivers from the adapters' own manifests", () => {
    // The pattern is a claim about which packages talk to a database. Read the adapters rather than
    // recall them, so a dialect the repository gains cannot leave it silently short.
    const declared = new Set<string>();
    for (const adapter of [
      "adapter-postgres",
      "adapter-mysql",
      "adapter-sqlite",
    ]) {
      const manifest = JSON.parse(
        realIo.read(join(PACKAGES, adapter, "package.json"))
      );
      for (const name of Object.keys(manifest.dependencies ?? {}))
        declared.add(name);
    }
    const drivers = [...declared].filter(
      name =>
        !name.startsWith("@nextlyhq/") || name.startsWith("@nextlyhq/adapter-")
    );
    expect(drivers.length).toBeGreaterThan(0);
    for (const driver of drivers) {
      expect(
        DATABASE_PACKAGE.test(driver),
        `${driver} must be recognised`
      ).toBe(true);
    }
  });

  it("walks past the directive into the whole bundle", () => {
    // The closure is the subject. If this collapses toward the entry count, the walk has stopped
    // crossing a boundary it used to cross and every assertion below is passing on a smaller tree.
    expect(entries.length).toBeGreaterThan(300);
    expect(result.visited.size).toBeGreaterThan(entries.length * 2);
  });

  it("resolves every runtime import it meets", () => {
    // An unresolved import is an unwalked subtree, and an unreadable dynamic target is a module this
    // cannot see at all. Either one makes the result below a statement about less than it claims.
    expect(
      result.unresolved.map(
        item => `${fromRepo(item.from)} -> ${item.specifier}`
      )
    ).toEqual([]);
  });

  it("reaches no server-only code", () => {
    // A value imported from `nextly/schemas`, the server's barrel, fails here: it reaches drizzle-orm and node:crypto.
    expect(describeViolations(result)).toEqual([]);
  });
});

/**
 * Each piece of server-only code reached, with the shortest chain to it, read from the reaching
 * module back to the entry: the entry and the import path are what the person fixing it needs.
 */
function describeViolations(result: ClosureResult): string[] {
  const shortest = new Map<string, { kind: string; chain: string[] }>();
  for (const violation of result.violations) {
    const existing = shortest.get(violation.package);
    if (
      existing === undefined ||
      violation.chain.length < existing.chain.length
    ) {
      shortest.set(violation.package, violation);
    }
  }
  return [...shortest.entries()].map(
    ([name, { kind, chain }]) =>
      `${name} (${kind})\n    ${describeChain(chain)}`
  );
}

/**
 * The entries `nextly` publishes as safe for a browser, read from its build config.
 *
 * 🔴 Read from the file, not restated: a copy of the list here would pass while an entry added
 * there went unchecked. Parsed rather than imported, because importing the config loads `tsup`
 * and with it esbuild, which refuses to start under this package's browser-like test environment.
 * The parse accepts exactly one shape, `const clientEntries = ["…", …]`, and throws on any other,
 * so a list it cannot read fails the run instead of being read as empty.
 */
export function readClientEntries(configSource: string): string[] {
  const parsed = ts.createSourceFile(
    "tsup.config.js",
    configSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== "clientEntries"
      ) {
        continue;
      }
      const list = declaration.initializer;
      if (list === undefined || !ts.isArrayLiteralExpression(list))
        return refuseClientEntries();
      const paths: string[] = [];
      for (const element of list.elements) {
        // Narrowed one element at a time: a spread, a variable or a template is a list this
        // cannot read as written, and is refused below like a missing one.
        if (!ts.isStringLiteral(element)) return refuseClientEntries();
        paths.push(element.text);
      }
      return paths;
    }
  }
  return refuseClientEntries();
}

/** The one refusal, whichever way the list could not be read. */
function refuseClientEntries(): never {
  throw new Error(
    "tsup.config.js must declare `clientEntries` as an array of path strings"
  );
}

describe("what nextly's client-safe entries can reach", () => {
  const workspace = readWorkspace(PACKAGES, realIo);
  const resolveSpecifier = makeResolver(ALIASES, workspace, realIo);
  const entries = readClientEntries(
    realIo.read(join(NEXTLY_ROOT, "tsup.config.js"))
  ).map(entry => join(NEXTLY_ROOT, entry));
  const result = walkClientClosure(entries, resolveSpecifier, realIo);

  it("reads the list the build declares, nextly/config among it", () => {
    // If this shrinks to nothing, every assertion below passes on an empty walk.
    expect(entries).toContain(join(NEXTLY_ROOT, "src/config.ts"));
    expect(entries.length).toBeGreaterThan(10);
    for (const entry of entries) {
      expect(realIo.exists(entry), `${fromRepo(entry)} must exist`).toBe(true);
    }
    expect(result.visited.size).toBeGreaterThan(entries.length);
  });

  it("resolves every runtime import it meets", () => {
    expect(
      result.unresolved.map(
        item => `${fromRepo(item.from)} -> ${item.specifier}`
      )
    ).toEqual([]);
  });

  it("reaches no server-only code", () => {
    expect(describeViolations(result)).toEqual([]);
  });

  it("reaches only third-party packages reviewed as safe for a browser", () => {
    expect(packagesOffList(result, REVIEWED_BROWSER_PACKAGES)).toEqual({
      unreviewed: [],
      unused: [],
    });
  });
});

/**
 * The control.
 *
 * 🔴 An empty result is not evidence: a walk that resolves nothing reports the same clean answer as
 * one that resolved everything. These feed the same functions a tree that MUST fail, so the green
 * above means the rule ran rather than that it found nothing to say.
 */
describe("the rule can fail", () => {
  const fakeIo = (files: Record<string, string>): Io => ({
    read: file => {
      if (!(file in files)) throw new Error(`ENOENT ${file}`);
      return files[file];
    },
    exists: file => file in files,
  });

  const build = (files: Record<string, string>) => {
    const io = fakeIo(files);
    const workspace = new Map<string, WorkspacePackage>([
      [
        "@nextlyhq/admin",
        { dir: "/repo/packages/admin", manifest: { name: "@nextlyhq/admin" } },
      ],
    ]);
    return {
      io,
      resolve: makeResolver(
        new Map([
          ["@admin/", "/repo/packages/admin/src"],
          ["@nextly/", "/repo/packages/nextly/src"],
        ]),
        workspace,
        io
      ),
    };
  };

  it("fails on a driver several hops past the directive", () => {
    // 🔴 The case this whole file exists for, and the one the first version of it missed.
    const { io, resolve } = build({
      "/repo/packages/admin/src/Entry.tsx":
        '"use client";\nimport { h } from "./helper";\nexport { h };',
      "/repo/packages/admin/src/helper.ts":
        'import { deep } from "./deep";\nexport const h = deep;',
      "/repo/packages/admin/src/deep.ts":
        'import { sql } from "drizzle-orm";\nexport const deep = sql;',
    });
    const { violations } = walkClientClosure(
      ["/repo/packages/admin/src/Entry.tsx"],
      resolve,
      io
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].package).toBe("drizzle-orm");
    expect(violations[0].chain).toEqual([
      "/repo/packages/admin/src/deep.ts",
      "/repo/packages/admin/src/helper.ts",
      "/repo/packages/admin/src/Entry.tsx",
    ]);
  });

  it.each([
    [
      "a Node built-in, with its prefix",
      'import { createHash } from "node:crypto";',
      "node:crypto",
      "Node built-in",
    ],
    [
      "a Node built-in, bare",
      'import { readFileSync } from "fs";',
      "fs",
      "Node built-in",
    ],
    [
      "a Node built-in's subpath",
      'import { readFile } from "fs/promises";',
      "fs/promises",
      "Node built-in",
    ],
    [
      "a module marked server-only",
      'import "server-only";\nexport const secret = 1;',
      "server-only",
      "server-only module",
    ],
    [
      "a database package",
      'import { sql } from "drizzle-orm";',
      "drizzle-orm",
      "database package",
    ],
  ])(
    "fails on %s, naming the entry and the path to it",
    (_label, planted, name, kind) => {
      // A client-safe entry two hops from the planted import, through the core alias, as
      // `nextly/config` reaches `layout.ts`.
      const { io, resolve } = build({
        "/repo/packages/nextly/src/config.ts":
          'export { LIMIT } from "@nextly/domains/limits";',
        "/repo/packages/nextly/src/domains/limits.ts": `${planted}\nexport const LIMIT = 1;`,
      });
      const result = walkClientClosure(
        ["/repo/packages/nextly/src/config.ts"],
        resolve,
        io
      );
      expect(result.unresolved).toEqual([]);
      expect(result.violations).toEqual([
        {
          package: name,
          kind,
          chain: [
            "/repo/packages/nextly/src/domains/limits.ts",
            "/repo/packages/nextly/src/config.ts",
          ],
        },
      ]);
    }
  );

  it("reads the entry list as written, and refuses a shape it cannot read", () => {
    expect(
      readClientEntries(
        'const other = ["x"];\nconst clientEntries = [\n  // a note\n  "src/a.ts",\n  "src/b.ts",\n];'
      )
    ).toEqual(["src/a.ts", "src/b.ts"]);
    expect(() =>
      readClientEntries('const clientEntries = [...base, "src/a.ts"];')
    ).toThrow(/array of path strings/);
    expect(() => readClientEntries("const entries = [];")).toThrow(
      /array of path strings/
    );
  });

  it("names a third-party import no one has reviewed, and a listed one no longer reached", () => {
    // The case the list exists for: a package whose own imports the walk cannot see.
    const { io, resolve } = build({
      "/repo/packages/nextly/src/config.ts":
        'import { pick } from "leaky-lib/sub";\nimport { z } from "zod";\nexport { pick, z };',
      "/repo/packages/nextly/node_modules/leaky-lib/package.json":
        '{ "version": "1.0.0" }',
      "/repo/packages/nextly/node_modules/zod/package.json":
        '{ "version": "4.6.2" }',
    });
    const result = walkClientClosure(
      ["/repo/packages/nextly/src/config.ts"],
      resolve,
      io
    );
    expect(result.violations).toEqual([]);
    expect(
      packagesOffList(result, ["zod@4.6.2", "leaky-lib/sub@1.0.0"])
    ).toEqual({ unreviewed: [], unused: [] });
    expect(packagesOffList(result, ["zod@4.6.2", "gone@1.0.0"])).toEqual({
      unreviewed: ["leaky-lib/sub@1.0.0"],
      unused: ["gone@1.0.0"],
    });
    // An approval of one subpath does not cover another, and an approval of one version does not
    // cover the next: each is a new import to review.
    expect(packagesOffList(result, ["zod@4.6.1", "leaky-lib@1.0.0"])).toEqual({
      unreviewed: ["leaky-lib/sub@1.0.0", "zod@4.6.2"],
      unused: ["zod@4.6.1", "leaky-lib@1.0.0"],
    });
  });

  it("reads the version installed nearest the importing file", () => {
    const io = fakeIo({
      "/repo/node_modules/zod/package.json": '{ "version": "3.0.0" }',
      "/repo/packages/nextly/node_modules/zod/package.json":
        '{ "version": "4.6.2" }',
    });
    expect(
      installedVersion("zod", "/repo/packages/nextly/src/a/b.ts", io)
    ).toBe("4.6.2");
    expect(installedVersion("zod", "/repo/packages/admin/src/c.ts", io)).toBe(
      "3.0.0"
    );
    expect(installedVersion("absent", "/repo/x.ts", io)).toBe("unknown");
  });

  it("names a scoped package without its subpath", () => {
    expect(packageNameOf("@scope/pkg/deep/path")).toBe("@scope/pkg");
    expect(packageNameOf("pkg/deep")).toBe("pkg");
  });

  it("passes an entry whose closure is all import-free leaves", () => {
    // The other direction: the fix this rule asks for, a value moved to a module with no
    // imports, must satisfy it.
    const { io, resolve } = build({
      "/repo/packages/nextly/src/config.ts":
        'export { LIMIT } from "./limits";',
      "/repo/packages/nextly/src/limits.ts": "export const LIMIT = 1;",
    });
    const result = walkClientClosure(
      ["/repo/packages/nextly/src/config.ts"],
      resolve,
      io
    );
    expect(result.violations).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it("fails on a CommonJS load", () => {
    // `require`, `import x = require` and `module.require` reach a module exactly as an import
    // does, and a visitor written by hand forgets them.
    for (const form of [
      'const db = require("drizzle-orm");',
      'import db = require("drizzle-orm");',
      'const db = module.require("drizzle-orm");',
      'const db = module["require"]("drizzle-orm");',
    ]) {
      const { io, resolve } = build({
        "/repo/packages/admin/src/Entry.ts": `"use client";\n${form}`,
      });
      const { violations } = walkClientClosure(
        ["/repo/packages/admin/src/Entry.ts"],
        resolve,
        io
      );
      expect(
        violations.map(v => v.package),
        form
      ).toEqual(["drizzle-orm"]);
    }
  });

  it("fails on a dynamic import", () => {
    const { io, resolve } = build({
      "/repo/packages/admin/src/Entry.ts":
        '"use client";\nconst f = () => import("drizzle-orm");',
    });
    const { violations } = walkClientClosure(
      ["/repo/packages/admin/src/Entry.ts"],
      resolve,
      io
    );
    expect(violations.map(v => v.package)).toEqual(["drizzle-orm"]);
  });

  it("fails on a target it cannot read", () => {
    // A guard that approves what it could not read approves anything.
    const { io, resolve } = build({
      "/repo/packages/admin/src/Entry.ts":
        '"use client";\nconst f = (n: string) => import(n);',
    });
    const { unresolved } = walkClientClosure(
      ["/repo/packages/admin/src/Entry.ts"],
      resolve,
      io
    );
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].specifier).toBe(UNRESOLVABLE_SPECIFIER);
  });

  it("passes an erased reference", () => {
    // The other direction, so the rule cannot be satisfied by refusing everything.
    const { io, resolve } = build({
      "/repo/packages/admin/src/Entry.ts":
        '"use client";\nimport type { SQL } from "drizzle-orm";\nexport type T = SQL;',
    });
    const { violations, unresolved } = walkClientClosure(
      ["/repo/packages/admin/src/Entry.ts"],
      resolve,
      io
    );
    expect(violations).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it("says nothing about a server module the client never reaches", () => {
    const { io, resolve } = build({
      "/repo/packages/admin/src/Entry.tsx":
        '"use client";\nexport const a = 1;',
      "/repo/packages/admin/src/server.ts":
        'import { sql } from "drizzle-orm";\nexport const s = sql;',
    });
    const { violations } = walkClientClosure(
      ["/repo/packages/admin/src/Entry.tsx"],
      resolve,
      io
    );
    expect(violations).toEqual([]);
  });

  it("recognises the directive behind a doc comment", () => {
    expect(declaresUseClient('/** doc */\n"use client";\n', "C.tsx")).toBe(
      true
    );
    expect(
      declaresUseClient(
        'import x from "y";\nconst t = \'"use client"\';',
        "C.ts"
      )
    ).toBe(false);
  });

  it("resolves a published subpath through its package's own entry table", () => {
    // `./color` builds `dist/color.mjs` from `src/lib/color/index.ts`: no name
    // convention leads from one to the other, so only the package's table can.
    const ui = {
      dir: "/repo/packages/ui",
      manifest: {
        name: "@x/ui",
        exports: { "./color": { import: { default: "./dist/color.mjs" } } },
      },
    };
    const io = fakeIo({ "/repo/packages/ui/src/lib/color/index.ts": "" });
    const resolve = (entrySources?: ReadonlyMap<string, string>) =>
      makeResolver(
        new Map(),
        new Map([
          ["@x/ui", { ...ui, ...(entrySources ? { entrySources } : {}) }],
        ]),
        io
      )("/repo/packages/admin/src/a.ts", "@x/ui/color");
    expect(resolve(new Map([["./color", "src/lib/color/index.ts"]]))).toEqual({
      kind: "file",
      file: "/repo/packages/ui/src/lib/color/index.ts",
    });
    // The control: by the name convention alone it is unresolved, and fails.
    expect(resolve()).toEqual({ kind: "unresolved", specifier: "@x/ui/color" });
  });

  it("resolves the design system's nested subpaths in this repository", () => {
    const workspace = readWorkspace(PACKAGES, realIo);
    const resolve = makeResolver(new Map(), workspace, realIo);
    expect(
      resolve(join(PACKAGES, "admin/src/a.ts"), "@nextlyhq/ui/color")
    ).toEqual({
      kind: "file",
      file: join(PACKAGES, "ui/src/lib/color/index.ts"),
    });
  });

  it("resolves a NodeNext .js specifier to the .ts beside it", () => {
    const io = fakeIo({ "/p/banner.ts": "" });
    expect(resolveSourceFile("/p/banner.js", io)).toBe("/p/banner.ts");
  });

  it("reads both export-condition shapes", () => {
    expect(pickImportCondition({ types: "./d.d.ts", import: "./d.mjs" })).toBe(
      "./d.mjs"
    );
    expect(
      pickImportCondition({ import: { types: "./d.d.ts", default: "./d.mjs" } })
    ).toBe("./d.mjs");
  });

  it.each([
    "pg-boss",
    "postgres-array",
    "react",
    "nextly/config",
    "@scope/fs",
    "fs-extra-like",
    "server-only-ish",
  ])("leaves %s alone", name => expect(serverOnlyKind(name)).toBe(null));
});
