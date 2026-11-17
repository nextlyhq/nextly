/**
 * What the editor says about starting an empty document, and about adding in
 * a gap between blocks. The start card speaks of sections on a page and of
 * blocks in every other kind of document; a gap's "+" names where it adds.
 * One source for the canvas's start card and gaps and for the Getting started
 * checklist, so the checklist names the control that is there.
 *
 * @module page-start-words
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";

/** What the start card says: of sections on a page, of blocks elsewhere. */
const WORDS = {
  sections: {
    title: "Start your page",
    hint: "Add a section, or drag one here from the panel.",
    start: "Add section",
  },
  blocks: {
    title: "Add the first block",
    hint: "Add a block, or drag one here from the panel.",
    start: "Add block",
  },
} as const;

/**
 * Which words each kind of document speaks. Only a page is built of sections;
 * a pattern, a component and a collection template hold blocks at their top
 * level (a section among them, where the rules allow).
 * Every kind is named, so a kind the engine adds fails to type-check here
 * rather than quietly reading as a page.
 */
const WORDS_OF_KIND: Record<BlockDocument["kind"], keyof typeof WORDS> = {
  page: "sections",
  pattern: "blocks",
  component: "blocks",
  template: "blocks",
};

/**
 * The words for a document of this kind.
 *
 * Block wording for a kind this editor does not know. The engine's forgiving
 * read lets a stored document through with a kind newer than the code, and
 * the type cannot see that, so the lookup is asked as an own property: a kind
 * spelled like one of an object's inherited names (`toString`) is unknown
 * too, not a function to index with.
 */
export function startWords(
  kind: BlockDocument["kind"]
): (typeof WORDS)[keyof typeof WORDS] {
  return WORDS[
    Object.hasOwn(WORDS_OF_KIND, kind) ? WORDS_OF_KIND[kind] : "blocks"
  ];
}

/**
 * What a gap's "+" says, as its name and its tooltip: where the block it adds
 * goes. "Add a block between Hero and Pricing" between two blocks, and "Add a
 * block after Contact" after the last one, in every kind of document: the "+"
 * adds any block, so it names none.
 *
 * @param after - the name of the block before the gap
 * @param before - the name of the block after it, absent after the last
 */
export function gapWords(after: string, before?: string): string {
  return before === undefined
    ? `Add a block after ${after}`
    : `Add a block between ${after} and ${before}`;
}
