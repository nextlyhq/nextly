/**
 * The anchor each heading of a passage is drawn with, and the outline a table
 * of contents lists from it.
 *
 * One reading of a passage, shared by the two blocks that must agree on it:
 * `core/rich-text` puts each id on its heading, and `core/table-of-contents`
 * links to the same ids. Two readers would agree until one of them changed,
 * and then every contents link on a published page would go nowhere without
 * a single error to say so.
 *
 * ## How an id is made
 *
 * From the heading's words, as a reader sees them, with the formatting
 * dropped: lower-cased, every letter and digit kept in any script,
 * punctuation removed, and each run of spaces and hyphens one hyphen. A
 * heading whose words leave nothing is `section`. A repeat takes the next
 * free number: `notes`, `notes-2`, `notes-3`.
 *
 * For headings written in ASCII this is the slug the hand-written blog
 * template gives its headings, so a page rebuilt with the builder keeps the
 * addresses its readers have already shared. Letters outside ASCII are kept
 * rather than dropped, so a heading in another script gets a readable anchor
 * instead of `section`.
 *
 * Ids are unique within one passage. Two passages on one page that share a
 * heading both give it the same id, and a link to it reaches the first; the
 * renderer draws each block alone and has no page-wide count to number them
 * by.
 *
 * @module blocks/heading-anchors
 */
import {
  isRichTextNode,
  isRichTextValue,
  richTextToPlainText,
  type RichTextNode,
} from "@nextlyhq/blocks-engine";

/** The heading levels a passage can hold. */
export type HeadingRank = 1 | 2 | 3 | 4 | 5 | 6;

/** One heading of a passage, with the id it is drawn with. */
export interface HeadingAnchor {
  /** The stored node, so a renderer can find the id of the heading it draws. */
  readonly node: RichTextNode;
  /** The anchor, unique within the passage. */
  readonly id: string;
  /** The heading's words, as a reader sees them. */
  readonly text: string;
  /** Its level, read as the renderer reads it. */
  readonly rank: HeadingRank;
}

const HEADING_TAG = /^h([1-6])$/;

/**
 * The level a heading node draws at: its stored tag, or 2 for a tag the
 * renderer does not know, the renderer's own answer (one level too deep
 * rather than a second top-level heading).
 */
export function headingRank(node: RichTextNode): HeadingRank {
  const match =
    typeof node.tag === "string" ? HEADING_TAG.exec(node.tag) : null;
  return match === null ? 2 : (Number(match[1]) as HeadingRank);
}

/**
 * How many nodes one reading visits at most. A stored passage has no size
 * of its own, and a reading past this keeps the headings it found rather than
 * walking an unbounded tree on a live page.
 */
const MAX_VISITS = 50_000;

/** A heading's words as an anchor, before repeats are numbered. */
function slug(words: string): string {
  return (
    words
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s-]+/gu, "")
      .trim()
      .replace(/[\s-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/** A heading's words, read by the engine's own flattener. */
function wordsOf(node: RichTextNode): string {
  const children = Array.isArray(node.children) ? node.children : [];
  return richTextToPlainText({ root: { type: "root", children } }).trim();
}

/** `base`, or the first of `base-2`, `base-3` … no heading has taken yet. */
function freeId(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
  used.add(id);
  return id;
}

/** Puts a node's children on the walk's stack, so they pop in their order. */
function pushChildren(stack: unknown[], node: RichTextNode): void {
  if (!Array.isArray(node.children)) return;
  for (let i = node.children.length - 1; i >= 0; i -= 1) {
    stack.push(node.children[i]);
  }
}

/**
 * Every heading of a passage, in document order, each with its anchor.
 *
 * Takes `unknown` because it reads a block prop, which holds whatever was
 * stored: anything that is not rich text has no headings. A heading with no
 * words has no anchor and is not listed, since a link to it would have no
 * text.
 */
export function headingAnchors(value: unknown): readonly HeadingAnchor[] {
  if (!isRichTextValue(value)) return [];
  const anchors: HeadingAnchor[] = [];
  const used = new Set<string>();
  const stack: unknown[] = [...value.root.children].reverse();
  let visits = 0;

  while (stack.length > 0 && visits < MAX_VISITS) {
    const node = stack.pop();
    visits += 1;
    if (!isRichTextNode(node)) continue;
    // A heading's own children are its words; nothing in them is a heading
    // the outline could list, so the walk does not go into them.
    if (node.type !== "heading") {
      pushChildren(stack, node);
      continue;
    }
    const text = wordsOf(node);
    if (text === "") continue;
    anchors.push({
      node,
      id: freeId(slug(text), used),
      text,
      rank: headingRank(node),
    });
  }
  return anchors;
}

/** The anchors of a passage, by the node each is drawn on. */
export function anchorIds(
  anchors: readonly HeadingAnchor[]
): ReadonlyMap<RichTextNode, string> {
  return new Map(anchors.map(anchor => [anchor.node, anchor.id]));
}
