/**
 * How a publish is worded for the person choosing it: what it does to each
 * language, from the server's own outcome for it, and the names a sentence
 * gives languages and fields. One module words them for every surface that
 * says what a publish would do, so no two of them word one outcome
 * differently.
 *
 * @module components/features/entries/publishAllOutcomes
 */

import type { PublishLanguageOutcome } from "@admin/services/publishParts";

/** A language's display name for its code. */
export type LanguageLabel = (code: string) => string;

/**
 * Fields as a sentence names them: those the caller may read by name, then a
 * count of those it may not, which the server withholds by name. Shared with the choice of what
 * goes live, which names the same fields the same way.
 */
export function fieldList(fields: readonly string[], hiddenCount = 0): string {
  const hidden =
    hiddenCount > 0
      ? `${hiddenCount} field${hiddenCount === 1 ? "" : "s"} you can't see`
      : "";
  if (fields.length === 0) return hidden;
  const named = fields.join(", ");
  return hidden ? `${named} and ${hidden}` : named;
}

/** What a publish does to one language, before it is done. */
export function outcomeSentence(
  language: PublishLanguageOutcome,
  labelOf: LanguageLabel
): string {
  switch (language.outcome) {
    case "goes-live-with-pending-change":
      return "Its unpublished changes go live.";
    case "stays-published":
      return "Stays as published.";
    case "goes-live":
      return "Goes live for the first time.";
    case "shows-fallback":
      return language.fallback === null
        ? "Goes live with no content of its own."
        : `Goes live with no content of its own, showing ${labelOf(language.fallback)}.`;
    // Where to act: a publish of that language alone is refused with the
    // offer to take the live values, which brings its change up to date.
    case "out-of-date":
      return `Its changes are behind the published ${fieldList(
        language.fields,
        language.hiddenCount
      )}. Publish ${labelOf(language.locale)} on its own and choose "Take the live values", then publish again.`;
  }
}

/** A language's name as the app's localization labels it, or its code. */
export function languageLabelOf(
  locales: readonly { code: string; label: string }[]
): (code: string) => string {
  return code => locales.find(locale => locale.code === code)?.label ?? code;
}
