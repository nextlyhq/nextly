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
 * the `derived-checks` skill states the rule this file exists to satisfy:
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
import { Visitor } from "oxc-parser";
import type {
  BindingPattern,
  CallExpression,
  Comment,
  Expression,
  ParamPattern,
  Program,
} from "oxc-parser";

import { literalText, parseSource } from "./parse-source.mjs";

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
 * - `import("pkg")` and `require("pkg")`. The first is its own node; the second
 *   is a call. A bare `require` identifier, or `module.require` — the documented
 *   CommonJS method, which resolves exactly as the free function does.
 *   `loader.require("x")` is a method on some other object and is not a module
 *   resolve.
 * - `import x = require("pkg")`, the documented CommonJS-interop spelling, which
 *   is neither of the above.
 * - `typeof import("pkg")` in type position, which the parser gives as a
 *   `TSImportType` rather than an import expression. It erases at build, so a
 *   purely runtime guard would skip it.
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
 * `fileName` is REQUIRED, and is not merely diagnostic. The parser picks its
 * language from the extension, so a `.tsx` file read under a `.ts` name parses
 * `<div>` as a type assertion, and a `.ts` angle-bracket assertion read as
 * `.tsx` is a syntax error. A default would let any caller read a file as the
 * wrong language silently.
 */
export function importedSpecifiers(text: string, fileName: string): string[] {
  return moduleSpecifierRefs(text, fileName).map(ref => ref.specifier);
}

/** One module a source file names, and whether it survives to runtime. */
export interface ModuleSpecifierRef {
  /** The specifier as written, or {@link UNRESOLVABLE_SPECIFIER}. */
  readonly specifier: string;
  /**
   * Whether this reference is erased before anything runs.
   *
   * True for `import type` (including `import type x = require()`), `export
   * type`, `typeof import()`, a JSDoc `@import` and a triple-slash type
   * reference. False for everything that survives into the emitted module: a
   * plain import, a bare side-effect import, `import(...)`, `require(...)` and
   * `import x = require(...)`.
   *
   * 🔴 A mixed clause such as `import { a, type B } from "pkg"` is NOT type-only.
   * The module is still loaded for `a`, and reading the inline `type` keyword as
   * governing the whole clause would erase a real runtime edge.
   */
  readonly typeOnly: boolean;
}

/** A reference and where it starts, so references from the tree and from comments merge in source order. */
interface PlacedRef extends ModuleSpecifierRef {
  readonly start: number;
}

/**
 * See through wrappers that change the type or the grouping, never the object.
 *
 * `(module).require(...)`, `(module as NodeModule).require(...)` and
 * `module!.require(...)` all read the same binding. A check on the receiver as
 * written treats each as somebody else's property and reports the file as loading
 * nothing, which is a bypass anyone can reach by accident.
 */
function unwrapReceiver(expression: Expression): Expression {
  let current = expression;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSSatisfiesExpression"
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Whether a callee is `module.require`, however it is spelled.
 *
 * `module.require` is the documented CommonJS method and resolves exactly as the
 * free `require` does, so a reader that recognises only the bare identifier
 * reports a file loading nothing while it loads a driver. `a.b` and `a["b"]` are
 * the same read, and a rule for one is a rule the other walks around.
 *
 * Deliberately narrow: the receiver has to be `module` itself, seen through
 * casts and grouping. `loader.require` is a method on somebody else's object, and
 * treating every `.require` as a resolve would report ordinary code as a
 * dependency nobody has. Whether the file shadows `module` is decided after the
 * walk, by the caller.
 */
function isModuleRequire(callee: Expression): boolean {
  if (callee.type !== "MemberExpression") return false;
  const receiver = unwrapReceiver(callee.object);
  if (receiver.type !== "Identifier" || receiver.name !== "module") {
    return false;
  }
  if (!callee.computed) {
    return callee.property.type === "Identifier"
      ? callee.property.name === "require"
      : false;
  }
  return literalText(callee.property) === "require";
}

/** Every name a binding pattern introduces, through destructuring, defaults and rests. */
function boundNames(pattern: BindingPattern | ParamPattern | null): string[] {
  if (!pattern) return [];
  switch (pattern.type) {
    case "Identifier":
      return [pattern.name];
    case "AssignmentPattern":
      return boundNames(pattern.left);
    case "RestElement":
      return boundNames(pattern.argument);
    case "TSParameterProperty":
      return boundNames(pattern.parameter);
    case "ArrayPattern":
      return pattern.elements.flatMap(element => boundNames(element));
    case "ObjectPattern":
      return pattern.properties.flatMap(property =>
        boundNames(property.type === "RestElement" ? property : property.value)
      );
    default:
      return [];
  }
}

/**
 * The modules a JSDoc block names: an `@import` tag's specifier, and every
 * `import("...")` inside a tag's `{type}` expression.
 *
 * The parser does not build a tree for JSDoc, so this reads the comment's own
 * grammar: a tag type is the brace-balanced `{...}` after a tag, and an
 * `@import` tag runs to the next tag. Prose in the description is not a type
 * expression and is not read, which keeps a sentence that mentions `import()`
 * from becoming a dependency.
 */
function jsDocRefs(comment: Comment): PlacedRef[] {
  const found: PlacedRef[] = [];
  const text = comment.value;
  // `value` excludes the opening `/*`, so offsets inside it start two characters in.
  const at = (index: number): number => comment.start + 2 + index;

  for (const tag of text.matchAll(/@import\b([^@]*)/g)) {
    const from = /\bfrom\s*(["'])([^"'\n]*)\1/.exec(tag[1] ?? "");
    found.push({
      specifier: from?.[2] ?? UNRESOLVABLE_SPECIFIER,
      typeOnly: true,
      start: at(tag.index),
    });
  }

  for (const tag of text.matchAll(/@[A-Za-z]+\s*\{/g)) {
    const open = tag.index + tag[0].length - 1;
    let depth = 0;
    let close = open;
    for (; close < text.length; close++) {
      if (text[close] === "{") depth++;
      else if (text[close] === "}" && --depth === 0) break;
    }
    const typeExpression = text.slice(open + 1, close);
    for (const call of typeExpression.matchAll(
      /\bimport\s*\(\s*(?:(["'`])([^"'`]*)\1\s*\))?/g
    )) {
      found.push({
        specifier: call[2] ?? UNRESOLVABLE_SPECIFIER,
        typeOnly: true,
        start: at(open + 1 + call.index),
      });
    }
  }
  return found;
}

/**
 * The `/// <reference types="..." />` directives, which only count before the
 * first statement: one further down is an ordinary comment to the compiler.
 */
function typeReferenceRefs(comments: Comment[], program: Program): PlacedRef[] {
  const firstStatement = program.body[0]?.start ?? Number.POSITIVE_INFINITY;
  return comments.flatMap(comment => {
    if (comment.type !== "Line" || comment.end > firstStatement) return [];
    const directive = /^\/\s*<reference\s+types\s*=\s*(["'])([^"']*)\1/.exec(
      comment.value
    );
    return directive?.[2]
      ? [{ specifier: directive[2], typeOnly: true, start: comment.start }]
      : [];
  });
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
 * the `derived-checks` skill exists to prevent, and which this file was already written to
 * fix once.
 *
 * Throws on a file the parser cannot read. A failed parse yields an empty
 * program, which would report as importing nothing: a clean green over a file
 * that was never read.
 */
export function moduleSpecifierRefs(
  text: string,
  fileName: string
): ModuleSpecifierRef[] {
  const parsed = parseSource(text, fileName);

  const found: PlacedRef[] = [];
  const moduleRequires: PlacedRef[] = [];
  // 🔴 A file that declares `module` — a parameter, a variable, an import — is
  // not talking about the CommonJS loader when it writes `module.require`, and
  // reporting a dependency it never loads is the FALSE direction for a guard: a
  // rule that fires on correct code stops being read. File-granular rather than
  // scope-precise, and deliberately so: resolving a name to its declaration
  // needs a checker, which this reader exists to work without. The gap it leaves
  // is a file that shadows `module` in one function and uses the real loader in
  // another, where this reports neither.
  let shadowsModule = false;
  const bind = (names: string[]): void => {
    if (names.includes("module")) shadowsModule = true;
  };
  const bindParams = (node: { params: ParamPattern[] }): void => {
    for (const param of node.params) bind(boundNames(param));
  };

  const add = (
    start: number,
    target: Expression | null | undefined,
    typeOnly: boolean
  ): void => {
    found.push({
      specifier: literalText(target) ?? UNRESOLVABLE_SPECIFIER,
      typeOnly,
      start,
    });
  };

  new Visitor({
    ImportDeclaration(node) {
      add(node.start, node.source, node.importKind === "type");
    },
    ExportNamedDeclaration(node) {
      if (node.source) add(node.start, node.source, node.exportKind === "type");
    },
    ExportAllDeclaration(node) {
      add(node.start, node.source, node.exportKind === "type");
    },
    ImportExpression(node) {
      add(node.start, node.source, false);
    },
    TSImportType(node) {
      add(node.start, node.source, true);
    },
    TSImportEqualsDeclaration(node) {
      if (node.moduleReference.type === "TSExternalModuleReference") {
        // `import type x = require("pkg")` erases like any `import type`.
        add(
          node.start,
          node.moduleReference.expression,
          node.importKind === "type"
        );
      }
    },
    CallExpression(node: CallExpression) {
      const [first] = node.arguments;
      const target = first?.type === "SpreadElement" ? undefined : first;
      if (node.callee.type === "Identifier" && node.callee.name === "require") {
        add(node.start, target, false);
      } else if (isModuleRequire(node.callee)) {
        moduleRequires.push({
          specifier: literalText(target) ?? UNRESOLVABLE_SPECIFIER,
          typeOnly: false,
          start: node.start,
        });
      }
    },
    VariableDeclarator(node) {
      bind(boundNames(node.id));
    },
    FunctionDeclaration(node) {
      bind(node.id ? [node.id.name] : []);
      bindParams(node);
    },
    FunctionExpression: bindParams,
    ArrowFunctionExpression: bindParams,
    TSDeclareFunction: bindParams,
    ClassDeclaration(node) {
      bind(node.id ? [node.id.name] : []);
    },
    CatchClause(node) {
      bind(boundNames(node.param));
    },
    ImportDefaultSpecifier(node) {
      bind([node.local.name]);
    },
    ImportSpecifier(node) {
      bind([node.local.name]);
    },
    ImportNamespaceSpecifier(node) {
      bind([node.local.name]);
    },
  }).visit(parsed.program);

  if (!shadowsModule) found.push(...moduleRequires);
  for (const comment of parsed.comments) {
    if (comment.type === "Block" && comment.value.startsWith("*")) {
      found.push(...jsDocRefs(comment));
    }
  }
  found.push(...typeReferenceRefs(parsed.comments, parsed.program));

  return found
    .sort((a, b) => a.start - b.start)
    .map(({ specifier, typeOnly }) => ({ specifier, typeOnly }));
}
