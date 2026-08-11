/**
 * Every type this package's public API is written in terms of must be
 * IMPORTABLE from an entry the consumer of that API can actually resolve.
 *
 * A package that names a type in a parameter or return position owes that type
 * to its callers. A type mentioned but not exported leaves a host able to SEE
 * the name it is required to pass with no way to write it down: the value must
 * stay unannotated, which keeps the check at the call site and loses the
 * ability to name the value, move it, or type a module boundary around it.
 *
 * `@nextlyhq/blocks-engine` is a DEPENDENCY of this package rather than a peer,
 * so a host has no direct path to it and cannot import those types itself.
 *
 * **Asserted against the BUILT `.d.ts`, not the source, and that distinction is
 * the test.** A `.d.ts` can mention a type in three ways and only one of them
 * is importable: declared and exported, declared and NOT exported (a name a
 * consumer can read and not use), or inlined structurally with no name at all.
 * Reading `src/index.ts` cannot tell them apart — `export *` re-exports without
 * naming, and the bundler rewrites what survives. The artifact a consumer
 * actually resolves is the only place this question has an answer.
 *
 * **The requirement is per ENTRY, because the entries are not interchangeable.**
 * `./next` declares `next` and `nextly` peer imports, so a standalone install
 * that reaches for a type there loads a declaration file whose own imports do
 * not resolve. An entry's obligation is therefore satisfied only by itself or
 * by the root, which imports nothing but the engine and so resolves from
 * anywhere the package does.
 *
 * @module type-surface.test
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");

/**
 * The sentinel each entry is pinned against — see the assertion for why.
 *
 * Keyed by the export subpath as the manifest spells it, so an entry added to
 * `package.json` without a sentinel here fails rather than being skipped.
 */
const SENTINELS: Readonly<Record<string, string>> = {
  ".": "PageRenderer",
  "./next": "createBlocksPage",
  "./blocks": "coreBlocks",
};

/** The root entry, whose exports satisfy every other entry's obligation. */
const ROOT_SUBPATH = ".";

interface EntryPoint {
  readonly subpath: string;
  readonly declaration: string;
}

/**
 * Every entry a consumer can import, read from the manifest rather than listed.
 *
 * **A hand-written entry list has the defect a hand-written type list has**: it
 * certifies the entries someone remembered, and a package that grows a fourth
 * one grows it unchecked. `exports` is the same map the resolver uses, so
 * reading it means an entry cannot exist without being covered — and the
 * declaration extension comes from the manifest too, rather than from an
 * assumption about what the bundler emits.
 */
function entryPoints(): EntryPoint[] {
  const manifest: unknown = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")
  );
  const exportMap = readRecord(readProperty(manifest, "exports"));
  return Object.entries(exportMap).map(([subpath, condition]) => {
    const types = readProperty(condition, "types");
    if (typeof types !== "string") {
      throw new Error(`exports["${subpath}"] declares no \`types\` condition`);
    }
    return { subpath, declaration: resolve(PACKAGE_ROOT, types) };
  });
}

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }
  return Reflect.get(value, key);
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value));
}

/**
 * An entry's declaration file plus every chunk it reaches.
 *
 * The bundler splits shared declarations into chunk files, and the signatures
 * of `createBlockResolver`, `migrationSourceFor`, `toPageStyles` and
 * `fetchPolicyLabel` live in one — so an entry file read alone under-reports
 * the types its own surface is written in. Following the relative specifiers
 * attributes each chunk to the entries that actually reach it, which a flat
 * scan of the output directory cannot do.
 */
function declarationGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file) || !existsSync(file)) continue;
    seen.add(file);

    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/from\s*['"](\.[^'"]*)['"]/g)) {
      const resolved = resolveDeclaration(dirname(file), match[1]!);
      if (resolved !== undefined) queue.push(resolved);
    }
  }

  return [...seen];
}

/**
 * A relative specifier as written in the emitted declarations.
 *
 * The bundler emits runtime specifiers (`./chunk-ABC.js`) inside declaration
 * files, so the extension on the page is never the extension on disk.
 */
function resolveDeclaration(
  from: string,
  specifier: string
): string | undefined {
  const base = resolve(from, specifier).replace(/\.(m|c)?js$/, "");
  for (const candidate of [
    `${base}.d.ts`,
    `${base}.d.mts`,
    `${base}.d.cts`,
    join(base, "index.d.ts"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Every engine type a declaration graph names, derived rather than listed.
 *
 * **A hand-written list has the defect it exists to catch**: it can only hold
 * what someone already knew was missing, so it grows with memory rather than
 * with the API and certifies exactly the state it was written against.
 *
 * The declarations name their own dependency two ways, and both count. A named
 * import lists the types outright. A namespace import binds the whole module
 * and the types then appear qualified — `_nextlyhq_blocks_engine.BlockDefinition` —
 * which is how the block catalogue's declarations reference the engine, and
 * which a scan for named imports alone reports as requiring nothing at all.
 */
function engineTypesNamed(files: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    for (const name of engineTypesIn(readFileSync(file, "utf8"))) {
      names.add(name);
    }
  }
  return names;
}

/** The text-level half, kept pure so both import forms can be pinned below. */
function engineTypesIn(source: string): Set<string> {
  const names = new Set<string>();

  for (const line of source.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*['"]@nextlyhq\/blocks-engine['"]/g
  )) {
    for (const clause of line[1]!.split(",")) {
      // `BlockRenderArgs as BlockRenderArgs$1` imports the LEFT name; the
      // right is the bundler's local alias, which no consumer ever writes.
      const original = clause
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0];
      const trimmed = (original ?? "").trim();
      if (trimmed !== "") names.add(trimmed);
    }
  }

  for (const namespace of source.matchAll(
    /import\s*\*\s*as\s+([A-Za-z0-9_$]+)\s+from\s*['"]@nextlyhq\/blocks-engine['"]/g
  )) {
    const qualified = new RegExp(`\\b${namespace[1]!}\\.([A-Za-z0-9_$]+)`, "g");
    for (const reference of source.matchAll(qualified)) {
      names.add(reference[1]!);
    }
  }

  return names;
}

/**
 * The names a declaration file actually exports.
 *
 * **The alias form is the whole difficulty, and it is why this parser exists
 * rather than a grep.** A bundled declaration re-exports as
 * `export { a as BlockRenderArgs }`, so the exported NAME is on the right of
 * `as` while the local name on the left is a generated letter; reading the
 * left-hand side concludes the type is missing when it is not. `export type
 * { ... }`, inline `{ type X }` and direct `export interface X` all have to be
 * read for the same reason — any form missed reports an absence that is not
 * there.
 */
function exportedNames(declaration: string): Set<string> {
  const names = new Set<string>();

  for (const block of declaration.matchAll(
    /export\s+(?:type\s+)?\{([^}]*)\}/g
  )) {
    for (const clause of block[1]!.split(",")) {
      const trimmed = clause.trim().replace(/^type\s+/, "");
      if (trimmed === "") continue;
      // `a as BlockRenderArgs` exports the RIGHT-hand name.
      const parts = trimmed.split(/\s+as\s+/);
      const exported = (parts[parts.length - 1] ?? "").trim();
      if (exported !== "") names.add(exported);
    }
  }

  for (const declared of declaration.matchAll(
    /export\s+(?:declare\s+)?(?:type|interface|const|function|class)\s+([A-Za-z0-9_$]+)/g
  )) {
    names.add(declared[1]!);
  }

  return names;
}

/** The nearest `package.json` at or above a resolved module file. */
function manifestFor(entry: string): string {
  for (let directory = dirname(entry); ; directory = dirname(directory)) {
    const candidate = join(directory, "package.json");
    if (existsSync(candidate)) return candidate;
    if (dirname(directory) === directory) {
      throw new Error(`no package.json above ${entry}`);
    }
  }
}

interface EngineDeclaration {
  readonly kind: string;
  readonly body: string;
}

interface EngineSurface {
  /** Every top-level declaration by name, whether exported or not. */
  readonly declarations: Map<string, EngineDeclaration>;
  /** The subset the engine publishes — the most this package can pass on. */
  readonly exported: Set<string>;
}

/**
 * The engine's built entry, split into what it DECLARES and what it EXPORTS.
 *
 * The bodies are what make CLOSURE checkable: a type is only as writable as
 * the types it is composed of, and that composition is visible nowhere else.
 *
 * Both halves are needed and they are not the same set. Composition runs
 * THROUGH private declarations — `Binding` is an intersection over an
 * unexported `BindingBase` that itself names an exported `BindingFormat` — so
 * traversal must follow them, while the obligation stops at the engine's own
 * export list. This package can only pass on what its dependency publishes;
 * a type the engine keeps private is the engine's call to revisit.
 */
function engineSurface(): EngineSurface {
  // Located from the resolved entry rather than by requiring
  // `.../package.json` directly: the engine's `exports` map does not publish
  // its own manifest, and a hard-coded relative path would bind this test to
  // one workspace layout.
  const require = createRequire(import.meta.url);
  const manifestPath = manifestFor(require.resolve("@nextlyhq/blocks-engine"));
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  const types = readProperty(
    readProperty(readProperty(manifest, "exports"), "."),
    "types"
  );
  if (typeof types !== "string") {
    throw new Error(
      "@nextlyhq/blocks-engine declares no root `types` condition"
    );
  }

  const source = readFileSync(resolve(dirname(manifestPath), types), "utf8");
  const declarations = new Map<string, EngineDeclaration>();
  const heads =
    /^(?:export\s+)?(?:declare\s+)?(type|interface|const|function|class)\s+([A-Za-z0-9_$]+)/gm;

  for (
    let head = heads.exec(source);
    head !== null;
    head = heads.exec(source)
  ) {
    const kind = head[1]!;
    const end =
      kind === "type"
        ? endOfAlias(source, heads.lastIndex)
        : endOfBlock(source, heads.lastIndex);
    declarations.set(head[2]!, {
      kind,
      body: source.slice(head.index, end + 1),
    });
  }

  return { declarations, exported: exportedNames(source) };
}

/** A `type X = ...` runs to its terminating `;` at nesting depth zero. */
function endOfAlias(source: string, from: number): number {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const char = source[i]!;
    if ("{<([".includes(char)) depth++;
    else if ("}>)]".includes(char)) depth--;
    else if (char === ";" && depth <= 0) return i;
  }
  return source.length - 1;
}

/** An `interface X { ... }` runs to its matching brace; a `declare const` to `;`. */
function endOfBlock(source: string, from: number): number {
  let depth = 0;
  let opened = false;
  for (let i = from; i < source.length; i++) {
    const char = source[i]!;
    if (char === "{") {
      depth++;
      opened = true;
    } else if (char === "}") {
      depth--;
      if (opened && depth === 0) return i;
    } else if (char === ";" && !opened) return i;
  }
  return source.length - 1;
}

/**
 * The engine types reachable from a starting set, following composition.
 *
 * **Reachability, not mention, is the obligation.** A consumer handed
 * `BlockDefinition` can name that and still be unable to write the `supports`
 * object it must pass — so every type a re-exported type is BUILT FROM is owed
 * to the same consumer. A check over the names this package's own declarations
 * happen to import cannot see this: `BlockSeoContribution` reaches a caller
 * only through `BlockDefinition["seo"]`, so the bundler never emits an import
 * for it and a scan of import lines reports nothing missing.
 *
 * Only type-like declarations count. A value reached through `typeof` is named
 * by the alias built on it and never written out, so it carries no obligation
 * and re-exporting it would mean shipping engine runtime this package does not
 * otherwise expose.
 */
function reachableTypes(
  seed: Iterable<string>,
  declarations: ReadonlyMap<string, EngineDeclaration>
): Set<string> {
  const reached = new Set<string>();
  const queue = [...seed].filter(name => declarations.has(name));

  while (queue.length > 0) {
    const name = queue.pop();
    const declaration = name === undefined ? undefined : declarations.get(name);
    if (declaration === undefined) continue;

    for (const token of declaration.body.matchAll(
      /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g
    )) {
      const reference = token[0];
      if (reference === name || reached.has(reference)) continue;
      const target = declarations.get(reference);
      if (target === undefined) continue;
      if (target.kind !== "type" && target.kind !== "interface") continue;
      reached.add(reference);
      queue.push(reference);
    }
  }

  return reached;
}

/** `stdout`/`stderr` off a failed `execFileSync`, without assuming its shape. */
function streamText(error: unknown, key: "stdout" | "stderr"): string {
  if (typeof error !== "object" || error === null || !(key in error)) return "";
  const value: unknown = Reflect.get(error, key);
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return "";
}

describe("the published type surface", () => {
  beforeAll(() => {
    // Turbo declares this package's `build` as a dependency of its `test` task,
    // so under Turbo the declarations on disk are current and rebuilding here
    // only repeats work Turbo has already hashed. `TURBO_HASH` is injected into
    // every task Turbo runs and is absent from a direct `vitest` invocation —
    // which is precisely the run that carries no build edge and would otherwise
    // assert against a `dist` predating the source.
    // Non-empty, not merely present: an exported-but-empty `TURBO_HASH` comes
    // from a shell, never from Turbo, and reading it as "Turbo ran the build"
    // skips the rebuild in exactly the run that has no build edge.
    if ((process.env.TURBO_HASH ?? "") !== "") return;

    try {
      // Through Turbo, not `tsup` here. The declaration build resolves
      // `@nextlyhq/blocks-engine`, so invoking the bundler directly on a tree
      // where that package has not been built fails with TS2307 before any
      // declarations exist. `turbo run build` carries the `^build` edge, so the
      // dependency is built first and its result is cached.
      execFileSync(
        "pnpm",
        ["exec", "turbo", "run", "build", "--filter=@nextlyhq/blocks-react"],
        { cwd: REPO_ROOT, stdio: "pipe" }
      );
    } catch (error) {
      // Compiler diagnostics are the only thing that makes a failure here
      // actionable, and a discarded stream reduces every cause to the same
      // opaque non-zero exit.
      const output = `${streamText(error, "stdout")}${streamText(error, "stderr")}`;
      throw new Error(
        `building @nextlyhq/blocks-react failed:\n${output.trim()}`
      );
    }
  }, 300_000);

  // The parsers are the part of this test that can fail SILENTLY: a form they
  // miss reports an absence that is not there, or an obligation that is not
  // required. Three earlier detectors were wrong in exactly these ways — a
  // grep over source (meaningless against `export *`), a parser blind to
  // `export type { }`, and one reading the LEFT of `as` in a re-export.
  it("reads every form the bundler emits", () => {
    expect([
      ...engineTypesIn(
        `import { Binding, type Condition, BlockRenderArgs as BlockRenderArgs$1 } from '@nextlyhq/blocks-engine';`
      ),
    ]).toEqual(["Binding", "Condition", "BlockRenderArgs"]);

    expect([
      ...engineTypesIn(
        `import * as engine from '@nextlyhq/blocks-engine';\n` +
          `declare const b: engine.BlockDefinition<P, C>;`
      ),
    ]).toEqual(["BlockDefinition"]);

    // An import from anywhere else owes this package nothing.
    expect([...engineTypesIn(`import { ReactElement } from 'react';`)]).toEqual(
      []
    );

    expect([
      ...exportedNames(
        `export { a as BlockRenderArgs, type b as NodeStyles };\n` +
          `export type { PageStyles } from './styles.js';\n` +
          `export interface DerivedPageSeo {}\n` +
          `export declare function createBlocksPage(): void;`
      ),
    ]).toEqual([
      "BlockRenderArgs",
      "NodeStyles",
      "PageStyles",
      "DerivedPageSeo",
      "createBlocksPage",
    ]);

    // A name only MENTIONED is the case the whole test exists to separate.
    expect([...exportedNames(`interface BlockDocument {}`)]).toEqual([]);
  });

  it("declares a sentinel for every entry the manifest exports", () => {
    expect(
      entryPoints()
        .map(entry => entry.subpath)
        .sort()
    ).toEqual(Object.keys(SENTINELS).sort());
  });

  it("exports every engine type its declarations name, per entry", () => {
    const entries = entryPoints();

    for (const entry of entries) {
      expect(
        existsSync(entry.declaration),
        `${entry.declaration} is missing — run \`pnpm build --filter @nextlyhq/blocks-react\``
      ).toBe(true);
    }

    const exportsBySubpath = new Map<string, Set<string>>(
      entries.map(entry => [
        entry.subpath,
        exportedNames(readFileSync(entry.declaration, "utf8")),
      ])
    );

    // The positive control, and it is load-bearing. A parser that found NOTHING
    // would assert nothing at all and read as a clean pass.
    for (const [subpath, sentinel] of Object.entries(SENTINELS)) {
      expect(
        exportsBySubpath.get(subpath)?.has(sentinel),
        `parser found no \`${sentinel}\` in the "${subpath}" entry`
      ).toBe(true);
    }

    const rootExports = exportsBySubpath.get(ROOT_SUBPATH) ?? new Set<string>();
    const missing: Record<string, string[]> = {};

    for (const entry of entries) {
      const required = engineTypesNamed(declarationGraph(entry.declaration));
      // A graph walk that reached no chunk, or a scan that matched no import
      // form, requires nothing and reads as a clean pass.
      expect(
        required.size,
        `no engine types derived for the "${entry.subpath}" entry`
      ).toBeGreaterThan(0);

      const reachable =
        exportsBySubpath.get(entry.subpath) ?? new Set<string>();
      const unreachable = [...required]
        .filter(name => !reachable.has(name) && !rootExports.has(name))
        .sort();
      if (unreachable.length > 0) missing[entry.subpath] = unreachable;
    }

    expect(missing).toEqual({});
  });

  it("exports every engine type reachable from the ones it re-exports", () => {
    const { declarations, exported } = engineSurface();
    // A parse that produced nothing would make every closure empty and every
    // obligation vacuous.
    expect(declarations.size).toBeGreaterThan(50);
    expect(declarations.get("BlockDefinition")?.kind).toBe("interface");
    // Traversal must reach declarations the engine keeps private, or the
    // exported types composed through them go unexamined.
    expect(declarations.has("BindingBase")).toBe(true);
    expect(exported.has("BindingBase")).toBe(false);

    const rootExports = exportedNames(
      readFileSync(
        entryPoints().find(entry => entry.subpath === ROOT_SUBPATH)!
          .declaration,
        "utf8"
      )
    );
    const reExported = [...rootExports].filter(name => declarations.has(name));
    expect(reExported.length).toBeGreaterThan(4);

    const unwritable = [...reachableTypes(reExported, declarations)]
      .filter(name => exported.has(name) && !rootExports.has(name))
      .sort();

    expect(unwritable).toEqual([]);
  });
});
