/**
 * The publish gate, asked of a save that names a status: the same judgement a publish of chosen
 * parts is given, early and again on the save's own transaction once its entry is locked, and
 * settled before that transaction commits. A save that names a status changes what readers see,
 * so it may not go past what holds a publish back.
 *
 * Which parts a save moves follows from its status and the language it writes: one language, and
 * the shared part with it where that language is the default (whose save moves the entry's own
 * status) or where the entry is not translated; every language and the shared part for a save to
 * every language.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module domains/collections/services/save-door-gate
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { z } from "zod";

import type { RequestActor } from "../../../auth/request-actor";
import { NextlyError } from "../../../errors/nextly-error";
import type { ValidationPublicData } from "../../../errors/public-data";
import type { VersionsDbApi } from "../../versions/db-api";
import { SHARED_DRAFT_SLOT } from "../../versions/part-drafts";
import {
  type VersionRef,
  VersionsRepository,
} from "../../versions/versions-repository";

import type {
  PublishCaller,
  PublishGateQuestion,
  PublishGateRefusal,
  PublishGateVerdict,
  PublishPart,
  PublishScope,
} from "./publish-gate";
import { publishGate } from "./publish-gate";
import type { PublishDirection } from "./publish-parts";

/** A save's own facts the gate's question is built from. */
export interface StatusSave {
  scope: PublishScope;
  entryId: string;
  /** The status the save names. */
  status: string;
  /** The language the save writes; the every-language key for all of them; absent for none. */
  locale: string | undefined;
  /** Whether the save writes every language. */
  everyLanguage: boolean;
  /** Whether the document keeps values per language. */
  translated: boolean;
  configured: readonly string[];
  defaultLocale: string | undefined;
  caller: PublishCaller;
  actor?: RequestActor;
  withoutReview?: { reason: string };
  /**
   * Whether a draft the save puts live holds the shared part (`draftSlotParts`): the shared draft
   * kept apart, or a language's draft holding the whole document. The shared part then moves too.
   */
  sharedDraftPending?: boolean;
  /**
   * For a save of every language that publishes, the languages it moves: one holding nothing, or
   * live with no change, stays as it is and is not asked about. Every configured one where absent.
   */
  languagesMoved?: readonly string[];
}

/** The parts a status save moves, and which way. */
export function partsOfStatusSave(save: StatusSave): {
  direction: PublishDirection;
  parts: PublishPart[];
} {
  const direction: PublishDirection =
    save.status === "published" ? "publish" : "unpublish";
  if (!save.translated) return { direction, parts: [{ kind: "shared" }] };
  const languages = save.everyLanguage
    ? (save.languagesMoved ?? save.configured)
    : [save.locale ?? save.defaultLocale].filter(
        (locale): locale is string => locale !== undefined
      );
  const movesShared =
    save.everyLanguage ||
    save.locale === undefined ||
    save.locale === save.defaultLocale ||
    (direction === "publish" && save.sharedDraftPending === true);
  return {
    direction,
    parts: [
      ...languages.map(locale => ({ kind: "language" as const, locale })),
      ...(movesShared ? [{ kind: "shared" as const }] : []),
    ],
  };
}

/** The gate's refusals as a validation error, one issue per part held back. */
function refusalOf(refusals: readonly PublishGateRefusal[]): NextlyError {
  const errors: ValidationPublicData["errors"] = refusals.map(
    ({ part, code, message }) =>
      part.kind === "shared"
        ? { path: "shared", code, message }
        : { path: part.locale, code, locale: part.locale, message }
  );
  return NextlyError.validation({ errors });
}

/**
 * The gate's early answer to a move, asked before the move runs any hook or writes anything:
 * throws the refusal where a part is held back. An unpublish is never gated.
 */
export async function refusePublishEarly(
  question: PublishGateQuestion
): Promise<void> {
  if (question.direction !== "publish") return;
  const refusals = await publishGate().refusals(question);
  if (refusals.length > 0) throw refusalOf(refusals);
}

/**
 * Whether a document holds a pending shared draft, as `reader` reads it: on the pool for an early
 * answer, on a write's transaction under its row lock for the verdict.
 */
export async function sharedDraftPendingOn(
  reader: VersionsDbApi,
  ref: VersionRef
): Promise<boolean> {
  return (
    (await new VersionsRepository(reader).findWorkingDraft(
      ref,
      SHARED_DRAFT_SLOT
    )) !== undefined
  );
}

/** What the gate is asked of a status save, given what was live as it was read. */
function questionOf(
  save: StatusSave,
  live: { languages: readonly string[]; shared: boolean }
) {
  const { direction, parts } = partsOfStatusSave(save);
  return {
    scope: save.scope,
    entryId: save.entryId,
    direction,
    parts,
    live,
    caller: save.caller,
    ...(save.actor === undefined ? {} : { actor: save.actor }),
    ...(save.withoutReview === undefined
      ? {}
      : { withoutReview: save.withoutReview }),
  };
}

/**
 * The gate's early answer to a status save, before its transaction opens: throws the refusal where
 * a part is held back.
 */
export async function refuseStatusSaveEarly(
  save: StatusSave,
  live: { languages: readonly string[]; shared: boolean }
): Promise<void> {
  await refusePublishEarly(questionOf(save, live));
}

/**
 * The gate's verdict on a status save, on its own transaction once the entry is locked: throws the
 * refusal where a part is held back, else returns what to settle before the transaction commits.
 * An unpublish is never gated: it is not asked, and has nothing to settle.
 */
export async function judgeStatusSave(
  tx: TransactionContext,
  save: StatusSave,
  live: { languages: readonly string[]; shared: boolean }
): Promise<() => Promise<void>> {
  const question = questionOf(save, live);
  // Unpublishing is never gated: nothing is asked, and nothing settled.
  if (question.direction !== "publish") return () => Promise.resolve();
  const verdict: PublishGateVerdict = await publishGate().judge(tx, question);
  if (verdict.refusals.length > 0) throw refusalOf(verdict.refusals);
  return () => verdict.settle();
}

/**
 * The key a save names a publish made without review under, beside its values. A system key, as
 * `_rev` and `_overwrite` are, so it can never be taken for a field of the author's own: a
 * collection may have a field called `withoutReview`. A publish or unpublish of chosen parts names
 * it `withoutReview`, since its body is no document.
 */
export const WITHOUT_REVIEW_KEY = "_withoutReview";

const WithoutReview = z
  .object({ reason: z.string().trim().min(1).max(2000) })
  .strict();

/**
 * A save's publish made without review, and why, read off its body at the boundary: told to the
 * publish gate, never stored. Absent where the body does not name one; a malformed one is refused.
 */
export function withoutReviewOfBody(
  body: Readonly<Record<string, unknown>>
): { reason: string } | undefined {
  if (!(WITHOUT_REVIEW_KEY in body) || body[WITHOUT_REVIEW_KEY] === undefined) {
    return undefined;
  }
  const parsed = WithoutReview.safeParse(body[WITHOUT_REVIEW_KEY]);
  if (parsed.success) return parsed.data;
  throw NextlyError.validation({
    errors: [
      {
        path: WITHOUT_REVIEW_KEY,
        code: "INVALID_WITHOUT_REVIEW",
        message:
          "A publish made without review names its reason: { reason: string }.",
      },
    ],
  });
}
