/**
 * The "Shown on (from the builder)" route's address and answer, apart from
 * the route, so a Single's panel reads them without loading the server code
 * that answers.
 *
 * @module shown-on-contract
 */

/** Where the route is mounted under the plugin. */
export const SHOWN_ON_ROUTE_PATH = "/singles/:slug/shown-on";

/** The route's address for one Single; `?all=1` asks for every place. */
export function shownOnPath(slug: string, all = false): string {
  return `/singles/${encodeURIComponent(slug)}/shown-on${all ? "?all=1" : ""}`;
}

/** The section's heading, as a Single's panel draws it. */
export const SHOWN_ON_TITLE = "Shown on (from the builder)";

/** How many places the panel lists before "and N more". */
export const SHOWN_ON_FIRST = 10;

/** One place the builder shows one of the Single's values. */
export interface ShownOnPlace {
  /** The document and block, as one key: unique within an answer. */
  readonly key: string;
  readonly kind: "collection" | "single";
  /** The document's collection, or the Single holding the blocks. */
  readonly slug: string;
  readonly documentId?: string;
  /** Pages, components, patterns, layouts, entries or singles. */
  readonly place: string;
  /** The document as the reader knows it: its title, or a Single's name. */
  readonly title: string;
  /** The block it sits in, as Layers names it; "Page metadata" for a page's own. */
  readonly block: string;
  /** The block's id, which the builder opens at; empty for page metadata. */
  readonly nodeId: string;
  /** The blocks field the block is in, as a dotted path. */
  readonly blocksField: string;
  /**
   * Whether it is only in a language other than the default, the one the
   * builder edits, so no builder address reaches it.
   */
  readonly inAnotherLanguage?: true;
}

/** The route's answer. */
export interface ShownOnAnswer {
  /**
   * Whether the index has never been filled by a complete check of every
   * document, so "nothing found" is not yet an answer.
   */
  readonly checking: boolean;
  /** The places the reader may open: the first ten, or all with `?all=1`. */
  readonly places: readonly ShownOnPlace[];
  /** How many more places the reader may open than `places` lists. */
  readonly more: number;
  /** How many places are in documents the reader may not open: a number only. */
  readonly hidden: number;
  /**
   * How many places, found only in working drafts of documents the reader
   * may read, this answer didn't check they may open: past the reads one
   * answer makes. Neither listed nor in `hidden`.
   */
  readonly unchecked: number;
  /**
   * Whether the read of the index stopped at its bound, so the counts, and
   * the full list, are of the places it reached: "at least".
   */
  readonly floor: boolean;
}
