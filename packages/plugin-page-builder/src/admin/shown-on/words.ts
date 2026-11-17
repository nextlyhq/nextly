/**
 * The words of a Single's "Shown on (from the builder)" section, in one
 * place, so the section and its tests read the same sentences.
 *
 * @module admin/shown-on/words
 */

export const SHOWN_ON_WORDS = {
  /** Under the list, always: what the list can and can't know. */
  onlyBuilder:
    "Only pages made with the builder are listed. Code that reads this Single directly isn't.",
  /** Before a complete check of every document has filled the index once. */
  checking: "Still checking pages…",
  /** After it, with nothing found. */
  none: "Not shown on any builder page yet",
  /** A place the reader may open, as its row reads. */
  place: (title: string, block: string): string => `${title}, ${block}`,
  /** The places past the first ten, which open the full list. */
  more: (count: number): string => `and ${String(count)} more`,
  /** The places in documents the reader may not open. */
  hidden: (count: number): string => `and ${String(count)} you can't open`,
  /** A place only in another language, which the builder doesn't edit. */
  anotherLanguage: "in another language",
  /** The full list's description, and a read that failed. */
  allDescription:
    "Every builder page, header & footer set and component that shows this Single's values.",
  loadFailed: "Couldn't check where this Single is shown.",
  retry: "Try again",
} as const;
