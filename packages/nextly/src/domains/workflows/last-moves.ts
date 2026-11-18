/**
 * Each part's last move, as the review state read names it: the latest workflow event in the record
 * of content events that involved the part, in the document's current life. An assignment is left
 * out, since it moves nothing; every other workflow event (a step, a withdrawn approval, a deploy
 * that renamed or removed a stage, a discard, a publish closing review) moved the part or closed
 * its review.
 *
 * Read on the caller's transaction, so it agrees with the review state read beside it, in two
 * statements for the whole document: the latest event's id for each part, then those events.
 *
 * @module domains/workflows/last-moves
 * @experimental
 */
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";
import { and, eq, inArray, isNull, like, max, ne } from "drizzle-orm";

import {
  contentEventsTables,
  SHARED_PART,
  type ContentEventActorKind,
} from "../../schemas/content-events";
import type { ContentEventActor } from "../content-events/actor";

import type { ReviewDocument } from "./review-state-repository";
import { workflowEventKind } from "./steps";

/**
 * A part's last move: the kind it was recorded as (`workflow-submit`), who made it and when, the
 * stages it moved from and to, and the comment given with it.
 *
 * @experimental
 */
export interface LastMove {
  kind: string;
  actor: ContentEventActor;
  at: Date;
  /** Null where the event names no single stage it left. */
  from: string | null;
  /** Null where the part's review state went with the move (a discard, a detach). */
  to: string | null;
  comment: string | null;
}

/** The kinds every workflow event is named with: `workflow-` and its own name. */
const WORKFLOW_KINDS = "workflow-%";

/** A stored event, as the read selects it. */
interface MoveRow {
  id: string;
  kind: string;
  actorKind: ContentEventActorKind;
  actorId: string | null;
  actorPrincipalKind: string | null;
  actorName: string | null;
  occurredAt: Date | string | number;
  fromState: string | null;
  toState: string | null;
  note: string | null;
}

type Rows<T> = Promise<T[]>;

/** The Drizzle query builders this read uses, in the form all three dialects share. */
interface MovesDb {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      innerJoin(
        table: unknown,
        on: unknown
      ): {
        where(condition: unknown): {
          groupBy(column: unknown): Rows<Record<string, unknown>>;
        };
      };
      where(condition: unknown): Rows<Record<string, unknown>>;
    };
  };
}

/**
 * The last move of each part of `document` that has one, keyed by part (null for the shared
 * part), read on `tx`.
 *
 * @experimental
 */
export async function lastMovesOn(
  tx: TransactionContext,
  dialect: SupportedDialect,
  document: ReviewDocument
): Promise<Map<string | null, LastMove>> {
  const { nextlyContentEvents: e, nextlyContentEventParts: p } =
    contentEventsTables(dialect);
  const db = tx.getDrizzle<MovesDb>();
  // The latest event's id for each part: ids are time-ordered, so the greatest is the latest.
  const latest = await db
    .select({ part: p.part, id: max(e.id) })
    .from(e)
    .innerJoin(p, eq(p.eventId, e.id))
    .where(
      and(
        eq(e.subjectKind, document.scopeKind),
        eq(e.subjectSlug, document.scopeSlug),
        eq(e.subjectId, document.entryId),
        isNull(e.endedBy),
        like(e.kind, WORKFLOW_KINDS),
        ne(e.kind, workflowEventKind("assign"))
      )
    )
    .groupBy(p.part);
  const partsOf = new Map<string, (string | null)[]>();
  for (const row of latest) {
    if (typeof row.id !== "string") continue;
    const part = String(row.part);
    partsOf.set(row.id, [
      ...(partsOf.get(row.id) ?? []),
      part === SHARED_PART ? null : part,
    ]);
  }
  const moves = new Map<string | null, LastMove>();
  if (partsOf.size === 0) return moves;
  const events = (await db
    .select({
      id: e.id,
      kind: e.kind,
      actorKind: e.actorKind,
      actorId: e.actorId,
      actorPrincipalKind: e.actorPrincipalKind,
      actorName: e.actorName,
      occurredAt: e.occurredAt,
      fromState: e.fromState,
      toState: e.toState,
      note: e.note,
    })
    .from(e)
    .where(inArray(e.id, [...partsOf.keys()]))) as unknown as MoveRow[];
  for (const event of events) {
    const move: LastMove = {
      kind: event.kind,
      actor: actorOf(event),
      at:
        event.occurredAt instanceof Date
          ? event.occurredAt
          : new Date(event.occurredAt),
      from: event.fromState,
      to: event.toState,
      comment: event.note,
    };
    for (const part of partsOf.get(event.id) ?? []) moves.set(part, move);
  }
  return moves;
}

/** The actor as the event was recorded with it. */
function actorOf(row: MoveRow): ContentEventActor {
  const name = row.actorName;
  if (row.actorKind === "system") return { kind: "system", name };
  if (row.actorKind === "principal") {
    return {
      kind: "principal",
      principalKind: row.actorPrincipalKind ?? "",
      id: row.actorId ?? "",
      name,
    };
  }
  return { kind: row.actorKind, id: row.actorId ?? "", name };
}
