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
 * `packages/ui/scripts/check-server-safe-artifacts.mjs` does deliberately
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
 *   `require` identifier only: `loader.require("x")` is a method on some object,
 *   not a module resolve.
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
export function importedSpecifiers(text: string, fileName: string): string[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.ESNext,
    true
  );
  const found: string[] = [];
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
      found.push(node.moduleSpecifier.text);
    } else if (ts.isJSDocImportTag(node)) {
      const target = node.moduleSpecifier;
      found.push(
        target && ts.isStringLiteralLike(target)
          ? target.text
          : UNRESOLVABLE_SPECIFIER
      );
    } else if (ts.isImportTypeNode(node)) {
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
    found.push(directive.fileName);
  }

  return found;
}
