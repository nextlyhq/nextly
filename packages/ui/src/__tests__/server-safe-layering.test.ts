/**
 * A server-safe entry point must stay reachable from a server component.
 *
 * `published-entries.mjs` declares which subpaths are server-safe, the build routes those through a
 * config that adds no `"use client"` banner, and a guard asserts the built artifact carries none.
 * None of that looks at what the source IMPORTS — so adding `useState` to `lib/utils.ts` would
 * build cleanly, ship without a banner, and break the first server component to import
 * `@nextlyhq/ui/utils`, with every existing check green.
 *
 * The dependency graph cannot answer this the way it can for a package that is simply not a
 * dependency: `react` is a declared peer dependency of this package and resolves fine. What makes
 * an entry server-safe is that nothing it REACHES pulls in a client runtime, which is a property of
 * the import graph and has to be walked.
 *
 * Everything below reads the PARSED module rather than its text, because a module can cross the
 * boundary in four ways and no single pattern catches them: importing a client package, carrying a
 * client directive, containing JSX (which the `react-jsx` transform turns into a
 * `react/jsx-runtime` import appearing nowhere in the source), or reading a browser global where
 * the module body runs.
 *
 * ## What this is, and what it is not
 *
 * A FAST SIGNAL, not a proof. It reads source, and source has an unbounded number of ways to reach
 * a runtime: a folded expression, a global nobody has enumerated, a construct a future compiler
 * introduces. Each is closed as it is found, and the next one is not knowable from here.
 *
 * Its value is that it runs in milliseconds without a build and names the file and the specifier,
 * so the failure is actionable. The COMPLETE check is a different one: inspect the built artifact,
 * which is bounded by construction because the bundler has already resolved every specifier this
 * has to predict. The two are complementary, and this file should not be read as making the other
 * unnecessary.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it, onTestFinished } from "vitest";

import { publishedEntries } from "../../scripts/published-entries.mjs";

const PKG_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

/**
 * The packages a server-safe entry point is allowed to reach.
 *
 * An ALLOW-list, not a list of client-only packages to refuse. A deny-list has to name every way of
 * pulling in a client runtime, and it cannot name the ones that do not exist yet: a workspace
 * package added later, or a sibling that itself imports React, is not "react" by name and would
 * pass. Listing what is permitted fails closed instead, and makes each addition a decision someone
 * takes deliberately.
 *
 * Both entries here are pure functions over strings, with no React and no DOM.
 */
const ALLOWED_PACKAGES = new Set(["clsx", "tailwind-merge"]);

/**
 * Globals that exist only in a browser.
 *
 * Reading one where the module body runs throws on a server before any of this package's own code
 * is reached, and it involves no import and no directive, so nothing else here would notice.
 */
const BROWSER_GLOBALS = new Set([
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "history",
  "location",
  "matchMedia",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "HTMLElement",
  "Element",
  "Node",
  "Image",
  "DOMParser",
  "IntersectionObserver",
  "ResizeObserver",
  "MutationObserver",
]);

/** What one module does that could put it on the client side of the boundary. */
interface Analysis {
  /** Module specifiers whose import survives to runtime. */
  specifiers: string[];
  /** Whether its directive prologue contains `"use client"`. */
  clientDirective: boolean;
  /** Whether it contains JSX, which compiles to a `react/jsx-runtime` import. */
  jsx: boolean;
  /** Browser globals it reads where the module body runs. */
  globals: string[];
}

/**
 * Read one module.
 *
 * Parsed rather than matched. The text-matching version needed comments stripped first, and that
 * stripping fails OPEN: an unclosed comment marker inside a template literal swallows everything up
 * to the next terminator, removing real imports rather than adding noise. It also reported a usage
 * example inside a doc comment as a genuine reach, and could not see a directive that a doc comment
 * preceded — which is how every client module in this package is written.
 */
function analyze(source: string, fileName: string): Analysis {
  const tree = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const specifiers: string[] = [];
  const globals: string[] = [];
  let jsx = false;

  const record = (node: ts.Node | undefined): void => {
    // A backtick specifier — `import(`react`)` — parses as a no-substitution template, NOT a string
    // literal, while bundlers treat both as an ordinary static dependency. Reading only the string
    // form leaves that spelling invisible.
    if (
      node &&
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ) {
      specifiers.push(node.text);
      return;
    }
    // Anything else is FAILED CLOSED rather than skipped. A bundler folds constant expressions —
    // `import("re" + "act")` resolves to React — and this does not evaluate them. Recording a name
    // no allow-list can contain reports it as unreadable instead of passing it in silence, which
    // is the behaviour that would hide exactly the dependency this guard exists to find.
    if (node) specifiers.push(`<unreadable specifier: ${node.getText()}>`);
  };

  /** Whether every name a declaration binds is type-only, so the whole import is erased. */
  const allBindingsAreTypes = (
    bindings: ts.NamedImportBindings | ts.NamedExportBindings | undefined
  ): boolean =>
    bindings !== undefined &&
    (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) &&
    bindings.elements.length > 0 &&
    bindings.elements.every(element => element.isTypeOnly);

  // A directive prologue is the leading run of string-expression statements. Taken from the tree,
  // so comments before it are irrelevant: `"use client"` sits under a module doc comment in every
  // client module here, and a start-anchored text match saw none of them.
  const clientDirective = ((): boolean => {
    for (const statement of tree.statements) {
      if (
        !ts.isExpressionStatement(statement) ||
        !ts.isStringLiteral(statement.expression)
      ) {
        return false;
      }
      if (statement.expression.text === "use client") return true;
    }
    return false;
  })();

  // Names the module declares itself. `const location = "home"` is not the browser global, and a
  // name-only check rejects ordinary server-safe code for using an ordinary word.
  const declared = new Set<string>();
  const collectDeclared = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isImportSpecifier(node) ||
        ts.isImportClause(node) ||
        ts.isNamespaceImport(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name)
    ) {
      declared.add(node.name.text);
    }
    ts.forEachChild(node, collectDeclared);
  };
  collectDeclared(tree);

  /** Whether this identifier reads the global, rather than naming something in another position. */
  const readsTheGlobal = (node: ts.Identifier): boolean => {
    if (declared.has(node.text)) return false;
    const parent = node.parent;
    // `export type Root = HTMLElement` names a TYPE. TypeScript erases the annotation, so nothing
    // reads the global at runtime and reporting it would reject declaration-only code.
    if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent))
      return false;
    // `globalThis.document` reaches the same global through a property. `globalThis` exists on a
    // server while `document` does not, so the read still throws while naming nothing the bare
    // identifier check would see.
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.name === node &&
      ts.isIdentifier(parent.expression) &&
      parent.expression.text === "globalThis"
    ) {
      return true;
    }
    // `shape.window` and `{ window: 1 }` name a property, not the global.
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
      return false;
    }
    if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
    if (ts.isBindingElement(parent) && parent.propertyName === node) {
      return false;
    }
    // `typeof window === "undefined"` is the guard that MAKES a module server-safe: it evaluates to
    // a string rather than throwing, so reporting it would punish the correct pattern.
    if (ts.isTypeOfExpression(parent)) return false;
    return true;
  };

  const visit = (node: ts.Node, insideFunction: boolean): void => {
    if (ts.isImportDeclaration(node)) {
      // `import type` is erased before the emitted JavaScript exists, so it cannot pull in a
      // runtime. Reporting it would fail a change that only affects declarations.
      //
      // `import { type A, type B } from "x"` is erased too — the flags sit on the SPECIFIERS
      // rather than the declaration, and with `verbatimModuleSyntax` unset TypeScript elides an
      // import once every name it binds is a type. A default or namespace binding is a value, so
      // those keep it.
      const clause = node.importClause;
      const erased =
        clause?.isTypeOnly === true ||
        (clause !== undefined &&
          clause.name === undefined &&
          allBindingsAreTypes(clause.namedBindings));
      if (!erased) record(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly && !allBindingsAreTypes(node.exportClause)) {
        record(node.moduleSpecifier);
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      record(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      if (isDynamicImport || isRequire) record(node.arguments[0]);
    }

    if (
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node)
    ) {
      jsx = true;
    }

    // Only where the module BODY runs. A browser global inside a function is reached when that
    // function is called, which a server importing the module never does.
    if (
      !insideFunction &&
      ts.isIdentifier(node) &&
      BROWSER_GLOBALS.has(node.text) &&
      readsTheGlobal(node)
    ) {
      globals.push(node.text);
    }

    const isFunction =
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node) ||
      ts.isConstructorDeclaration(node);

    // An immediately invoked function is not deferred: its body runs while the module is being
    // imported, so a browser global inside one throws on a server exactly as a bare read would.
    // Treating every function body as deferred suppressed it.
    const runsNow = ((): boolean => {
      if (!isFunction) return false;
      let invoked: ts.Node = node;
      while (invoked.parent && ts.isParenthesizedExpression(invoked.parent)) {
        invoked = invoked.parent;
      }
      const parent = invoked.parent;
      return (
        parent !== undefined &&
        ts.isCallExpression(parent) &&
        parent.expression === invoked
      );
    })();
    const entersFunction = isFunction && !runsNow;

    ts.forEachChild(node, child =>
      visit(child, insideFunction || entersFunction)
    );
  };

  visit(tree, false);
  return { specifiers, clientDirective, jsx, globals: [...new Set(globals)] };
}

/** Resolve a relative specifier the way the bundler does, or `null` if it names a package. */
function resolveLocal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  // A TypeScript module may import `./helper.js` while the source is `helper.ts`, and the bundler
  // substitutes the extension. Probing `helper.js.ts` finds nothing, and the specifier would then
  // be recorded as an external PACKAGE, failing the allow-list for an ordinary local import.
  const swapped = base.replace(/\.(?:js|jsx|mjs|cjs)$/, "");
  // `./helper.mjs` may be backed by `helper.mts`, and `.cjs` by `.cts`. Those keep their own
  // extension rather than collapsing to `.ts`, so they need their own candidates.
  const moduleForm = base.replace(/\.mjs$/, ".mts").replace(/\.cjs$/, ".cts");
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${swapped}.ts`,
    `${swapped}.tsx`,
    moduleForm,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every local module reachable from an entry, analysed, plus the packages they name. */
function reach(entry: string): {
  files: { file: string; analysis: Analysis }[];
  packages: Map<string, string>;
} {
  const files: { file: string; analysis: Analysis }[] = [];
  const packages = new Map<string, string>();
  const queue = [entry];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const analysis = analyze(readFileSync(file, "utf8"), file);
    files.push({ file, analysis });

    for (const specifier of analysis.specifiers) {
      const local = resolveLocal(file, specifier);
      if (local) {
        queue.push(local);
      } else if (!packages.has(specifier)) {
        packages.set(specifier, path.relative(PKG_ROOT, file));
      }
    }
  }
  return { files, packages };
}

const SERVER_SAFE = publishedEntries()
  .filter(entry => entry.serverSafe)
  .map(entry => [entry.subpath, path.join(PKG_ROOT, entry.source)] as const);

const relative = (file: string): string => path.relative(PKG_ROOT, file);

describe("reading a module", () => {
  const read = (source: string, name = "probe.ts"): Analysis =>
    analyze(source, name);

  it("covers every import form, including the ones no single pattern catches", () => {
    expect(
      read(`
        import a from "static";
        import "side-effect";
        export { c } from "re-export";
        export * from "star";
        const d = await import("dynamic");
        const e = require("required");
        import f = require("equals");
      `).specifiers.sort()
    ).toEqual([
      "dynamic",
      "equals",
      "re-export",
      "required",
      "side-effect",
      "star",
      "static",
    ]);
  });

  it("reads a specifier written with backticks", () => {
    // `import(`x`)` parses as a no-substitution template rather than a string literal, and a
    // bundler resolves it exactly like the quoted form.
    expect(
      read(
        "const a = await import(`back-tick`);\nconst b = require(`tick-required`);"
      ).specifiers.sort()
    ).toEqual(["back-tick", "tick-required"]);
  });

  it("ignores a type-only import, which is erased before runtime", () => {
    // Reporting one would fail a change that affects declarations only, and no declaration can
    // pull a client runtime into the emitted JavaScript.
    expect(
      read(`
        import type { A } from "type-only";
        export type { B } from "type-only-export";
        import { real } from "value-import";
      `).specifiers
    ).toEqual(["value-import"]);
  });

  it("does not report an example inside a doc comment", () => {
    expect(
      read(`
        /**
         * @example
         * import uiPreset from "@nextlyhq/ui/tailwind-preset";
         */
        import { real } from "actually-imported";
      `).specifiers
    ).toEqual(["actually-imported"]);
  });

  it("still sees an import after a template holding an unclosed comment marker", () => {
    // The reason this is parsed rather than matched. A non-greedy comment regex handles a CLOSED
    // marker pair inside a template correctly, so that case proves nothing. An UNCLOSED one runs
    // on to the next terminator anywhere in the file — the doc comment below — and deletes the
    // import between them. That failure REMOVES evidence rather than adding noise.
    expect(
      read(
        [
          "const css = `a { /* width: 0 }`;",
          'import { real } from "after-template";',
          "/** A doc comment, whose terminator a regex would pair with the template's. */",
        ].join("\n")
      ).specifiers
    ).toEqual(["after-template"]);
  });

  it("sees a client directive that a doc comment precedes", () => {
    // How every client module in this package is written: the module doc comes first. A
    // start-anchored text match found none of them.
    expect(
      read(`
        /**
         * A module with documentation above its directive.
         */
        "use client";
        export const x = 1;
      `).clientDirective
    ).toBe(true);
  });

  it("does not mistake a later string statement for a directive", () => {
    // The control: a string expression after real code is not a prologue.
    expect(
      read(`
        export const x = 1;
        "use client";
      `).clientDirective
    ).toBe(false);
  });

  it("sees JSX, which compiles to an import appearing nowhere in the source", () => {
    const analysis = read(`export const A = () => <div />;`, "probe.tsx");
    expect(analysis.jsx).toBe(true);
    // The point: nothing here names React, yet the emitted module imports `react/jsx-runtime`.
    expect(analysis.specifiers).toEqual([]);
  });

  it("reports a browser global read where the module body runs", () => {
    expect(read(`export const w = window.innerWidth;`).globals).toEqual([
      "window",
    ]);
  });

  it("reports a browser global inside an immediately invoked function", () => {
    // An IIFE is not deferred: its body runs while the module is being imported, so this throws on
    // a server exactly as a bare read would. Treating every function body as deferred hid it.
    expect(
      read(`export const width = (() => window.innerWidth)();`).globals
    ).toEqual(["window"]);
  });

  it("does not report a name the module declares itself", () => {
    // `location` and `history` are ordinary words. A name-only check rejects valid server-safe
    // code for using one as a local, an import, or a parameter.
    expect(
      read(`
        const location = "home";
        import { history } from "./router";
        export const where = location + history;
      `).globals
    ).toEqual([]);
  });

  it("does not report a browser global named in a TYPE position", () => {
    // `export type Root = HTMLElement` is erased with the rest of the annotation, so nothing reads
    // the global at runtime. Reporting it rejects declaration-only code.
    expect(
      read(`
        export type Root = HTMLElement;
        export type W = typeof window;
      `).globals
    ).toEqual([]);
  });

  it("reports a browser global reached through globalThis", () => {
    // `globalThis` exists on a server and `document` does not, so this still throws — while the
    // bare-identifier check sees only `globalThis`, which is legitimate everywhere.
    expect(read(`export const b = globalThis.document.title;`).globals).toEqual(
      ["document"]
    );
  });

  it("reports a specifier it cannot read, rather than passing it in silence", () => {
    // A bundler folds constant expressions — `import("re" + "act")` resolves to React — and this
    // does not evaluate them. Failing closed reports it as unreadable; skipping it would hide
    // exactly the dependency this guard exists to find.
    const found = read(`const a = await import("re" + "act");`).specifiers;
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("unreadable specifier");
  });

  it("ignores an import whose named bindings are all types", () => {
    // The flags sit on the SPECIFIERS, not the declaration. With `verbatimModuleSyntax` unset,
    // TypeScript elides the import once every name it binds is a type — so reporting it fails a
    // change that affects declarations only.
    expect(
      read(`
        import { type ComponentType } from "all-types";
        export { type Other } from "all-types-export";
        import { type A, real } from "mixed";
      `).specifiers.sort()
    ).toEqual(["mixed"]);
  });

  it("does not report one inside a function, or behind a typeof guard", () => {
    // The controls. A global inside a function is reached when that function is CALLED, which a
    // server importing the module never does; `typeof window` is the guard that makes a module
    // server-safe; and a property named `window` is not the global at all.
    expect(
      read(`
        export function measure() {
          return document.body.clientWidth;
        }
        export const isBrowser = typeof window !== "undefined";
        const shape = { window: 1 };
        export const w = shape.window;
      `).globals
    ).toEqual([]);
  });
});

describe("resolving a local import", () => {
  it("follows a `.js` specifier to its TypeScript source", () => {
    // A TypeScript module may import `./helper.js` while the source is `helper.ts`, and the
    // bundler substitutes the extension. Probing `helper.js.ts` finds nothing, and the specifier
    // would then be recorded as an external PACKAGE — failing the allow-list for an ordinary local
    // import. Written to a temp directory so the fixture is real files, which is what the resolver
    // reads, without adding a `.js`-specifier module to this package's own sources.
    const dir = mkdtempSync(path.join(os.tmpdir(), "nx-layering-"));
    // Removed however this ends. A watch session reruns this constantly, and a fixture left behind
    // each time accumulates directories on developer and CI hosts indefinitely.
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(path.join(dir, "helper.ts"), "export const helper = 1;\n");
    const entry = path.join(dir, "entry.ts");
    writeFileSync(
      entry,
      'export { helper } from "./helper.js";\nexport const x = helper;\n'
    );

    const { files, packages } = reach(entry);
    expect([...packages.keys()]).toEqual([]);
    expect(files.map(({ file }) => path.basename(file)).sort()).toEqual([
      "entry.ts",
      "helper.ts",
    ]);
  });
});

describe("what a server-safe entry point reaches", () => {
  it("has server-safe entries to check", () => {
    // Fail closed: were the classification to stop reporting any, every case below would pass by
    // iterating an empty list.
    expect(SERVER_SAFE.length).toBeGreaterThan(0);
  });

  it.each(SERVER_SAFE)(
    "%s reaches only packages that are allowed",
    (_subpath, entry) => {
      const unlisted = [...reach(entry).packages.entries()]
        .filter(([specifier]) => !ALLOWED_PACKAGES.has(specifier))
        .map(([specifier, importer]) => `${specifier} (from ${importer})`);

      expect(
        unlisted,
        "a server-safe entry point reached a package that is not on the allow-list. If it is " +
          "genuinely free of React and the DOM — including everything IT reaches — add it to " +
          "ALLOWED_PACKAGES; otherwise a server component importing this subpath will fail at " +
          "runtime while the build and the client-directive guard both pass"
      ).toEqual([]);
    }
  );

  it.each(SERVER_SAFE)(
    "%s reaches no module marked client",
    (_subpath, entry) => {
      expect(
        reach(entry)
          .files.filter(({ analysis }) => analysis.clientDirective)
          .map(({ file }) => relative(file))
      ).toEqual([]);
    }
  );

  it.each(SERVER_SAFE)("%s reaches no JSX", (_subpath, entry) => {
    expect(
      reach(entry)
        .files.filter(({ analysis }) => analysis.jsx)
        .map(({ file }) => relative(file)),
      "JSX compiles to a `react/jsx-runtime` import under this package's `react-jsx` transform, so " +
        "a reached module containing any would put React in the emitted artifact while naming it " +
        "nowhere in the source"
    ).toEqual([]);
  });

  it.each(SERVER_SAFE)(
    "%s touches no browser global at module scope",
    (_subpath, entry) => {
      expect(
        reach(entry)
          .files.filter(({ analysis }) => analysis.globals.length > 0)
          .map(
            ({ file, analysis }) =>
              `${relative(file)}: ${analysis.globals.join(", ")}`
          ),
        "reading a browser global where the module body runs throws on a server, and involves no " +
          "import and no directive for the other checks to notice"
      ).toEqual([]);
    }
  );
});
