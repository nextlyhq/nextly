import { EXEMPTION_MARKER } from "./vocabulary.js";

/**
 * Whether the line a node sits on carries the exemption marker.
 *
 * An exception is marked in place, with a reason, rather than by disabling the
 * rule for a file or a directory: a marked line states what was decided and
 * survives review, while a disabled scope silently exempts everything added to
 * it afterwards.
 *
 * The marker is looked for on the node's own line and on the line above, because
 * a long JSX attribute is commonly preceded by its comment rather than trailed
 * by one.
 */
export function isExempt(sourceCode, node) {
  const start = node.loc.start.line;
  return sourceCode
    .getAllComments()
    .some(
      comment =>
        comment.value.includes(EXEMPTION_MARKER) &&
        (comment.loc.start.line === start ||
          comment.loc.end.line === start ||
          comment.loc.end.line === start - 1)
    );
}
