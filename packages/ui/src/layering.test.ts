/**
 * `@nextlyhq/ui` is the block-agnostic layer.
 *
 * The page builder splits three ways, and the split is what keeps one rule in
 * one place:
 *
 * - `blocks-engine` owns the block model, its validation and its style
 *   compiler. No UI.
 * - `packages/builder` is UI that UNDERSTANDS blocks. It depends on the engine
 *   and reads rules from it directly.
 * - this package is generic primitives — button, dialog, input, colour
 *   arithmetic — and knows nothing about blocks.
 *
 * The third clause is the load-bearing one. A block-aware component placed HERE
 * cannot reach the engine cheaply, so it restates the engine's rules instead,
 * and the copy drifts silently: the editor accepts a definition compilation
 * discards, or refuses one it would have kept. That has already happened three
 * times, in the breakpoint rules, a token predicate and an access context.
 *
 * This is not a new rule. `.claude/rules/derived-checks.md` already states it —
 * a narrower view must be DERIVED from the richer one, because two
 * implementations agree the day they are written and drift silently after —
 * and records defects from five unrelated packages behind it.
 *
 * WHAT THIS FILE ESTABLISHES, and what it does not. The checks decide one
 * narrow thing: this package takes no DIRECT dependency on the engine, by
 * manifest or by import. That is a PRECONDITION for the layer being
 * block-agnostic, not evidence that it is — a second implementation of an
 * engine rule is ordinary code, not an import, and no scan below can see one.
 *
 * The known counter-example is GONE as of 2026-08-12. `lib/breakpoints.ts` and
 * `breakpoint-dialog.tsx` restated the compiler's breakpoint drop rules and
 * were green under every assertion here for exactly that reason. They now live
 * in `packages/builder`, which depends on the engine and imports its cap and
 * types rather than mirroring them. The `./breakpoints` subpath was removed
 * from this package's export map in the same change.
 *
 * So no restatement is KNOWN to remain — which is a weaker claim than none
 * existing, and deliberately worded that way.
 *
 * Placement is worth enforcing precisely because availability is not enough.
 * `baseStyles` on the block definition is the supported way to declare a
 * block's visual defaults, is derived by the renderer, and is used by no block
 * in this repository — while blocks restate the same defaults inline. A
 * supported export that is merely available loses to the easy path, so the
 * boundary has to be one something FAILS at.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  importedSpecifiers,
  UNRESOLVABLE_SPECIFIER,
} from "@nextlyhq/module-specifiers";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const SRC = join(__dirname);

/** Every manifest field that can make a package resolvable from here. */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** The package this layer may not reach. */
const FORBIDDEN = "@nextlyhq/blocks-engine";

/**
 * Every module extension the bundler follows.
 *
 * Pinned as a literal, and wider than the `.ts`/`.tsx` a source tree usually
 * holds: tsup follows a local `.mts` or `.cts` bridge as readily as a `.ts`
 * one, so a scan that reads only the common two leaves a route into the bundle
 * unwatched. The `.js` family is here for the same reason — nothing stops a
 * shipped entry importing one.
 */
const MODULE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

/**
 * Whether a filename is a shipped module this scan must read.
 *
 * Separated from the directory walk so each extension can be exercised
 * directly. Driving it through the filesystem instead means a route is only
 * covered if a file with that extension happens to exist today.
 */
function isShippedModule(entry: string): boolean {
  if (/\.(test|fixture)\./.test(entry)) return false;
  return MODULE_EXTENSIONS.some(extension => entry.endsWith(extension));
}

/**
 * Whether a module specifier loads the forbidden package.
 *
 * A SUBPATH counts. `@nextlyhq/blocks-engine/schema` reaches the same package
 * through its export map, so an equality test on the package name admits the
 * dependency through every subpath the engine publishes — and the subpaths are
 * exactly where a narrow, tempting import lives. The trailing slash is what
 * keeps a differently-named neighbour such as `@nextlyhq/blocks-engine-extra`
 * from matching a prefix it merely starts with.
 */
function resolvesToForbidden(specifier: string): boolean {
  return specifier === FORBIDDEN || specifier.startsWith(`${FORBIDDEN}/`);
}

/**
 * Whether a specifier stops this file being cleared.
 *
 * Two different reasons, and the second is easy to lose. A specifier that
 * RESOLVES to the engine is the obvious one. A specifier the reader could not
 * read — `import(name)`, `require(base + id)` — is the other: it is reported as
 * {@link UNRESOLVABLE_SPECIFIER}, and passing that through a "does this name the
 * engine" test answers `false`, which certifies a load nobody has read.
 *
 * This guard is allow-by-default: it names ONE forbidden package rather than
 * listing what is permitted, so an unreadable specifier falls straight through
 * unless it is rejected on purpose. `packages/builder` is deny-by-default and
 * gets this for free, because a marker that matches no allowlist entry is
 * already a violation there. The marker was designed for that shape; this
 * consumer has to opt in.
 */
function blocksClearance(specifier: string): boolean {
  return resolvesToForbidden(specifier) || specifier === UNRESOLVABLE_SPECIFIER;
}

/**
 * Every `field.package` a manifest declares that RESOLVES to the forbidden
 * package — by name, or through an npm alias.
 *
 * Keys alone are not the boundary. `"engine": "npm:@nextlyhq/blocks-engine@1"`
 * declares the engine under a name of the author's choosing, so the key says
 * `engine` and the source says `import ... from "engine"`: the manifest check
 * and the import check both see a package they have never heard of, and both
 * pass. The VALUE is where the real specifier lives.
 *
 * Both routes ask {@link resolvesToForbidden} rather than testing the string
 * themselves. A second opinion about which package a name refers to is what
 * makes a guard disagree with itself: a bare `npm:<pkg>` prefix test rejects
 * `npm:@nextlyhq/blocks-engine-extra` — a legitimately different package — even
 * while the import side is careful to allow it.
 */
function aliasedPackage(range: string): string | null {
  if (!range.startsWith("npm:")) return null;
  const target = range.slice("npm:".length);
  // A scoped package opens with `@`, so the version delimiter is the LAST `@`
  // rather than the first. An alias carrying no version is the whole remainder.
  const versionAt = target.lastIndexOf("@");
  return versionAt > 0 ? target.slice(0, versionAt) : target;
}

function forbiddenDeclarationsIn(manifest: Record<string, unknown>): string[] {
  return DEPENDENCY_FIELDS.flatMap(field =>
    Object.entries((manifest[field] as Record<string, string>) ?? {})
      .filter(([name, range]) => {
        if (resolvesToForbidden(name)) return true;
        const target = aliasedPackage(range);
        return target !== null && resolvesToForbidden(target);
      })
      .map(([name]) => `${field}.${name}`)
  );
}

/**
 * Every SHIPPED source file in this package.
 *
 * Test material is excluded by three separate spellings, because it uses all
 * three: a `.test.ts` filename, a `__tests__` directory holding helpers that
 * carry no test suffix, and a `.fixture.ts` file. Excluding only the filename
 * suffix reports a helper importing the engine FOR a test as a production
 * layering violation, which is a false alarm about code that never ships.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" ? [] : sourceFiles(path);
    }
    return isShippedModule(entry) ? [path] : [];
  });
}

describe("this package takes no direct dependency on the block engine", () => {
  it("is exercised — there are source files to scan", () => {
    // Without this the assertions below pass against an empty list, which is
    // the shape of a guard that reports success because it found nothing.
    expect(sourceFiles(SRC).length).toBeGreaterThan(20);
  });

  it("declares it in no manifest field", () => {
    // All four fields, because each makes the engine reachable in its own way:
    // `peerDependencies` and `optionalDependencies` push it onto consumers,
    // and `devDependencies` makes it resolvable while the package is being
    // written, which is exactly when a component would reach for it.
    const manifest: Record<string, unknown> = JSON.parse(
      readFileSync(join(SRC, "..", "package.json"), "utf8")
    ) as Record<string, unknown>;

    expect(
      forbiddenDeclarationsIn(manifest),
      "packages/ui is the block-agnostic layer. A component needing the block " +
        "model belongs in packages/builder, which already depends on the engine."
    ).toEqual([]);
  });

  it("names every npm dependency field, so no route can go missing", () => {
    // Pinned as a literal set, because the per-field control below cannot
    // guard the list it iterates: removing a field deletes that field's own
    // case, the suite shrinks by one and every remaining case passes. A
    // vanishing test reads exactly like a passing one.
    expect([...DEPENDENCY_FIELDS].sort()).toEqual([
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]);
  });

  it.each(DEPENDENCY_FIELDS)(
    "is exercised — the collector reads the %s field",
    field => {
      // Per field, not in aggregate. A count-based control is satisfied by the
      // fields that happen to be populated, so dropping `dependencies` from the
      // list would leave it green while the real assertion stopped inspecting
      // runtime dependencies entirely. A sentinel in ONE field at a time is the
      // only shape that fails when that field's route is missing.
      expect(
        forbiddenDeclarationsIn({ [field]: { [FORBIDDEN]: "workspace:*" } })
      ).toEqual([`${field}.${FORBIDDEN}`]);
      // The ALIAS route through the same field. `"engine": "npm:<pkg>@1"`
      // declares the engine under a name of the author's choosing, so a check
      // reading keys alone never sees the package it forbids.
      expect(
        forbiddenDeclarationsIn({
          [field]: { engine: `npm:${FORBIDDEN}@1.0.0` },
        })
      ).toEqual([`${field}.engine`]);
    }
  );

  it("names every module extension the bundler follows", () => {
    // Pinned literally, for the reason the field list is: removing an
    // extension deletes that extension's own case below, the suite shrinks by
    // one, and every remaining case passes. A vanishing test reads exactly
    // like a passing one.
    expect([...MODULE_EXTENSIONS].sort()).toEqual([
      ".cjs",
      ".cts",
      ".js",
      ".jsx",
      ".mjs",
      ".mts",
      ".ts",
      ".tsx",
    ]);
  });

  it.each(MODULE_EXTENSIONS)("scans a %s module", extension => {
    // Per extension, asserted on the decision rather than through the
    // filesystem: driving this off real files covers only the extensions that
    // happen to exist today, and a `.mts` bridge importing the engine is
    // exactly the file nobody has written yet.
    expect(isShippedModule(`bridge${extension}`)).toBe(true);
    expect(isShippedModule(`bridge.test${extension}`)).toBe(false);
  });

  it("skips a file the bundler does not follow", () => {
    // The positive control for the two above: an `isShippedModule` returning
    // true for everything satisfies every extension case.
    expect(isShippedModule("theme.css")).toBe(false);
    expect(isShippedModule("README.md")).toBe(false);
  });

  it("is exercised — the import scan can find the specifier it hunts", () => {
    // An empty offender list is only evidence once the search is shown to
    // work. A renamed package or a typo in the pattern returns exactly the same
    // clean result as compliance does.
    //
    // This asserts the WIRING, in the two shapes this package's own files take:
    // a `.ts` module and the `.tsx` most of it is written in. One case per
    // import form the reader claims — and the comment and string cases it must
    // NOT claim — lives beside the reader in
    // `packages/module-specifiers/src/index.test.ts`, so a reader that stops
    // recognising a form fails there rather than silently in every consumer.
    expect(
      importedSpecifiers(`import { x } from "${FORBIDDEN}";`, "module.ts")
    ).toContain(FORBIDDEN);
    expect(
      importedSpecifiers(
        `export const C = () => <div>{require("${FORBIDDEN}")}</div>;`,
        "component.tsx"
      )
    ).toContain(FORBIDDEN);
    expect(
      importedSpecifiers('import { x } from "@nextlyhq/ui";', "module.ts")
    ).toEqual(["@nextlyhq/ui"]);
  });

  it("counts a subpath of the forbidden package, and only that package", () => {
    // The export map is the open door: the package root may never be imported
    // while a subpath delivers the same dependency. The neighbour case is the
    // other half — a prefix test alone rejects a package that merely shares the
    // opening characters, which is the false positive that gets a guard muted.
    expect(resolvesToForbidden(FORBIDDEN)).toBe(true);
    expect(resolvesToForbidden(`${FORBIDDEN}/schema`)).toBe(true);
    expect(resolvesToForbidden(`${FORBIDDEN}-extra`)).toBe(false);
    expect(resolvesToForbidden("@nextlyhq/ui")).toBe(false);

    // The manifest side must agree, and it is a separate code path: a neighbour
    // declared through an alias is a legal dependency, and a guard that fails
    // the suite over one is a guard people start routing around.
    expect(
      forbiddenDeclarationsIn({
        dependencies: { engine: `npm:${FORBIDDEN}-extra@1.0.0` },
      })
    ).toEqual([]);
    // An alias carrying no version at all still resolves to a package.
    expect(
      forbiddenDeclarationsIn({ dependencies: { engine: `npm:${FORBIDDEN}` } })
    ).toEqual(["dependencies.engine"]);

    // Through the reader, because that is how the scan asks the question.
    expect(
      importedSpecifiers(
        `import { s } from "${FORBIDDEN}/schema";`,
        "module.ts"
      ).some(resolvesToForbidden)
    ).toBe(true);
  });

  it("refuses to clear a file whose load it could not read", () => {
    // A computed target cannot be resolved by reading the file, so the reader
    // reports a marker rather than a name. Asked only "does this name the
    // engine", the marker answers no — and the file is certified on the
    // strength of a load nobody read.
    //
    // Driven through the reader rather than by handing the marker straight to
    // the predicate: the two have to agree about what an unreadable load
    // produces, and a test that supplies the marker itself would pass even if
    // the reader stopped emitting it.
    const computed = importedSpecifiers(
      `const m = await import(name);`,
      "module.ts"
    );
    expect(computed).toEqual([UNRESOLVABLE_SPECIFIER]);
    expect(computed.some(blocksClearance)).toBe(true);

    // And the reason it needs saying here at all: the narrower predicate this
    // one wraps says no, because the marker is not the engine's name.
    expect(computed.some(resolvesToForbidden)).toBe(false);

    // An ordinary import is still cleared, so the guard has not become one that
    // rejects everything.
    expect(
      importedSpecifiers('import { x } from "react";', "module.ts").some(
        blocksClearance
      )
    ).toBe(false);
  });

  it("imports it in no shipped source file", () => {
    // The manifest alone is not a boundary: under pnpm a package hoisted for
    // another workspace member stays importable from one whose own manifest
    // never declares it. The import is the thing that would actually resolve,
    // so the import is what is checked.
    const offenders = sourceFiles(SRC).filter(file =>
      importedSpecifiers(readFileSync(file, "utf8"), file).some(blocksClearance)
    );

    expect(
      offenders,
      "A component that needs the block model belongs in packages/builder, " +
        "which already depends on the engine. Importing it here makes this " +
        "package block-aware; restating its rules here makes them drift."
    ).toEqual([]);
  });
});

/**
 * Runtime module resolution, which a bundler cannot see and an artifact scan cannot bound.
 *
 * `require`, `createRequire`, `module.require` and `import.meta.resolve` name a module without
 * importing it. The bundler never resolves them, so they appear in no metafile record and leave no
 * surviving import — a consumer installing only the declared dependencies gets a resolution error
 * at runtime for something no build-time check saw.
 *
 * This is a SOURCE ban rather than an artifact scan, and the difference is the point. Reading the
 * built output for these constructs means recognising every way a resolver can be stored and
 * retrieved: under a name, through an alias, destructured, on an object property, assigned after
 * declaration, reassigned before use. Each is a valid spelling, the set has no end, and the check
 * has to be right about all of them. A source ban is complete by construction — the constructs
 * simply are not present — and a bundled DEPENDENCY that uses one is caught by the artifact gate
 * as a package, which is the half a source ban cannot see.
 */
const RUNTIME_RESOLVERS = [
  "createRequire",
  "module.require",
  "import.meta.resolve",
];

/** The runtime-resolution constructs a shipped source file names, read from the syntax. */
function runtimeResolversIn(text: string, fileName: string): string[] {
  const tree = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true
  );
  const found: string[] = [];

  /** `a.b` and `a["b"]` are the same read, and a rule for one is a rule the other walks around. */
  const readsMember = (node: ts.Node, member: string): boolean => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text === member;
    if (!ts.isElementAccessExpression(node)) return false;
    const key = node.argumentExpression;
    return (
      (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) &&
      key.text === member
    );
  };

  const visit = (node: ts.Node): void => {
    // Any import of Node's module loader, in either specifier spelling. The named binding is not
    // checked: importing the module at all is what makes the loader reachable.
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const from = node.moduleSpecifier.text;
      if (from === "node:module" || from === "module")
        found.push("createRequire");
    }
    // `import.meta` is checked as a WHITELIST rather than by hunting for `.resolve`, and that is
    // what makes this bounded where the artifact scan was not. Hunting means enumerating the ways
    // a resolver can be reached — `.resolve`, `["resolve"]`, `const { resolve } = import.meta`,
    // handed to a function — and the set has no end. Allowing only `import.meta.url` refuses every
    // other use by construction, including ones nobody has thought of.
    if (
      ts.isMetaProperty(node) &&
      node.keywordToken === ts.SyntaxKind.ImportKeyword
    ) {
      const read = node.parent;
      const isUrl =
        read !== undefined &&
        (ts.isPropertyAccessExpression(read) ||
          ts.isElementAccessExpression(read)) &&
        read.expression === node &&
        readsMember(read, "url");
      if (!isUrl) found.push("import.meta.resolve");
    }
    // `module.require(...)`, which survives a format guard into a CommonJS build.
    if (
      readsMember(node, "require") &&
      ts.isIdentifier((node as ts.PropertyAccessExpression).expression) &&
      ((node as ts.PropertyAccessExpression).expression as ts.Identifier)
        .text === "module"
    ) {
      found.push("module.require");
    }
    ts.forEachChild(node, visit);
  };

  visit(tree);
  return [...new Set(found)];
}

describe("this package resolves no module at runtime", () => {
  it("is exercised — the reader finds each construct it bans", () => {
    // Without this the assertion below passes against a reader that finds nothing, which is the
    // shape of a guard reporting success because it looked for the wrong thing.
    expect(
      runtimeResolversIn(`import { createRequire } from "node:module";`, "a.ts")
    ).toEqual(["createRequire"]);
    expect(runtimeResolversIn(`import mod from "module";`, "a.ts")).toEqual([
      "createRequire",
    ]);
    expect(
      runtimeResolversIn(`export const r = import.meta.resolve("x");`, "a.ts")
    ).toEqual(["import.meta.resolve"]);
    expect(
      runtimeResolversIn(
        `export const r = import.meta["resolve"]("x");`,
        "a.ts"
      )
    ).toEqual(["import.meta.resolve"]);
    expect(
      runtimeResolversIn(`export const r = module.require("x");`, "a.ts")
    ).toEqual(["module.require"]);
    expect(
      runtimeResolversIn(`export const r = module["require"]("x");`, "a.ts")
    ).toEqual(["module.require"]);
    // Stored, aliased or destructured, the CONSTRUCT is still named in the source — which is what
    // makes a source ban bounded where reading the built artifact was not.
    expect(
      runtimeResolversIn(
        `const { resolve } = import.meta;\nconst load = resolve;`,
        "a.ts"
      )
    ).toEqual(["import.meta.resolve"]);
    // The controls: ordinary code names none of them.
    expect(
      runtimeResolversIn(
        `import { clsx } from "clsx";\nexport const x = clsx("a");`,
        "a.ts"
      )
    ).toEqual([]);
    expect(
      runtimeResolversIn(`export const u = import.meta.url;`, "a.ts")
    ).toEqual([]);
    expect(
      runtimeResolversIn(
        `const holder = { require: (n) => n };\nholder.require("x");`,
        "a.ts"
      )
    ).toEqual([]);
  });

  it("names one in no shipped source file", () => {
    const offenders = sourceFiles(SRC)
      .map(
        file =>
          [file, runtimeResolversIn(readFileSync(file, "utf8"), file)] as const
      )
      .filter(([, found]) => found.length > 0)
      .map(([file, found]) => `${file}: ${found.join(", ")}`);

    expect(
      offenders,
      `A published entry point may not resolve a module at runtime. ${RUNTIME_RESOLVERS.join(", ")} ` +
        "name a package the bundler never resolves, so it appears in no build record and a " +
        "consumer installing the declared dependencies gets a resolution error instead. Import " +
        "the module normally, or add the dependency deliberately."
    ).toEqual([]);
  });
});
