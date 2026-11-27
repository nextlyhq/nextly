/**
 * What publishing one language, or taking it offline, says before and after:
 * worded from the server's own description of the request and its own report
 * of what it did.
 *
 * @module components/features/translations/page/publish-language-words
 */

import { fieldList } from "@admin/hooks/useSharedFieldsRecovery";
import {
  apiErrorMessage,
  validationIssues,
} from "@admin/lib/api/parseApiError";
import { refusedAsChangedSince } from "@admin/lib/document-version";
import { humanizeFieldName } from "@admin/lib/field-label";
import type {
  PartsLanguageOutcome,
  PublishPartsResult,
} from "@admin/services/publishParts";

import type { EmptyField } from "./reader-preview";

/** A language's display name for its code. */
export type LabelOf = (code: string) => string;

/** The shared fields a language's saved changes are behind on. */
export function behindOn(behind: {
  fields: readonly string[];
  hiddenCount?: number | undefined;
}): string {
  return fieldList(behind.fields.map(humanizeFieldName), behind.hiddenCount);
}

/**
 * What a publish does to the language, before it is done. `sharedGoLive` is
 * whether it publishes the document itself, which a language marked published
 * beforehand has been waiting for.
 */
export function publishSentence(
  outcome: PartsLanguageOutcome | undefined,
  language: string,
  sharedGoLive: boolean
): string {
  switch (outcome?.outcome) {
    case "goes-live-with-pending-change":
      return `${language} readers will see your saved changes.`;
    case "goes-live":
      return `${language} readers will see this translation.`;
    // The language the server names here may be one nobody has published,
    // which readers are not shown, so each field is left to say its own.
    case "shows-fallback":
      return `${language} has no text of its own yet. Its readers will see another published language where there is one, and nothing where there isn't.`;
    case "stays-published":
      return sharedGoLive
        ? `${language} readers will see this translation.`
        : `${language} is already published as it stands. There is nothing to publish.`;
    case "out-of-date":
      return `${language}'s saved changes also hold ${behindOn(outcome)}, which changed on the published document since. Take the live values first, then publish. History keeps the values they replace.`;
    default:
      return `${language} will be published.`;
  }
}

/** Whether the described publish does anything at all. */
export function publishes(
  outcome: PartsLanguageOutcome | undefined,
  sharedGoLive: boolean
): boolean {
  if (outcome === undefined || outcome.outcome === "out-of-date") return false;
  return outcome.outcome !== "stays-published" || sharedGoLive;
}

/** "English", "English and French". */
function named(codes: readonly string[], labelOf: LabelOf): string {
  return fieldList(codes.map(labelOf));
}

/**
 * Said before a first publish that shows other languages to their readers
 * too; undefined where it shows none.
 */
export function goingLiveTooSentence(
  codes: readonly string[] | undefined,
  labelOf: LabelOf
): string | undefined {
  if (codes === undefined) {
    return "Any other language already marked published goes live too.";
  }
  if (codes.length === 0) return undefined;
  const one = codes.length === 1;
  return `${named(codes, labelOf)} ${one ? "is" : "are"} already marked published, so ${one ? "it goes" : "they go"} live too.`;
}

/** Said before a publish that takes the shared fields live with the language. */
export function sharedGoLiveSentence(language: string): string {
  return `The shared fields aren't published yet. They go live with ${language}.`;
}

/** One empty field, and what its readers get instead. */
export function emptyFieldLine(field: EmptyField, labelOf: LabelOf): string {
  if (field.shows === null) return `${field.label}: nothing is shown`;
  return field.shows === undefined
    ? `${field.label}: another language may be shown`
    : `${field.label}: ${labelOf(field.shows)} is shown`;
}

/** Whether a publish publishes the document itself, its shared fields with it. */
export function sharedGoLive(
  result: Pick<PublishPartsResult, "shared"> | undefined
): boolean {
  return result?.shared.added === true || result?.shared.changes === true;
}

/**
 * What was published, from what the server reports it did. The default
 * language is said to be unchanged only where it is: a first publish shows its
 * readers one already marked published.
 */
export function publishedMessage(args: {
  result: Pick<PublishPartsResult, "shared">;
  language: string;
  defaultLocale: string;
  /** See `languagesGoingLiveToo`, as it was before the publish. */
  goingLiveToo: readonly string[] | undefined;
  labelOf: LabelOf;
}): string {
  const { result, language, defaultLocale, goingLiveToo, labelOf } = args;
  if (!sharedGoLive(result)) {
    return `${language} is published. ${labelOf(defaultLocale)} and the shared fields are unchanged.`;
  }
  const said = [
    `${language} is published, and the shared fields went live with it.`,
  ];
  if (goingLiveToo !== undefined && goingLiveToo.length > 0) {
    said.push(`So did ${named(goingLiveToo, labelOf)}.`);
  }
  if (goingLiveToo !== undefined && !goingLiveToo.includes(defaultLocale)) {
    said.push(`${labelOf(defaultLocale)} is unchanged.`);
  }
  return said.join(" ");
}

/**
 * What its readers get once the language is offline. One sentence for both:
 * whether another language stands in for a whole document is each read's own
 * choice, so nothing here can say which of the two a site asks for.
 */
export function offlineSentence(language: string): string {
  return `${language} readers will get “not found”, or the fallback language where the site shows the whole document in another language.`;
}

/** What was taken offline, once it is. */
export function offlineMessage(
  language: string,
  defaultLanguage: string
): string {
  return `${language} is offline. ${defaultLanguage} and the shared fields are unchanged.`;
}

/** The server's codes for what refuses a publish as a whole, in words. */
function blockerMessage(
  code: string | undefined,
  path: string,
  language: string
): string | undefined {
  const fields = fieldList(path.split(", ").map(humanizeFieldName));
  switch (code) {
    case "pending-change-forbidden":
      return `${language}'s saved changes edit ${fields}, which you may not publish.`;
    case "pending-change-invalid":
      return `${language}'s saved changes to ${fields} don't pass validation.`;
    case "shared-edits-unmergeable":
    case "shared-edits-unordered":
      return `Saved changes in different languages edit ${fields} differently, and can't be put together.`;
    default:
      return undefined;
  }
}

/** Why the server refuses the request, each reason once; none without one. */
export function refusalMessages(
  error: unknown,
  language: string,
  fallback: string
): string[] {
  if (error === null || error === undefined) return [];
  if (refusedAsChangedSince(error)) {
    return [
      "This document changed since you opened it. Close this, look at the current version, then try again.",
    ];
  }
  const said = new Set<string>();
  for (const { code, path, message } of validationIssues(error)) {
    const words = blockerMessage(code, path ?? "", language) ?? message;
    if (words !== undefined) said.add(words);
  }
  return said.size > 0 ? [...said] : [apiErrorMessage(error, fallback)];
}
