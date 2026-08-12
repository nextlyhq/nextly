import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { collectModules, TEST_MODULE } from "./source-modules";

/**
 * The package's layering contract, enforced rather than documented.
 *
 * Two promises, each broken by an import that is individually reasonable:
 *
 * 1. **The builder never imports `@nextlyhq/admin` directly.** Plugins and
 *    libraries reach admin only through `@nextlyhq/plugin-sdk/admin` — a curated
 *    facade where every export is named individually and carries a stability
 *    tag. A direct import bypasses the facade and takes a dependency on
 *    internals nobody promised to keep.
 *
 *    The pull toward it is real rather than hypothetical: the editor wants
 *    admin's Lexical node set for inline rich text, and reaching for it directly
 *    is the shape that looks harmless at the call site.
 *
 * 2. **The builder does not pull in the CMS runtime.** It draws with
 *    `@nextlyhq/blocks-react`'s root entry, which is standalone; the `/next`
 *    subpath is the Next-coupled one and imports `nextly/runtime`. Admitting it
 *    here would put the whole server runtime behind an editor component.
 *
 * The guard is an ALLOWLIST of exact specifiers. A blocklist only stops what
 * someone thought to name, and a rule written per PACKAGE rather than per
 * specifier silently admits every subpath a package happens to publish — which
 * is how `blocks-react/next` and `plugin-sdk/testing` would arrive. Adding an
 * entry below is a deliberate act with a reason recorded beside it.
 *
 * **What this file does NOT prove.** That the canvas renders THROUGH
 * `blocks-react` rather than reimplementing rendering on top of React and
 * `@nextlyhq/blocks-engine` is a property of what the code does, not of what it
 * imports, and both spellings import exactly the same packages. The allowlist
 * makes the shortcut inconvenient; it cannot make it impossible. That rule is a
 * design constraint, and nothing in this file enforces it.
 */

// `import.meta.dirname` only exists from Node 20.11 and the package floor is
// Node >=20.0, so derive the directory from the module URL instead.
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * What the package may import at runtime, and why.
 *
 * - `react`, `react-dom`, `react/jsx-runtime`: the editor is a React app. Peer
 *   dependencies, so the host's copy is the only one in the tree.
 * - `@nextlyhq/blocks-engine`: the document model, validation and style
 *   compiler. Runtime-free.
 * - `@nextlyhq/blocks-react`: the renderer the canvas draws with — the same one
 *   that serves published pages.
 * - `@nextlyhq/ui`: the design system, and the only source of admin-theme
 *   tokens. Peer, for the same one-copy reason as React.
 * - `@nextlyhq/plugin-sdk`: the stable import surface, including the `/admin`
 *   subpath that is the ONLY sanctioned route to admin components.
 */
const ALLOWED_RUNTIME_IMPORTS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "@nextlyhq/blocks-engine",
  // The ROOT entry only. `@nextlyhq/blocks-react/next` imports `nextly/runtime`,
  // and `/blocks` is the built-in catalogue, which nothing here needs yet.
  "@nextlyhq/blocks-react",
  "@nextlyhq/ui",
  // The `/admin` subpath ONLY, and not the SDK root. The root re-exports runtime
  // values from `nextly` (`export { definePlugin } from "nextly"`), which that
  // package's build leaves external, so importing it loads the CMS runtime this
  // guard exists to keep out. `/admin` re-exports from `@nextlyhq/admin` alone
  // and is the one sanctioned route to admin components. Nothing here imports
  // the root today; when the editor needs SDK types, add a type-only route
  // deliberately rather than widening this entry back.
  "@nextlyhq/plugin-sdk/admin",
];

/** Node built-ins and test-only tooling, which never reach a consumer's bundle. */
const ALLOWED_IN_TESTS = [
  "node:fs",
  "node:path",
  "node:url",
  "typescript",
  "vitest",
];

/**
 * Stands in for a module call whose target is not a literal, such as
 * `import(base + name)` or `require(name)`.
 *
 * Such a target cannot be resolved by reading the file, so the honest report is
 * "unknown", and unknown has to be a violation: the alternative is a guard that
 * approves whatever it could not read. It is deliberately not a legal package
 * specifier, so it can never be satisfied by an allowlist entry.
 */
const UNRESOLVABLE_SPECIFIER = "<unresolvable-specifier>";

/**
 * Extensions the bundler will follow, and therefore the ones this guard must read.
 *
 * Not just `.ts`/`.tsx`. A TypeScript entry can side-effect-import `./bridge.js`, and tsup
 * bundles it; a scan restricted to TypeScript would walk past the one file free to import
 * anything, with the typecheck none the wiser because `allowJs` is off.
 */

/** The package's modules, by the shared rule; only the file reading is local. */
function sourceFiles(dir: string): string[] {
  return collectModules(
    dir,
    at => readdirSync(at, { withFileTypes: true }),
    join
  );
}

/**
 * Every module specifier a source text imports, read from the AST rather than by
 * regex.
 *
 * Several shapes reach a module, not one, and a visitor that reads only
 * declarations walks straight past most of them — approving a file that pulls
 * the forbidden package in anyway:
 *
 * - `import ... from` and `export ... from`, which carry a module specifier.
 * - `import("pkg")` and `require("pkg")`, which are call expressions. A bare
 *   `require` identifier only: `loader.require("x")` is a method on some object,
 *   not a module resolve.
 * - `import x = require("pkg")`, the documented CommonJS-interop spelling, which
 *   is neither of the above.
 * - `typeof import("pkg")` in type position, which the parser gives as an
 *   `ImportTypeNode` rather than a call. It erases at build, so a purely runtime
 *   guard would skip it — this one does not, for the reason below.
 *
 * Template literals with no substitutions are as statically known as quoted
 * strings, so they count as literals here.
 *
 * Type-only imports are collected too, which is stricter than a purely runtime
 * guard would be. The admin prohibition is not only about what reaches a bundle:
 * importing admin's types is the same dependency on internals nobody promised to
 * keep, and it is one rename away from becoming a value import.
 *
 * Separated from the file reading so the shapes above can be asserted against
 * source text directly: the contract tests below scan real files, and a file
 * that happens to contain none of a shape cannot demonstrate the shape is seen.
 */
function importsOfSource(text: string, fileName = "module.ts"): string[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.ESNext,
    true
  );
  const found: string[] = [];
  const seen = new Set<ts.Node>();
  const visit = (node: ts.Node): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (ts.isJSDocImportTag(node)) {
      // `/** @import { X } from "pkg" */`. A tag with its own module specifier, not the
      // `ImportTypeNode` a `@typedef` produces, so entering the JSDoc tree is not enough.
      const target = node.moduleSpecifier;
      found.push(
        target && ts.isStringLiteralLike(target)
          ? target.text
          : UNRESOLVABLE_SPECIFIER
      );
    } else if (ts.isImportTypeNode(node)) {
      // `type A = typeof import("pkg")`. A type query, so it never reaches a bundle — but it is
      // still a dependency on that package's internals, which is what the admin rule forbids.
      const target = node.argument;
      found.push(
        ts.isLiteralTypeNode(target) && ts.isStringLiteralLike(target.literal)
          ? target.literal.text
          : UNRESOLVABLE_SPECIFIER
      );
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const target = node.moduleReference.expression;
      found.push(
        ts.isStringLiteralLike(target) ? target.text : UNRESOLVABLE_SPECIFIER
      );
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const resolvesAModule =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === "require");
      if (resolvesAModule) {
        const target = node.arguments[0];
        found.push(
          target && ts.isStringLiteralLike(target)
            ? target.text
            : UNRESOLVABLE_SPECIFIER
        );
      }
    }
    ts.forEachChild(node, visit);
    // JSDoc hangs off a node rather than sitting under it, so `forEachChild` never enters it.
    // In a JavaScript file that is where the types live: `@typedef {import("pkg").T}` puts an
    // ImportTypeNode inside the comment, invisible to every branch above.
    for (const doc of ts.getJSDocCommentsAndTags(node)) visit(doc);
  };
  visit(source);

  // `/// <reference types="pkg" />` is not part of the node tree, so `forEachChild` never
  // reaches it. The parser puts it here instead, and it is a dependency on that package's
  // types exactly as an `import type` is.
  for (const directive of source.typeReferenceDirectives) {
    found.push(directive.fileName);
  }

  return found;
}

/** Every module specifier a file imports. */
function importsOf(file: string): string[] {
  return importsOfSource(readFileSync(file, "utf8"), file);
}

/**
 * Whether one specifier may be imported.
 *
 * Exact match, deliberately. Judging by package would let any subpath in, and the subpaths are
 * exactly where the coupling lives: `blocks-react/next` carries `nextly/runtime` and
 * `plugin-sdk/testing` is not a production surface. A permitted subpath is written out in full.
 */
function isAllowed(specifier: string, inTest: boolean): boolean {
  const allowed = inTest
    ? [...ALLOWED_RUNTIME_IMPORTS, ...ALLOWED_IN_TESTS]
    : ALLOWED_RUNTIME_IMPORTS;
  return allowed.includes(specifier);
}

/** Bare package specifiers only — relative paths are this package's own code. */
function isBare(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

describe("reading a module's imports", () => {
  it("sees static imports and re-exports", () => {
    expect(importsOfSource(`import { a } from "react";`)).toEqual(["react"]);
    expect(importsOfSource(`export { b } from "@nextlyhq/ui";`)).toEqual([
      "@nextlyhq/ui",
    ]);
    expect(importsOfSource(`export * from "@nextlyhq/blocks-react";`)).toEqual([
      "@nextlyhq/blocks-react",
    ]);
  });

  it("sees type-only imports, which a rename could turn into a value import", () => {
    expect(
      importsOfSource(`import type { P } from "@nextlyhq/admin";`)
    ).toEqual(["@nextlyhq/admin"]);
  });

  it("sees dynamic imports, which carry a dependency no declaration records", () => {
    expect(
      importsOfSource(`const m = await import("@nextlyhq/admin/lexical");`)
    ).toEqual(["@nextlyhq/admin/lexical"]);
    expect(
      importsOfSource("const m = await import(`@nextlyhq/admin`);")
    ).toEqual(["@nextlyhq/admin"]);
  });

  it("sees a bare require, which reaches a module exactly as an import does", () => {
    expect(importsOfSource(`const a = require("@nextlyhq/admin");`)).toEqual([
      "@nextlyhq/admin",
    ]);
  });

  it("sees a triple-slash type reference, which is not in the node tree at all", () => {
    // The parser stores these on `typeReferenceDirectives`, so a visitor built on
    // `forEachChild` cannot reach one however carefully it is written.
    expect(
      importsOfSource(`/// <reference types="@nextlyhq/admin" />\nexport {};`)
    ).toEqual(["@nextlyhq/admin"]);
  });

  it("sees a JSDoc @import tag, which carries its own module specifier", () => {
    // Distinct from the `@typedef` form: `@import` parses to a JSDocImportTag, so walking into
    // JSDoc reaches it but no ImportTypeNode branch records it. Asserted against a subpath the
    // guard genuinely must catch, since admin is unresolvable here anyway.
    expect(
      importsOfSource(
        `/** @import { N } from "@nextlyhq/blocks-react/next" */\nexport const x = 1;`,
        "probe.js"
      )
    ).toContain("@nextlyhq/blocks-react/next");
  });

  it("sees an import type inside a JSDoc typedef, which JavaScript files use", () => {
    // JSDoc is attached to a node, not nested under it, so `forEachChild` walks past the whole
    // comment. This only became reachable once the enumerator started scanning `.js` files.
    expect(
      importsOfSource(
        `/** @typedef {import("@nextlyhq/admin").Node} Node */\nexport const x = 1;`,
        "probe.js"
      )
    ).toContain("@nextlyhq/admin");
  });

  it("sees a typeof-import type query, which no call expression covers", () => {
    // The parser gives this as an ImportTypeNode, so a visitor watching for calls and declarations
    // walks past it. It erases at build, which is exactly why it is an easy way to take a
    // dependency on admin internals without appearing to import anything.
    expect(
      importsOfSource(`type A = typeof import("@nextlyhq/admin");`)
    ).toEqual(["@nextlyhq/admin"]);
    expect(
      importsOfSource(`let x: import("@nextlyhq/admin/lexical").Node;`)
    ).toEqual(["@nextlyhq/admin/lexical"]);
  });

  it("sees the CommonJS-interop import-equals spelling", () => {
    expect(
      importsOfSource(`import admin = require("@nextlyhq/admin");`)
    ).toEqual(["@nextlyhq/admin"]);
  });

  it("does not count a method that merely happens to be named require", () => {
    // `loader.require("x")` resolves nothing; treating it as an import would make the guard
    // fail CLOSED on innocent code, which gets guards deleted rather than obeyed.
    expect(importsOfSource(`loader.require("@nextlyhq/admin");`)).toEqual([]);
  });

  it("reports a require it cannot resolve rather than dropping it", () => {
    expect(importsOfSource(`const a = require(name);`)).toEqual([
      UNRESOLVABLE_SPECIFIER,
    ]);
  });

  it("reports a dynamic import it cannot resolve rather than dropping it", () => {
    // The failure this replaces is silent: an unreadable target that produced no
    // entry left the allowlist with nothing to reject.
    expect(importsOfSource(`const m = await import(name);`)).toEqual([
      UNRESOLVABLE_SPECIFIER,
    ]);
    expect(
      importsOfSource("const m = await import(`@nextlyhq/${pkg}`);")
    ).toEqual([UNRESOLVABLE_SPECIFIER]);
  });

  it("rejects an unresolved dynamic import through the same allowlist as a named one", () => {
    // The sentinel is only useful if it survives the two filters between the
    // reader and the verdict: it must look bare, and must match no entry.
    expect(isBare(UNRESOLVABLE_SPECIFIER)).toBe(true);
    expect(ALLOWED_RUNTIME_IMPORTS).not.toContain(UNRESOLVABLE_SPECIFIER);
    expect(ALLOWED_IN_TESTS).not.toContain(UNRESOLVABLE_SPECIFIER);
  });

  it("ignores relative imports of the package's own code", () => {
    expect(
      importsOfSource(`import { x } from "./canvas";`).filter(isBare)
    ).toEqual([]);
  });
});

describe("what the allowlist admits", () => {
  // Asserted on specifiers directly rather than through the file scan: the rule that matters is
  // about subpaths no file in this package imports yet, and a contract test over real source can
  // only demonstrate rules its own source happens to exercise.

  it("admits the packages the editor is built from", () => {
    for (const specifier of [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "@nextlyhq/blocks-engine",
      "@nextlyhq/blocks-react",
      "@nextlyhq/ui",
    ]) {
      expect(isAllowed(specifier, false)).toBe(true);
    }
  });

  it("admits the one sanctioned route to admin", () => {
    expect(isAllowed("@nextlyhq/plugin-sdk/admin", false)).toBe(true);
  });

  it("refuses the Next-coupled renderer entry, which carries the CMS runtime", () => {
    // `@nextlyhq/blocks-react/next` imports `nextly/runtime`. Judging by package rather than by
    // specifier would have admitted it on the strength of the root entry being allowed.
    expect(isAllowed("@nextlyhq/blocks-react/next", false)).toBe(false);
    expect(isAllowed("@nextlyhq/blocks-react/blocks", false)).toBe(false);
  });

  it("refuses the SDK root, which re-exports runtime values from nextly", () => {
    // `@nextlyhq/plugin-sdk` re-exports `definePlugin` from `nextly`, and the SDK build leaves
    // `nextly` external, so the root drags the CMS runtime into the editor graph. The `/admin`
    // subpath re-exports from `@nextlyhq/admin` alone and stays allowed.
    expect(isAllowed("@nextlyhq/plugin-sdk", false)).toBe(false);
    expect(isAllowed("@nextlyhq/plugin-sdk/admin", false)).toBe(true);
  });

  it("refuses other subpaths of an allowed package", () => {
    expect(isAllowed("@nextlyhq/plugin-sdk/testing", false)).toBe(false);
    expect(isAllowed("@nextlyhq/plugin-sdk/client", false)).toBe(false);
  });

  it("refuses admin under every spelling", () => {
    expect(isAllowed("@nextlyhq/admin", false)).toBe(false);
    expect(isAllowed("@nextlyhq/admin/lexical", false)).toBe(false);
  });

  it("keeps test-only tooling out of shipped code", () => {
    // The one asymmetry in the list, so it is worth pinning in both directions.
    expect(isAllowed("vitest", true)).toBe(true);
    expect(isAllowed("vitest", false)).toBe(false);
    expect(isAllowed("node:fs", true)).toBe(true);
    expect(isAllowed("node:fs", false)).toBe(false);
  });
});

describe("the dependency graph, which is the stronger half of the admin rule", () => {
  // A package cannot import what it does not depend on. `@nextlyhq/admin` is in no dependency
  // field here, and pnpm's node_modules is not hoisted, so every spelling of a direct admin
  // import — dynamic, `require`, `import x = require`, `typeof import`, a JSDoc typedef, a
  // triple-slash reference, in a `.js` file, cached or not — fails to RESOLVE. That is a
  // completeness the source scan cannot claim: the scan covers the syntaxes someone thought of,
  // this covers all of them at once, including syntaxes TypeScript has not shipped yet.
  //
  // The scan is still worth having. It fails at test time with a message that names the rule
  // rather than at build time with a resolution error, and it is the ONLY enforcement for the
  // subpath policy: `blocks-react/next`, the `plugin-sdk` root and `plugin-sdk/testing` all
  // resolve perfectly, because their packages are legitimate dependencies — the graph has
  // nothing to say about which ENTRY of a dependency is allowed.

  const manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  } = JSON.parse(readFileSync(join(SRC_DIR, "..", "package.json"), "utf8"));

  const declared = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];

  it("reads a manifest that actually declares things", () => {
    // Positive control. An unparsed or empty manifest would satisfy the assertion below while
    // proving nothing, which is the failure mode this file has already paid for once.
    expect(declared).toContain("@nextlyhq/blocks-react");
  });

  it("does not depend on @nextlyhq/admin in any form", () => {
    expect(
      declared.filter(
        name =>
          name === "@nextlyhq/admin" || name.startsWith("@nextlyhq/admin/")
      )
    ).toEqual([]);
  });
});

describe("the builder's layering contract", () => {
  const files = sourceFiles(SRC_DIR);

  it("reads its own source, so the assertions below are not vacuous", () => {
    // Positive control. An empty file list would satisfy every `every()` below,
    // and a guard that passes because it found nothing is the failure mode this
    // program has paid for repeatedly.
    expect(files.length).toBeGreaterThan(0);
    expect(files.some(f => f.endsWith("index.ts"))).toBe(true);
  });

  it("reads every extension it claims to, not only the common ones", () => {
    // `length > 0` and "an index.ts is present" both survive a walk narrowed to
    // `.ts` alone, so neither separates full coverage from partial. A file in a
    // less common extension has to be named for that.
    //
    // The scan going quiet on one extension is the dangerous direction: the
    // files it stops reading are the ones it then reports clean.
    expect(files.some(f => f.endsWith(".mts"))).toBe(true);
  });

  it("never imports @nextlyhq/admin directly", () => {
    // The one route to admin is `@nextlyhq/plugin-sdk/admin`. Asserted as a
    // prefix so `@nextlyhq/admin/anything` is caught too — a subpath import is
    // the shape this would most plausibly take.
    const offenders = files.filter(file =>
      importsOf(file).some(
        specifier =>
          specifier === "@nextlyhq/admin" ||
          specifier.startsWith("@nextlyhq/admin/")
      )
    );

    expect(offenders).toEqual([]);
  });

  it("imports only what the contract allows", () => {
    const violations: string[] = [];
    for (const file of files) {
      const inTest = TEST_MODULE.test(file);
      for (const specifier of importsOf(file).filter(isBare)) {
        if (!isAllowed(specifier, inTest)) {
          violations.push(`${file}: ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("relaxes its allowlist only for files the runner actually runs", () => {
    // The test above trusts `TEST_MODULE` to say which files may import
    // `vitest` and `node:fs`. That trust is only sound while vitest RUNS
    // everything `TEST_MODULE` matches: a config listing narrower globs would
    // leave a file classified as a test, exempt from the allowlist, and never
    // executed — so a shipped module could reach anything it liked by choosing
    // its filename.
    //
    // Both now derive from one list, and this checks the config still asks for
    // it rather than restating it. The assertion is syntactic because the
    // question is syntactic: whether this file derives its globs or spells them
    // out again. Importing the config to compare values is not available —
    // `rootDir` is `src`, and reaching outside it fails `check-types` (TS6059).
    const configPath = join(SRC_DIR, "..", "vitest.config.ts");
    const config = ts.createSourceFile(
      "vitest.config.ts",
      readFileSync(configPath, "utf8"),
      ts.ScriptTarget.ESNext,
      true
    );

    let includeInitialiser: ts.Expression | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "include"
      ) {
        includeInitialiser = node.initializer;
      }
      ts.forEachChild(node, visit);
    };
    visit(config);

    // Positive control: an `include` that stopped being found would make the
    // assertion below vacuous, and this guard exists because a check that
    // passes on nothing is the failure mode the package keeps paying for.
    expect(
      includeInitialiser,
      "vitest.config.ts must set `include`"
    ).toBeDefined();
    expect(
      includeInitialiser && ts.isIdentifier(includeInitialiser)
        ? includeInitialiser.text
        : config.text.slice(
            includeInitialiser!.getStart(config),
            includeInitialiser!.getEnd()
          )
    ).toBe("TEST_GLOBS");
  });
});
