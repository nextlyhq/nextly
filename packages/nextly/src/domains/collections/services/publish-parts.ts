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
    { live: boolean; values: Readonly<Record<string, unknown>> }
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
    locales: readonly string[];
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
export type Issue = ValidationPublicData["errors"][number];

const SHARED_PATH = "shared";

/** A language's English name, or its code when the runtime cannot name it. */
function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** The issues a language's own values raise when it goes live. */
function ownValueIssues(state: PartsState, locale: string): Issue[] {
  const values = state.languages.get(locale)?.values ?? {};
  const name = languageName(locale);
  const issues: Issue[] = [];
  for (const field of state.fields) {
    if (!field.translatable || !field.required) continue;
    if (!isBlank(values[field.name])) continue;
    if (field.unique && locale !== state.defaultLocale) {
      // A unique field is never filled from another language, so a language going live needs its
      // own value.
      issues.push({
        path: field.name,
        code: "UNIQUE_VALUE_REQUIRED_IN_LANGUAGE",
        locale,
        message: `${field.label} needs its own value in ${name} before ${name} is published: a unique field is never filled from another language.`,
      });
    } else if (state.requireEveryLanguage) {
      issues.push({
        path: field.name,
        code: "REQUIRED_IN_LANGUAGE",
        locale,
        message: `${field.label} needs its own value in ${name} before ${name} is published: this collection requires every language to hold its own.`,
      });
    }
  }
  return issues;
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

/**
 * Every refusal the request meets before anything is written. `everyLanguage` requests leave
 * access to the transition, which judges it as publishing every language always has.
 */
async function refusalsOf(
  id: string,
  request: PublishPartsRequest,
  chosen: readonly string[],
  sharedPart: boolean,
  reads: PartsReads,
  engines: PublishPartsEngines,
  everyLanguage: boolean
): Promise<Issue[]> {
  const { direction } = request;
  const { state } = reads;
  const issues: Issue[] = [];
  for (const locale of chosen) {
    if (!state.configured.includes(locale)) {
      issues.push({
        path: locale,
        code: "UNKNOWN_LANGUAGE",
        locale,
        message: `The site has no language ${locale}.`,
      });
      continue;
    }
    const refused = reads.languageRefusals.get(locale);
    if (refused !== undefined) {
      issues.push({
        path: locale,
        code: "FORBIDDEN",
        locale,
        message: `${languageName(locale)} (${locale}): ${refused}`,
      });
    }
  }
  if (sharedPart && reads.sharedRefusal !== null) {
    issues.push({
      path: SHARED_PATH,
      code: "FORBIDDEN",
      message: `The shared part: ${reads.sharedRefusal}`,
    });
  }
  const parts: PublishPart[] = [
    ...chosen.map(locale => ({ kind: "language" as const, locale })),
    ...(sharedPart ? [{ kind: "shared" as const }] : []),
  ];
  for (const held of await engines.gate.refusals({
    collection: engines.collection,
    entryId: id,
    direction,
    parts,
    userId: engines.userId,
  })) {
    issues.push({
      path: held.part.kind === "shared" ? SHARED_PATH : held.part.locale,
      code: "HELD",
      ...(held.part.kind === "language" ? { locale: held.part.locale } : {}),
      message: held.message,
    });
  }
  if (direction === "unpublish" && sharedPart && !everyLanguage) {
    const stillLive = state.configured.filter(
      locale => !chosen.includes(locale) && state.languages.get(locale)?.live
    );
    if (stillLive.length > 0) {
      issues.push({
        path: SHARED_PATH,
        code: "LANGUAGES_STILL_LIVE",
        message: `The shared part stays live while ${stillLive.map(languageName).join(", ")} ${stillLive.length === 1 ? "is" : "are"} published: unpublish ${stillLive.length === 1 ? "it" : "them"} too, or keep the shared part.`,
      });
    }
  }
  if (direction === "publish") {
    // Each language going live: a chosen one, or, for every language, each stored one. A language
    // already live does not go live again.
    for (const locale of chosen) {
      const stored = state.languages.get(locale);
      if (stored?.live) continue;
      if (everyLanguage && stored === undefined) continue;
      issues.push(...ownValueIssues(state, locale));
    }
  }
  return issues;
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
  const describe = request.describe === true;
  const everyLanguage = request.locales === "all";
  const asked = everyLanguage ? [] : [...new Set(request.locales)];
  // The shared part's rule is asked whether or not the request ends up moving it: whether a first
  // publish adds it is known only once the entry is read.
  const read = await engines.reads({
    locales: asked,
    shared: !everyLanguage,
  });
  if ("success" in read) return read;
  const { state } = read;
  const chosen = everyLanguage ? [...state.configured] : asked;
  // An entry's first publish takes the shared part with it, chosen or not: no language is live
  // while its shared part is not.
  const added =
    !everyLanguage &&
    request.direction === "publish" &&
    !state.sharedLive &&
    request.shared !== true;
  const sharedPart = everyLanguage || request.shared === true || added;

  const issues = await refusalsOf(
    id,
    request,
    chosen,
    sharedPart,
    read,
    engines,
    everyLanguage
  );
  if (issues.length > 0) return refused(issues);

  const parts: LifecycleParts | undefined = everyLanguage
    ? undefined
    : { locales: new Set(chosen), shared: sharedPart };
  const shared = {
    changes:
      sharedPart &&
      (request.direction === "publish" ? !state.sharedLive : state.sharedLive),
    added,
  };

  if (request.direction === "unpublish") {
    const answer: PublishPartsAnswer = {
      id,
      languages: chosen.map(locale => unpublishOutcome(state, locale)),
      shared,
    };
    if (describe) {
      return {
        success: true,
        statusCode: 200,
        message: "What the change does.",
        data: answer,
      };
    }
    const moved = await engines.move("unpublish", parts, false);
    if (!moved.success) return moved;
    return { ...moved, message: "Unpublished.", data: answer };
  }

  const moved = await engines.move("publish", parts, describe);
  if (!moved.success) return moved;
  const data = moved.data as {
    languages?: LanguageOutcome[];
    blockers?: PublishAllBlocker[];
  } | null;
  if (describe && (data?.blockers?.length ?? 0) > 0) {
    return refused(blockerIssues(data?.blockers ?? []));
  }
  return {
    ...moved,
    message: describe ? "What the change does." : "Published.",
    data: {
      id,
      languages: chosenOutcomes(data?.languages ?? [], chosen),
      shared,
    },
  };
}
