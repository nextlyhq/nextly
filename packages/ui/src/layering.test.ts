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
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

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
  if (/\.(test|fixture|spec)\./.test(entry)) return false;
  return MODULE_EXTENSIONS.some(extension => entry.endsWith(extension));
}

/**
 * The files the SHIPPING tsconfig compiles, asked of TypeScript rather than recomputed.
 *
 * `isShippedModule` answers the same question by pattern, and the two drifted: the tsconfig
 * excludes `*.spec.ts` and `*.spec.tsx`, the pattern did not, and a contributor adding a
 * conventional spec file would have had it scanned as published code and rejected for using
 * `eval` in a test. Whichever way that divergence points it is wrong — a spec scanned as shipped
 * blocks valid work, and a shipped file the tsconfig stops compiling would silently leave the
 * scan. Asking the compiler makes the next convention added to `exclude` apply here for free.
 */
function tsconfigShippedFiles(): string[] {
  const path = join(SRC, "..", "tsconfig.json");
  const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, "utf8"));
  const resolved = ts.parseJsonConfigFileContent(
    parsed.config,
    ts.sys,
    join(SRC, "..")
  );
  return resolved.fileNames.map(file => resolve(file)).sort();
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
 * has to be right about all of them. A bundled DEPENDENCY that uses one is caught by the artifact
 * gate as a package, which is the half a source ban cannot see.
 *
 * ## WHAT THIS BAN DOES NOT ESTABLISH
 *
 * Stated here rather than left to be discovered from a miss, because a green run reads as
 * "this package resolves nothing at runtime" and that is stronger than what was checked.
 *
 * Each rule below is written to refuse by NAMING WHAT IS ALLOWED rather than by listing what is
 * not — `import.meta` permits only `.url`, `process` only `.env`/`typeof`/a declaration, the
 * loader module is banned by specifier through the shared reader, and the ambient names are
 * refused outright. Within its reach that construction is complete: a spelling nobody has thought
 * of is refused with the rest.
 *
 * Its REACH is the limit. This reads syntax, so it sees a route only where the route appears as
 * syntax it recognises: computed member access, host objects that re-expose globals, dynamic
 * evaluation, an absolute import, a manifest alias, and an import into a path this scan skips are
 * all covered because each was found and added. None of them was found BY the check.
 *
 * One boundary of that reach is worth naming exactly, because it is reachable rather than
 * hypothetical. A restricted global read under a LITERAL key — `globalThis["process"]` — is
 * refused, since a literal is a fixed translation of the dotted form. A COMPUTED key is not:
 * `globalThis["pro" + "cess"]` names the same binding and cannot be recognised without evaluating
 * the expression, which is a different kind of analysis than reading syntax. The same holds for a
 * specifier computed at runtime and handed to a loader that is otherwise allowed.
 *
 * A boundary that does not depend on recognising anything is to BUILD the package into a project
 * containing only the dependencies it is allowed to use, and run it: a load of anything else fails
 * at that moment, whatever spelling produced it. That is complete in the dimension this is weak
 * in, and blind where this is strong — it only sees code that actually executes, so a resolver
 * behind a branch never taken is invisible to it, and visible here. Neither replaces the other.
 * Tracked as its own task rather than grown into this file.
 */
/**
 * The names that re-expose the global object, so `X.process` is the `process` binding itself.
 *
 * Closed by the language rather than by this list's authorship: `globalThis` is the standard
 * spelling, and the other three are the host aliases that exist on the runtimes this package ships
 * to. A name skipped as a property key after one of these is not a key at all.
 */
const GLOBAL_OBJECTS = new Set(["globalThis", "global", "self", "window"]);

/** The globals this package may not reach, whether named directly or off a host object. */
const RESTRICTED_GLOBALS = new Set([
  "require",
  "module",
  "process",
  "eval",
  "Function",
]);

const RUNTIME_RESOLVERS = [
  "require",
  "module",
  "eval",
  "process.getBuiltinModule",
  "createRequire",
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

  /**
   * Whether an identifier sits in a slot that NAMES a member, rather than referring to a binding.
   *
   * `holder.require` and `{ require: fn }` spell the word without reaching the ambient loader — the
   * key belongs to some other object. Everything else is treated as a reference, including a
   * DECLARATION of the name: `const require = …` shadows it, and a shipped module that introduces
   * either name is refused rather than scope-analysed, which is the analysis this boundary exists
   * to avoid needing.
   */
  /**
   * Whether an expression IS a host object, seen through casts and grouping.
   *
   * `(globalThis as typeof globalThis & { process: P }).process` reads the same binding as
   * `globalThis.process`, but the receiver is an `AsExpression` rather than an identifier — so a
   * check reading the receiver directly treats `process` as somebody else's property key. `as`,
   * `satisfies`, `!` and parentheses change the type or the grouping and never which object is in
   * hand, so they are transparent here for the same reason they are transparent to capture.
   */
  const receiverIsHost = (expression: ts.Expression): boolean => {
    let current: ts.Node = expression;
    while (
      ts.isAsExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
    }
    return ts.isIdentifier(current) && GLOBAL_OBJECTS.has(current.text);
  };

  const isMemberName = (node: ts.Identifier): boolean => {
    const parent = node.parent;
    if (parent === undefined) return false;
    // `globalThis.process` is the SAME binding as `process`, so treating the word as a harmless
    // key there hands back every restricted global through one extra hop. The host objects that
    // re-expose globals are a closed set the language defines, unlike the open set of member
    // spellings this predicate exists to skip.
    if (ts.isPropertyAccessExpression(parent)) {
      if (parent.name === node && receiverIsHost(parent.expression))
        return false;
      return parent.name === node;
    }
    if (ts.isQualifiedName(parent)) return parent.right === node;
    if (ts.isBindingElement(parent)) return parent.propertyName === node;
    // `<Widget module={value} require />` spells both words as PROP names. They reach no ambient
    // binding, and reporting them would reject a component that resolves nothing.
    if (ts.isJsxAttribute(parent)) return parent.name === node;
    if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) {
      return parent.propertyName === node;
    }
    if (
      ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isEnumMember(parent)
    ) {
      return parent.name === node;
    }
    return false;
  };

  /**
   * A restricted global read off a host object under a LITERAL key: `globalThis["process"]`.
   *
   * The identifier rules below cannot see this — there is no `process` node, only a string — and
   * `isMemberName` is not involved either. Literal keys are covered because they are a fixed
   * translation of the dotted form. A COMPUTED key is not, and cannot be without evaluating the
   * expression; that limit is stated in this file's doc comment rather than left to be found.
   */
  const readsRestrictedGlobal = (node: ts.Node): string | undefined => {
    if (!ts.isElementAccessExpression(node)) return undefined;
    if (
      !ts.isIdentifier(node.expression) ||
      !GLOBAL_OBJECTS.has(node.expression.text)
    ) {
      return undefined;
    }
    const key = node.argumentExpression;
    if (!ts.isStringLiteral(key) && !ts.isNoSubstitutionTemplateLiteral(key)) {
      return undefined;
    }
    return RESTRICTED_GLOBALS.has(key.text) ? key.text : undefined;
  };

  /**
   * Whether a host-object reference is CAPTURED — bound to a name, passed, or stored.
   *
   * Aliasing is what defeats a rule that requires the receiver to be the literal host:
   * `const host = globalThis; host.process` reaches the same binding through a name, and
   * recognising that means following a value through a binding, which is dataflow rather than
   * syntax. So capture itself is refused, and the three NON-capturing uses are allowed instead:
   * testing with `typeof`, testing membership with `in`, and reading a member off it. That is a
   * statement about what may be DONE with the object rather than a list of spellings, so an alias
   * created in a way nobody has thought of is refused with the rest.
   *
   * `as`, `!` and parentheses are unwrapped on the way up: they change the type or the grouping,
   * never which object is in hand, and real code cast `window` before reading a member off it.
   */
  const capturesHost = (node: ts.Identifier): boolean => {
    let child: ts.Node = node;
    let parent = node.parent;
    while (
      parent !== undefined &&
      (ts.isAsExpression(parent) ||
        ts.isParenthesizedExpression(parent) ||
        ts.isNonNullExpression(parent) ||
        ts.isSatisfiesExpression(parent))
    ) {
      child = parent;
      parent = parent.parent;
    }
    if (parent === undefined) return true;
    // Reading a member off it, which the member rules then judge on their own terms.
    if (
      (ts.isPropertyAccessExpression(parent) ||
        ts.isElementAccessExpression(parent)) &&
      parent.expression === child
    ) {
      return false;
    }
    // `typeof host`, and `"name" in host` — neither yields a reference to the object.
    if (ts.isTypeOfExpression(parent)) return false;
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.InKeyword &&
      parent.right === child
    ) {
      return false;
    }
    // A declaration of the name, or any type position, introduces no value.
    if (ts.isVariableDeclaration(parent) && parent.name === child) return false;
    if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)) {
      return false;
    }
    return true;
  };

  const visit = (node: ts.Node): void => {
    const restricted = readsRestrictedGlobal(node);
    if (restricted !== undefined) found.push(restricted);
    if (
      ts.isIdentifier(node) &&
      GLOBAL_OBJECTS.has(node.text) &&
      !isMemberName(node) &&
      capturesHost(node)
    ) {
      found.push(node.text);
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
    // The ambient CommonJS names are refused OUTRIGHT, not in the shapes that call them. A rule
    // written for `module.require(...)` is walked around by `module["req" + "uire"](...)`, and one
    // written for `require(...)` by `const load = require`, because both describe a use rather than
    // the name. Neither identifier is a reference a shipped module has any reason to make — the
    // package is authored as ESM and there are none today — so the name itself is the boundary,
    // and any use of it, including one nobody has thought of, is refused by construction.
    if (
      ts.isIdentifier(node) &&
      (node.text === "require" || node.text === "module") &&
      !isMemberName(node)
    ) {
      found.push(node.text);
    }
    // Dynamic code evaluation puts the specifier in a STRING, where no visitor over syntax can
    // see it — `eval('require("react")')` contains no `require` node at all. There is no reading
    // of the source that recovers it, so the constructs themselves are refused: this package
    // renders components and computes styles, and never has cause to build code at runtime.
    if (
      ts.isIdentifier(node) &&
      (node.text === "eval" || node.text === "Function") &&
      !isMemberName(node)
    ) {
      found.push(node.text);
    }
    // `process` cannot be refused outright — `process.env.NODE_ENV` is how this package decides
    // whether to warn — so it is WHITELISTED down to the uses that exist, exactly as `import.meta`
    // is. `process.getBuiltinModule("module")` hands back the loader without importing anything,
    // and enumerating that member would leave `process["getBuiltin" + "Module"]` and any future
    // host addition behind it. Reading `.env`, testing with `typeof`, and DECLARING the binding are
    // the three forms this package uses; everything else, including taking a reference to pass on,
    // is refused.
    if (
      ts.isIdentifier(node) &&
      node.text === "process" &&
      !isMemberName(node)
    ) {
      const parent = node.parent;
      const declares =
        parent !== undefined &&
        ts.isVariableDeclaration(parent) &&
        parent.name === node;
      const tested = parent !== undefined && ts.isTypeOfExpression(parent);
      const readsEnv =
        parent !== undefined &&
        (ts.isPropertyAccessExpression(parent) ||
          ts.isElementAccessExpression(parent)) &&
        parent.expression === node &&
        readsMember(parent, "env");
      if (!declares && !tested && !readsEnv) found.push("process");
    }
    ts.forEachChild(node, visit);
  };

  visit(tree);

  // Node's module loader is banned by SPECIFIER rather than by import form. A static import, a
  // dynamic `await import("node:module")`, a `require("node:module")` and `import m = require(…)`
  // all make the loader reachable, and enumerating those forms here would repeat — badly — a
  // reader this package already shares for exactly that question. The named binding is not
  // inspected: importing the module at all is what makes `createRequire` available.
  if (
    importedSpecifiers(text, fileName).some(
      specifier => specifier === "node:module" || specifier === "module"
    )
  ) {
    found.push("createRequire");
  }

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
    // Every import form the shared reader knows, since the loader is banned by SPECIFIER rather
    // than by the shape of the statement that reaches it.
    expect(
      runtimeResolversIn(
        `const { createRequire } = await import("node:module");`,
        "a.ts"
      )
    ).toEqual(["createRequire"]);
    expect(
      runtimeResolversIn(`const m = require("node:module");`, "a.ts")
    ).toEqual(["require", "createRequire"]);
    expect(
      runtimeResolversIn(`import m = require("node:module");`, "a.ts")
    ).toEqual(["createRequire"]);
    expect(
      runtimeResolversIn(`export const r = import.meta.resolve("x");`, "a.ts")
    ).toEqual(["import.meta.resolve"]);
    expect(
      runtimeResolversIn(
        `export const r = import.meta["resolve"]("x");`,
        "a.ts"
      )
    ).toEqual(["import.meta.resolve"]);
    // The ambient names are refused wherever they are REFERENCED, so the shapes below are controls
    // on the boundary rather than an inventory of what it recognises: a call, a computed member
    // that folds to one at build time, a bare alias never called here, and a local declaration
    // that shadows the name.
    expect(
      runtimeResolversIn(`export const r = module.require("x");`, "a.ts")
    ).toEqual(["module"]);
    expect(
      runtimeResolversIn(
        `export const r = module["req" + "uire"]("x");`,
        "a.ts"
      )
    ).toEqual(["module"]);
    expect(
      runtimeResolversIn(
        `const load = require;\nexport const r = load("react");`,
        "a.ts"
      )
    ).toEqual(["require"]);
    expect(
      runtimeResolversIn(`export const r = require("x");`, "a.ts")
    ).toEqual(["require"]);
    expect(
      runtimeResolversIn(`const module = {};\nexport const m = module;`, "a.ts")
    ).toEqual(["module"]);
    // Stored, aliased or destructured, the CONSTRUCT is still named in the source — which is what
    // makes a source ban bounded where reading the built artifact was not.
    expect(
      runtimeResolversIn(
        `const { resolve } = import.meta;\nconst load = resolve;`,
        "a.ts"
      )
    ).toEqual(["import.meta.resolve"]);
    // `process` is whitelisted rather than banned, so both directions need pinning: the loader
    // route is refused, and the three forms this package actually uses are not.
    expect(
      runtimeResolversIn(
        `export const r = process.getBuiltinModule("module").createRequire("/x")("react");`,
        "a.ts"
      )
    ).toEqual(["process"]);
    expect(
      runtimeResolversIn(`const p = process;\nexport const r = p;`, "a.ts")
    ).toEqual(["process"]);
    // Dynamic evaluation hides the specifier in a string, so the construct is what is named.
    expect(
      runtimeResolversIn(
        `export const load = () => eval('require("react")');`,
        "a.ts"
      )
    ).toEqual(["eval"]);
    expect(
      runtimeResolversIn(
        `export const load = new Function("return require")();`,
        "a.ts"
      )
    ).toEqual(["Function"]);
    // A restricted global read off a host object under a literal key — no identifier for the
    // rules above to see, only a string.
    expect(
      runtimeResolversIn(
        `declare const globalThis: { process: { getBuiltinModule(n: string): { createRequire(p: string): (s: string) => unknown } } };\n` +
          `export const r = globalThis["process"].getBuiltinModule("module").createRequire("/x")("react");`,
        "a.ts"
      )
    ).toEqual(["process"]);
    expect(
      runtimeResolversIn(`export const r = globalThis["require"]("x");`, "a.ts")
    ).toEqual(["require"]);
    // Capturing the host defeats any rule keyed to the literal receiver, so capture is what is
    // refused — an alias, an argument, a stored reference.
    expect(
      runtimeResolversIn(
        `const host = globalThis;\nexport const r = host.process;`,
        "a.ts"
      )
    ).toEqual(["globalThis"]);
    expect(
      runtimeResolversIn(
        `const host = globalThis as unknown as Record<string, unknown>;\nexport const r = host;`,
        "a.ts"
      )
    ).toEqual(["globalThis"]);
    expect(
      runtimeResolversIn(`export const r = use(globalThis);`, "a.ts")
    ).toEqual(["globalThis"]);
    // A cast receiver is still the host: `(globalThis as T).process` reads the same binding as
    // `globalThis.process`, so the member is not somebody else's key.
    expect(
      runtimeResolversIn(
        `export const r = (globalThis as typeof globalThis & { process: P }).process;`,
        "a.ts"
      )
    ).toEqual(["process"]);
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
    // An unrelated literal key off a host object is not a restricted global.
    expect(
      runtimeResolversIn(`export const w = globalThis["fetch"];`, "a.ts")
    ).toEqual([]);
    // The three NON-capturing uses, copied from `color-picker.tsx` so the rule is pinned against
    // real code rather than against an idea of it.
    expect(
      runtimeResolversIn(
        `export const has = typeof window !== "undefined" && "EyeDropper" in window;`,
        "a.ts"
      )
    ).toEqual([]);
    expect(
      runtimeResolversIn(
        `export const c = (window as unknown as Record<string, unknown>).EyeDropper;`,
        "a.ts"
      )
    ).toEqual([]);
    expect(
      runtimeResolversIn(
        `const holder = { require: (n) => n };\nholder.require("x");`,
        "a.ts"
      )
    ).toEqual([]);
    // A prop is a name, not a binding — this component reaches no loader.
    expect(
      runtimeResolversIn(
        `export const W = () => <Widget module={1} require />;`,
        "a.tsx"
      )
    ).toEqual([]);
    // The three `process` forms this package uses, exactly as `dev-warn.ts` writes them.
    expect(
      runtimeResolversIn(
        `declare const process: { env?: { NODE_ENV?: string } } | undefined;\n` +
          `export const dev = typeof process !== "undefined" && process?.env?.NODE_ENV === "test";`,
        "a.ts"
      )
    ).toEqual([]);
  });

  // The ban above reads the files `sourceFiles(SRC)` returns, so it is only a boundary while that
  // set is CLOSED. A shipped module importing a relative path out of `src` puts the imported file
  // in the bundle without putting it in the scan, and every gate then agrees the package is clean:
  // the reader never opens the file, and the bundler records a package-local input rather than a
  // dependency. Making the tree un-leavable is what keeps the enumeration complete — the
  // alternative, following the entries' transitive graph, re-derives module resolution here and
  // inherits every disagreement with the resolver that actually runs.
  it("scans exactly the files the shipping tsconfig compiles", () => {
    // `isShippedModule` decides the scan by PATTERN and the tsconfig decides shipping by
    // `exclude`; two answers to one question, which is why they drifted over `*.spec.*`. Asserted
    // rather than merged into one function because `sourceFiles` has other callers — the point is
    // that a divergence fails loudly here instead of silently changing what gets scanned.
    expect(sourceFiles(SRC).sort()).toEqual(tsconfigShippedFiles());
  });

  // The containment test is complete only while no ALIAS can name a file for it, and aliases come
  // from two places this package could grow: the manifest's `imports` map, asserted below, and
  // tsconfig `paths`. Both are conditions rather than observations, so both are pinned.
  it("declares no tsconfig path alias for a specifier to hide behind", () => {
    const aliases = ["tsconfig.json", "tsconfig.tests.json"].flatMap(name => {
      const path = join(SRC, "..", name);
      const parsed = ts.parseConfigFileTextToJson(
        path,
        readFileSync(path, "utf8")
      );
      const paths = (
        parsed.config as {
          compilerOptions?: { paths?: Record<string, unknown> };
        }
      ).compilerOptions?.paths;
      return Object.keys(paths ?? {}).map(alias => `${name}: ${alias}`);
    });

    expect(
      aliases,
      "A `paths` alias maps a bare specifier to a file, so shipped source could import one that " +
        "the containment test reads as a package name and never resolves. Resolve those aliases " +
        "in the containment test before declaring one."
    ).toEqual([]);
  });

  it("reaches no file outside the tree the ban reads", () => {
    const escapes = sourceFiles(SRC).flatMap(file =>
      importedSpecifiers(readFileSync(file, "utf8"), file)
        // Split by what the specifier RESOLVES against rather than by how it starts. A bare package
        // name goes through the dependency graph, which the artifact gate reads; everything else
        // names a file, and an absolute path names one just as a relative path does — a rule
        // written for `./` alone is walked around by `/abs/path/escape.mjs`.
        .filter(
          specifier =>
            specifier.startsWith(".") ||
            specifier.startsWith("#") ||
            isAbsolute(specifier)
        )
        .filter(specifier => {
          // A `#alias` names a manifest-defined path, which this test cannot follow without
          // reimplementing the `imports` resolution algorithm. It is reported OUTRIGHT rather than
          // resolved — passing it to the path comparison below treats it as a relative name, which
          // lands it inside `src` and clears it. The assertion after this one keeps the refusal
          // from being a live restriction by pinning that no such alias is declared.
          if (specifier.startsWith("#")) return true;
          // Compared after RESOLUTION, so a specifier that climbs out and back in is judged by
          // where it lands rather than by how it is spelled.
          const target = resolve(dirname(file), specifier);
          if (relative(SRC, target).startsWith("..")) return true;
          // Inside `src` is not the same as inside the SCANNED set, and the difference is the
          // whole point of the check. `sourceFiles` skips `__tests__` directories and anything
          // `isShippedModule` rejects, so `./helper.fixture.ts` and `../__tests__/helper.ts` both
          // resolve within `src` and are never opened by the ban above — while the bundler still
          // pulls them into the artifact as first-party input.
          //
          // Resolution here is deliberately the small subset TypeScript sources use — the literal
          // path, an added extension, or a directory's `index` — rather than a reimplementation of
          // Node's algorithm. Every candidate is checked for MEMBERSHIP of the scanned set, so a
          // form this does not construct reports an escape and gets looked at, instead of being
          // waved through by a resolver guess that happens to land somewhere plausible.
          const scanned = new Set(sourceFiles(SRC));
          const candidates = [target];
          for (const extension of MODULE_EXTENSIONS) {
            candidates.push(
              target + extension,
              join(target, `index${extension}`)
            );
          }
          return !candidates.some(candidate => scanned.has(candidate));
        })
        .map(specifier => `${file}: ${specifier}`)
    );

    // The containment test above is only complete while `#alias` specifiers cannot resolve at all,
    // and that is a property of the MANIFEST rather than of this file. Asserted rather than
    // observed: an `imports` map added later would silently give shipped source a route out of
    // `src` that reads as a bare specifier, and the previous version of this test recorded the
    // absence as a fact checked once instead of a condition held.
    const manifest = JSON.parse(
      readFileSync(join(SRC, "..", "package.json"), "utf8")
    ) as { imports?: Record<string, unknown> };
    expect(
      Object.keys(manifest.imports ?? {}),
      "Adding an `imports` map gives shipped source a route out of `src` that the containment " +
        "test cannot follow. Resolve those aliases here before declaring one."
    ).toEqual([]);

    expect(
      escapes,
      "A shipped source may only import relative paths inside `src`. A file outside it is bundled " +
        "into the published artifact without being read by the runtime-resolution ban above, so a " +
        "resolver placed there passes every gate."
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
