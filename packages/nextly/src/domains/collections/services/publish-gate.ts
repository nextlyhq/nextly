/**
 * The question a publish or unpublish asks before it writes anything, of whatever governs
 * publishing beyond access: workflows, say, which hold a part until it is approved.
 *
 * Core asks it; it decides nothing itself. With nothing registered every part may move. A gate is
 * registered in the container as `publishGate`.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module domains/collections/services/publish-gate
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import type { RequestActor } from "../../../auth/request-actor";
import { container } from "../../../di/container";

import type { PublishDirection } from "./publish-parts";

/** One part of an entry a publish or unpublish moves: a language, or the shared part. */
export type PublishPart =
  | { kind: "language"; locale: string }
  | { kind: "shared" };

/**
 * Who asks to move the parts, as a gate decides by it: trusted code (`overrideAccess`), a person,
 * an API key judged on its own grants (with the person who owns it, where one does), or a visitor
 * with neither. A key is never passed off as its owner.
 */
export type PublishCaller =
  | { kind: "trusted" }
  | { kind: "user"; userId: string }
  | { kind: "api-key"; userId?: string; scope: AuthenticatedScope }
  | { kind: "visitor" };

/** What an entry belongs to: a collection, or a Single (whose one entry is its document). */
export interface PublishScope {
  kind: "collection" | "single";
  slug: string;
}

/** What a gate is asked: every part the request would move, the added shared part included. */
export interface PublishGateQuestion {
  scope: PublishScope;
  entryId: string;
  direction: PublishDirection;
  parts: readonly PublishPart[];
  /**
   * The parts live before this move, as core read them: under the entry's row lock when the gate
   * is asked on the move's transaction. A gate tells a part with nothing new to put live from one
   * going live for the first time by it.
   */
  live: { languages: readonly string[]; shared: boolean };
  caller: PublishCaller;
  /**
   * Who makes the move, as the write records it, so what a gate records names the same actor.
   * Absent, a gate names the caller as `caller` describes it.
   */
  actor?: RequestActor;
  /**
   * A publish without review, with the caller's reason, as the request asked for it. A release
   * never asks for it.
   */
  withoutReview?: { reason: string };
}

/** Why a gate holds a part back. */
export type PublishGateRefusalCode = "NOT_APPROVED" | "WITHOUT_REVIEW_REFUSED";

/** A part a gate holds back, and why, as the caller is told. */
export interface PublishGateRefusal {
  part: PublishPart;
  code: PublishGateRefusalCode;
  message: string;
}

/**
 * A gate's answer on the move's own transaction: the parts held back, and what the move must do
 * once it has written the parts.
 */
export interface PublishGateVerdict {
  refusals: readonly PublishGateRefusal[];
  /**
   * Called once by core, on the same transaction, after it has written the parts and before the
   * transaction commits; never for a description, an unpublish or a refused move. It finishes
   * what the gate's judgement started (a workflow closes each published part's review cycle) and
   * throws when what was judged changed since, so the whole move rolls back.
   */
  settle(): Promise<void>;
}

/** Whatever decides, beyond access, whether parts of an entry may move now. */
export interface PublishGate {
  /**
   * The parts held back, or none: an early answer, asked once per request before anything is
   * read under a lock, for a description and an early refusal. The verdict `judge` gives under
   * the lock is the one a move keeps to.
   */
  refusals(
    question: PublishGateQuestion
  ): Promise<readonly PublishGateRefusal[]>;
  /**
   * The verdict on the move's own transaction, asked after the entry's row is locked. A gate
   * reads only on `tx` and never opens a transaction of its own: a nested one cannot see the
   * move's writes on PostgreSQL and MySQL, and waits behind it on SQLite.
   */
  judge(
    tx: TransactionContext,
    question: PublishGateQuestion
  ): Promise<PublishGateVerdict>;
}

/** The verdict that holds nothing back and has nothing to finish. */
const NOTHING_HELD: PublishGateVerdict = {
  refusals: [],
  settle: () => Promise.resolve(),
};

/** The gate when none is registered: every part may move. */
const OPEN_GATE: PublishGate = {
  refusals: () => Promise.resolve([]),
  judge: () => Promise.resolve(NOTHING_HELD),
};

/** The gate publishing asks: the registered one, else one that holds nothing back. */
export function publishGate(): PublishGate {
  return container.has("publishGate")
    ? container.get<PublishGate>("publishGate")
    : OPEN_GATE;
}
