/**
 * The rules a heading's anchor is made by: its level, and the id its words
 * give it.
 *
 * Which headings a page draws, and with which words, is answered once per
 * page by the page outline (`../outline`): Heading blocks and the headings
 * inside Rich text, in page order. It hands every heading its id from ONE
 * allocator made here, so `core/heading`, `core/rich-text` and a table of
 * contents all read the same anchor, and no two headings on a page share one.
 *
 * ## How an id is made
 *
 * From the heading's words, as a reader sees them: lower-cased, every letter
 * and digit kept in any script, punctuation removed, and each run of spaces
 * and hyphens one hyphen. A heading whose words leave nothing is `section`. A
 * repeat takes the next free number: `notes`, `notes-2`, `notes-3`.
 *
 * For headings written in ASCII this is the slug the hand-written blog
 * template gives its headings, so a page rebuilt with the builder keeps the
 * addresses its readers have already shared. Letters outside ASCII are kept
 * rather than dropped, so a heading in another script gets a readable anchor
 * instead of `section`.
 *
 * A made id never holds two hyphens in a row, since a run of them is one. The
 * outline relies on that to give a heading drawn once per entry of a list an
 * id no other heading's words can make (`../outline`).
 *
 * @module blocks/heading-anchors
 */
import type { RichTextNode } from "@nextlyhq/blocks-engine";

/** The heading levels a passage can hold. */
export type HeadingRank = 1 | 2 | 3 | 4 | 5 | 6;

/** One heading a passage draws, with the id it is drawn with. */
export interface HeadingAnchor {
  /** The node the renderer draws, so it can find the id of the heading it draws. */
  readonly node: RichTextNode;
  /** The anchor, unique among the headings it was handed out with. */
  readonly id: string;
  /** The words the heading draws, as a reader sees them. */
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
  return rankOfTag(node.tag);
}

/**
 * The level a stored heading tag draws at: `h1` to `h6`, or 2 for anything
 * else. Shared by a passage's headings and by `core/heading`'s level, so a
 * heading is drawn at the level the page outline lists it at.
 */
export function rankOfTag(tag: unknown): HeadingRank {
  const match = typeof tag === "string" ? HEADING_TAG.exec(tag) : null;
  return match === null ? 2 : (Number(match[1]) as HeadingRank);
}

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

/**
 * The ids of a page's headings, handed out in the order they are drawn.
 *
 * Each base remembers the next number it may try, so a passage of thousands
 * of identical headings costs one probe per heading rather than one per
 * heading before it. The probe still checks every id taken, so a repeat never
 * takes an id another heading's own words gave it (`notes-2` written by hand,
 * then a second `notes`).
 *
 * @param used - the ids taken before the first heading: the page outline
 *   passes every id an author gave a block, so a made id never repeats one;
 *   a test passes its own to count probes
 */
export function anchorAllocator(used: Set<string> = new Set()): {
  take(words: string): string;
} {
  const nextNumber = new Map<string, number>();
  return {
    take(words: string): string {
      const base = slug(words);
      let id = base;
      if (used.has(id)) {
        let n = nextNumber.get(base) ?? 2;
        while (used.has(`${base}-${n}`)) n += 1;
        id = `${base}-${n}`;
        nextNumber.set(base, n + 1);
      }
      used.add(id);
      return id;
    },
  };
}
