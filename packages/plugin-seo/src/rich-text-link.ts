/**
 * Which rich-text nodes are links a reader follows, for the readers that
 * turn stored rich text into words and links.
 *
 * The editor stores a link it made from a typed address as an `autolink`.
 * When the author takes that link off, the node stays, marked `isUnlinked`,
 * so the address is not linked again as they type; it is drawn as its words
 * alone. The page renderers in core read the node the same way.
 *
 * @module rich-text-link
 */

/** Whether `node` is a link: a `link`, or an `autolink` still linked. */
export function isFollowedLink(
  node: Readonly<Record<string, unknown>>
): boolean {
  if (node.type === "link") return true;
  return node.type === "autolink" && node.isUnlinked !== true;
}
