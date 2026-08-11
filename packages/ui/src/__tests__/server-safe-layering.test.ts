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
  mkdirSync,
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
  "screen",
  // The browser's own alias for the global scope. Absent from every supported Node.
  "self",
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

  /**
   * Whether a node sits inside a `declare` context, which emits no JavaScript at all.
   *
   * `declare namespace Types { import React = require("react") }` describes a shape; TypeScript
   * erases the whole namespace, so the emitted module imports nothing. The declaration's own
   * `isTypeOnly` is false, which is why it has to be asked of the surroundings instead.
   *
   * Read from the modifier flags of the enclosing declarations rather than `NodeFlags.Ambient`,
   * which is not part of TypeScript's published API.
   */
  const inAmbientContext = (node: ts.Node): boolean => {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
      if (
        ts.isModuleDeclaration(n) ||
        ts.isInterfaceDeclaration(n) ||
        ts.isTypeAliasDeclaration(n)
      ) {
        const flags = ts.getCombinedModifierFlags(n);
        if ((flags & ts.ModifierFlags.Ambient) !== 0) return true;
      }
    }
    return false;
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
  //
  // Resolved per OCCURRENCE against the enclosing scopes rather than collected into one file-wide
  // set. The set was the cheaper approximation and it is wrong in both directions: a parameter
  // named `window` in some unrelated helper suppressed a genuine top-level `window.innerWidth`,
  // and a block-scoped binding excused reads outside its block.

  /** Nodes a name can be bound in. Not every node with children opens a scope. */
  const opensScope = (node: ts.Node): boolean =>
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isCatchClause(node) ||
    // An enum's initializers resolve against its own members: `enum E { window = 1, width =
    // window }` reads the member, not the global.
    ts.isEnumDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isFunctionLike(node);

  /** The scopes `var` hoists to, passing through blocks on the way. */
  const holdsHoistedVars = (node: ts.Node): boolean =>
    ts.isSourceFile(node) || ts.isFunctionLike(node) || ts.isModuleBlock(node);

  /**
   * The name a single node binds, or undefined.
   *
   * `declare const require: ...` binds nothing at runtime — it describes what the environment
   * already provides — so treating it as a shadow would suppress the very call it is declaring.
   */
  const boundName = (node: ts.Node): string | undefined => {
    const named =
      ts.isVariableDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node) ||
      ts.isFunctionExpression(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node) ||
      ts.isImportSpecifier(node) ||
      ts.isImportClause(node) ||
      ts.isNamespaceImport(node) ||
      // `import Node = require("./safe")` emits a real local binding, so a later `Node.value` is
      // the module's own rather than the DOM one.
      ts.isImportEqualsDeclaration(node) ||
      // A member is a binding within its enum, which is what an initializer beside it resolves
      // against.
      ts.isEnumMember(node);
    if (!named || node.name === undefined || !ts.isIdentifier(node.name)) {
      return undefined;
    }
    const flags = ts.getCombinedModifierFlags(node as ts.Declaration);
    if ((flags & ts.ModifierFlags.Ambient) !== 0) return undefined;
    return node.name.text;
  };

  /** Whether a variable declaration is a `var`, which hoists out of its block. */
  const isHoisted = (node: ts.VariableDeclaration): boolean => {
    const list = node.parent;
    if (list === undefined || !ts.isVariableDeclarationList(list)) return false;
    return (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0;
  };

  const scopeBindings = new Map<ts.Node, Set<string>>();

  /** Every name bound directly in one scope, not counting the scopes nested inside it. */
  const bindingsOf = (scope: ts.Node): Set<string> => {
    const cached = scopeBindings.get(scope);
    if (cached) return cached;
    const names = new Set<string>();

    // A function's parameters and a named function expression's own name belong to the function
    // itself, not to the scope around it. The same is true of a class expression's name and a
    // catch clause's variable.
    if (ts.isFunctionLike(scope)) {
      for (const parameter of scope.parameters) {
        const name = boundName(parameter);
        if (name !== undefined) names.add(name);
        // A destructured parameter binds through its pattern rather than through `name`.
        ts.forEachChild(parameter, function descend(child): void {
          const bound = boundName(child);
          if (bound !== undefined) names.add(bound);
          ts.forEachChild(child, descend);
        });
      }
    }
    const own = boundName(scope);
    if (
      own !== undefined &&
      (ts.isFunctionExpression(scope) || ts.isClassExpression(scope))
    ) {
      names.add(own);
    }

    // Declarations written directly in this scope. Nested scopes keep their own.
    const collect = (node: ts.Node): void => {
      ts.forEachChild(node, child => {
        if (opensScope(child)) {
          // A function declaration's NAME belongs here even though its body does not.
          const declaredHere = boundName(child);
          if (declaredHere !== undefined && !ts.isFunctionExpression(child)) {
            names.add(declaredHere);
          }
          // `var` passes through a block on its way to the nearest function or module scope, so
          // those declarations still belong to this one.
          if (holdsHoistedVars(scope) && !ts.isFunctionLike(child)) {
            const hoisted = (inner: ts.Node): void => {
              ts.forEachChild(inner, grandchild => {
                // A static block owns its `var` declarations the way a function does: they do not
                // hoist past it to the scope around the class.
                if (
                  ts.isFunctionLike(grandchild) ||
                  ts.isClassStaticBlockDeclaration(grandchild)
                ) {
                  return;
                }
                if (
                  ts.isVariableDeclaration(grandchild) &&
                  isHoisted(grandchild)
                ) {
                  // `var { window } = source` binds through a PATTERN, so the declaration itself
                  // has no single name and every binding sits in a nested element.
                  const name = boundName(grandchild);
                  if (name !== undefined) names.add(name);
                  ts.forEachChild(
                    grandchild.name,
                    function element(child): void {
                      const bound = boundName(child);
                      if (bound !== undefined) names.add(bound);
                      ts.forEachChild(child, element);
                    }
                  );
                }
                hoisted(grandchild);
              });
            };
            hoisted(child);
          }
          return;
        }
        const name = boundName(child);
        if (name !== undefined) names.add(name);
        collect(child);
      });
    };
    collect(scope);

    scopeBindings.set(scope, names);
    return names;
  };

  /** Whether this occurrence of `name` resolves to a binding the module declares. */
  const declaredAt = (node: ts.Node, name: string): boolean => {
    for (let scope: ts.Node | undefined = node; scope; scope = scope.parent) {
      if (opensScope(scope) && bindingsOf(scope).has(name)) return true;
    }
    return false;
  };

  /**
   * Whether this expression is the AMBIENT `globalThis`, rather than something the module named
   * `globalThis` itself.
   *
   * `globalThis` is an ordinary global property, not a keyword, so `const globalThis = { ... }`
   * is legal and shadows it. Matching the spelling alone would report the properties of a plain
   * local object as browser globals.
   */
  const isAmbientGlobalThis = (node: ts.Node): boolean =>
    ts.isIdentifier(node) &&
    node.text === "globalThis" &&
    !declaredAt(node, "globalThis");

  /**
   * Whether a node is a wrapper TypeScript erases, leaving what it wraps in its place.
   *
   * Defined once because it is needed in three places — seeing whether an access is used, whether
   * a function is invoked, and unwrapping a guard condition — and a second copy of the list is how
   * the angle-bracket form came to be handled in one of them and not the others.
   */
  const isErasedWrapper = (node: ts.Node): boolean =>
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node);

  /** The expression underneath any erased wrappers around it. */
  const unwrap = (node: ts.Node): ts.Node => {
    let inner = node;
    while (isErasedWrapper(inner) && "expression" in inner) {
      inner = (inner as { expression: ts.Expression }).expression;
    }
    return inner;
  };

  /**
   * Whether a node IS `typeof <name>`, rather than merely containing one.
   *
   * `(typeof window && "object") === "object"` contains a `typeof` and proves nothing — the left
   * side is always `"object"`, so the guarded branch runs on a server too. Only an operand that
   * IS the `typeof`, once its wrappers are stripped, establishes the comparison's polarity.
   */
  const isTypeofOf = (node: ts.Node, name: string): boolean => {
    const inner = unwrap(node);
    if (!ts.isTypeOfExpression(inner)) return false;
    const operand = unwrap(inner.expression);
    // Every spelling of the same guard: `typeof document`, `typeof globalThis.document`, and
    // `typeof globalThis["document"]`. All three evaluate to a string rather than throwing.
    return (
      (ts.isIdentifier(operand) && operand.text === name) ||
      (ts.isPropertyAccessExpression(operand) &&
        operand.name.text === name &&
        isAmbientGlobalThis(operand.expression)) ||
      (ts.isElementAccessExpression(operand) &&
        isAmbientGlobalThis(operand.expression) &&
        ts.isStringLiteral(operand.argumentExpression) &&
        operand.argumentExpression.text === name)
    );
  };

  /** Whether a condition subtree asks `typeof <name>`, which is the SSR guard. */
  const mentionsTypeof = (condition: ts.Node, name: string): boolean => {
    let found = false;
    const look = (node: ts.Node): void => {
      if (ts.isTypeOfExpression(node)) {
        const operand = node.expression;
        // Every spelling of the same guard: `typeof document`, `typeof globalThis.document`, and
        // `typeof globalThis["document"]`. All three evaluate to a string rather than throwing.
        const namesIt =
          (ts.isIdentifier(operand) && operand.text === name) ||
          (ts.isPropertyAccessExpression(operand) &&
            operand.name.text === name &&
            isAmbientGlobalThis(operand.expression)) ||
          (ts.isElementAccessExpression(operand) &&
            isAmbientGlobalThis(operand.expression) &&
            ts.isStringLiteral(operand.argumentExpression) &&
            operand.argumentExpression.text === name);
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
  /**
   * Whether a guard condition is true exactly when the name EXISTS.
   *
   * `undefined` when the shape is not one this recognises, which is treated as no guard at all.
   * The polarity is the whole point: `typeof window === "undefined" ? window.innerWidth : 0` runs
   * the read on precisely the runtime that cannot serve it, and a check that only asked whether
   * `typeof window` was mentioned excused it.
   */
  const definedWhenTrue = (
    condition: ts.Node,
    name: string
  ): boolean | undefined => {
    let node: ts.Node = condition;
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    // `globalThis.document && globalThis.document.body` guards by TRUTHINESS, and it is safe for
    // this spelling only: reading a property off `globalThis` yields undefined rather than
    // throwing, so the chain short-circuits. The bare `document && document.body` is NOT
    // equivalent — the condition itself throws a ReferenceError on a server — so only an access
    // off the ambient `globalThis` counts.
    if (
      (ts.isPropertyAccessExpression(node) &&
        node.name.text === name &&
        isAmbientGlobalThis(node.expression)) ||
      (ts.isElementAccessExpression(node) &&
        isAmbientGlobalThis(node.expression) &&
        ts.isStringLiteral(node.argumentExpression) &&
        node.argumentExpression.text === name)
    ) {
      return true;
    }
    if (!ts.isBinaryExpression(node)) return undefined;
    const operator = node.operatorToken.kind;
    const equal =
      operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      operator === ts.SyntaxKind.EqualsEqualsToken;
    const notEqual =
      operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsToken;
    if (!equal && !notEqual) return undefined;
    const sides = [node.left, node.right];
    const typeofSide = sides.find(side => isTypeofOf(side, name));
    const other = sides.find(side => side !== typeofSide);
    if (typeofSide === undefined || other === undefined) return undefined;
    if (!ts.isStringLiteral(other)) return undefined;
    // Compared against `"undefined"`, equality means ABSENT. Compared against any other type name
    // — `"object"`, `"function"` — equality means present.
    return other.text === "undefined" ? notEqual : equal;
  };

  const guardedByTypeof = (read: ts.Node, name: string): boolean => {
    for (let node: ts.Node = read; node.parent; node = node.parent) {
      const parent = node.parent;
      let condition: ts.Node | undefined;
      // Whether reaching this branch requires the condition to have been TRUE.
      let reachedWhenTrue: boolean | undefined;
      if (
        ts.isConditionalExpression(parent) &&
        (parent.whenTrue === node || parent.whenFalse === node)
      ) {
        condition = parent.condition;
        reachedWhenTrue = parent.whenTrue === node;
      } else if (
        ts.isIfStatement(parent) &&
        (parent.thenStatement === node || parent.elseStatement === node)
      ) {
        condition = parent.expression;
        reachedWhenTrue = parent.thenStatement === node;
      } else if (
        ts.isBinaryExpression(parent) &&
        parent.right === node &&
        (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)
      ) {
        condition = parent.left;
        // `a && b` reaches `b` when `a` was true; `a || b` reaches it when `a` was false.
        reachedWhenTrue =
          parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken;
      }
      if (condition === undefined || reachedWhenTrue === undefined) continue;
      const defined = definedWhenTrue(condition, name);
      // A recognised guard protects the read only where the branch that reaches it is the one the
      // name exists on. An unrecognised shape protects nothing.
      if (defined !== undefined && defined === reachedWhenTrue) return true;
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
    while (value.parent && isErasedWrapper(value.parent)) {
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
      if (outer.questionDotToken === undefined) return true;
      // `a?.b.c` short-circuits the whole chain, but PARENTHESES end it: `(a?.b).c` reads
      // `.c` off the `undefined` the chain produced, and throws.
      // ANY erased wrapper ends the chain, not only parentheses: TypeScript emits
      // `(globalThis.document?.body).title` for the `as` form too, and the assertion is gone by
      // the time it runs. Asked of the shared set so this cannot drift from the other unwrappers.
      return (
        outer.parent !== undefined &&
        isErasedWrapper(outer.parent) &&
        usedAsValue(outer.parent)
      );
    }
    // `new globalThis.Image()` throws for the same reason a call does, and `new` has no optional
    // form that could short-circuit it. A tagged template invokes its tag, so ``globalThis.foo`x` ``
    // throws as well, with no call parentheses to recognise.
    if (ts.isNewExpression(outer) && outer.expression === value) return true;
    if (ts.isTaggedTemplateExpression(outer) && outer.tag === value)
      return true;
    // `class C extends globalThis.HTMLElement {}` reads the base when the class is DEFINED, so
    // extending `undefined` throws while the module body is still running.
    if (
      ts.isExpressionWithTypeArguments(outer) &&
      outer.expression === value &&
      outer.parent !== undefined &&
      ts.isHeritageClause(outer.parent) &&
      outer.parent.token === ts.SyntaxKind.ExtendsKeyword
    ) {
      return true;
    }
    // Destructuring reads properties off the value, so `const { body } = globalThis.document`
    // throws on `undefined` exactly as `globalThis.document.body` does — in the declaration form
    // and in the assignment form, where the pattern parses as an object or array literal.
    if (
      ts.isVariableDeclaration(outer) &&
      outer.initializer === value &&
      // The two binding patterns are named individually because `ts.isBindingPattern` is one of
      // TypeScript's internals: present at runtime, absent from the published types, and free to
      // disappear in a minor release.
      (ts.isObjectBindingPattern(outer.name) ||
        ts.isArrayBindingPattern(outer.name))
    ) {
      return true;
    }
    if (
      ts.isBinaryExpression(outer) &&
      outer.right === value &&
      outer.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isObjectLiteralExpression(outer.left) ||
        ts.isArrayLiteralExpression(outer.left))
    ) {
      return true;
    }
    // Iterating asks the value for an iterator, so `[...globalThis.document]`,
    // `use(...globalThis.document)` and `for (const n of globalThis.document)` all throw. Object
    // spread does not — `{ ...undefined }` is an empty object — and needs no exclusion here,
    // because it parses as a SpreadAssignment rather than a SpreadElement.
    if (ts.isSpreadElement(outer)) return true;
    return ts.isForOfStatement(outer) && outer.expression === value;
  };

  /** Whether this identifier reads the global, rather than naming something in another position. */
  const readsTheGlobal = (node: ts.Identifier): boolean => {
    if (declaredAt(node, node.text)) return false;
    const parent = node.parent;

    // Checked BEFORE the naming rule below, which would otherwise swallow it: `document` here is
    // the `name` of a property access, and it is exactly the read that matters. `globalThis`
    // exists on a server while `document` does not, so this still throws.
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.name === node &&
      isAmbientGlobalThis(parent.expression)
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
      return !guardedByTypeof(node, node.text);
    }

    // `export const globals = { window }` READS the global — the shorthand is both the name and
    // the value, so the general naming rule below would wrongly excuse it.
    if (ts.isShorthandPropertyAssignment(parent))
      return !guardedByTypeof(node, node.text);

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
    // A statement LABEL is not a read: `window: for (;;) { break window; }` names a jump target,
    // and the label sits in a `label` property rather than any of the `name` positions above.
    if (
      (ts.isLabeledStatement(parent) ||
        ts.isBreakStatement(parent) ||
        ts.isContinueStatement(parent)) &&
      parent.label === node
    ) {
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
    //
    // `class C extends HTMLElement {}` is the exception, and it has to be recognised INSIDE this
    // loop rather than after it. TypeScript parses a heritage clause's target as an
    // `ExpressionWithTypeArguments`, for which `ts.isTypeNode` returns true — so a check placed
    // after the loop never runs. The base of a class is evaluated when the class is defined, and
    // extending `undefined` throws while the module body is still running.
    const isClassBase = (n: ts.Node): boolean =>
      ts.isExpressionWithTypeArguments(n) &&
      n.parent !== undefined &&
      ts.isHeritageClause(n.parent) &&
      n.parent.token === ts.SyntaxKind.ExtendsKeyword &&
      n.parent.parent !== undefined &&
      (ts.isClassDeclaration(n.parent.parent) ||
        ts.isClassExpression(n.parent.parent));
    for (let n: ts.Node | undefined = parent; n; n = n.parent) {
      if (isClassBase(n)) break;
      if (ts.isTypeNode(n) || ts.isTypeAliasDeclaration(n)) return false;
      if (ts.isStatement(n) || ts.isSourceFile(n)) break;
    }

    // `typeof window === "undefined"` is the guard that MAKES a module server-safe: it evaluates
    // to a string rather than throwing, so reporting it would punish the correct pattern.
    // `typeof (window)` and `typeof (window as unknown)` evaluate to a string just as the bare
    // form does, so the wrappers between the identifier and the `typeof` are stepped over.
    let operandOf: ts.Node = node;
    while (operandOf.parent && isErasedWrapper(operandOf.parent)) {
      operandOf = operandOf.parent;
    }
    if (operandOf.parent && ts.isTypeOfExpression(operandOf.parent))
      return false;

    // `typeof window === "undefined" ? 0 : window.innerWidth` is the standard way to write a
    // module that is safe to import on a server, and the second read never runs there. Reporting
    // it would reject the very pattern this check exists to encourage.
    return !guardedByTypeof(node, node.text);
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
      // `import type React = require("react")` is erased like any other type-only import, and so
      // is any import inside a `declare` context, whose enclosing declaration emits nothing.
      if (!node.isTypeOnly && !inAmbientContext(node)) {
        record(node.moduleReference.expression);
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      // A module that declares its own `require` is not calling the ambient loader, so its
      // argument is not a module specifier.
      const ambientRequire = (expression: ts.Expression): boolean =>
        ts.isIdentifier(expression) &&
        expression.text === "require" &&
        !declaredAt(expression, "require");
      const isRequire = ambientRequire(callee);
      // `require.call(undefined, "react")` loads the module just as `require("react")` does, and
      // the specifier moves to the second argument. `.bind` is absent because it defers.
      const isIndirectRequire =
        ts.isPropertyAccessExpression(callee) &&
        (callee.name.text === "call" || callee.name.text === "apply") &&
        ambientRequire(callee.expression);
      if (isDynamicImport || isRequire) record(node.arguments[0]);
      // `.apply` takes its arguments as an array, which is not a literal this can read — recorded
      // as unreadable rather than skipped, so it fails the allow-list.
      if (isIndirectRequire) record(node.arguments[1]);
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
      isAmbientGlobalThis(node.expression) &&
      node.argumentExpression !== undefined &&
      ts.isStringLiteral(node.argumentExpression) &&
      BROWSER_GLOBALS.has(node.argumentExpression.text) &&
      // The `?.` in `globalThis?.["document"]` protects `globalThis`, which always exists — not
      // the missing property. Whether the chain really short-circuits is decided by what USES the
      // result, so that question is left to `usedAsValue` rather than answered here.
      usedAsValue(node) &&
      !guardedByTypeof(node, node.argumentExpression.text)
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
      while (invoked.parent && isErasedWrapper(invoked.parent)) {
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
      // A tagged template invokes its tag as the module evaluates, with no call parentheses to
      // recognise: ``(() => window.innerWidth)`` `` runs the body now.
      if (ts.isTaggedTemplateExpression(parent) && parent.tag === invoked) {
        return true;
      }
      // `new (function () { ... })()` runs the body as the object is constructed.
      if (ts.isNewExpression(parent) && parent.expression === invoked) {
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

/**
 * Files whose contents are DATA, carrying no imports, no directive and no globals.
 *
 * Named explicitly, with everything else analysed. The inverse — allow-listing the SOURCE
 * extensions — reads as failing closed and does the opposite: an unrecognised extension would get
 * an empty analysis, which is the most permissive result available. The bundler loads a file
 * literally named `helper`, with no extension at all, as JavaScript, and that spelling would have
 * shipped unread. Anything this build cannot load is not a valid import in the first place, so
 * analysing it costs nothing.
 */
const ASSET = /\.(?:css|json)$/;

/** Resolve a relative specifier the way the bundler does, or `null` if it names a package. */
function resolveLocal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  // esbuild retries resolution with any `?query` or `#fragment` suffix removed, so `./helper.ts?x`
  // reaches `helper.ts`. Probing the suffixed path finds nothing, and an unresolved RELATIVE
  // specifier is recorded as an external package — failing the allow-list for a local import.
  const withoutSuffix = specifier.replace(/[?#].*$/, "");
  const base = path.resolve(path.dirname(fromFile), withoutSuffix);
  // A TypeScript module may import `./helper.js` while the source is `helper.ts`, and the bundler
  // substitutes the extension. Probing `helper.js.ts` finds nothing, and the specifier would then
  // be recorded as an external PACKAGE, failing the allow-list for an ordinary local import.
  const swapped = base.replace(/\.(?:js|jsx|mjs|cjs)$/, "");
  // `./helper.mjs` may be backed by `helper.mts`, and `.cjs` by `.cts`. Those keep their own
  // extension rather than collapsing to `.ts`, so they need their own candidates.
  const moduleForm = base.replace(/\.mjs$/, ".mts").replace(/\.cjs$/, ".cts");
  // `.tsx` BEFORE `.ts`, matching esbuild's documented implicit-extension order
  // (`.tsx,.ts,.jsx,.js,.css,.json`). With both present the build takes the `.tsx`, so probing the
  // other way round reads a file that does not ship and every conclusion about it is about the
  // wrong module.
  for (const candidate of [
    base,
    // esbuild's implicit-extension order, in full. Probing only the TypeScript pair left a plain
    // `helper.js` sibling unresolved, and an unresolved relative specifier is recorded as an
    // external PACKAGE — so an ordinary local import failed the allow-list.
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    `${base}.css`,
    `${base}.json`,
    // BEFORE the `.ts` collapse: with both `helper.ts` and `helper.mts` present, esbuild resolves
    // `./helper.mjs` to the `.mts`. Probing the collapsed form first would follow a different file
    // than the bundler does.
    moduleForm,
    // The `.js`-substituted form goes the OTHER way: `.ts` before `.tsx`. Measured against
    // esbuild 0.25.12 with both siblings present — `./helper.js` resolves to `helper.ts` while the
    // extensionless `./helper` resolves to `helper.tsx`. The `.tsx,.ts,...` default describes
    // implicit-extension resolution only, and does not govern this substitution.
    `${swapped}.ts`,
    `${swapped}.tsx`,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
    path.join(base, "index.jsx"),
    path.join(base, "index.js"),
    path.join(base, "index.css"),
    path.join(base, "index.json"),
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

    // A reached asset is not executable JavaScript, and parsing one as TypeScript invents
    // identifiers from its contents: a stylesheet with a `.window` selector would be reported as
    // reading the browser global. It still counts as reached, and it can import nothing, so it is
    // recorded with an empty analysis rather than parsed.
    const analysis = ASSET.test(file)
      ? { specifiers: [], clientDirective: false, jsx: false, globals: [] }
      : analyze(readFileSync(file, "utf8"), file);
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

  it("reads the ambient require invoked indirectly", () => {
    // `require.call(undefined, "react")` loads the module exactly as a direct call does, and the
    // specifier moves to the second argument.
    expect(
      read(`export const react = require.call(undefined, "react");`).specifiers
    ).toEqual(["react"]);
    // `.apply` takes an array, which is not a literal this can read. Recorded as unreadable so it
    // fails the allow-list, rather than skipped so it passes.
    const applied = read(
      `export const react = require.apply(undefined, ["react"]);`
    ).specifiers;
    expect(applied).toHaveLength(1);
    expect(applied[0]).toContain("unreadable specifier");
    // A module that binds its own `require` is not calling the loader, indirectly either.
    expect(
      read(`
        const require = (value: string): string => value;
        export const x = require.call(undefined, "react");
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

  it("reports taking the value apart, not only reading through it", () => {
    // Destructuring and iterating both ask the value for something, so each throws on `undefined`
    // exactly as a property read does.
    expect(
      read(`export const { body } = globalThis.document;`).globals
    ).toEqual(["document"]);
    expect(
      read(`export let body; ({ body } = globalThis.document);`).globals
    ).toEqual(["document"]);
    expect(
      read(`export const all = [...globalThis.document];`).globals
    ).toEqual(["document"]);
    expect(
      read(`export const n = Math.max(...globalThis.document);`).globals
    ).toEqual(["document"]);
    expect(
      read(`for (const n of globalThis.document) { console.log(n); }`).globals
    ).toEqual(["document"]);
  });

  it("does not report object spread, which tolerates undefined", () => {
    // The control for the case above: `{ ...undefined }` is an empty object rather than a throw,
    // so spreading into an OBJECT is safe where spreading into an array or a call is not.
    expect(
      read(`export const copy = { ...globalThis.document };`).globals
    ).toEqual([]);
  });

  it("does not report a module that shadows globalThis itself", () => {
    // `globalThis` is an ordinary global property rather than a keyword, so a module may bind the
    // name. Its properties are then a plain object's, in either spelling.
    expect(
      read(`
        const globalThis = { document: { body: 1 } };
        export const x = globalThis.document.body;
        export const y = globalThis["document"].body;
      `).globals
    ).toEqual([]);
  });

  it("applies the typeof guard to the bracket spelling too", () => {
    // `typeof globalThis["document"]` evaluates to a string rather than throwing, so the guarded
    // branch is as safe as the dot form's.
    expect(
      read(
        `export const b = typeof globalThis["document"] === "undefined" ? 0 : globalThis["document"].body;`
      ).globals
    ).toEqual([]);
  });

  it("does not report a named class expression's own binding", () => {
    // The `Node` in the initializer is the class's self-binding, which shadows the DOM global for
    // the whole expression.
    expect(
      read(`export const C = class Node { static self: unknown = Node };`)
        .globals
    ).toEqual([]);
  });

  it("reports a function invoked as a template tag", () => {
    // A tagged template calls its tag as the module evaluates, with no call parentheses for the
    // direct-call check to recognise.
    expect(
      read(
        "export const width = ((s: TemplateStringsArray) => window.innerWidth)``;"
      ).globals
    ).toEqual(["window"]);
  });

  it("resolves a shadowing name against the scopes that enclose the read", () => {
    // A binding somewhere else in the file shadows nothing. The parameter below is the helper's,
    // and the top-level read still reaches the ambient global.
    expect(
      read(`
        function normalize(window: unknown) { return window; }
        export const width = window.innerWidth;
      `).globals
    ).toEqual(["window"]);
    // Nor does a binding confined to a block reach past it.
    expect(
      read(`
        { const location = "home"; void location; }
        export const href = location.href;
      `).globals
    ).toEqual(["location"]);
  });

  it("still excuses a read the enclosing scope really does bind", () => {
    // The control for the case above. A module-level binding, a `var` reached from inside a block
    // it hoists out of, and a parameter read inside its own function are all the module's own.
    expect(
      read(`
        const location = "home";
        export const href = location;
      `).globals
    ).toEqual([]);
    expect(
      read(`
        { var history = "own"; }
        export const h = history;
      `).globals
    ).toEqual([]);
    expect(
      read(`export const f = (document: { title: string }) => document.title;`)
        .globals
    ).toEqual([]);
  });

  it("reports a class whose base is a browser global", () => {
    // A class base is evaluated when the class is DEFINED, so extending `undefined` throws while
    // the module body is still running. TypeScript parses it as a node `ts.isTypeNode` accepts,
    // which is why it is recognised inside the type walk rather than after it.
    expect(read(`export class C extends HTMLElement {}`).globals).toEqual([
      "HTMLElement",
    ]);
  });

  it("does not report an interface extending the same name", () => {
    // The control: a heritage clause on an INTERFACE is erased with it, so nothing reads the
    // global at runtime.
    expect(
      read(`export interface Root extends HTMLElement {}`).globals
    ).toEqual([]);
  });

  it("does not report a name bound by an import-equals", () => {
    // `import Node = require("./safe")` emits a real local binding, so the later read is the
    // module's own rather than the DOM one.
    expect(
      read(`
        import Node = require("./safe");
        export const n = Node.value;
      `).globals
    ).toEqual([]);
  });

  it("reports a globalThis property invoked as a template tag", () => {
    // A tagged template invokes its tag, so this calls `undefined`.
    expect(read("export const out = globalThis.document`x`;").globals).toEqual([
      "document",
    ]);
  });

  it("reads which side of a typeof guard the code is on", () => {
    // The guard's POLARITY decides which branch is safe. These run the read on exactly the runtime
    // that cannot serve it, and a check that only asked whether `typeof window` appeared nearby
    // excused every one of them.
    expect(
      read(
        `export const w = typeof window === "undefined" ? window.innerWidth : 0;`
      ).globals
    ).toEqual(["window"]);
    expect(
      read(
        `export const w = typeof window === "undefined" && window.innerWidth;`
      ).globals
    ).toEqual(["window"]);
    expect(
      read(
        `export const w = typeof window !== "undefined" || window.innerWidth;`
      ).globals
    ).toEqual(["window"]);
  });

  it("still excuses the guard written the right way round", () => {
    // The control for the case above, in each of the four shapes.
    expect(
      read(
        `export const w = typeof window !== "undefined" ? window.innerWidth : 0;`
      ).globals
    ).toEqual([]);
    expect(
      read(
        `export const w = typeof window !== "undefined" && window.innerWidth;`
      ).globals
    ).toEqual([]);
    expect(
      read(
        `export const w = typeof window === "undefined" || window.innerWidth;`
      ).globals
    ).toEqual([]);
    expect(
      read(`export const w = typeof window === "object" && window.innerWidth;`)
        .globals
    ).toEqual([]);
  });

  it("follows an optional chain that grouping has ended", () => {
    // `a?.b.c` short-circuits the whole chain, but parentheses END it: `(a?.b).c` reads `.c` off
    // the `undefined` the chain produced.
    expect(
      read(`export const n = (globalThis.document?.body).nodeName;`).globals
    ).toEqual(["document"]);
    // The control: without the parentheses the chain carries through and nothing throws.
    expect(
      read(`export const n = globalThis.document?.body.nodeName;`).globals
    ).toEqual([]);
  });

  it("reports a function whose body runs because it is constructed", () => {
    expect(
      read(
        `export const w = new (function () { return window.innerWidth; })();`
      ).globals
    ).toEqual(["window"]);
  });

  it("reports a class extending a globalThis property", () => {
    expect(
      read(`export class C extends globalThis.HTMLElement {}`).globals
    ).toEqual(["HTMLElement"]);
  });

  it("keeps a class static block's bindings inside it", () => {
    // A `const` in a static block is invisible to the field initialisers beside it, so the second
    // read is the ambient global and the class throws as it is defined.
    expect(
      read(`
        export class C {
          static { const window = {}; void window; }
          static width = window.innerWidth;
        }
      `).globals
    ).toEqual(["window"]);
  });

  it("does not record an import inside a declare context", () => {
    // A `declare namespace` emits nothing, so the module it names is never imported at runtime.
    // The declaration's own `isTypeOnly` is false, which is why the surroundings decide it.
    expect(
      read(`
        declare namespace Types { import React = require("react"); }
        export const x = 1;
      `).specifiers
    ).toEqual([]);
  });

  it("still records the same import outside one", () => {
    // The control: an ordinary namespace DOES emit, so the import is real.
    expect(
      read(`
        namespace Types { import React = require("react"); export const y = React; }
        export const x = 1;
      `).specifiers
    ).toEqual(["react"]);
  });

  it("accepts a typeof guard written with wrappers around it", () => {
    // `typeof (window)` evaluates to a string exactly as the bare form does, so the wrappers
    // between the identifier and the `typeof` are stepped over rather than ending the search.
    expect(read(`export const t = typeof (window);`).globals).toEqual([]);
    expect(
      read(`export const t = typeof (window as unknown);`).globals
    ).toEqual([]);
  });

  it("requires the operand to BE a typeof, not merely contain one", () => {
    // `(typeof window && "object") === "object"` is always true, so the guarded branch runs on a
    // server too. A recursive search for a `typeof` anywhere in the operand called that a guard.
    expect(
      read(
        `export const w = (typeof window && "object") === "object" && window.innerWidth;`
      ).globals
    ).toEqual(["window"]);
    // The control: the ordinary spelling, which IS the typeof, still guards.
    expect(
      read(
        `export const w = typeof window !== "undefined" && window.innerWidth;`
      ).globals
    ).toEqual([]);
  });

  it("ends an optional chain at any erased wrapper", () => {
    // TypeScript emits `(globalThis.document?.body).title` for the `as` form, so the assertion
    // ends the chain exactly as parentheses do and the dereference throws.
    expect(
      read(`export const t = (globalThis.document?.body as HTMLElement).title;`)
        .globals
    ).toEqual(["document"]);
    // The control: with the chain unbroken, it short-circuits and nothing throws.
    expect(
      read(`export const t = globalThis.document?.body?.title;`).globals
    ).toEqual([]);
  });

  it("still defers a function the module only defines", () => {
    // The control, and the reason this is not simply "look inside every function": a module may
    // export something that touches the DOM when a browser eventually calls it.
    expect(
      read(`
        export function later() { return window.innerWidth; }
        const unused = () => document.title;
        export { unused };
      `).globals
    ).toEqual([]);
  });

  it("reports the browser's alias for the global scope", () => {
    expect(read(`export const scope = self;`).globals).toEqual(["self"]);
  });

  it("reads an optional access on globalThis by what uses it", () => {
    // `globalThis` always exists, so `?.` there protects nothing: the read of the missing property
    // still happens and `.body` still dereferences `undefined`.
    expect(
      read(`export const b = globalThis?.["document"].body;`).globals
    ).toEqual(["document"]);
    // The controls: a bare optional access evaluates to undefined, and an optional chain that
    // continues really does short-circuit.
    expect(read(`export const d = globalThis?.["document"];`).globals).toEqual(
      []
    );
    expect(
      read(`export const b = globalThis?.["document"]?.body;`).globals
    ).toEqual([]);
  });

  it("does not report an enum member referenced by its neighbour", () => {
    // `width = window` resolves to the member declared above it, which TypeScript emits as the
    // enum's own value. Rejecting this would rule out an ordinary enum for using an ordinary word.
    expect(
      read(`export enum E { window = 1, width = window }`).globals
    ).toEqual([]);
    // And the members stay INSIDE it. A member named after a global must not excuse a read beyond
    // the enum, which is what makes this a scope rather than a set of names.
    expect(
      read(`
        export enum E { window = 1 }
        export const w = window.innerWidth;
      `).globals
    ).toEqual(["window"]);
  });

  it("sees through an angle-bracket assertion wherever one can appear", () => {
    // The same erasure has to be seen in both places that unwrap: where a value is USED, and
    // where a function is INVOKED. They used to carry separate copies of the list.
    expect(
      read(`export const b = (<{ body: unknown }>globalThis.document).body;`)
        .globals
    ).toEqual(["document"]);
    expect(
      read(`export const w = (<() => number>(() => window.innerWidth))();`)
        .globals
    ).toEqual(["window"]);
  });

  it("sees through an angle-bracket type assertion", () => {
    // `<T>expr` is erased exactly as `as T` is, so the dereference underneath it still throws.
    expect(
      read(`export const b = (<{ body: unknown }>globalThis.document).body;`)
        .globals
    ).toEqual(["document"]);
  });

  it("reports the viewport globals a server does not have", () => {
    // `screen` is browser-only in every supported Node, needs no import, no JSX and no directive,
    // so nothing else in this file would notice a module reading it at load time.
    expect(read(`export const w = screen.width;`).globals).toEqual(["screen"]);
  });

  it("accepts a truthiness guard on a globalThis property", () => {
    // Reading a property off `globalThis` yields undefined rather than throwing, so the chain
    // short-circuits and the module is safe.
    expect(
      read(`export const b = globalThis.document && globalThis.document.body;`)
        .globals
    ).toEqual([]);
    expect(
      read(
        `export const b = globalThis["document"] && globalThis["document"].body;`
      ).globals
    ).toEqual([]);
  });

  it("still reports the same shape written on a bare identifier", () => {
    // `document && document.body` is NOT an equivalent guard: the condition itself throws a
    // ReferenceError on a server, which is why the rule above is written only for an access off
    // `globalThis`.
    //
    // What this pins is the verdict, not the rule's narrowness. The condition is a bare read and
    // is reported on its own account, so widening the rule to identifiers would still leave this
    // module reported — measured, by making that change and watching this test pass. The
    // narrowness is a correctness argument carried by the comment on `definedWhenTrue`, and no
    // input distinguishes it through `globals`.
    expect(read(`export const b = document && document.body;`).globals).toEqual(
      ["document"]
    );
  });

  it("does not report a statement label that shares a global\'s name", () => {
    // A label names a jump target, not a value, in all three positions it can appear.
    // At MODULE scope, where a read would actually be reported — inside a function the walker
    // skips globals anyway, so a wrapped fixture would pass without reaching this rule.
    expect(
      read(`
        window: for (;;) { break window; }
        location: for (;;) { continue location; }
        export const ok = 1;
      `).globals
    ).toEqual([]);
  });

  it("hoists every name a destructured var binds", () => {
    // `var { window } = source` binds through a PATTERN, so the declaration has no single name and
    // the binding sits in a nested element. The hoist still reaches module scope, so the later
    // read is the module's own and reporting it would reject valid code.
    expect(
      read(`
        const source = { window: 1, location: 2 };
        { var { window, location } = source; }
        export const w = window;
        export const l = location;
      `).globals
    ).toEqual([]);
  });

  it("keeps a static block's var inside it too", () => {
    // `var` hoists out of a plain block but NOT out of a static block, which owns its var scope
    // the way a function does. The field initialiser beside it reads the ambient global.
    expect(
      read(`
        export class C {
          static { var window = {}; void window; }
          static width = window.innerWidth;
        }
      `).globals
    ).toEqual(["window"]);
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

  it("resolves a plain JavaScript sibling", () => {
    // esbuild probes `.jsx` and `.js` after the TypeScript pair. Missing them left an ordinary
    // local import unresolved, and an unresolved RELATIVE specifier is recorded as an external
    // package — so `./helper` failed the allow-list for existing as JavaScript.
    const dir = mkdtempSync(path.join(os.tmpdir(), "nx-layering-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(path.join(dir, "helper.js"), "export const helper = 1;\n");
    const entry = path.join(dir, "entry.ts");
    writeFileSync(entry, 'export { helper } from "./helper";\n');

    const { files, packages } = reach(entry);
    expect([...packages.keys()]).toEqual([]);
    expect(files.map(({ file }) => path.basename(file)).sort()).toEqual([
      "entry.ts",
      "helper.js",
    ]);
  });

  it("resolves a specifier carrying a query suffix", () => {
    // esbuild retries resolution with `?query` and `#fragment` removed. Probing the suffixed path
    // finds nothing, and an unresolved RELATIVE specifier is recorded as an external package.
    const dir = mkdtempSync(path.join(os.tmpdir(), "nx-layering-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(path.join(dir, "helper.ts"), "export const helper = 1;\n");
    const entry = path.join(dir, "entry.ts");
    writeFileSync(entry, 'export { helper } from "./helper.ts?raw";\n');

    const { files, packages } = reach(entry);
    expect([...packages.keys()]).toEqual([]);
    expect(files.map(({ file }) => path.basename(file)).sort()).toEqual([
      "entry.ts",
      "helper.ts",
    ]);
  });

  it("analyses a file with no extension, which the bundler loads as JavaScript", () => {
    // The reason the asset rule names DATA extensions rather than allow-listing source ones:
    // an unrecognised extension given an empty analysis is the most permissive result available,
    // and a file literally named `helper` is loaded as JavaScript.
    const dir = mkdtempSync(path.join(os.tmpdir(), "nx-layering-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      path.join(dir, "helper"),
      "export const w = window.innerWidth;\n"
    );
    const entry = path.join(dir, "entry.ts");
    writeFileSync(entry, 'export { w } from "./helper";\n');

    const { files } = reach(entry);
    expect(files.map(({ file }) => path.basename(file)).sort()).toEqual([
      "entry.ts",
      "helper",
    ]);
    expect(files.flatMap(({ analysis }) => analysis.globals)).toEqual([
      "window",
    ]);
  });

  it("resolves a reached asset by implicit extension", () => {
    // `.css` and `.json` are in esbuild's implicit-extension list. Missing them left the specifier
    // unresolved, and an unresolved RELATIVE specifier is recorded as an external package.
    const dir = mkdtempSync(path.join(os.tmpdir(), "nx-layering-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(path.join(dir, "helper.css"), ".window { color: red; }\n");
    const entry = path.join(dir, "entry.ts");
    writeFileSync(entry, 'import "./helper";\nexport const x = 1;\n');

    const { files, packages } = reach(entry);
    expect([...packages.keys()]).toEqual([]);
    expect(files.map(({ file }) => path.basename(file)).sort()).toEqual([
      "entry.ts",
      "helper.css",
    ]);
    expect(files.flatMap(({ analysis }) => analysis.globals)).toEqual([]);
  });

  it("resolves a directory index written as JavaScript", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nx-layering-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(path.join(dir, "helper"));
    writeFileSync(
      path.join(dir, "helper", "index.js"),
      "export const helper = 1;\n"
    );
    const entry = path.join(dir, "entry.ts");
    writeFileSync(entry, 'export { helper } from "./helper";\n');

    expect([...reach(entry).packages.keys()]).toEqual([]);
  });

  it("keeps `.ts` first for an explicit `.js` specifier", () => {
    // The two resolutions differ and both are measured against esbuild 0.25.12 with BOTH siblings
    // present: `./helper.js` resolves to `helper.ts`, while the extensionless `./helper` in the
    // case below resolves to `helper.tsx`. The `.tsx,.ts,...` default governs implicit-extension
    // resolution only; it does not describe `.js`-to-TypeScript substitution.
    const dir = mkdtempSync(path.join(os.tmpdir(), "nx-layering-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(path.join(dir, "helper.ts"), "export const helper = 1;\n");
    writeFileSync(
      path.join(dir, "helper.tsx"),
      "export const helper = <div />;\n"
    );
    const entry = path.join(dir, "entry.ts");
    writeFileSync(entry, 'export { helper } from "./helper.js";\n');

    expect(
      reach(entry)
        .files.map(({ file }) => path.basename(file))
        .sort()
    ).toEqual(["entry.ts", "helper.ts"]);
  });

  it("prefers `.tsx` over `.ts`, as esbuild's implicit-extension order does", () => {
    // Only observable when BOTH exist. esbuild's documented default is
    // `.tsx,.ts,.jsx,.js,.css,.json`, so the build takes `helper.tsx` — and reading `helper.ts`
    // instead would inspect a file that does not ship, leaving every conclusion about that module
    // green and about the wrong source. The `.tsx` here carries JSX, which the `.ts` does not.
    const dir = mkdtempSync(path.join(os.tmpdir(), "nx-layering-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(path.join(dir, "helper.ts"), "export const helper = 1;\n");
    writeFileSync(
      path.join(dir, "helper.tsx"),
      "export const helper = <div />;\n"
    );
    const entry = path.join(dir, "entry.ts");
    writeFileSync(entry, 'export { helper } from "./helper";\n');

    const { files } = reach(entry);
    expect(files.map(({ file }) => path.basename(file)).sort()).toEqual([
      "entry.ts",
      "helper.tsx",
    ]);
    // And the JSX in it is seen, which is the consequence that matters: the `.ts` sibling has none.
    expect(files.some(({ analysis }) => analysis.jsx)).toBe(true);
  });

  it("counts a reached stylesheet without parsing it as TypeScript", () => {
    // A CSS file is reached and can import nothing, but it is not executable JavaScript. Parsed as
    // TypeScript its selectors become identifiers, so a `.window` rule would be reported as
    // reading the browser global and a valid entry rejected.
    const dir = mkdtempSync(path.join(os.tmpdir(), "nx-layering-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      path.join(dir, "styles.css"),
      ".window { color: red; }\n.document { color: blue; }\n"
    );
    const entry = path.join(dir, "entry.ts");
    writeFileSync(entry, 'import "./styles.css";\nexport const x = 1;\n');

    const { files, packages } = reach(entry);
    expect([...packages.keys()]).toEqual([]);
    expect(files.map(({ file }) => path.basename(file)).sort()).toEqual([
      "entry.ts",
      "styles.css",
    ]);
    // The point of the case: nothing in the stylesheet is read as a global.
    expect(files.flatMap(({ analysis }) => analysis.globals)).toEqual([]);
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
