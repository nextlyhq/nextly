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
        // An enum creates a real runtime binding, so `export enum Node { A }` means `Node` is the
        // module's own, not the DOM one.
        ts.isEnumDeclaration(node) ||
        // `export namespace Node { export const A = 1 }` emits a real local `Node` value, so a
        // later `Node.A` is the module's own binding rather than the DOM one.
        ts.isModuleDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isImportSpecifier(node) ||
        ts.isImportClause(node) ||
        ts.isNamespaceImport(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name)
    ) {
      // `declare const require: ...` introduces no runtime binding — it describes something the
      // environment already provides. Treating it as a local shadow would suppress the very call
      // it is declaring.
      const ambient = ts
        .getCombinedModifierFlags(node as ts.Declaration)
        .valueOf();
      const isDeclare = (ambient & ts.ModifierFlags.Ambient) !== 0;
      if (!isDeclare) declared.add(node.name.text);
    }
    ts.forEachChild(node, collectDeclared);
  };
  collectDeclared(tree);

  /** Whether a condition subtree asks `typeof <name>`, which is the SSR guard. */
  const mentionsTypeof = (condition: ts.Node, name: string): boolean => {
    let found = false;
    const look = (node: ts.Node): void => {
      if (ts.isTypeOfExpression(node)) {
        const operand = node.expression;
        // Both spellings of the same guard: `typeof document` and `typeof globalThis.document`.
        const namesIt =
          (ts.isIdentifier(operand) && operand.text === name) ||
          (ts.isPropertyAccessExpression(operand) &&
            operand.name.text === name &&
            ts.isIdentifier(operand.expression) &&
            operand.expression.text === "globalThis");
        if (namesIt) found = true;
      }
      ts.forEachChild(node, look);
    };
    look(condition);
    return found;
  };

  /**
   * Whether this read sits on the protected side of a `typeof` guard.
   *
   * Walks outward looking for a conditional, an `if`, or a short-circuit whose CONDITION tests
   * `typeof` the same name. Syntactic rather than a flow analysis, which is the honest limit: it
   * recognises the shapes people write and would miss a guard stored in a variable first.
   */
  const guardedByTypeof = (identifier: ts.Identifier): boolean => {
    for (let node: ts.Node = identifier; node.parent; node = node.parent) {
      const parent = node.parent;
      let condition: ts.Node | undefined;
      if (
        ts.isConditionalExpression(parent) &&
        (parent.whenTrue === node || parent.whenFalse === node)
      ) {
        condition = parent.condition;
      } else if (
        ts.isIfStatement(parent) &&
        (parent.thenStatement === node || parent.elseStatement === node)
      ) {
        condition = parent.expression;
      } else if (
        ts.isBinaryExpression(parent) &&
        parent.right === node &&
        (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)
      ) {
        condition = parent.left;
      }
      if (condition && mentionsTypeof(condition, identifier.text)) return true;
    }
    return false;
  };

  /**
   * Whether the value of an access off `globalThis` is USED, rather than merely evaluated.
   *
   * `globalThis.document` on its own evaluates to `undefined` on a server rather than throwing;
   * only dereferencing, calling, or constructing from that `undefined` throws. An optional token
   * on the node that uses it short-circuits the whole chain, which is safe again. Both spellings
   * of the access — `globalThis.document` and `globalThis["document"]` — pass through here, so
   * they cannot drift apart.
   */
  const usedAsValue = (access: ts.Node): boolean => {
    // Parentheses and the erased TypeScript wrappers sit between the access and whatever uses it,
    // and every one of them disappears at runtime: `(globalThis.document!).body` dereferences
    // exactly as the bare spelling does.
    let value: ts.Node = access;
    while (
      value.parent &&
      (ts.isParenthesizedExpression(value.parent) ||
        ts.isNonNullExpression(value.parent) ||
        ts.isAsExpression(value.parent) ||
        ts.isSatisfiesExpression(value.parent))
    ) {
      value = value.parent;
    }
    const outer = value.parent;
    if (outer === undefined) return false;
    if (
      (ts.isPropertyAccessExpression(outer) ||
        ts.isElementAccessExpression(outer) ||
        ts.isCallExpression(outer)) &&
      outer.expression === value
    ) {
      return outer.questionDotToken === undefined;
    }
    // `new globalThis.Image()` throws for the same reason a call does, and `new` has no optional
    // form that could short-circuit it.
    return ts.isNewExpression(outer) && outer.expression === value;
  };

  /** Whether this identifier reads the global, rather than naming something in another position. */
  const readsTheGlobal = (node: ts.Identifier): boolean => {
    if (declared.has(node.text)) return false;
    const parent = node.parent;

    // Checked BEFORE the naming rule below, which would otherwise swallow it: `document` here is
    // the `name` of a property access, and it is exactly the read that matters. `globalThis`
    // exists on a server while `document` does not, so this still throws.
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.name === node &&
      ts.isIdentifier(parent.expression) &&
      parent.expression.text === "globalThis"
    ) {
      // The occurrence INSIDE the guard is not a read either: `typeof globalThis.document`
      // evaluates to a string rather than throwing, exactly as `typeof document` does. Here the
      // identifier's parent is the property access, whose parent is the `typeof`, so the check a
      // few lines down on `parent` alone does not see it.
      if (parent.parent !== undefined && ts.isTypeOfExpression(parent.parent)) {
        return false;
      }
      // A BARE read — `export const doc = globalThis.document` — evaluates to undefined on a
      // server rather than throwing, and `globalThis.document?.title` short-circuits to the same
      // place. Only using the value throws, so that is what decides.
      if (!usedAsValue(parent)) return false;
      // And the guarded USE is as safe as the bare-identifier form, so the same guard excuses it.
      return !guardedByTypeof(node);
    }

    // `export const globals = { window }` READS the global — the shorthand is both the name and
    // the value, so the general naming rule below would wrongly excuse it.
    if (ts.isShorthandPropertyAssignment(parent)) return !guardedByTypeof(node);

    // `globalThis["document"]` is the same read spelled with brackets — the name is a string
    // literal in an element access rather than an identifier, so it is caught where the string is
    // rather than where an identifier would be.
    if (
      ts.isElementAccessExpression(parent) &&
      parent.argumentExpression === node
    ) {
      return true;
    }

    // An identifier that IS a declaration's name is not a read of anything. This covers the
    // members these globals share a spelling with — `interface Options { history }`, `type Point =
    // { location: string }`, an enum member, a class property, a parameter — as well as
    // `shape.window` and `{ window: 1 }`. Written as one rule over `name` rather than a list of
    // node kinds, because the list was three entries long and already missing the rest.
    if ("name" in parent && parent.name === node) return false;
    if (ts.isBindingElement(parent) && parent.propertyName === node) {
      return false;
    }
    // `import { window as viewport } from "./safe"` puts `window` in `propertyName`, which the
    // `name` rule above does not cover — it names the export being imported, not the global.
    if (
      (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) &&
      parent.propertyName === node
    ) {
      return false;
    }

    // `export type Root = HTMLElement` names a TYPE. TypeScript erases the annotation, so nothing
    // reads the global at runtime and reporting it would reject declaration-only code.
    if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent))
      return false;
    // A name inside ANY type subtree is erased with it — `dom.HTMLElement` in
    // `type Root = dom.HTMLElement` is a qualified name, not a value read. Walking up to the
    // nearest type node covers the qualified and nested cases the two checks above miss.
    for (let n: ts.Node | undefined = parent; n; n = n.parent) {
      if (ts.isTypeNode(n) || ts.isTypeAliasDeclaration(n)) return false;
      if (ts.isStatement(n) || ts.isSourceFile(n)) break;
    }
    // `interface Root extends HTMLElement` names a type in a heritage clause, erased with the
    // interface. An `extends` on a CLASS is a value expression, so only the interface form is
    // excused here.
    if (
      ts.isExpressionWithTypeArguments(parent) &&
      parent.parent !== undefined &&
      ts.isHeritageClause(parent.parent) &&
      parent.parent.parent !== undefined &&
      ts.isInterfaceDeclaration(parent.parent.parent)
    ) {
      return false;
    }

    // `typeof window === "undefined"` is the guard that MAKES a module server-safe: it evaluates
    // to a string rather than throwing, so reporting it would punish the correct pattern.
    if (ts.isTypeOfExpression(parent)) return false;

    // `typeof window === "undefined" ? 0 : window.innerWidth` is the standard way to write a
    // module that is safe to import on a server, and the second read never runs there. Reporting
    // it would reject the very pattern this check exists to encourage.
    return !guardedByTypeof(node);
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
      // `import type React = require("react")` is erased like any other type-only import.
      if (!node.isTypeOnly) record(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      // A module that declares its own `require` is not calling the ambient loader, so its
      // argument is not a module specifier.
      const isRequire =
        ts.isIdentifier(callee) &&
        callee.text === "require" &&
        !declared.has("require");
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

    // `globalThis["document"]` names the global as a STRING, not an identifier, so the check above
    // never sees it. Node evaluates the computed property and the read throws just the same.
    if (
      !insideFunction &&
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "globalThis" &&
      node.argumentExpression !== undefined &&
      ts.isStringLiteral(node.argumentExpression) &&
      BROWSER_GLOBALS.has(node.argumentExpression.text) &&
      node.questionDotToken === undefined &&
      usedAsValue(node)
    ) {
      globals.push(node.argumentExpression.text);
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
      // Calling a generator returns an iterator; its body does not run until something pulls from
      // it. So an immediately invoked generator is still deferred, unlike an ordinary IIFE.
      if (!isFunction || ("asteriskToken" in node && node.asteriskToken)) {
        return false;
      }
      let invoked: ts.Node = node;
      // Parentheses AND the erased TypeScript wrappers — `!`, `as T`, `satisfies T` — all sit
      // between a function expression and the call that invokes it, and all disappear at runtime.
      while (
        invoked.parent &&
        (ts.isParenthesizedExpression(invoked.parent) ||
          ts.isNonNullExpression(invoked.parent) ||
          ts.isAsExpression(invoked.parent) ||
          ts.isSatisfiesExpression(invoked.parent))
      ) {
        invoked = invoked.parent;
      }
      const parent = invoked.parent;
      if (parent === undefined) return false;
      // `(() => window.x).call(undefined)` runs the body now, but its callee is a property access
      // rather than the function itself. `bind` is deliberately absent — it defers.
      if (
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === invoked &&
        (parent.name.text === "call" || parent.name.text === "apply") &&
        parent.parent !== undefined &&
        ts.isCallExpression(parent.parent) &&
        parent.parent.expression === parent
      ) {
        return true;
      }
      return ts.isCallExpression(parent) && parent.expression === invoked;
    })();
    const entersFunction = isFunction && !runsNow;

    ts.forEachChild(node, child => {
      // A computed member name is evaluated when the class body runs, even though the member it
      // names is deferred: `class C { [window.location.href]() {} }` throws on import.
      if (ts.isComputedPropertyName(child)) return visit(child, insideFunction);
      // A decorator expression is evaluated when the class body runs, like a computed name — the
      // member it decorates is deferred, the decorator itself is not.
      if (ts.isDecorator(child)) return visit(child, insideFunction);
      // An INSTANCE field initializer runs at construction, not at definition, so a server that
      // imports the class without building one never reaches it. A static field does run.
      const deferredField =
        ts.isPropertyDeclaration(node) &&
        node.initializer === child &&
        !node.modifiers?.some(
          modifier => modifier.kind === ts.SyntaxKind.StaticKeyword
        );
      visit(child, insideFunction || entersFunction || deferredField);
    });
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
    // BEFORE the `.ts` collapse: with both `helper.ts` and `helper.mts` present, esbuild resolves
    // `./helper.mjs` to the `.mts`. Probing the collapsed form first would follow a different file
    // than the bundler does.
    moduleForm,
    `${swapped}.ts`,
    `${swapped}.tsx`,
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

  it("reports a shorthand property, which reads the global", () => {
    // `{ window }` is both the name and the value. The general naming rule would excuse it, so
    // this is checked first.
    expect(read(`export const globals = { window };`).globals).toEqual([
      "window",
    ]);
  });

  it("does not report a read behind a typeof guard", () => {
    // The standard way to write a module that is safe to import on a server. The second read
    // never runs there, and reporting it would reject the very pattern this encourages.
    expect(
      read(`
        export const width = typeof window === "undefined" ? 0 : window.innerWidth;
        export const has = typeof document !== "undefined" && document.title;
      `).globals
    ).toEqual([]);
  });

  it("does not report the erased contexts a global name can sit in", () => {
    // Each of these is removed before the emitted JavaScript exists, so none reads anything at
    // runtime — and reporting them rejects declaration-only code.
    expect(
      read(`
        export interface Root extends HTMLElement { extra: number }
        export const ok = typeof globalThis.document !== "undefined" && globalThis.document.title;
      `).globals
    ).toEqual([]);
  });

  it("does not read a locally declared require as the module loader", () => {
    // A module that declares its own `require` is not calling the ambient loader, so its argument
    // is not a module specifier.
    expect(
      read(`
        const require = (value: string): string => value;
        export const x = require("react");
      `).specifiers
    ).toEqual([]);
  });

  it("ignores a type-only import-equals declaration", () => {
    expect(read(`import type React = require("react");`).specifiers).toEqual(
      []
    );
  });

  it("keeps an invoked generator body deferred", () => {
    // Calling a generator returns an iterator; the body does not run until something pulls from
    // it, so this is safe to import on a server.
    expect(
      read(
        `export const values = (function* () { yield window.innerWidth; })();`
      ).globals
    ).toEqual([]);
  });

  it("reports a computed member name, which runs when the class body does", () => {
    expect(
      read(`export class C { [window.location.href]() { return 1; } }`).globals
    ).toEqual(["window"]);
  });

  it("does not report an instance field initializer, but does report a static one", () => {
    // An instance field runs at construction; a server that imports the class without building
    // one never reaches it. A static field runs at definition.
    expect(
      read(`export class M { width = window.innerWidth; }`).globals
    ).toEqual([]);
    expect(
      read(`export class M { static width = window.innerWidth; }`).globals
    ).toEqual(["window"]);
  });

  it("does not report a declaration member that shares a global's name", () => {
    // `location`, `history`, `navigator`, `Node`, `Element` and `Image` are ordinary words. A
    // check that only excluded property ACCESS still reported them wherever they name a member,
    // rejecting valid server-safe code for describing a shape.
    expect(
      read(`
        export interface Options { history: boolean; location: string }
        export type Point = { location: string };
        export enum Kind { Image = 1 }
        export class Box { navigator = 1; }
        export function move(location: string) { return location; }
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

  it("does not report the erased and short-circuiting forms", () => {
    // Each of these is safe on a server, and reporting any of them rejects valid code:
    // an enum declares its own `Node`; `declare` introduces no runtime binding to shadow;
    // an optional chain evaluates to undefined rather than throwing; and a qualified name inside
    // a type is erased with it.
    expect(
      read(`
        export enum Node { A }
        export const first = Node.A;
        export const title = globalThis.document?.title;
        import type * as dom from "./dom";
        export type Root = dom.HTMLElement;
      `).globals
    ).toEqual([]);
  });

  it("does not report a namespace, an aliased import name, or a bare globalThis read", () => {
    // A namespace emits a real runtime binding; an aliased import names the EXPORT rather than the
    // global; and `globalThis.document` on its own evaluates to undefined on a server — only
    // dereferencing the result throws. All three are valid server-safe code.
    expect(
      read(`
        export namespace Node { export const A = 1; }
        export const first = Node.A;
        import { window as viewport } from "./safe";
        export const w = viewport;
        export const doc = globalThis.document;
      `).globals
    ).toEqual([]);
  });

  it("reports a globalThis read whose result is dereferenced", () => {
    // The control for the case above: the bare read is safe, using it is not.
    expect(read(`export const b = globalThis.document.body;`).globals).toEqual([
      "document",
    ]);
  });

  it("treats both spellings of a globalThis access by the same rule", () => {
    // The bracket form is the same read as the dot form, so the same question decides it: a bare
    // evaluation and a short-circuited chain are safe, an optional call short-circuits too.
    expect(
      read(`
        export const doc = globalThis["document"];
        export const title = globalThis["document"]?.title;
        export const m = globalThis.matchMedia?.("(min-width: 0px)");
      `).globals
    ).toEqual([]);
  });

  it("reports constructing from a globalThis property", () => {
    // `new` throws on undefined exactly as a call does, in either spelling.
    expect(read(`export const i = new globalThis.Image();`).globals).toEqual([
      "Image",
    ]);
    expect(read(`export const j = new globalThis["Image"]();`).globals).toEqual(
      ["Image"]
    );
  });

  it("sees through the erased wrappers between an access and its use", () => {
    // `!`, `as`, and parentheses all vanish at runtime, so the dereference underneath them still
    // throws on a server.
    expect(
      read(`export const b = (globalThis.document!).body;`).globals
    ).toEqual(["document"]);
    expect(
      read(`export const c = (globalThis["document"] as Document).body;`)
        .globals
    ).toEqual(["document"]);
  });

  it("reports an IIFE invoked through .call", () => {
    // `.call` and `.apply` run the body now; the callee is a property access rather than the
    // function itself, so the direct-call check misses it. `.bind` defers and is excluded.
    expect(
      read(`export const w = (() => window.innerWidth).call(undefined);`)
        .globals
    ).toEqual(["window"]);
    expect(
      read(`export const later = (() => window.innerWidth).bind(undefined);`)
        .globals
    ).toEqual([]);
  });

  it("reports the spellings that still reach a global", () => {
    // Bracket access names the global as a STRING; an erased `!` wrapper still leaves the function
    // immediately invoked; a decorator runs when the class body does.
    expect(
      read(`export const b = globalThis["document"].body;`).globals
    ).toEqual(["document"]);
    expect(
      read(`export const w = (() => window.innerWidth)!();`).globals
    ).toEqual(["window"]);
    expect(
      read(
        `export class C { @factory(window.location.href) method() {} }`,
        "probe.ts"
      ).globals
    ).toEqual(["window"]);
  });

  it("treats an empty named import as erased, and an ambient declare as not a binding", () => {
    // `import {} from "react"` binds nothing, so the import is erased. `declare const require`
    // describes what the environment provides — treating it as a local shadow would suppress the
    // very call it declares.
    expect(read(`import {} from "react";`).specifiers).toEqual([]);
    expect(
      read(`
        declare const require: (id: string) => unknown;
        export const react = require("react");
      `).specifiers
    ).toEqual(["react"]);
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

  it("prefers `.mts` over `.ts` for a `.mjs` specifier, as the bundler does", () => {
    // Only observable when BOTH exist: esbuild resolves `./helper.mjs` to `helper.mts`, so probing
    // the collapsed `.ts` form first would follow a different file than the bundle contains — and
    // the walk would read the wrong module's imports while reporting nothing wrong.
    const dir = mkdtempSync(path.join(os.tmpdir(), "nx-layering-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(path.join(dir, "helper.ts"), "export const helper = 1;\n");
    writeFileSync(path.join(dir, "helper.mts"), "export const helper = 2;\n");
    const entry = path.join(dir, "entry.ts");
    writeFileSync(entry, 'export { helper } from "./helper.mjs";\n');

    expect(
      reach(entry)
        .files.map(({ file }) => path.basename(file))
        .sort()
    ).toEqual(["entry.ts", "helper.mts"]);
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
