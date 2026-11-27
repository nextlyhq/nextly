/**
 * Which stored rich-text nodes are links a reader follows: the one rule every
 * renderer and reader of the stored format asks, the page renderers, the CMS's
 * HTML, and plugins' copies of a page alike.
 *
 * It imports nothing, so the format entry can carry it to readers that may not
 * load the engine's root.
 *
 * @module rich-text-link
 */

/**
 * Whether `node` is a link a reader follows: a `link`, or an `autolink` the
 * author has not taken the link off. The editor keeps an address the author
 * unlinked as an `autolink` marked `isUnlinked`, so it is not linked again
 * as they type, and every reader draws that as its words alone.
 */
export function isFollowedLink(node: {
  readonly type?: unknown;
  readonly isUnlinked?: unknown;
}): boolean {
  if (node.type === "link") return true;
  return node.type === "autolink" && node.isUnlinked !== true;
}
