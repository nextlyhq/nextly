/**
 * What the editor says about starting an empty document, and about adding at
 * its top level: of sections on a page, of blocks in a component, which has
 * no sections. One source for the canvas's start card and gaps and for the
 * Getting started checklist, so the checklist names the control that is there.
 *
 * @module page-start-words
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";

/**
 * What the start card and a gap's "+" say: of sections on a page, of blocks in
 * a component, which has no sections.
 */
const WORDS = {
  page: {
    title: "Start your page",
    hint: "Add a section, or drag one here from the panel.",
    start: "Add section",
    gap: "Add a section here",
    after: "Add a section after",
  },
  component: {
    title: "Add the first block",
    hint: "Add a block, or drag one here from the panel.",
    start: "Add block",
    gap: "Add a block here",
    after: "Add a block after",
  },
} as const;

/** The words for a document of this kind. */
export function startWords(
  kind: BlockDocument["kind"]
): (typeof WORDS)[keyof typeof WORDS] {
  return WORDS[kind === "component" ? "component" : "page"];
}
