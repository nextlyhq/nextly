/**
 * What publishing every language says about each language, worded from the
 * server's own outcomes: before the publish (the preview the "Publish all"
 * dialog lists) and after it (the result message). One module words both, so
 * the dialog cannot say a pending change goes live where the result then
 * reports it did not.
 *
 * @module components/features/entries/publishAllOutcomes
 */

import type {
  PublishAllBlocker,
  PublishAllLanguageOutcome,
  PublishAllPreview,
} from "@admin/services/publishAllPreview";

/** A language's display name for its code. */
export type LanguageLabel = (code: string) => string;

/**
 * Fields as a sentence names them: those the caller may read by name, then a
 * count of those it may not, which the server withholds by name.
 */
function fieldList(fields: readonly string[], hiddenCount = 0): string {
  const hidden =
    hiddenCount > 0
      ? `${hiddenCount} field${hiddenCount === 1 ? "" : "s"} you can't see`
      : "";
  if (fields.length === 0) return hidden;
  const named = fields.join(", ");
  return hidden ? `${named} and ${hidden}` : named;
}

/** What publishing every language does to one language, before it is done. */
export function outcomeSentence(
  language: PublishAllLanguageOutcome,
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
      )}. Publish ${labelOf(language.locale)} on its own and choose "Take the live values", then publish all again.`;
  }
}

/** Why a blocker stops the publish as a whole. */
export function blockerSentence(blocker: PublishAllBlocker): string {
  const fields = fieldList(blocker.fields, blocker.hiddenCount);
  switch (blocker.reason) {
    case "shared-edits-unmergeable":
      return `Languages edit ${fields} differently. Publish them one language at a time.`;
    case "shared-edits-unordered":
      return `Languages edit ${fields} in an order that can't be told. Publish them one language at a time.`;
    case "pending-change-forbidden":
      return `Unpublished changes edit ${fields}, which you may not publish.`;
    case "pending-change-invalid":
      return `Unpublished changes to ${fields} don't pass validation.`;
  }
}

/**
 * Whether the server would refuse the publish: a blocker, or a language whose
 * changes are behind the published values. Read from the same preview the
 * dialog lists, so the button and the list cannot disagree.
 */
export function publishAllBlocked(preview: PublishAllPreview): boolean {
  return (
    preview.blockers.length > 0 ||
    preview.languages.some(language => language.outcome === "out-of-date")
  );
}

/** What happened to one language, once the publish has gone through. */
function publishedPhrase(
  language: PublishAllLanguageOutcome,
  labelOf: LanguageLabel
): string {
  switch (language.outcome) {
    case "goes-live-with-pending-change":
      return "its unpublished changes went live";
    case "stays-published":
      return "stayed as published";
    case "goes-live":
      return "went live for the first time";
    case "shows-fallback":
      return language.fallback === null
        ? "went live with no content of its own"
        : `went live with no content of its own, showing ${labelOf(language.fallback)}`;
    // A publish that went through left no language behind; worded anyway so
    // a report the server sends is never dropped from the message.
    case "out-of-date":
      return "was left as it was";
  }
}

/** A language's name as the app's localization labels it, or its code. */
export function languageLabelOf(
  locales: readonly { code: string; label: string }[]
): (code: string) => string {
  return code => locales.find(locale => locale.code === code)?.label ?? code;
}

/**
 * The result message after publishing every language: each language's
 * outcome, as the publish reports it. Where the server reports none, only that
 * every language was published.
 */
export function publishedSummary(
  languages: readonly PublishAllLanguageOutcome[] | undefined,
  labelOf: LanguageLabel
): string {
  const head = "All languages published.";
  if (!languages || languages.length === 0) return head;
  const each = languages.map(
    language =>
      `${labelOf(language.locale)}: ${publishedPhrase(language, labelOf)}.`
  );
  return [head, ...each].join(" ");
}
