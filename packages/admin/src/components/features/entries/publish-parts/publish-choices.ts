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
 * - whether the shared fields go live with a first publish, from both.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/publish-choices
 */

import { validationIssues } from "@admin/lib/api/parseApiError";
import type {
  PartsLanguageOutcome,
  PublishPartsResult,
} from "@admin/services/publishParts";

import { fieldList, type LanguageLabel } from "../publishAllOutcomes";

import { outOfDateForecast, type OutOfDateCount } from "./out-of-date";
import {
  partsOutcomeSentence,
  sharedSentence,
  SHARED_PATH,
  type PartsChoice,
} from "./publish-parts-choice";
import { NOT_APPROVED } from "./ready-to-publish";

/** One part as the choice lists it: a language, or the shared fields. */
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
interface PublishChoices {
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

/** What says which parts are offered: the site's languages and what is known of each part. */
interface PartsKnown {
  /** The site's languages, in order, where the document is translated; otherwise none. */
  languages: readonly string[];
  /** The server's description of publishing every language, once it has said. */
  everyLanguageAnswer: PublishPartsResult | undefined;
  /** Whether the shared fields hold changes nobody has published. */
  sharedPending: boolean;
}

/**
 * Whether the shared fields hold anything to publish: changes of their own, or a published state
 * to put live. While the server has not said, they are offered, and the server judges the request.
 */
function sharedHoldsSomething(known: PartsKnown): boolean {
  return (
    known.sharedPending ||
    known.everyLanguageAnswer === undefined ||
    known.everyLanguageAnswer.shared.changes
  );
}

/**
 * Whether publishing `locales` takes the shared fields with it: they are not live, and no language
 * goes live without them.
 */
function takesShared(locales: readonly string[], known: PartsKnown): boolean {
  return (
    locales.length > 0 && known.everyLanguageAnswer?.shared.changes === true
  );
}

/**
 * The part of `choice` that is offered: what is described and sent. A language with nothing to
 * publish, or one the server refuses as it stands, is left out, and so are shared fields with
 * nothing to publish. Those a first publish takes are not asked for: the server adds them itself,
 * and says so. A document that is not translated is its shared fields, so the choice stands.
 */
export function offeredChoice(
  choice: PartsChoice,
  known: PartsKnown
): PartsChoice {
  if (known.languages.length === 0) return choice;
  const locales = choice.locales.filter(locale =>
    languageOffered(outcomeIn(known.everyLanguageAnswer, locale))
  );
  return {
    locales,
    shared:
      choice.shared &&
      sharedHoldsSomething(known) &&
      !takesShared(locales, known),
  };
}

/** Whether the server refuses the request for want of the shared fields' approval. */
function refusedForSharedApproval(refusal: unknown): boolean {
  return validationIssues(refusal).some(
    issue => issue.path === SHARED_PATH && issue.code === NOT_APPROVED
  );
}

/**
 * The parts `request` moves, the shared fields a first publish takes among them: what a workflow
 * judges. The descriptions say whether it takes them; while the shared fields wait for approval
 * both are refused, and the refusal names them.
 */
export function movedParts(
  request: PartsChoice,
  known: PartsKnown & {
    chosenAnswer: PublishPartsResult | undefined;
    /** Why the server refuses the request, if it does. */
    error: unknown;
  }
): PartsChoice {
  return {
    ...request,
    shared:
      request.shared ||
      known.chosenAnswer?.shared.added === true ||
      takesShared(request.locales, known) ||
      refusedForSharedApproval(known.error),
  };
}

/** What publishing the shared fields changes, or why they are not offered. */
function sharedSays(known: PartsKnown): string | undefined {
  if (known.sharedPending) {
    return "Their unpublished changes go live for readers of every language.";
  }
  if (known.everyLanguageAnswer === undefined) return undefined;
  return known.everyLanguageAnswer.shared.changes
    ? "Go live for readers of every language."
    : "No unpublished changes.";
}

/** The shared fields' row, for the part of the choice that is offered. */
function sharedRow(
  offered: PartsChoice,
  chosenAnswer: PublishPartsResult | undefined,
  known: PartsKnown
): PublishChoiceRow {
  const base = { part: SHARED_PATH, label: "Shared fields", current: false };
  // Not translated: the shared fields are the whole document.
  if (known.languages.length === 0) {
    return {
      ...base,
      chosen: offered.shared,
      offered: true,
      says:
        chosenAnswer === undefined
          ? undefined
          : sharedSentence("publish", chosenAnswer.shared),
    };
  }
  if (
    chosenAnswer?.shared.added === true ||
    takesShared(offered.locales, known)
  ) {
    return {
      ...base,
      chosen: true,
      offered: false,
      says: "Go live too: a first publish always takes them, for readers of every language.",
    };
  }
  return {
    ...base,
    chosen: offered.shared,
    offered: sharedHoldsSomething(known),
    says: sharedSays(known),
  };
}

/** What the choice of what goes live lists, for `choice`. */
export function publishChoices(
  args: PartsKnown & {
    labelOf: LanguageLabel;
    /** The language on screen. */
    currentLocale: string | undefined;
    choice: PartsChoice;
    /** The server's description of the request as chosen, once it has said. */
    chosenAnswer: PublishPartsResult | undefined;
    /** The translations publishing the chosen languages would leave out of date. */
    outOfDate: readonly OutOfDateCount[];
  }
): PublishChoices {
  const request = offeredChoice(args.choice, args);
  const languageRows = args.languages.map((locale): PublishChoiceRow => {
    const label = args.labelOf(locale);
    const listed = outcomeIn(args.everyLanguageAnswer, locale);
    const chosen = request.locales.includes(locale);
    // A chosen language in the server's words for the request as chosen; any other in its
    // words for publishing every language.
    const outcome =
      (chosen ? outcomeIn(args.chosenAnswer, locale) : undefined) ?? listed;
    return {
      part: locale,
      label,
      current: locale === args.currentLocale,
      chosen,
      offered: languageOffered(listed),
      says:
        outcome === undefined
          ? undefined
          : languageSays(outcome, label, args.labelOf),
    };
  });
  const shared = sharedRow(request, args.chosenAnswer, args);
  const forecast = outOfDateForecast(args.outOfDate, args.labelOf);
  const facts = [
    ...(shared.chosen && args.languages.length > 1
      ? [SHARED_CHANGE_EVERY_LANGUAGE]
      : []),
    ...(forecast === null ? [] : [forecast]),
  ];
  return { rows: [...languageRows, shared], facts };
}
