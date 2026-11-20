/**
 * What the choice of what goes live lists, decided apart from drawing it: each language and the
 * shared fields as a part of its own, whether it can be chosen, and what publishing it changes for
 * its readers; then what the publish means beyond its parts (the shared fields change every
 * language, and which translations it leaves out of date). Free of React, so every case is tested
 * without rendering anything.
 *
 * Every sentence is the server's description put into words, never a guess:
 * - whether a language can be chosen, and what it says while it is not chosen, from the server's
 *   description of publishing every language;
 * - what a chosen language does, from the description of the request as chosen;
 * - whether the shared fields go live with a first publish, from that same description.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/publish-choices
 */

import type {
  PartsLanguageOutcome,
  PublishPartsResult,
} from "@admin/services/publishParts";

import { fieldList, type LanguageLabel } from "../publishAllOutcomes";

import { outOfDateForecast, type OutOfDateCount } from "./out-of-date";
import {
  partsOutcomeSentence,
  SHARED_PATH,
  type PartsChoice,
} from "./publish-parts-choice";

/** One part the person may publish: a language, or the shared fields. */
export interface PublishChoiceRow {
  /** The language's code, or {@link SHARED_PATH} for the shared fields. */
  part: string;
  label: string;
  /** Whether it is the language on screen. */
  current: boolean;
  /** Whether it goes live with this publish, as drawn. */
  chosen: boolean;
  /**
   * Whether the person may choose it or leave it: not for a part with nothing to publish, nor for
   * the shared fields a first publish takes with it.
   */
  offered: boolean;
  /** What publishing it changes for its readers, or why it is not offered; undefined while unknown. */
  says: string | undefined;
}

/** The parts, in the site's order with the shared fields last, and the lines that follow them. */
export interface PublishChoices {
  rows: PublishChoiceRow[];
  /** What the publish means beyond its parts, each a line. */
  facts: string[];
}

/** The shared fields' line, said whenever they go live on a site with several languages. */
const SHARED_CHANGE_EVERY_LANGUAGE = "Shared fields change every language.";

/** What a language's readers see, worded from what the server says publishing it does. */
function languageSays(
  outcome: PartsLanguageOutcome,
  label: string,
  labelOf: LanguageLabel
): string {
  switch (outcome.outcome) {
    case "goes-live-with-pending-change":
      return `Its unpublished changes go live for readers of ${label}.`;
    case "goes-live":
      return `Goes live for the first time: readers of ${label} see it.`;
    case "stays-published":
      return "Live, with nothing new to publish.";
    case "shows-fallback":
      return "Not started, so there is nothing to publish.";
    case "out-of-date":
      return `Its changes are behind the live ${fieldList(
        outcome.fields,
        outcome.hiddenCount
      )}. Open ${label} and take the live values before publishing it.`;
    default:
      return partsOutcomeSentence(outcome, labelOf);
  }
}

/**
 * Whether a language with this outcome can be chosen: one with nothing to publish cannot, and
 * neither can one whose change the server refuses as it stands, until it takes the live values.
 */
function languageOffered(outcome: PartsLanguageOutcome | undefined): boolean {
  if (outcome === undefined) return true;
  return (
    outcome.outcome !== "stays-published" &&
    outcome.outcome !== "shows-fallback" &&
    outcome.outcome !== "out-of-date"
  );
}

function outcomeIn(
  answer: PublishPartsResult | undefined,
  locale: string
): PartsLanguageOutcome | undefined {
  return answer?.languages.find(language => language.locale === locale);
}

/** The shared fields' row. */
function sharedRow(args: {
  choice: PartsChoice;
  chosenAnswer: PublishPartsResult | undefined;
  sharedPending: boolean;
}): PublishChoiceRow {
  const base = { part: SHARED_PATH, label: "Shared fields", current: false };
  if (args.chosenAnswer?.shared.added === true) {
    return {
      ...base,
      chosen: true,
      offered: false,
      says: "Go live too: a first publish always takes them, for readers of every language.",
    };
  }
  if (!args.sharedPending) {
    return {
      ...base,
      chosen: false,
      offered: false,
      says: "No unpublished changes.",
    };
  }
  return {
    ...base,
    chosen: args.choice.shared,
    offered: true,
    says: "Their unpublished changes go live for readers of every language.",
  };
}

/** What the choice of what goes live lists, for `choice`. */
export function publishChoices(args: {
  /** The site's languages, in order, where the document is translated; otherwise none. */
  languages: readonly string[];
  labelOf: LanguageLabel;
  /** The language on screen. */
  currentLocale: string;
  choice: PartsChoice;
  /** The server's description of the request as chosen, once it has said. */
  chosenAnswer: PublishPartsResult | undefined;
  /** The server's description of publishing every language, once it has said. */
  everyLanguageAnswer: PublishPartsResult | undefined;
  /** Whether the shared fields hold changes nobody has published. */
  sharedPending: boolean;
  /** The translations publishing the chosen languages would leave out of date. */
  outOfDate: readonly OutOfDateCount[];
}): PublishChoices {
  const languageRows = args.languages.map((locale): PublishChoiceRow => {
    const label = args.labelOf(locale);
    const listed = outcomeIn(args.everyLanguageAnswer, locale);
    const offered = languageOffered(listed);
    const chosen = offered && args.choice.locales.includes(locale);
    // A chosen language in the server's words for the request as chosen; any other in its
    // words for publishing every language.
    const outcome =
      (chosen ? outcomeIn(args.chosenAnswer, locale) : undefined) ?? listed;
    return {
      part: locale,
      label,
      current: locale === args.currentLocale,
      chosen,
      offered,
      says:
        outcome === undefined
          ? undefined
          : languageSays(outcome, label, args.labelOf),
    };
  });
  const shared = sharedRow(args);
  const facts = [
    ...(shared.chosen && args.languages.length > 1
      ? [SHARED_CHANGE_EVERY_LANGUAGE]
      : []),
    ...[outOfDateForecast(args.outOfDate, args.labelOf)].filter(
      (line): line is string => line !== null
    ),
  ];
  return { rows: [...languageRows, shared], facts };
}

/**
 * The request the rows make: the languages chosen and offered, and the shared fields where they
 * are chosen and offered. The shared fields a first publish takes are not asked for: the server
 * adds them itself, and says so.
 */
export function choiceFromRows(rows: readonly PublishChoiceRow[]): PartsChoice {
  return {
    locales: rows
      .filter(row => row.part !== SHARED_PATH && row.offered && row.chosen)
      .map(row => row.part),
    shared: rows.some(
      row => row.part === SHARED_PATH && row.offered && row.chosen
    ),
  };
}
