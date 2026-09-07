/**
 * Nothing a browser loads may be able to reach a database driver.
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
import { dirname, join, relative, resolve } from "node:path";

import {
  moduleSpecifierRefs,
  UNRESOLVABLE_SPECIFIER,
} from "@nextlyhq/module-specifiers";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../../..");
const ADMIN_SRC = join(REPO_ROOT, "packages/admin/src");
const PACKAGES = join(REPO_ROOT, "packages");

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
}

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
    if (typeof manifest.name === "string")
      index.set(manifest.name, { dir, manifest });
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
  const { dir, manifest } = workspace.get(owner)!;
  const subpath =
    specifier === owner ? "." : `.${specifier.slice(owner.length)}`;
  const distPath = pickImportCondition(manifest.exports?.[subpath]);
  if (typeof distPath !== "string") return { kind: "unresolved", specifier };
  // A stylesheet or other asset ends the walk: it carries no imports and reaches no driver.
  if (!/\.(mjs|js|cjs)$/.test(distPath)) return { kind: "asset" };

  const relativeSource = distPath
    .replace(/^\.\//, "")
    .replace(/^dist\//, "src/")
    .replace(/\.(mjs|js|cjs)$/, "");
  return asFile(resolveSourceFile(join(dir, relativeSource), io), specifier);
}

export function makeResolver(
  adminSrc: string,
  workspace: Map<string, WorkspacePackage>,
  io: Io
) {
  return (fromFile: string, specifier: string): Resolution => {
    if (specifier === UNRESOLVABLE_SPECIFIER) {
      return { kind: "unresolved", specifier };
    }
    if (specifier.startsWith(".")) {
      return asFile(
        resolveSourceFile(resolve(dirname(fromFile), specifier), io),
        specifier
      );
    }
    if (specifier.startsWith("@admin/")) {
      const base = join(adminSrc, specifier.slice("@admin/".length));
      return asFile(resolveSourceFile(base, io), specifier);
    }
    // A database package is the answer wherever it lives; walking into it adds nothing.
    if (DATABASE_PACKAGE.test(specifier))
      return { kind: "external", name: specifier };

    const owner = ownerOf(specifier, workspace);
    if (owner === undefined) return { kind: "external", name: specifier };
    return resolveWorkspaceSubpath(specifier, owner, workspace, io);
  };
}

export interface ClosureResult {
  readonly visited: Set<string>;
  readonly violations: { package: string; chain: string[] }[];
  readonly unresolved: { from: string; specifier: string }[];
}

/**
 * Walk everything a set of client entries pulls into a browser bundle.
 *
 * Returns the chain that reached each database package, because "something in the admin reaches
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
  const violations: { package: string; chain: string[] }[] = [];

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
      if (DATABASE_PACKAGE.test(next.name)) {
        violations.push({ package: next.name, chain: chainTo(file) });
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

  return { visited, violations, unresolved };
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

const describeChain = (chain: string[]): string =>
  chain.map(file => relative(REPO_ROOT, file)).join("\n      imported by ");

describe("what a browser bundle can reach", () => {
  const workspace = readWorkspace(PACKAGES, realIo);
  const resolveSpecifier = makeResolver(ADMIN_SRC, workspace, realIo);
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
        item => `${relative(REPO_ROOT, item.from)} -> ${item.specifier}`
      )
    ).toEqual([]);
  });

  it("reaches no database package", () => {
    const shortest = new Map<string, string[]>();
    for (const violation of result.violations) {
      const existing = shortest.get(violation.package);
      if (existing === undefined || violation.chain.length < existing.length) {
        shortest.set(violation.package, violation.chain);
      }
    }
    expect(
      [...shortest.entries()].map(
        ([name, chain]) => `${name}\n    ${describeChain(chain)}`
      )
    ).toEqual([]);
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
      resolve: makeResolver("/repo/packages/admin/src", workspace, io),
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

  it.each(["pg-boss", "postgres-array", "react", "nextly/config"])(
    "leaves %s alone",
    name => expect(DATABASE_PACKAGE.test(name)).toBe(false)
  );
});
