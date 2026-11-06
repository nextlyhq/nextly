/**
 * What the editor says about starting an empty document, and about adding at
 * its top level: of sections on a page, of blocks in every other kind of
 * document. One source for the canvas's start card and gaps and for the
 * Getting started checklist, so the checklist names the control that is there.
 *
 * @module page-start-words
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";

/**
 * What the start card and a gap's "+" say: of sections on a page, of blocks
 * in a document built of blocks.
 */
const WORDS = {
  sections: {
    title: "Start your page",
    hint: "Add a section, or drag one here from the panel.",
    start: "Add section",
    gap: "Add a section here",
    after: "Add a section after",
  },
  blocks: {
    title: "Add the first block",
    hint: "Add a block, or drag one here from the panel.",
    start: "Add block",
    gap: "Add a block here",
    after: "Add a block after",
  },
} as const;

/**
 * Which words each kind of document speaks. Only a page is built of sections;
 * a pattern, a component, a Layout region and a collection template hold
 * blocks at their top level (a section among them, where the rules allow).
 * Every kind is named, so a kind the engine adds fails to type-check here
 * rather than quietly reading as a page.
 */
const WORDS_OF_KIND: Record<BlockDocument["kind"], keyof typeof WORDS> = {
  page: "sections",
  pattern: "blocks",
  component: "blocks",
  region: "blocks",
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
