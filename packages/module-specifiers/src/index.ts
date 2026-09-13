/**
 * One reader for the module specifiers a source file loads.
 *
 * Layering guards in several packages each need the same answer — which
 * packages does this file reach — and each had grown its own reader. They
 * agreed the day they were written and had already drifted: the copy in
 * `packages/ui` omitted import-equals declarations, import types and JSDoc
 * imports, parsed every `.tsx` file with the TypeScript parser, and treated a
 * dynamic import it could not resolve as importing nothing. Three of those are
 * silent, and all three answer "clean".
 *
 * `.claude/rules/derived-checks.md` states the rule this file exists to satisfy:
 * a narrower view must be DERIVED from the richer one, never computed alongside
 * it.
 *
 * SCOPE, stated because the wrong consumer is the likely failure. This answers
 * "which specifiers does this SOURCE load", which is the import-boundary
 * question. It is NOT the answer to "what does this entry point actually
 * reach": a bundler can INLINE a dependency, and the specifier then exists
 * nowhere in the output, so no source reader can see it. That question is
 * answered by reading the built artifact and the bundler's metafile, which
 * `packages/ui/scripts/check-server-safe-artifacts.ts` does deliberately
 * separately.
 *
 * @module @nextlyhq/module-specifiers
 */
import ts from "typescript";

/**
 * Stands in for a module call whose target is not a literal, such as
 * `import(base + name)` or `require(name)`.
 *
 * Such a target cannot be resolved by reading the file, so the honest report is
 * "unknown", and unknown has to be a violation: the alternative is a guard that
 * approves whatever it could not read. It is deliberately not a legal package
 * specifier, so it can never be satisfied by an allowlist entry.
 */
export const UNRESOLVABLE_SPECIFIER = "<unresolvable-specifier>";

/**
 * Every module specifier a source text loads, read from the AST rather than by
 * regex.
 *
 * A raw-text search cannot do this. It reports the specifier appearing in a
 * COMMENT or a string as an import — a false positive, and the worse direction
 * for a guard, because one that cries wolf about code the compiler never loads
 * stops being read.
 *
 * Several shapes reach a module, not one, and a visitor that reads only
 * declarations walks straight past most of them:
 *
 * - `import ... from` and `export ... from`, which carry a module specifier.
 * - `import "pkg"`, a bare side-effect import, which carries no bindings.
 * - `import("pkg")` and `require("pkg")`, which are call expressions. A bare
 *   `require` identifier, or `module.require` — the documented CommonJS method,
 *   which resolves exactly as the free function does. `loader.require("x")` is a
 *   method on some other object and is not a module resolve.
 * - A function `createRequire` returned: `const load = createRequire(import.meta.url)`
 *   and then `load("pkg")`, which is how an ES module reaches CommonJS and loads
 *   exactly as `require` does. Counted only when `createRequire` comes from
 *   `module` or `node:module`, since a helper of that name from anywhere else
 *   returns whatever that helper returns.
 * - `require.resolve("pkg")`, the same on a created require, and
 *   `import.meta.resolve("pkg")`. They find a module without loading it, and fail
 *   exactly as loading it would when the package is not there.
 * - `import x = require("pkg")`, the documented CommonJS-interop spelling, which
 *   is neither of the above.
 * - `typeof import("pkg")` in type position, which the parser gives as an
 *   `ImportTypeNode` rather than a call. It erases at build, so a purely runtime
 *   guard would skip it.
 * - `/** @import ... *␍/` and `@typedef {import("pkg").T}` in JSDoc, which is
 *   where a JavaScript file keeps its types.
 * - `/// <reference types="pkg" />`, which is not in the node tree at all.
 *
 * Template literals with no substitutions are as statically known as quoted
 * strings, so they count as literals here.
 *
 * Type-only imports are collected too, which is stricter than a purely runtime
 * guard would be: depending on a package's types is the same dependency on
 * internals nobody promised to keep, and it is one rename away from becoming a
 * value import. A caller wanting runtime-only reachability filters afterwards.
 *
 * `fileName` is REQUIRED, and is not merely diagnostic. TypeScript picks its
 * parser from the extension, so reading a `.tsx` file under a `.ts` name parses
 * `<div>` as a type assertion; the malformed tree that follows contains no
 * import nodes, and the file reports as importing nothing. That is a clean green
 * over a file that was never read, and it was a live defect in two of the
 * readers this replaces. A default would let any caller reintroduce it silently.
 */
/**
 * See through wrappers that change the type or the grouping, never the object.
 *
 * `(module).require(...)`, `(module as NodeModule).require(...)` and
 * `module!.require(...)` all read the same binding. A check on the receiver as
 * written treats each as somebody else's property and reports the file as loading
 * nothing, which is a bypass anyone can reach by accident.
 */
function unwrapReceiver(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Whether the file introduces a binding of its own called `module`.
 *
 * 🔴 A file that declares `module` — a parameter, a variable, an import — is not
 * talking about the CommonJS loader when it writes `module.require`, and
 * reporting a dependency it never loads is the FALSE direction for a guard: a
 * rule that fires on correct code stops being read. Renaming the identical
 * receiver to `loader` already makes the report disappear, which is the tell that
 * it was about the name rather than the thing.
 *
 * File-granular rather than scope-precise, and deliberately so: resolving a name
 * to its declaration needs a program and a checker, which this reader exists to
 * work without. The gap it leaves is a file that shadows `module` in one function
 * and uses the real loader in another, where this reports neither.
 */
/** Every node kind that introduces a name a later expression can read. */
const BINDING_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.Parameter,
  ts.SyntaxKind.BindingElement,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ImportClause,
  ts.SyntaxKind.ImportSpecifier,
  ts.SyntaxKind.NamespaceImport,
]);

/** Whether one node binds the name `module`. */
function bindsModule(node: ts.Node): boolean {
  if (!BINDING_KINDS.has(node.kind)) return false;
  const { name } = node as ts.NamedDeclaration;
  return name !== undefined && ts.isIdentifier(name) && name.text === "module";
}

function declaresOwnModule(source: ts.SourceFile): boolean {
  let declared = false;
  const visit = (node: ts.Node): void => {
    if (declared) return;
    if (bindsModule(node)) {
      declared = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return declared;
}

/**
 * Whether an expression is `module.require`, however it is spelled.
 *
 * `module.require` is the documented CommonJS method and resolves exactly as the
 * free `require` does, so a reader that recognises only the bare identifier
 * reports a file loading nothing while it loads a driver. `a.b` and `a["b"]` are
 * the same read, and a rule for one is a rule the other walks around.
 *
 * Deliberately narrow: the receiver has to be `module` itself, seen through
 * casts and grouping, and the file must not have introduced a `module` of its
 * own. `loader.require` is a method on somebody else's object, and treating every
 * `.require` as a resolve would report ordinary code as a dependency nobody has.
 */
function readsModuleRequire(callee: ts.Expression, shadowed: boolean): boolean {
  if (shadowed) return false;
  const receiver =
    ts.isPropertyAccessExpression(callee) ||
    ts.isElementAccessExpression(callee)
      ? unwrapReceiver(callee.expression)
      : null;
  if (
    receiver === null ||
    !ts.isIdentifier(receiver) ||
    receiver.text !== "module"
  ) {
    return false;
  }
  if (ts.isPropertyAccessExpression(callee))
    return callee.name.text === "require";
  const key = (callee as ts.ElementAccessExpression).argumentExpression;
  return ts.isStringLiteralLike(key) && key.text === "require";
}

/** The specifiers `createRequire` is imported from. */
const NODE_MODULE_SPECIFIERS: ReadonlySet<string> = new Set([
  "module",
  "node:module",
]);

/** The property a call reads, `a.b` or `a["b"]`, or null for any other callee. */
function accessedName(callee: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (
    ts.isElementAccessExpression(callee) &&
    ts.isStringLiteralLike(callee.argumentExpression)
  ) {
    return callee.argumentExpression.text;
  }
  return null;
}

/** The object an access reads its property from, seen through wrappers. */
function accessReceiver(callee: ts.Expression): ts.Expression | null {
  return ts.isPropertyAccessExpression(callee) ||
    ts.isElementAccessExpression(callee)
    ? unwrapReceiver(callee.expression)
    : null;
}

/** `require("module")` or `require("node:module")`, seen through wrappers. */
function requiresNodeModule(expression: ts.Expression): boolean {
  const call = unwrapReceiver(expression);
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) {
    return false;
  }
  const [target] = call.arguments;
  return (
    call.expression.text === "require" &&
    target !== undefined &&
    ts.isStringLiteralLike(target) &&
    NODE_MODULE_SPECIFIERS.has(target.text)
  );
}

/** The local names bound to Node's `createRequire`, and to the `module` builtin carrying it. */
interface CreateRequireBindings {
  readonly factories: Set<string>;
  readonly namespaces: Set<string>;
}

/** Record `local` as a `createRequire` when the name it binds is `createRequire`. */
function recordFactory(
  bindings: CreateRequireBindings,
  bound: ts.Node,
  local: ts.Node
): void {
  const named = ts.isIdentifier(bound) || ts.isStringLiteral(bound);
  if (named && bound.text === "createRequire" && ts.isIdentifier(local)) {
    bindings.factories.add(local.text);
  }
}

/** The bindings an `import ... from "node:module"` declaration makes. */
function recordImportedBindings(
  node: ts.ImportDeclaration,
  bindings: CreateRequireBindings
): void {
  const clause = node.importClause;
  if (clause?.name) bindings.namespaces.add(clause.name.text);
  const named = clause?.namedBindings;
  if (named === undefined) return;
  if (ts.isNamespaceImport(named)) {
    bindings.namespaces.add(named.name.text);
    return;
  }
  for (const element of named.elements) {
    recordFactory(bindings, element.propertyName ?? element.name, element.name);
  }
}

/** The bindings `const ... = require("node:module")` makes. */
function recordRequiredBindings(
  node: ts.VariableDeclaration,
  bindings: CreateRequireBindings
): void {
  if (ts.isIdentifier(node.name)) {
    bindings.namespaces.add(node.name.text);
    return;
  }
  if (!ts.isObjectBindingPattern(node.name)) return;
  for (const element of node.name.elements) {
    recordFactory(bindings, element.propertyName ?? element.name, element.name);
  }
}

/**
 * Where a file binds Node's `createRequire`, or the `module` builtin that carries it.
 *
 * Only a binding from `module` or `node:module` counts. A helper of the same name
 * imported from anywhere else returns whatever that helper returns, and reading its
 * calls as module loads would report a dependency nobody has.
 */
function createRequireBindings(source: ts.SourceFile): CreateRequireBindings {
  const bindings: CreateRequireBindings = {
    factories: new Set(),
    namespaces: new Set(),
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      NODE_MODULE_SPECIFIERS.has(node.moduleSpecifier.text)
    ) {
      recordImportedBindings(node, bindings);
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      requiresNodeModule(node.initializer)
    ) {
      recordRequiredBindings(node, bindings);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return bindings;
}

/** Whether an expression calls Node's `createRequire`, however the file bound it. */
function callsCreateRequire(
  expression: ts.Expression,
  bindings: CreateRequireBindings
): boolean {
  const call = unwrapReceiver(expression);
  if (!ts.isCallExpression(call)) return false;
  const callee = unwrapReceiver(call.expression);
  if (ts.isIdentifier(callee)) return bindings.factories.has(callee.text);
  const receiver = accessReceiver(callee);
  return (
    accessedName(callee) === "createRequire" &&
    receiver !== null &&
    ts.isIdentifier(receiver) &&
    bindings.namespaces.has(receiver.text)
  );
}

/**
 * The names in a file holding a require function Node's `createRequire` returned.
 *
 * File-granular, like {@link declaresOwnModule}: once a declaration binds a created
 * require to a name, that name reads as a require everywhere in the file. Resolving
 * each use to its own declaration needs a checker, which this reader works without.
 */
function createdRequireNames(source: ts.SourceFile): ReadonlySet<string> {
  const bindings = createRequireBindings(source);
  const names = new Set<string>();
  if (bindings.factories.size === 0 && bindings.namespaces.size === 0) {
    return names;
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      callsCreateRequire(node.initializer, bindings)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/**
 * Which resolver a call hands its argument to, or null when the call resolves no module.
 *
 * `import()` and `import.meta.resolve()` take the ES module resolver. `require()`,
 * `module.require()`, a created require, and `.resolve()` on `require` or on a created
 * require take CommonJS's. A `.resolve` on any other object is that object's own method.
 */
function callResolution(
  callee: ts.Expression,
  shadowsModule: boolean,
  requires: ReadonlySet<string>
): ModuleResolution | null {
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return "esm";
  if (ts.isIdentifier(callee)) {
    return callee.text === "require" || requires.has(callee.text)
      ? "cjs"
      : null;
  }
  if (readsModuleRequire(callee, shadowsModule)) return "cjs";
  const receiver = accessReceiver(callee);
  if (accessedName(callee) !== "resolve" || receiver === null) return null;
  if (ts.isMetaProperty(receiver)) {
    return receiver.keywordToken === ts.SyntaxKind.ImportKeyword ? "esm" : null;
  }
  const requireFunction =
    ts.isIdentifier(receiver) &&
    (receiver.text === "require" || requires.has(receiver.text));
  return requireFunction ? "cjs" : null;
}

export function importedSpecifiers(text: string, fileName: string): string[] {
  return moduleSpecifierRefs(text, fileName).map(ref => ref.specifier);
}

/** Which of Node's resolvers finds a module. */
export type ModuleResolution = "esm" | "cjs";

/** One module a source file names, whether it survives to runtime, and what finds it if so. */
export type ModuleSpecifierRef =
  | {
      /** The specifier as written, or {@link UNRESOLVABLE_SPECIFIER}. */
      readonly specifier: string;
      /**
       * Erased before anything runs: `import type`, `export type`,
       * `typeof import()`, a JSDoc `@import` and a triple-slash type reference.
       */
      readonly typeOnly: true;
    }
  | {
      /** The specifier as written, or {@link UNRESOLVABLE_SPECIFIER}. */
      readonly specifier: string;
      /**
       * Survives into the emitted module: a plain import, a bare side-effect
       * import, `import(...)`, `require(...)`, `import x = require(...)`, a
       * created require, and the resolve calls.
       *
       * 🔴 A mixed clause such as `import { a, type B } from "pkg"` is NOT type-only.
       * The module is still loaded for `a`, and reading the inline `type` keyword as
       * governing the whole clause would erase a real runtime edge.
       */
      readonly typeOnly: false;
      /**
       * Which resolver finds it. `"esm"` takes the path as written; `"cjs"` also
       * tries the extensions and index files CommonJS adds. A caller following a
       * relative specifier needs this to find the file Node would load.
       */
      readonly resolution: ModuleResolution;
    };

/** The reference an import or export declaration makes, which the ES module resolver finds. */
function declarationRef(
  specifier: string,
  typeOnly: boolean
): ModuleSpecifierRef {
  return typeOnly
    ? { specifier, typeOnly: true }
    : { specifier, typeOnly: false, resolution: "esm" };
}

/**
 * Every module a source text names, each labelled with whether it reaches runtime.
 *
 * The richer view {@link importedSpecifiers} is derived from, because the two answer different
 * questions and a caller that needs the distinction cannot recover it from a list of strings.
 * An import-boundary guard wants every reference, since depending on a package's types is a
 * dependency on internals nobody promised to keep; a guard about what a BUNDLE contains wants only
 * the references that survive, since an erased one cannot put code anywhere.
 *
 * 🔴 Both must come from one walk. Two visitors agree the day they are written, and the drift is
 * silent in the direction that answers "clean" -- which is the defect
 * `.claude/rules/derived-checks.md` exists to prevent, and which this file was already written to
 * fix once.
 */
export function moduleSpecifierRefs(
  text: string,
  fileName: string
): ModuleSpecifierRef[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.ESNext,
    true
  );
  const found: ModuleSpecifierRef[] = [];
  const shadowsModule = declaresOwnModule(source);
  const requires = createdRequireNames(source);
  const seen = new Set<ts.Node>();

  const visit = (node: ts.Node): void => {
    // A CYCLE guard, not a de-duplicator. The explicit JSDoc descent below and
    // `forEachChild` reach each other: a `@typedef` attached to a declaration
    // is reachable from that declaration, and `forEachChild` on the tag walks
    // back to it, so the walk recurses until the stack overflows. Measured —
    // removing this throws `RangeError` on
    // `/** @typedef {import("pkg").T} T */ export const x = 1;` rather than
    // reporting the specifier twice.
    if (seen.has(node)) return;
    seen.add(node);

    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      found.push(
        declarationRef(
          node.moduleSpecifier.text,
          ts.isImportDeclaration(node)
            ? Boolean(node.importClause?.isTypeOnly)
            : node.isTypeOnly
        )
      );
    } else if (ts.isJSDocImportTag(node)) {
      const target = node.moduleSpecifier;
      found.push({
        specifier:
          target && ts.isStringLiteralLike(target)
            ? target.text
            : UNRESOLVABLE_SPECIFIER,
        typeOnly: true,
      });
    } else if (ts.isImportTypeNode(node)) {
      const target = node.argument;
      found.push({
        specifier:
          ts.isLiteralTypeNode(target) && ts.isStringLiteralLike(target.literal)
            ? target.literal.text
            : UNRESOLVABLE_SPECIFIER,
        typeOnly: true,
      });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const target = node.moduleReference.expression;
      found.push({
        specifier: ts.isStringLiteralLike(target)
          ? target.text
          : UNRESOLVABLE_SPECIFIER,
        typeOnly: false,
        resolution: "cjs",
      });
    } else if (ts.isCallExpression(node)) {
      const resolution = callResolution(
        node.expression,
        shadowsModule,
        requires
      );
      if (resolution !== null) {
        const target = node.arguments[0];
        found.push({
          specifier:
            target && ts.isStringLiteralLike(target)
              ? target.text
              : UNRESOLVABLE_SPECIFIER,
          typeOnly: false,
          resolution,
        });
      }
    }

    ts.forEachChild(node, visit);
    // JSDoc hangs off a node rather than sitting under it, so `forEachChild`
    // never enters it. In a JavaScript file that is where the types live:
    // `@typedef {import("pkg").T}` puts an ImportTypeNode inside the comment,
    // invisible to every branch above.
    for (const doc of ts.getJSDocCommentsAndTags(node)) visit(doc);
  };
  visit(source);

  // `/// <reference types="pkg" />` is not part of the node tree, so
  // `forEachChild` never reaches it. The parser puts it here instead, and it is
  // a dependency on that package's types exactly as an `import type` is.
  for (const directive of source.typeReferenceDirectives) {
    found.push({ specifier: directive.fileName, typeOnly: true });
  }

  return found;
}
