/**
 * Publishing or unpublishing the parts of an entry a caller chooses: some of its languages, or
 * every one, and its shared part. One request, one answer: described without changing anything,
 * or applied, and everything chosen moves or nothing does.
 *
 * What it decides, before anything is written:
 * - every refusal, collected rather than the first: each language's own publish rule, the shared
 *   part's rule (asked in every language, since every language shows it), whatever governs
 *   publishing beyond access (`publishGate`), a unique translated field with no value of its own
 *   in a language going live, and, where the collection requires it, a required translated field
 *   with no value of its own;
 * - the shared part goes live with an entry's first language, chosen or not, and cannot be taken
 *   down while a language the request does not name stays live.
 *
 * The move itself is the transition of every language, told which parts it moves: one
 * transaction under the entry's row lock, which judges each language going live (every one at
 * fault reported) and writes the chosen parts' statuses together. What a request says it would do
 * is that transition's own preview, so the two come from one implementation.
 *
 * @experimental The request and its answer may change until publishing per language is complete.
 *
 * @module domains/collections/services/publish-parts
 */
import { errorEnvelopeFields } from "../../../errors/from-service-envelope";
import { NextlyError } from "../../../errors/nextly-error";
import type { ValidationPublicData } from "../../../errors/public-data";
import type {
  LanguageOutcome,
  PublishAllBlocker,
} from "../../versions/publish-all-plan";

import type { LifecycleParts } from "./all-locales-lifecycle";
import type { CollectionServiceResult } from "./collection-types";
import type { PublishGate, PublishPart } from "./publish-gate";

/** Which way the chosen parts move. */
export type PublishDirection = "publish" | "unpublish";

/** What a caller asks of an entry's parts. */
export interface PublishPartsRequest {
  direction: PublishDirection;
  /** The languages chosen, or every language the site has. */
  locales: readonly string[] | "all";
  /** Whether the shared part is chosen as well. */
  shared?: boolean;
  /** Say what the change would do, and change nothing. */
  describe?: boolean;
}

/**
 * What a request does to one language: a publish's outcomes as publishing every language reports
 * them, and an unpublish's own two.
 */
export type PartOutcome =
  | LanguageOutcome
  | { locale: string; outcome: "taken-down" | "stays-unpublished" };

/** What a request did, or would do, to each part of the entry. */
export interface PublishPartsAnswer {
  id: string;
  /** Each chosen language's outcome. */
  languages: PartOutcome[];
  shared: {
    /** Whether the shared part's publishing state changes. */
    changes: boolean;
    /** Whether the shared part was added to the request: the entry's first publish. */
    added: boolean;
  };
}

/** A field as the checks below read it. */
export interface PartsField {
  name: string;
  label: string;
  required: boolean;
  unique: boolean;
  /** Stored per language. */
  translatable: boolean;
}

/** The entry before the request, as the checks below read it. */
export interface PartsState {
  /** The site's languages, in its order. */
  configured: readonly string[];
  defaultLocale: string;
  /** Whether the shared part is live: the entry's own publishing state. */
  sharedLive: boolean;
  /** Each stored language's own publishing state and its own values, never fallback-filled. */
  languages: ReadonlyMap<
    string,
    {
      live: boolean;
      values: Readonly<Record<string, unknown>>;
      /**
       * The shared fields this language's pending change edits, where a language's change holds
       * the shared values too (without per-language storage): publishing it writes them.
       */
      pendingSharedEdits?: readonly string[];
    }
  >;
  fields: readonly PartsField[];
  /** Every language must hold its own value for each required translated field. */
  requireEveryLanguage: boolean;
}

/** What a request reads before it decides anything. */
export interface PartsReads {
  state: PartsState;
  /** Why the caller may not move each language it asked about, by language. */
  languageRefusals: ReadonlyMap<string, string>;
  /** Why the caller may not move the shared part, when asked about it, or null. */
  sharedRefusal: string | null;
}

/** What a request is carried out with, bound to the entry and the caller. */
export interface PublishPartsEngines {
  /**
   * The entry as stored and the caller's refusals for `locales` and, where `shared`, the shared
   * part; or the answer that ends the request, when the entry cannot be read.
   */
  reads(ask: {
    /** The languages whose refusal is asked, or every language the site has. */
    locales: readonly string[] | "all";
    shared: boolean;
  }): Promise<PartsReads | CollectionServiceResult>;
  gate: PublishGate;
  /** The entry's collection and the caller, for the gate. */
  collection: string;
  userId?: string;
  /**
   * The transition of `parts` (every part, where absent) in `direction`, in one transaction; or,
   * where `describe`, what a publish of them would do, changing nothing.
   */
  move(
    direction: PublishDirection,
    parts: LifecycleParts | undefined,
    describe: boolean
  ): Promise<CollectionServiceResult>;
}

/** One refused part, as a validation error carries it. */
type Issue = ValidationPublicData["errors"][number];

const SHARED_PATH = "shared";

/** A language's English name, or its code when the runtime cannot name it. */
function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A language named for a person, with its code: "Spanish (es)". */
function namedLanguage(code: string): string {
  return `${languageName(code)} (${code})`;
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** A unique field is never filled from another language, so a language going live needs its own. */
function uniqueValueIssue(field: PartsField, locale: string): Issue {
  const name = languageName(locale);
  return {
    path: field.name,
    code: "UNIQUE_VALUE_REQUIRED_IN_LANGUAGE",
    locale,
    message: `${field.label} needs its own value in ${name} before ${name} is published: a unique field is never filled from another language.`,
  };
}

/** Where a collection requires it, a language going live holds its own value for each required field. */
function requiredInLanguageIssue(field: PartsField, locale: string): Issue {
  const name = languageName(locale);
  return {
    path: field.name,
    code: "REQUIRED_IN_LANGUAGE",
    locale,
    message: `${field.label} needs its own value in ${name} before ${name} is published: this collection requires every language to hold its own.`,
  };
}

/** The issues a language's own values raise when it goes live. */
function ownValueIssues(state: PartsState, locale: string): Issue[] {
  const values = state.languages.get(locale)?.values ?? {};
  const unfilled = state.fields.filter(
    field => field.translatable && field.required && isBlank(values[field.name])
  );
  return unfilled.flatMap(field => {
    if (field.unique && locale !== state.defaultLocale) {
      return [uniqueValueIssue(field, locale)];
    }
    return state.requireEveryLanguage
      ? [requiredInLanguageIssue(field, locale)]
      : [];
  });
}

/** The outcome an unpublish has on one language, from the state before it. */
function unpublishOutcome(state: PartsState, locale: string): PartOutcome {
  return {
    locale,
    outcome: state.languages.get(locale)?.live
      ? "taken-down"
      : "stays-unpublished",
  };
}

/** What every check of one request reads. */
interface Judged {
  id: string;
  direction: PublishDirection;
  /** The languages the request moves. */
  chosen: readonly string[];
  /** Whether the shared part moves, chosen or added. */
  sharedPart: boolean;
  /** The request names every language, whose access the transition judges itself. */
  everyLanguage: boolean;
  reads: PartsReads;
}

/** A chosen language the site does not have, or one the caller may not move. */
function languageIssues(judged: Judged): Issue[] {
  return judged.chosen.flatMap((locale): Issue[] => {
    if (!judged.reads.state.configured.includes(locale)) {
      return [
        {
          path: locale,
          code: "UNKNOWN_LANGUAGE",
          locale,
          message: `The site has no language ${locale}.`,
        },
      ];
    }
    const refusal = judged.reads.languageRefusals.get(locale);
    return refusal === undefined
      ? []
      : [
          {
            path: locale,
            code: "FORBIDDEN",
            locale,
            message: `${namedLanguage(locale)}: ${refusal}`,
          },
        ];
  });
}

/** The shared part, where it moves and the caller may not move it. */
function sharedIssues(judged: Judged): Issue[] {
  const refusal = judged.reads.sharedRefusal;
  if (!judged.sharedPart || refusal === null) return [];
  return [
    {
      path: SHARED_PATH,
      code: "FORBIDDEN",
      message: `The shared part: ${refusal}`,
    },
  ];
}

/** Each part whatever governs publishing beyond access holds back. */
async function gateIssues(
  judged: Judged,
  engines: PublishPartsEngines
): Promise<Issue[]> {
  const parts: PublishPart[] = [
    ...judged.chosen.map(locale => ({ kind: "language" as const, locale })),
    ...(judged.sharedPart ? [{ kind: "shared" as const }] : []),
  ];
  const held = await engines.gate.refusals({
    collection: engines.collection,
    entryId: judged.id,
    direction: judged.direction,
    parts,
    userId: engines.userId,
  });
  return held.map(({ part, message }) =>
    part.kind === "shared"
      ? { path: SHARED_PATH, code: "HELD", message }
      : { path: part.locale, code: "HELD", locale: part.locale, message }
  );
}

/** Taking the shared part down while a language not chosen stays live. */
function stillLiveIssues(judged: Judged): Issue[] {
  const { state } = judged.reads;
  // Every language chosen leaves none live, so a request for every language never refuses here.
  if (judged.direction !== "unpublish" || !judged.sharedPart) return [];
  const stillLive = state.configured.filter(
    locale =>
      !judged.chosen.includes(locale) && state.languages.get(locale)?.live
  );
  if (stillLive.length === 0) return [];
  const one = stillLive.length === 1;
  return [
    {
      path: SHARED_PATH,
      code: "LANGUAGES_STILL_LIVE",
      message: `The shared part stays live while ${stillLive.map(namedLanguage).join(", ")} ${one ? "is" : "are"} published: unpublish ${one ? "it" : "them"} too, or keep the shared part.`,
    },
  ];
}

/**
 * The value rules of each language going live: each one of `locales`, or, for every language,
 * each stored one. A language already live does not go live again.
 */
function valueIssues(
  state: PartsState,
  locales: readonly string[] | "all"
): Issue[] {
  const every = locales === "all";
  return (every ? state.configured : locales).flatMap(locale => {
    const stored = state.languages.get(locale);
    if (stored?.live) return [];
    if (every && stored === undefined) return [];
    return ownValueIssues(state, locale);
  });
}

function goingLiveIssues(judged: Judged): Issue[] {
  if (judged.direction !== "publish") return [];
  return valueIssues(
    judged.reads.state,
    judged.everyLanguage ? "all" : judged.chosen
  );
}

/**
 * A publish that leaves the shared part as it is, of a language whose pending change also edits
 * shared fields: publishing that change would put its shared edits live, so the caller is told to
 * publish the shared part with it. Nothing of the change is lost.
 */
function sharedEditIssues(judged: Judged): Issue[] {
  if (judged.direction !== "publish" || judged.sharedPart) return [];
  return judged.chosen.flatMap((locale): Issue[] => {
    const edits = judged.reads.state.languages.get(locale)?.pendingSharedEdits;
    if (edits === undefined || edits.length === 0) return [];
    return [
      {
        path: edits.join(", "),
        code: "SHARED_EDITS_PENDING",
        locale,
        message: `${namedLanguage(locale)}'s pending change also edits ${edits.join(", ")}, which every language shares: publish the shared part with it (\`shared: true\`).`,
      },
    ];
  });
}

/** Every refusal the request meets before anything is written. */
async function refusalsOf(
  judged: Judged,
  engines: PublishPartsEngines
): Promise<Issue[]> {
  return [
    ...languageIssues(judged),
    ...sharedIssues(judged),
    ...(await gateIssues(judged, engines)),
    ...stillLiveIssues(judged),
    ...sharedEditIssues(judged),
    ...goingLiveIssues(judged),
  ];
}

/** The request refused whole, every issue in the validation error's public data. */
function refused(issues: Issue[]): CollectionServiceResult {
  const error = NextlyError.validation({ errors: issues });
  return {
    ...errorEnvelopeFields(error),
    success: false,
    statusCode: error.statusCode,
    // Every part's reason in the message too, for a caller that reads only that.
    message: issues.map(issue => issue.message).join(" "),
    data: null,
  };
}

/**
 * Why the value rules refuse putting `locales` live (each one, or every stored language for
 * `"all"`): a unique translated field, or under `requireEveryLanguage` a required one, with no
 * value of its own. Null where nothing refuses. The judgement a publish of chosen parts makes,
 * for the other ways a language is published to ask too.
 *
 * @experimental
 */
export function publishValueRefusal(
  state: PartsState,
  locales: readonly string[] | "all"
): CollectionServiceResult | null {
  const issues = valueIssues(state, locales);
  return issues.length > 0 ? refused(issues) : null;
}

/** The issues a preview's blockers stand for: what the publish it previews would refuse. */
function blockerIssues(blockers: readonly PublishAllBlocker[]): Issue[] {
  return blockers.map(blocker => ({
    path: blocker.fields.join(", ") || SHARED_PATH,
    code: blocker.reason,
    message: `Publishing would be refused (${blocker.reason})${blocker.fields.length > 0 ? `: ${blocker.fields.join(", ")}` : ""}.`,
  }));
}

/** Each chosen language's outcome, as the transition reports it, in the order they were chosen. */
function chosenOutcomes(
  reported: readonly LanguageOutcome[],
  chosen: readonly string[]
): PartOutcome[] {
  const byLocale = new Map(reported.map(outcome => [outcome.locale, outcome]));
  return chosen.flatMap(locale => {
    const outcome = byLocale.get(locale);
    return outcome === undefined ? [] : [outcome];
  });
}

/** A request that chooses nothing: no language, and not the shared part. */
function choosesNothing(
  request: PublishPartsRequest,
  asked: readonly string[]
): boolean {
  return (
    request.locales !== "all" && asked.length === 0 && request.shared !== true
  );
}

/**
 * Whether the shared part moves, and whether it was added rather than chosen: an entry's first
 * publish of a language takes the shared part with it, since no language is live while its shared
 * part is not.
 */
function sharedPartOf(
  request: PublishPartsRequest,
  asked: readonly string[],
  state: PartsState
): { sharedPart: boolean; added: boolean } {
  if (request.locales === "all") return { sharedPart: true, added: false };
  const added =
    asked.length > 0 &&
    request.direction === "publish" &&
    !state.sharedLive &&
    request.shared !== true;
  return { sharedPart: request.shared === true || added, added };
}

/** The chosen parts taken down, or what taking them down would do. */
async function unpublishParts(
  judged: Judged,
  answer: PublishPartsAnswer,
  parts: LifecycleParts | undefined,
  describe: boolean,
  engines: PublishPartsEngines
): Promise<
  CollectionServiceResult<PublishPartsAnswer> | CollectionServiceResult
> {
  const unpublished = {
    ...answer,
    languages: judged.chosen.map(locale =>
      unpublishOutcome(judged.reads.state, locale)
    ),
  };
  if (describe) {
    return {
      success: true,
      statusCode: 200,
      message: "What the change does.",
      data: unpublished,
    };
  }
  const moved = await engines.move("unpublish", parts, false);
  if (!moved.success) return moved;
  return { ...moved, message: "Unpublished.", data: unpublished };
}

/** The chosen parts published, or what publishing them would do, as the transition answers. */
async function publishChosenParts(
  judged: Judged,
  answer: PublishPartsAnswer,
  parts: LifecycleParts | undefined,
  describe: boolean,
  engines: PublishPartsEngines
): Promise<
  CollectionServiceResult<PublishPartsAnswer> | CollectionServiceResult
> {
  const moved = await engines.move("publish", parts, describe);
  if (!moved.success) return moved;
  const data = moved.data as {
    languages?: LanguageOutcome[];
    blockers?: PublishAllBlocker[];
  } | null;
  const blockers = data?.blockers ?? [];
  if (describe && blockers.length > 0) return refused(blockerIssues(blockers));
  return {
    ...moved,
    message: describe ? "What the change does." : "Published.",
    data: {
      ...answer,
      languages: chosenOutcomes(data?.languages ?? [], judged.chosen),
    },
  };
}

/**
 * Carry out `request` on entry `id`: every refusal collected before anything moves, then the
 * chosen parts moved together, or described.
 */
export async function publishParts(
  id: string,
  request: PublishPartsRequest,
  engines: PublishPartsEngines
): Promise<
  CollectionServiceResult<PublishPartsAnswer> | CollectionServiceResult
> {
  const everyLanguage = request.locales === "all";
  const asked = everyLanguage ? [] : [...new Set(request.locales)];
  // A request that chooses nothing moves nothing: refused, rather than read as a request for the
  // shared part a first publish would add.
  if (choosesNothing(request, asked)) {
    return refused([
      {
        path: "locales",
        code: "NOTHING_CHOSEN",
        message:
          "Choose at least one language, or the shared part (`shared: true`).",
      },
    ]);
  }
  // The shared part's rule is asked whether or not the request ends up moving it: whether a first
  // publish adds it is known only once the entry is read.
  // Each chosen language's rule is asked in that language. Unpublishing every language asks every
  // one, as a list of them would; publishing every language leaves it to the transition, which asks
  // each language it puts live.
  const askedForAccess = everyLanguage
    ? request.direction === "unpublish"
      ? "all"
      : []
    : asked;
  const reads = await engines.reads({
    locales: askedForAccess,
    shared: !everyLanguage,
  });
  if ("success" in reads) return reads;
  const { state } = reads;
  const { sharedPart, added } = sharedPartOf(request, asked, state);
  const judged: Judged = {
    id,
    direction: request.direction,
    chosen: everyLanguage ? [...state.configured] : asked,
    sharedPart,
    everyLanguage,
    reads,
  };

  const issues = await refusalsOf(judged, engines);
  if (issues.length > 0) return refused(issues);

  const parts: LifecycleParts | undefined = everyLanguage
    ? undefined
    : { locales: new Set(judged.chosen), shared: sharedPart };
  const sharedLiveAfter = request.direction === "publish";
  const answer: PublishPartsAnswer = {
    id,
    languages: [],
    shared: {
      changes: sharedPart && state.sharedLive !== sharedLiveAfter,
      added,
    },
  };
  const describe = request.describe === true;
  return request.direction === "unpublish"
    ? unpublishParts(judged, answer, parts, describe, engines)
    : publishChosenParts(judged, answer, parts, describe, engines);
}
