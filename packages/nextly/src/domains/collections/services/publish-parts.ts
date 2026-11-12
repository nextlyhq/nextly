/**
 * Publishing or unpublishing the parts of an entry a caller chooses: some of its languages, or
 * every one, and its shared part. One request, one answer: described without changing anything,
 * or applied, and everything chosen moves or nothing does.
 *
 * What it decides, before anything is written:
 * - every refusal, collected rather than the first: each language's own publish rule and
 *   validation, the shared part's rule (asked as every language, since every language shows it),
 *   whatever governs publishing beyond access (`publishGate`), a unique translated field with no
 *   value of its own in a language going live, and, where the collection requires it, a required
 *   translated field with no value of its own;
 * - the shared part goes live with an entry's first language, chosen or not, and cannot be taken
 *   down while a language the request does not name stays live.
 *
 * The writes themselves are each language's own publish, run together in one transaction: a dry
 * run of them, rolled back, finds their refusals, and the same writes, committed, apply the
 * request. So what a request says it would do and what it does come from one implementation.
 *
 * @experimental The request and its answer may change until publishing per language is complete.
 *
 * @module domains/collections/services/publish-parts
 */
import { NextlyError } from "../../../errors/nextly-error";
import type { ValidationPublicData } from "../../../errors/public-data";
import type { LanguageOutcome } from "../../versions/publish-all-plan";

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

/** The writes a request is carried out with, inside one transaction. */
export interface PartWrites {
  /** One language's own publish or unpublish, as an update in that language makes it. */
  language(
    direction: PublishDirection,
    locale: string
  ): Promise<CollectionServiceResult>;
  /** The shared part's publishing state: the entry's own. */
  shared(direction: PublishDirection): Promise<void>;
}

/** What a request is carried out with, bound to the entry and the caller. */
export interface PublishPartsEngines {
  /** Every language at once, or what doing so would do. */
  everyLanguage(
    direction: PublishDirection,
    describe: boolean
  ): Promise<CollectionServiceResult>;
  /** The entry before the request, or why it cannot be read. */
  state(): Promise<PartsState | CollectionServiceResult>;
  /** Why the caller may not move this language, or null. */
  languageRefusal(
    direction: PublishDirection,
    locale: string
  ): Promise<string | null>;
  /** Why the caller may not move the shared part, or null. */
  sharedRefusal(direction: PublishDirection): Promise<string | null>;
  gate: PublishGate;
  /** The entry's collection and the caller, for the gate. */
  collection: string;
  userId?: string;
  /**
   * `work` in one transaction: committed when `commit` is true and `work` refuses nothing (an
   * empty list), rolled back otherwise. A dry run runs no hooks and leaves nothing behind.
   */
  transaction(
    commit: boolean,
    work: (writes: PartWrites) => Promise<Issue[]>
  ): Promise<Issue[]>;
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

/** The outcome a publish or unpublish has on one language, from the state before it. */
function outcomeOf(
  state: PartsState,
  direction: PublishDirection,
  locale: string
): PartOutcome {
  const stored = state.languages.get(locale);
  if (direction === "unpublish") {
    return {
      locale,
      outcome: stored?.live ? "taken-down" : "stays-unpublished",
    };
  }
  if (stored?.live) return { locale, outcome: "stays-published" };
  if (stored === undefined && locale !== state.defaultLocale) {
    return { locale, outcome: "shows-fallback", fallback: state.defaultLocale };
  }
  return { locale, outcome: "goes-live" };
}

/** Every refusal of the request, before anything is written. */
async function refusalsOf(
  id: string,
  request: PublishPartsRequest,
  chosen: readonly string[],
  sharedPart: boolean,
  state: PartsState,
  engines: PublishPartsEngines
): Promise<Issue[]> {
  const { direction } = request;
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
    const refused = await engines.languageRefusal(direction, locale);
    if (refused !== null) {
      issues.push({
        path: locale,
        code: "FORBIDDEN",
        locale,
        message: refused,
      });
    }
  }
  if (sharedPart) {
    const refused = await engines.sharedRefusal(direction);
    if (refused !== null) {
      issues.push({
        path: SHARED_PATH,
        code: "FORBIDDEN",
        message: `The shared part: ${refused}`,
      });
    }
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
  if (direction === "unpublish" && sharedPart) {
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
    for (const locale of chosen) issues.push(...ownValueIssues(state, locale));
  }
  return issues;
}

/** Each language's write, the shared part's after them; each refusal collected, none thrown. */
async function writeAll(
  writes: PartWrites,
  direction: PublishDirection,
  chosen: readonly string[],
  sharedPart: boolean
): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const locale of chosen) {
    const result = await writes.language(direction, locale);
    if (!result.success) {
      issues.push({
        path: locale,
        code: "REFUSED",
        locale,
        message: `${languageName(locale)} (${locale}): ${result.message ?? "refused."}`,
      });
    }
  }
  if (sharedPart && issues.length === 0) await writes.shared(direction);
  return issues;
}

function refused(issues: Issue[]): CollectionServiceResult {
  const error = NextlyError.validation({ errors: issues });
  return {
    success: false,
    statusCode: 400,
    message: issues.map(issue => issue.message).join(" "),
    data: null,
    error,
  } as CollectionServiceResult;
}

/**
 * Carry out `request` on entry `id`: every language through the every-language engine, a list of
 * languages as one transaction of their own publishes, everything refused before anything moves.
 */
export async function publishParts(
  id: string,
  request: PublishPartsRequest,
  engines: PublishPartsEngines
): Promise<
  CollectionServiceResult<PublishPartsAnswer> | CollectionServiceResult
> {
  const describe = request.describe === true;
  if (request.locales === "all") {
    const result = await engines.everyLanguage(request.direction, describe);
    if (!result.success) return result;
    const data = result.data as { languages?: LanguageOutcome[] } | null;
    return {
      ...result,
      data: {
        id,
        languages: data?.languages ?? [],
        shared: { changes: true, added: false },
      },
    };
  }
  const read = await engines.state();
  if ("success" in read) return read;
  const state = read;
  const chosen = [...new Set(request.locales)];
  // An entry's first publish takes the shared part with it, chosen or not: no language is live
  // while its shared part is not.
  const added =
    request.direction === "publish" &&
    !state.sharedLive &&
    request.shared !== true;
  const sharedPart = request.shared === true || added;

  const issues = await refusalsOf(
    id,
    request,
    chosen,
    sharedPart,
    state,
    engines
  );
  // The writes' own refusals, found by running them and rolling back, so every language's is
  // known before any language moves.
  issues.push(
    ...(await engines.transaction(false, writes =>
      writeAll(writes, request.direction, chosen, sharedPart)
    ))
  );
  if (issues.length > 0) return refused(issues);

  const answer: PublishPartsAnswer = {
    id,
    languages: chosen.map(locale =>
      outcomeOf(state, request.direction, locale)
    ),
    shared: {
      changes:
        sharedPart &&
        (request.direction === "publish"
          ? !state.sharedLive
          : state.sharedLive),
      added,
    },
  };
  if (describe) {
    return {
      success: true,
      statusCode: 200,
      message: "What the change does.",
      data: answer,
    };
  }
  const late = await engines.transaction(true, writes =>
    writeAll(writes, request.direction, chosen, sharedPart)
  );
  if (late.length > 0) return refused(late);
  return {
    success: true,
    statusCode: 200,
    message: request.direction === "publish" ? "Published." : "Unpublished.",
    data: answer,
  };
}
