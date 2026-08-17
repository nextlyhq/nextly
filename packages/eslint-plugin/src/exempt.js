import { hasExemptionDirective } from "./vocabulary.js";

/**
 * Nodes a directive may not reach past.
 *
 * Without a ceiling, a comment above a component would exempt every violation
 * inside it — the "disabled scope silently exempts whatever is added later"
 * failure this mechanism exists to avoid, reintroduced by the back door. A
 * directive annotates a declaration, an element or an attribute; it does not
 * annotate a function or a module.
 */
const EXEMPTION_CEILING = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassBody",
  "Program",
]);

/**
 * Whether a `design-lint-ok` directive annotates this node or the construct
 * containing it.
 *
 * An exception is marked in place, with a reason, rather than by disabling the
 * rule for a file or a directory: a marked line states what was decided and
 * survives review, while a disabled scope silently exempts everything added to
 * it afterwards.
 *
 * Resolved by walking the node's ancestors and asking whether a directive
 * immediately PRECEDES any of them, rather than by comparing line numbers. Line
 * matching cannot annotate a construct that spans lines — a named palette
 * object, or a multi-property style — so the directive had to be repeated on
 * every line inside it, which is precisely the noise that makes a reader reach
 * for a blanket disable instead. The walk stops at {@link EXEMPTION_CEILING} so
 * the reach stays bounded to the thing the comment sits above.
 */
export function isExempt(sourceCode, node) {
  for (let current = node; current; current = current.parent) {
    if (EXEMPTION_CEILING.has(current.type)) break;

    const before = sourceCode.getCommentsBefore(current);
    if (before.some(comment => hasExemptionDirective(comment.value))) {
      return true;
    }
  }

  // A trailing directive on the node's own line, which reads naturally for a
  // short violation: `color: "#fff", // design-lint-ok: <reason>`.
  const line = node.loc.start.line;
  return sourceCode
    .getAllComments()
    .some(
      comment =>
        hasExemptionDirective(comment.value) &&
        comment.loc.start.line === line &&
        comment.range[0] > node.range[0]
    );
}
