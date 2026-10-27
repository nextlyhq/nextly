import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseSource } from "@nextlyhq/module-specifiers/parse-source";
import { describe, expect, it } from "vitest";

import { compile, listedFiles } from "../../../../scripts/tsc-cli.mjs";

import type {
  GridSize,
  WidgetArchetype,
  WidgetOp,
  WidgetSizeDeclaration,
  WidgetSourceField,
} from "../index";

// The rename is only complete when the old vocabulary is absent from every
// published entry point. A re-exported legacy name is indistinguishable from a
// supported one to anyone reading the package, so the list is spelled out here
// rather than derived: a name that comes back fails this test instead of
// shipping.
const FORBIDDEN = [
  "defineComponent",
  "component",
  "ComponentConfig",
  "ComponentLabel",
  "ComponentAdminOptions",
  "ComponentFieldConfig",
  "isComponentField",
  "validateComponentConfig",
  "assertValidComponentConfig",
  "RESERVED_COMPONENT_SLUGS",
  "MAX_COMPONENT_NESTING_DEPTH",
  "DesiredComponent",
  "dynamicComponents",
  "dynamicComponentsPg",
  "dynamicComponentsMysql",
  "dynamicComponentsSqlite",
  "DynamicComponentRecord",
  "DynamicComponentInsert",
  "ComponentSource",
  "ComponentMigrationStatus",
  "COMPONENT_SOURCE_TYPES",
  "COMPONENT_MIGRATION_STATUSES",
];

// The validators of the retired linked-account endpoints (listing a user's
// linked accounts and unlinking one). The endpoints and the service methods
// behind them are gone, so a validator still published for them describes a
// request nothing accepts.
const RETIRED_ACCOUNT_NAMES = [
  "DeleteUserAccountSchema",
  "UnlinkAccountSchema",
  "UnlinkAccountResponseSchema",
];

// The types inferred from those validators. A type is erased at runtime, so
// importing a module cannot see it, and compiling this file proves nothing
// about a name it never mentions: a type-only re-export would pass both. They
// are read from the compiler's own list of each entry point's exports instead.
const RETIRED_ACCOUNT_TYPES = [
  "DeleteUserAccount",
  "UnlinkAccount",
  "UnlinkAccountResponse",
];

/**
 * What a published function looks like from an import site.
 *
 * Arity and whether it is async, because those are the two halves a caller has
 * to get right and the two the collision this guards against differed in.
 */
function shapeOf(value: (...args: unknown[]) => unknown): string {
  const kind = value.constructor.name === "AsyncFunction" ? "async" : "sync";
  return `${kind}/${String(value.length)}`;
}

/** Names published from more than one entry point with more than one shape. */
function namesPublishedTwice(
  surfaces: Map<string, Record<string, unknown>>
): string[] {
  const seen = new Map<string, Array<{ entry: string; shape: string }>>();
  for (const [entry, mod] of surfaces) {
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value !== "function") continue;
      seen.set(name, [
        ...(seen.get(name) ?? []),
        { entry, shape: shapeOf(value as (...args: unknown[]) => unknown) },
      ]);
    }
  }
  return [...seen.entries()]
    .filter(
      ([, places]) =>
        places.length > 1 && new Set(places.map(p => p.shape)).size > 1
    )
    .map(
      ([name, places]) =>
        `${name}: ${places.map(p => `${p.entry} ${p.shape}`).join(", ")}`
    );
}

/**
 * Names published from two entry points meaning different things.
 *
 * 🔴 EMPTY, and that is the point. It held the two this check found when it was
 * written, `isFieldGroupType` and `createAdapter`, each recorded rather than
 * fixed because each needed the decision `getNextly` needed about which keeps
 * the name. Both have now been made, so nothing is exempt and the next one
 * fails on the day it appears rather than joining a list.
 *
 * Add to this only to record a clash somebody has decided to keep, with the
 * reason. A name added here to make a red test green is the defect being
 * written down instead of fixed.
 */
const KNOWN_SHAPE_CLASHES: string[] = [];

const manifestUrl = new URL("../../package.json", import.meta.url);
const packageRoot = path.dirname(fileURLToPath(manifestUrl));

const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
  exports: Record<string, { import: string }>;
};

const declaredSubpaths = Object.keys(manifest.exports);

/**
 * The source module behind a published subpath.
 *
 * 🔴 The mapping is `dist` -> `src` rather than a second hand-kept list, because a hand-kept list is
 * what this suite exists to stop being possible. `package.json` is what a consumer resolves, so it
 * is the only description of the surface that cannot fall behind it.
 */
function sourceOf(distEntry: string): string {
  return path.join(
    packageRoot,
    distEntry.replace(/^\.\/dist\//, "src/").replace(/\.mjs$/, ".ts")
  );
}

const ENTRY_POINTS: Array<[string, string]> = declaredSubpaths.map(subpath => [
  subpath === "." ? "nextly" : `nextly/${subpath.replace(/^\.\//, "")}`,
  sourceOf(manifest.exports[subpath]!.import),
]);

/**
 * Which of `names` each published entry point exports, types included, keyed by
 * entry point, as the compiler answers it.
 *
 * Read from the compiler rather than from an import, because an import sees only
 * runtime values and a type-only export is erased before it runs. A file per
 * entry point imports each name with `import type`, which accepts a value or a
 * type, and the compiler's command line checks them with the package's own
 * options, so `@nextly/*` paths and every `export *` chain resolve as they do in
 * the build: "has no exported member" on a line is that name's absence. Any other
 * error, such as an entry point that did not load, is a question the compiler
 * could not answer and stops the run rather than reading as an absence.
 *
 * The files sit in a directory of their own under the package's `.turbo`, which
 * git and every scan of the tree ignore, with `rootDir` widened to hold them.
 */
// TS2459 and TS2460 are a module that declares the name without exporting it,
// or exports it under another name: absent from the surface all the same.
const ABSENT = new Set(["TS2305", "TS2724", "TS2614", "TS2459", "TS2460"]);

function exportedAmong(names: readonly string[]): Map<string, Set<string>> {
  const parent = path.join(packageRoot, ".turbo");
  mkdirSync(parent, { recursive: true });
  const scratch = mkdtempSync(path.join(parent, "export-contract-"));
  try {
    const probes = ENTRY_POINTS.map(([entry, source], index) => {
      const file = path.join(scratch, `entry-${index}.ts`);
      const specifier = source.replace(/\.ts$/, "").replaceAll("\\", "/");
      writeFileSync(
        file,
        [
          ...names.map(
            (name, line) =>
              `import type { ${name} as _${line} } from ${JSON.stringify(specifier)};`
          ),
          `export type { ${names.map((_, line) => `_${line}`).join(", ")} };`,
          "",
        ].join("\n")
      );
      return { entry, file };
    });
    const config = path.join(scratch, "tsconfig.json");
    writeFileSync(
      config,
      JSON.stringify({
        extends: path.join(packageRoot, "tsconfig.json"),
        compilerOptions: { rootDir: packageRoot },
        files: probes.map(probe => probe.file),
        include: [],
      })
    );
    const listed = new Set(listedFiles(config));
    for (const { file } of probes) {
      expect(listed, `${file} is not in the program`).toContain(
        file.replaceAll("\\", "/")
      );
    }

    const diagnostics = compile(["-p", config], scratch);
    return new Map(
      probes.map(({ entry, file }) => {
        const absent = new Set<string>();
        for (const d of diagnostics) {
          if (d.file === undefined) continue;
          if (path.resolve(scratch, d.file) !== file) continue;
          const name = names[(d.line ?? 0) - 1];
          if (ABSENT.has(d.code) && name !== undefined) absent.add(name);
          else
            throw new Error(`${entry}: could not ask: ${d.code} ${d.message}`);
        }
        return [entry, new Set(names.filter(name => !absent.has(name)))];
      })
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The names asked about below, in one compile of the package. */
const ASKED = [
  ...RETIRED_ACCOUNT_TYPES,
  ...RETIRED_ACCOUNT_NAMES,
  "WidgetSizeDeclaration",
  "UserListResponse",
  "UserListResponseSchema",
  "defaultSkipAdminApi",
];

let exportedCache: Map<string, Set<string>> | undefined;
function exported(): Map<string, Set<string>> {
  exportedCache ??= exportedAmong(ASKED);
  return exportedCache;
}

/** How long the one compile of the package gets, on a slow runner. */
const COMPILE_TIMEOUT_MS = 180_000;

/** A statement that declares an exported name, with the file it sits in. */
interface Declared {
  file: string;
  text: string;
  start: number;
  comments: ReturnType<typeof parseSource>["comments"];
}

type Statement = ReturnType<typeof parseSource>["program"]["body"][number];

/** The source module a relative specifier names, as the build resolves it. */
function moduleFile(importer: string, specifier: string): string {
  const base = path
    .resolve(path.dirname(importer), specifier)
    .replace(/\.js$/, "");
  const file = [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find(
    candidate => existsSync(candidate)
  );
  if (!specifier.startsWith(".") || file === undefined) {
    throw new Error(`${importer}: could not follow ${specifier}`);
  }
  return file;
}

/** The names a declaration statement binds at the top of its module. */
function declaredNames(statement: Statement): string[] {
  if (statement.type === "FunctionDeclaration") {
    return statement.id ? [statement.id.name] : [];
  }
  if (statement.type === "VariableDeclaration") {
    return statement.declarations.flatMap(declarator =>
      declarator.id.type === "Identifier" ? [declarator.id.name] : []
    );
  }
  return [];
}

function nameOf(node: {
  type: string;
  name?: string;
  value?: unknown;
}): string {
  return node.type === "Identifier" ? (node.name ?? "") : String(node.value);
}

/** A parsed source module. */
interface Module {
  file: string;
  text: string;
  program: ReturnType<typeof parseSource>["program"];
  comments: ReturnType<typeof parseSource>["comments"];
}

function readModule(file: string): Module {
  const text = readFileSync(file, "utf8");
  // Named rather than spread: the parse result declares these as accessors,
  // which a spread does not carry.
  const { program, comments } = parseSource(text, file);
  return { file, text, program, comments };
}

function declaredAt(module: Module, statement: Statement): Declared {
  const { file, text, comments } = module;
  return { file, text, start: statement.start, comments };
}

/** The top-level statement declaring `binding`, exported or not. */
function declarationOf(module: Module, binding: string): Statement | undefined {
  return module.program.body.find(statement => {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    return declaration ? declaredNames(declaration).includes(binding) : false;
  });
}

/** Where an imported `binding` comes from; only a named import can be followed. */
function importOf(
  module: Module,
  binding: string
): { source: string; imported: string } | undefined {
  for (const statement of module.program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    const specifier = statement.specifiers.find(s => s.local.name === binding);
    if (specifier === undefined) continue;
    if (specifier.type !== "ImportSpecifier") {
      throw new Error(`${module.file}: could not follow ${binding}`);
    }
    return {
      source: statement.source.value,
      imported: nameOf(specifier.imported),
    };
  }
  return undefined;
}

/** The declarations behind a binding of this module: its own, or an import's. */
function localDeclarations(
  module: Module,
  binding: string,
  seen: Set<string>
): Declared[] {
  const statement = declarationOf(module, binding);
  if (statement) return [declaredAt(module, statement)];
  const imported = importOf(module, binding);
  if (imported === undefined) {
    throw new Error(`${module.file}: no binding ${binding}`);
  }
  return exportedDeclarations(
    moduleFile(module.file, imported.source),
    imported.imported,
    seen
  );
}

/** What one `export { ... }` or `export <declaration>` publishes as `name`. */
function namedExport(
  module: Module,
  statement: Extract<Statement, { type: "ExportNamedDeclaration" }>,
  name: string,
  seen: Set<string>
): Declared[] {
  const found: Declared[] = [];
  if (
    statement.declaration &&
    declaredNames(statement.declaration).includes(name)
  ) {
    found.push(declaredAt(module, statement));
  }
  for (const specifier of statement.specifiers) {
    if (nameOf(specifier.exported) !== name) continue;
    const binding = nameOf(specifier.local);
    found.push(
      ...(statement.source
        ? exportedDeclarations(
            moduleFile(module.file, statement.source.value),
            binding,
            seen
          )
        : localDeclarations(module, binding, seen))
    );
  }
  return found;
}

/**
 * The declarations behind what `file` exports as `name`, followed through
 * `export { a as b } from`, an export of an imported binding, and `export *`,
 * the way the compiler follows them. Asked of the export rather than found by
 * spelling, because a module re-exporting a different function under this
 * name publishes THAT function, whatever else in the package shares its name.
 * A chain this cannot follow throws rather than reading as no declaration.
 */
function exportedDeclarations(
  file: string,
  name: string,
  seen = new Set<string>()
): Declared[] {
  if (seen.has(`${file}#${name}`)) return [];
  seen.add(`${file}#${name}`);
  const module = readModule(file);
  return module.program.body.flatMap(statement => {
    if (statement.type === "ExportNamedDeclaration") {
      return namedExport(module, statement, name, seen);
    }
    if (statement.type === "ExportAllDeclaration" && !statement.exported) {
      return exportedDeclarations(
        moduleFile(file, statement.source.value),
        name,
        seen
      );
    }
    return [];
  });
}

/**
 * The JSDoc of the one declaration an entry point publishes as `name`. Only a
 * block comment opening with two asterisks, directly above it, counts: a plain
 * block comment is not documentation, and the compiler shows a consumer no tag
 * from one.
 */
function publishedDocs(entrySource: string, name: string): string {
  const declarations = exportedDeclarations(entrySource, name);
  expect(
    declarations.map(d => d.file),
    `declarations published as ${name}`
  ).toHaveLength(1);
  const [declared] = declarations;
  if (declared === undefined) return "";
  const nearest = declared.comments
    .filter(comment => comment.end <= declared.start)
    .at(-1);
  if (nearest === undefined) return "";
  const adjacent =
    declared.text.slice(nearest.end, declared.start).trim() === "";
  const jsdoc = nearest.type === "Block" && nearest.value.startsWith("*");
  return adjacent && jsdoc ? nearest.value : "";
}

describe("published export surface", () => {
  // 🔴 Guards the derivation, not the package. Every check below is generated from `ENTRY_POINTS`,
  // so a mapping that silently produced fewer entries — or none — would delete its own cases and
  // leave a suite whose every remaining case passes. A vanished test reads exactly like a passing
  // one, so the matrix is asserted against the manifest it claims to describe.
  it("covers every subpath package.json publishes", () => {
    expect(ENTRY_POINTS).toHaveLength(declaredSubpaths.length);
    expect(declaredSubpaths.length).toBeGreaterThan(0);
  });

  // The mapping is textual, so a renamed or moved module would resolve to a path that does not
  // exist. Importing it would throw inside the case that names it, which is legible; a missing file
  // is checked separately so the failure says which of the two happened.
  it.each(ENTRY_POINTS)("%s resolves to a source module", (_name, source) => {
    expect(existsSync(source), `no source module at ${source}`).toBe(true);
  });

  it.each(ENTRY_POINTS)(
    "%s exposes no retired linked-account validators",
    async (_name, source) => {
      const mod = (await import(pathToFileURL(source).href)) as Record<
        string,
        unknown
      >;
      const leaked = RETIRED_ACCOUNT_NAMES.filter(name => name in mod);
      expect(leaked).toEqual([]);
    }
  );

  it(
    "exports no retired linked-account type from any entry point",
    () => {
      const compiled = exported();
      const leaked = [...compiled].flatMap(([entry, names]) =>
        [...RETIRED_ACCOUNT_TYPES, ...RETIRED_ACCOUNT_NAMES]
          .filter(name => names.has(name))
          .map(name => `${entry}: ${name}`)
      );
      expect(leaked).toEqual([]);

      // The controls. An entry point the compiler could not load stops the run
      // in `exportedAmong` rather than reading as one exporting nothing, and
      // every entry point is asked. The user types and validators that stayed
      // beside the retired ones must be read through both `export *` hops to
      // the root, or a chain the compiler did not follow would pass this too.
      expect(compiled.size).toBe(ENTRY_POINTS.length);
      for (const entry of ["nextly", "nextly/schemas"]) {
        expect(compiled.get(entry)?.has("UserListResponse")).toBe(true);
        expect(compiled.get(entry)?.has("UserListResponseSchema")).toBe(true);
      }
    },
    COMPILE_TIMEOUT_MS
  );

  it(
    "exports the grid size type a definition names from the root and the config entry",
    () => {
      // A type is erased at runtime, so only the compiler can say it is
      // published. That no named size type is, anywhere, is the source scan's
      // to hold (`domains/widgets/__tests__/one-size-vocabulary.test.ts`).
      const compiled = exported();
      for (const entry of ["nextly", "nextly/config"]) {
        expect([
          entry,
          compiled.get(entry)?.has("WidgetSizeDeclaration"),
        ]).toEqual([entry, true]);
      }
    },
    COMPILE_TIMEOUT_MS
  );

  it(
    "keeps publishing defaultSkipAdminApi from the root, marked deprecated",
    () => {
      // No longer the REST limit's default, and kept for an app that passes it
      // as `rateLimit.skip` until a later release removes it.
      expect(
        exported().get("nextly")?.has("defaultSkipAdminApi"),
        "nextly exports defaultSkipAdminApi"
      ).toBe(true);
      const root = ENTRY_POINTS.find(([entry]) => entry === "nextly")?.[1];
      expect(root, "the root entry point").toBeDefined();
      expect(publishedDocs(root ?? "", "defaultSkipAdminApi")).toMatch(
        /@deprecated\b/
      );
    },
    COMPILE_TIMEOUT_MS
  );

  it("still publishes the user validators beside the retired ones", async () => {
    // The control: an absence check is also satisfied by an entry point that
    // published nothing. `nextly/schemas` is where the retired validators
    // were, and its other user validators are asserted there, so the scan
    // above is seen reading the module they lived in.
    const schemas = (await import("../schemas/index")) as Record<
      string,
      unknown
    >;
    expect(schemas.UserListResponseSchema).toBeDefined();
    expect(schemas.DeleteUserResponseSchema).toBeDefined();
  });

  it.each(ENTRY_POINTS)(
    "%s exposes no legacy component names",
    async (_name, source) => {
      const mod = (await import(pathToFileURL(source).href)) as Record<
        string,
        unknown
      >;
      const leaked = FORBIDDEN.filter(name => name in mod);
      expect(leaked).toEqual([]);
    }
  );

  // 🔴 The defect this generalises: `getNextly` was published from `nextly` as
  // an async function taking a required config, and from `nextly/runtime` as a
  // synchronous one taking none. Same name, opposite tolerance for an
  // uninitialised process, and nothing said so at an import site.
  //
  // Arity alone cannot separate that pair, which is worth stating because the
  // first version of this test used it and would have passed with the defect
  // reinstated: an optional TypeScript parameter is still a declared JavaScript
  // parameter, so `getNextly(options)` and `getNextly(config?)` both report a
  // `length` of 1. Whether the function is async is the half that separates
  // them, and `namesPublishedTwice` compares both.
  it("does not publish one name from two entries with different shapes", async () => {
    const surfaces = new Map<string, Record<string, unknown>>();
    for (const [entry, source] of ENTRY_POINTS) {
      surfaces.set(
        entry,
        (await import(pathToFileURL(source).href)) as Record<string, unknown>
      );
    }
    expect(namesPublishedTwice(surfaces)).toEqual(KNOWN_SHAPE_CLASHES);
    // The control: a scan that imported nothing would report no clash. This
    // asserts the scan actually read a surface.
    expect(surfaces.size).toEqual(ENTRY_POINTS.length);
  });

  it("catches the pair it was written for", () => {
    // The control the first version of this check lacked. These are the two
    // real shapes, and putting them back under one name has to be reported.
    const reinstated = new Map<string, Record<string, unknown>>([
      ["nextly", { getNextly: async (options: unknown) => options }],
      ["nextly/runtime", { getNextly: (config: unknown) => config }],
    ]);
    expect(namesPublishedTwice(reinstated)).toEqual([
      "getNextly: nextly async/1, nextly/runtime sync/1",
    ]);
    // And the other direction: one name, one shape, published twice is a
    // re-export rather than a collision.
    const reexported = new Map<string, Record<string, unknown>>([
      ["nextly", { shared: (a: unknown) => a }],
      ["nextly/runtime", { shared: (a: unknown) => a }],
    ]);
    expect(namesPublishedTwice(reexported)).toEqual([]);
  });

  it("publishes each way to reach an instance under its own name", async () => {
    // The two are kept apart on purpose. `getNextly` initialises and is correct
    // whether or not the process has booted; `requireNextly` reads what is
    // already registered and throws when there is none.
    const root = (await import("../index")) as Record<string, unknown>;
    const runtime = (await import("../runtime")) as Record<string, unknown>;
    expect(typeof root.getNextly).toBe("function");
    expect(typeof runtime.requireNextly).toBe("function");
    expect("getNextly" in runtime).toBe(false);
    expect("requireNextly" in root).toBe(false);
  });

  it("exposes the field-group vocabulary from the config entry point", async () => {
    // The counterpart to the list above: absence alone would also be satisfied
    // by deleting the API, so the replacements are asserted present.
    const cfg = (await import("../config")) as Record<string, unknown>;
    expect(typeof cfg.defineFieldGroup).toBe("function");
    expect(typeof cfg.fieldGroup).toBe("function");
  });

  it("publishes every contract a widget definition names", async () => {
    // `WidgetDefinition` is exported from the root and its `size` is typed
    // `WidgetSizeDeclaration`. There is no `nextly/widgets` subpath, so the root
    // entry point is the only place a plugin author can reach these -- and a
    // publicly visible property whose type has no public name cannot be
    // annotated, only inferred. Same argument for the source contract:
    // `registerSource` and `WidgetSource` are published, so the field and op
    // vocabularies they are built out of have to be nameable too.
    const root = (await import("../index")) as Record<string, unknown>;
    expect(root.GRID_COLUMNS).toBe(12);
    expect(root.WIDGET_ARCHETYPES).toContain("metric");
    expect(root.WIDGET_SOURCE_KINDS).toContain("collection");
    expect(root.WIDGET_OPS).toContain("count");

    // The types themselves: this file is compiled by `tsconfig.tests.json`, so
    // an unexported name here is a `check-types` failure rather than a silent
    // pass. Each is annotated (never merely inferred), which is the property a
    // plugin author actually needs.
    const unit: GridSize = { w: 6, h: 4 };
    const size: WidgetSizeDeclaration = { default: unit };
    const archetype: WidgetArchetype = "metric";
    const op: WidgetOp = "count";
    const field: WidgetSourceField = { name: "title", type: "string" };
    expect([unit, size, archetype, op, field.name]).toHaveLength(5);
  });

  it("publishes the grid size functions from the config entry point", async () => {
    // The admin sizes, clamps and offers a card's sizes through these, read
    // from `nextly/config`, so each must be a value there and not a type only.
    const cfg = (await import("../config")) as Record<string, unknown>;
    expect(cfg.GRID_COLUMNS).toBe(12);
    for (const name of [
      "clampSize",
      "isGridSize",
      "narrowedSizeBounds",
      "sizeBounds",
      "sizeDeclarationProblems",
      "sizeWithinBounds",
    ]) {
      expect([name, typeof cfg[name]]).toEqual([name, "function"]);
    }
    expect(cfg.UNSTATED_WIDGET_SIZE).toEqual({
      default: { w: 12, h: 4 },
      min: { w: 3, h: 2 },
      max: { w: 12, h: 6 },
    });
  });

  it("publishes the field-group type accessor", async () => {
    // Named explicitly because the derived matrix would still pass if this subpath were dropped
    // from package.json: the surface would simply be described as smaller. The accessor is the one
    // entry point whose absence sends callers back to reading the raw storage key by hand.
    expect(declaredSubpaths).toContain("./field-group-type");
    const mod = (await import("../field-group-type")) as Record<
      string,
      unknown
    >;
    expect(typeof mod.readFieldGroupType).toBe("function");
    expect(typeof mod.isFieldGroupType).toBe("function");
    expect(typeof mod.writeFieldGroupType).toBe("function");
  });

  /**
   * The names a resolved clash left behind, asserted where they were promised.
   *
   * An empty {@link KNOWN_SHAPE_CLASHES} says only that no name is published
   * twice with different shapes. Deleting `isFieldGroupFieldType` outright
   * satisfies that too, and so does dropping `createCliAdapter`: the collision
   * is gone either way, and a rename that quietly became a deletion reads as a
   * pass.
   *
   * So each is asserted at the entry it was moved TO. A rename is a promise
   * about where a caller finds the function afterwards, and that is the half an
   * absence check cannot make.
   */
  it("keeps the names the resolved clashes were renamed to", async () => {
    const root = (await import("../index")) as Record<string, unknown>;
    expect(typeof root.isFieldGroupFieldType).toBe("function");

    const fieldGroupType = (await import("../field-group-type")) as Record<
      string,
      unknown
    >;
    expect(typeof fieldGroupType.isFieldGroupFieldType).toBe("function");

    const cli = (await import("../cli/utils")) as Record<string, unknown>;
    expect(typeof cli.createCliAdapter).toBe("function");

    const database = (await import("../database")) as Record<string, unknown>;
    expect(typeof database.createAdapter).toBe("function");

    // The root re-exports the database factory, so `createAdapter` is expected
    // HERE and is the same function `nextly/database` publishes. That pair was
    // never the clash: they agreed. The CLI's was the odd one, and the other
    // half of the promise is that its old spelling has not come back.
    expect(root.createAdapter).toBe(database.createAdapter);
    expect(cli.createAdapter).toBeUndefined();
  });
});
