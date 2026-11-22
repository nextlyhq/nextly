/**
 * What a person chooses to publish: the languages, and separately the shared fields. Free of
 * React, so the defaults and the sentences are tested without rendering anything.
 *
 * - By default the language being edited is chosen, and the shared fields are chosen when they
 *   hold changes nobody has published yet.
 * - Each choice is described by the server first (`describe`), so the person reads what each
 *   part will do before anything goes live.
 * - A refusal names the parts it refuses; each reason is shown beside its part.
 *
 * @module components/features/entries/publish-parts/publish-parts-choice
 */

import { validationIssues } from "@admin/lib/api/parseApiError";
import type {
  PartsLanguageOutcome,
  PublishPartsDirection,
  PublishPartsResult,
} from "@admin/services/publishParts";

import { outcomeSentence, type LanguageLabel } from "../publishAllOutcomes";

/** The parts a person has chosen. */
export interface PartsChoice {
  /** Chosen languages, in the order the app configures them. */
  locales: readonly string[];
  shared: boolean;
}

/** The path a refusal names the shared fields by. */
export const SHARED_PATH = "shared";

/**
 * The choice the menu opens with: the language being edited, and the shared fields when they hold
 * unpublished changes. A Single or collection that is not translated has no languages to choose,
 * so its shared fields, which are the whole document, are chosen.
 */
export function defaultPartsChoice(args: {
  /** The site's languages, in order, or none where the document is not translated. */
  languages: readonly string[];
  /** The language on screen, or undefined for the default one. */
  currentLocale: string | undefined;
  defaultLocale: string | undefined;
  /** Whether the shared fields hold changes nobody has published yet. */
  sharedPending: boolean;
}): PartsChoice {
  if (args.languages.length === 0) return { locales: [], shared: true };
  const current = args.currentLocale ?? args.defaultLocale;
  return {
    locales:
      current !== undefined && args.languages.includes(current)
        ? [current]
        : [],
    shared: args.sharedPending,
  };
}

/** The choice with `locale` chosen or not, kept in the app's order of `languages`. */
export function withLanguage(
  choice: PartsChoice,
  languages: readonly string[],
  locale: string,
  chosen: boolean
): PartsChoice {
  const next = new Set(choice.locales);
  if (chosen) next.add(locale);
  else next.delete(locale);
  return {
    ...choice,
    locales: languages.filter(language => next.has(language)),
  };
}

/** Whether anything is chosen at all: a request choosing nothing is refused by the server. */
export function choosesAnything(choice: PartsChoice): boolean {
  return choice.locales.length > 0 || choice.shared;
}

/** What a publish or unpublish does to one chosen language, before it is done. */
export function partsOutcomeSentence(
  language: PartsLanguageOutcome,
  labelOf: LanguageLabel
): string {
  switch (language.outcome) {
    case "taken-down":
      return "Comes down: readers no longer see it.";
    case "stays-unpublished":
      return "Is not published, so nothing changes.";
    default:
      return outcomeSentence(language, labelOf);
  }
}

/** What the request does to the shared fields, before it is done. */
export function sharedSentence(
  direction: PublishPartsDirection,
  shared: PublishPartsResult["shared"]
): string {
  if (shared.added) {
    return "Go live too: a first publish always takes the shared fields with it.";
  }
  if (!shared.changes) return "Nothing changes.";
  return direction === "publish"
    ? "Their unpublished changes go live."
    : "Come down with the document.";
}

/**
 * Each refused part's reason, by part: one of the `parts` the dialog draws (a language code, or
 * {@link SHARED_PATH}). A reason naming none of them (a field, say) is kept under the empty key,
 * shown above the choices with the name it gives, so no refusal goes unshown.
 */
export function refusalsByPart(
  error: unknown,
  parts: readonly string[]
): ReadonlyMap<string, string[]> {
  const drawn = new Set(parts);
  const byPart = new Map<string, string[]>();
  for (const issue of validationIssues(error)) {
    if (issue.message === undefined) continue;
    const path = issue.path ?? "";
    const key = drawn.has(path) ? path : "";
    const message =
      key === "" && path !== "" ? `${path}: ${issue.message}` : issue.message;
    byPart.set(key, [...(byPart.get(key) ?? []), message]);
  }
  return byPart;
}
