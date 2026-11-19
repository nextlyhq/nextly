/**
 * What the editor says about starting an empty document, and about adding in
 * a gap between blocks. The start area greets a page by its title and every
 * other kind of document with "Add the first block"; a gap's "+" names where
 * it adds. One source for the canvas's start area and gaps and for the
 * Getting started checklist, so the checklist names the control that is
 * there.
 *
 * @module page-start-words
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";

/** The start area's words, the same in every kind of document. */
const START_AREA = {
  /** The primary button, after its "＋" icon. */
  start: "Add a block",
  /** The secondary button. */
  savedSection: "Insert a saved section",
  /** The line under the buttons. */
  drag: "or drag a block here",
  /** The heading over the row of starter pages, where there are any. */
  starters: "or start from a page",
  /** Under a starter page the site can't use, above the host's reason. */
  notAvailable: "Not available on this site",
} as const;

/** What the start area of an empty document says. */
export interface StartWords {
  readonly title: string;
  readonly start: string;
  readonly savedSection: string;
  readonly drag: string;
  readonly starters: string;
  readonly notAvailable: string;
}

/**
 * The start area's heading: a page is greeted by its own title, every other
 * kind of document (a saved section, a component, a collection template) by
 * what an author does first. Asked as an own property, so a kind newer than
 * this editor, or one spelled like an object's inherited names
 * (`toString`), reads as a document of blocks too.
 */
function titleOf(kind: BlockDocument["kind"], pageTitle: string | undefined) {
  const page = Object.hasOwn({ page: true }, kind);
  if (!page) return "Add the first block";
  const named = pageTitle?.trim();
  return named === undefined || named === ""
    ? "Start building your page"
    : `Start building ${named}`;
}

/**
 * The words for an empty document of this kind.
 *
 * @param kind - the document's kind
 * @param pageTitle - a page's title, which its heading names
 */
export function startWords(
  kind: BlockDocument["kind"],
  pageTitle?: string
): StartWords {
  return { ...START_AREA, title: titleOf(kind, pageTitle) };
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
