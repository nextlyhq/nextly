/**
 * The list's language chips: which of five states a language of one document is in, and how
 * each state is named and explained.
 *
 * Derived only from the facts the list read already carries on each row's `_translations` map
 * (whether the language is translated, its status, a pending change, a stale source), so the
 * chips can never claim more than the server told this reader. One word per chip, chosen in a
 * fixed order of what needs attention first; the other facts stay in the chip's spoken name, so
 * none is lost when the word is chosen.
 *
 * @module components/features/entries/EntryList/language-chips
 */
import type { LocaleTranslationMeta } from "../translation-meta";

/**
 * Every state a chip can show, in the order the key lists them. A tuple, so the key and the
 * type are read from one list and a state cannot be drawn that the key does not explain.
 */
export const LANGUAGE_CHIP_STATES = [
  "live",
  "changes",
  "outOfDate",
  "draft",
  "missing",
] as const;

export type LanguageChipState = (typeof LANGUAGE_CHIP_STATES)[number];

/** The word each state is shown with, in the chip's key. Sentence case. */
export const LANGUAGE_CHIP_WORD: Record<LanguageChipState, string> = {
  live: "Live",
  changes: "Changes",
  outOfDate: "Out of date",
  draft: "Draft",
  missing: "Missing",
};

/** What each state means, said beside its word in the key. */
export const LANGUAGE_CHIP_MEANING: Record<LanguageChipState, string> = {
  live: "published, as readers see it",
  changes: "published, with saved changes not yet published",
  // The text it was made from, which is not always the default language's: a translation
  // copied from another language goes out of date when that one changes.
  outOfDate: "the text it was translated from changed since",
  draft: "written, not yet published",
  missing: "not translated yet",
};

/** Everything a chip says about one language of one document. */
export interface LanguageChipFacts {
  /** The one state the chip is drawn in. */
  state: LanguageChipState;
  /** Whether readers are shown this language: published, or kept with no lifecycle at all. */
  live: boolean;
  /** Whether a saved change waits to be published in this language. */
  pendingChange: boolean;
}

/**
 * What one language of one document is, for its chip.
 *
 * `documentStatus` is the document's own Draft / Published status, passed only for a collection
 * with that lifecycle. A language is live only where both are public, as the server serves it
 * (`publishedInLanguageCondition`): the document's own row within the read's lifecycle, and the
 * language's own row published. Neither status stands in for the other: a language published
 * in a document still in draft is not shown to anyone. A status absent from either side (no
 * lifecycle, or no status kept per language) bounds nothing on that side; with neither, the
 * content is shown to readers once written, so it is live.
 *
 * The order of the checks is the order of what needs work first: a language with nothing is
 * missing whatever else is true; one whose source moved is out of date even while live, since
 * readers are being shown a translation of older text; a live one holding a change is "changes".
 */
export function languageChipFacts(
  meta: LocaleTranslationMeta | undefined,
  documentStatus?: unknown
): LanguageChipFacts {
  if (!meta?.translated) {
    return { state: "missing", live: false, pendingChange: false };
  }
  const documentPublic =
    typeof documentStatus !== "string" || documentStatus === "published";
  const languagePublic =
    meta.status === undefined || meta.status === "published";
  const live = documentPublic && languagePublic;
  const pendingChange = meta.pendingChange === true;
  const state: LanguageChipState =
    meta.stale === true
      ? "outOfDate"
      : !live
        ? "draft"
        : pendingChange
          ? "changes"
          : "live";
  return { state, live, pendingChange };
}

/**
 * The words a chip is spoken with: its state, and for an out-of-date language the facts its
 * one word left out, so a reader of the name hears all of them.
 */
export function languageChipSpoken(facts: LanguageChipFacts): string {
  switch (facts.state) {
    case "missing":
      return "missing";
    case "draft":
      return "draft";
    case "live":
      return "live";
    case "changes":
      return "live, with unpublished changes";
    case "outOfDate":
      return [
        "out of date",
        facts.live ? "live" : "draft",
        ...(facts.pendingChange ? ["with unpublished changes"] : []),
      ].join(", ");
  }
}
