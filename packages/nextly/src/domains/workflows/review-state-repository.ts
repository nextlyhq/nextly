/**
 * Read and write a workflow's review state, one row per document and part: a language, or the
 * shared part (`nextly_review_states`).
 *
 * Every function takes the database it runs on, the adapter or the caller's transaction, so a step
 * and the content write it belongs to land together. A write is a compare-and-set on the row's
 * `revision`: it says whether it matched, and one that did not changed nothing.
 *
 * @module domains/workflows/review-state-repository
 */
import { createHash } from "node:crypto";

import type {
  WhereClause,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";

import { REVIEW_STATES_TABLE } from "../../schemas/review-states";
import type {
  ReviewAssigneeKind,
  ReviewScopeKind,
} from "../../schemas/review-states/types";

/** A document a workflow is attached to: a collection's entry, or a Single. */
export interface ReviewDocument {
  scopeKind: ReviewScopeKind;
  scopeSlug: string;
  entryId: string;
}

/** One part of a document: a language, or null for the shared part. */
export interface ReviewPart extends ReviewDocument {
  part: string | null;
}

/** Who a part is assigned to. */
export interface ReviewAssignee {
  kind: ReviewAssigneeKind;
  id: string;
}

/** The approval a part holds. */
export interface ReviewApproval {
  /** The `versionNo` of the recorded version the reviewer was shown. */
  versionNo: number;
  digest: string;
  by: string;
  at: Date;
}

/** A part's review state as stored. */
export interface ReviewState extends ReviewPart {
  stage: string;
  enteredAt: Date;
  enteredBy: string | null;
  assignee: ReviewAssignee | null;
  dueAt: Date | null;
  approval: ReviewApproval | null;
  definitionHash: string;
  revision: number;
}

/** What a step changes on a part. Left out, a value stays as it is. */
export type ReviewStateChange = Partial<
  Pick<
    ReviewState,
    | "stage"
    | "enteredAt"
    | "enteredBy"
    | "assignee"
    | "dueAt"
    | "approval"
    | "definitionHash"
  >
>;

/** The database surface these need: the adapter, or a transaction's context, which has the same. */
export interface ReviewStatesDb {
  select<T = unknown>(
    table: string,
    options?: { where?: WhereClause; limit?: number }
  ): Promise<T[]>;
  insert<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    options?: { returning?: string[] | "*" }
  ): Promise<T>;
  updateCount(
    table: string,
    data: Record<string, unknown>,
    where: WhereClause
  ): Promise<number>;
  delete(table: string, where: WhereClause): Promise<number>;
}

/** A row as the adapter reads it, by property name. */
interface ReviewStateRow {
  scopeKind: ReviewScopeKind;
  scopeSlug: string;
  entryId: string;
  part: string | null;
  stage: string;
  enteredAt: Date | string | number;
  enteredBy: string | null;
  assigneeKind: ReviewAssigneeKind | null;
  assigneeId: string | null;
  dueAt: Date | string | number | null;
  approvedVersionNo: number | string | null;
  approvedDigest: string | null;
  approvedBy: string | null;
  approvedAt: Date | string | number | null;
  definitionHash: string;
  revision: number | string;
}

/**
 * The digest one row per document and part is enforced on. A digest because a null part cannot sit
 * in a unique index on every dialect, and the readable composite would pass MySQL's key limit. A
 * null part and a part named "" stay distinct.
 */
export function reviewStateKey(part: ReviewPart): string {
  const joined = [
    part.scopeKind,
    part.scopeSlug,
    part.entryId,
    part.part === null ? "-" : `=${part.part}`,
  ]
    .map(encodeURIComponent)
    .join(":");
  return createHash("sha256").update(joined, "utf8").digest("hex");
}

/** A part's review state, or null when it has none, which reads as the workflow's first stage. */
export async function readReviewState(
  db: ReviewStatesDb,
  part: ReviewPart
): Promise<ReviewState | null> {
  const [row] = await db.select<ReviewStateRow>(REVIEW_STATES_TABLE, {
    where: {
      and: [{ column: "partKey", op: "=", value: reviewStateKey(part) }],
    },
    limit: 1,
  });
  return row ? fromRow(row) : null;
}

/** Every part of a document that has a review state. */
export async function readDocumentReviewStates(
  db: ReviewStatesDb,
  document: ReviewDocument
): Promise<ReviewState[]> {
  const rows = await db.select<ReviewStateRow>(REVIEW_STATES_TABLE, {
    where: documentWhere(document),
  });
  return rows.map(fromRow);
}

/**
 * Gives a part its first review state, at revision 1. Refused by the unique index when the part
 * already has one, so two callers starting the same part do not both succeed.
 */
export async function createReviewState(
  db: ReviewStatesDb,
  part: ReviewPart,
  state: Pick<ReviewState, "stage" | "enteredAt" | "definitionHash"> &
    ReviewStateChange
): Promise<ReviewState> {
  const now = new Date();
  await db.insert(REVIEW_STATES_TABLE, {
    id: crypto.randomUUID(),
    scopeKind: part.scopeKind,
    scopeSlug: part.scopeSlug,
    entryId: part.entryId,
    part: part.part,
    partKey: reviewStateKey(part),
    enteredBy: null,
    ...toColumns({
      assignee: null,
      dueAt: null,
      approval: null,
      ...state,
    }),
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  return {
    ...part,
    enteredBy: null,
    assignee: null,
    dueAt: null,
    approval: null,
    ...state,
    revision: 1,
  };
}

/**
 * Applies `change` to a part's review state if its revision is still `expectedRevision`, raising
 * it by one. False, changing nothing, when someone wrote the row since or it is gone.
 */
export async function updateReviewState(
  db: ReviewStatesDb,
  part: ReviewPart,
  expectedRevision: number,
  change: ReviewStateChange
): Promise<boolean> {
  const affected = await db.updateCount(
    REVIEW_STATES_TABLE,
    {
      ...toColumns(change),
      // Always moves, so MySQL, which counts changed rows rather than matched ones, reports a write
      // that changes nothing else as the write it is rather than as a miss.
      revision: expectedRevision + 1,
      updatedAt: new Date(),
    },
    {
      and: [
        { column: "partKey", op: "=", value: reviewStateKey(part) },
        { column: "revision", op: "=", value: expectedRevision },
      ],
    }
  );
  return affected > 0;
}

/**
 * The review states of every document of a collection or Single that also meet `conditions`, in
 * one read: what a sweep over one collection's documents reads, rather than a read per document.
 */
export async function readEntityReviewStates(
  db: ReviewStatesDb,
  entity: Pick<ReviewDocument, "scopeKind" | "scopeSlug">,
  conditions: readonly WhereCondition[] = []
): Promise<ReviewState[]> {
  const rows = await db.select<ReviewStateRow>(REVIEW_STATES_TABLE, {
    where: {
      and: [
        { column: "scopeKind", op: "=", value: entity.scopeKind },
        { column: "scopeSlug", op: "=", value: entity.scopeSlug },
        ...conditions,
      ],
    },
  });
  return rows.map(fromRow);
}

/**
 * The review states of every document of a collection or Single other than those `attached`
 * names, in one read: the states a workflow no longer covers.
 */
export async function readReviewStatesOutside(
  db: ReviewStatesDb,
  attached: { collections: readonly string[]; singles: readonly string[] }
): Promise<ReviewState[]> {
  // An empty list names no scope, and `NOT IN ()` is no condition every dialect accepts.
  const outside = (
    scopeKind: ReviewScopeKind,
    slugs: readonly string[]
  ): WhereClause => ({
    and: [
      { column: "scopeKind", op: "=", value: scopeKind },
      ...(slugs.length > 0
        ? [{ column: "scopeSlug", op: "NOT IN" as const, value: [...slugs] }]
        : []),
    ],
  });
  const rows = await db.select<ReviewStateRow>(REVIEW_STATES_TABLE, {
    where: {
      or: [
        outside("collection", attached.collections),
        outside("single", attached.singles),
      ],
    },
  });
  return rows.map(fromRow);
}

/**
 * Points every review state of a collection or Single written under `from` at the definition
 * hash `to`, leaving the rest of each row as it is. Answers how many moved.
 */
export function restampReviewStates(
  db: ReviewStatesDb,
  entity: Pick<ReviewDocument, "scopeKind" | "scopeSlug">,
  from: string,
  to: string
): Promise<number> {
  return db.updateCount(
    REVIEW_STATES_TABLE,
    { definitionHash: to, updatedAt: new Date() },
    {
      and: [
        { column: "scopeKind", op: "=", value: entity.scopeKind },
        { column: "scopeSlug", op: "=", value: entity.scopeSlug },
        { column: "definitionHash", op: "=", value: from },
      ],
    }
  );
}

/** Removes one part's review state. Answers how many rows went: 1, or 0 when it had none. */
export function deletePartReviewState(
  db: ReviewStatesDb,
  part: ReviewPart
): Promise<number> {
  return db.delete(REVIEW_STATES_TABLE, {
    and: [{ column: "partKey", op: "=", value: reviewStateKey(part) }],
  });
}

/** Removes the review state of every part of a document. */
export function deleteDocumentReviewStates(
  db: ReviewStatesDb,
  document: ReviewDocument
): Promise<number> {
  return db.delete(REVIEW_STATES_TABLE, documentWhere(document));
}

/** Removes the review state of every document of a collection or Single. */
export function deleteEntityReviewStates(
  db: ReviewStatesDb,
  entity: Pick<ReviewDocument, "scopeKind" | "scopeSlug">
): Promise<number> {
  return db.delete(REVIEW_STATES_TABLE, {
    and: [
      { column: "scopeKind", op: "=", value: entity.scopeKind },
      { column: "scopeSlug", op: "=", value: entity.scopeSlug },
    ],
  });
}

function documentWhere(document: ReviewDocument): WhereClause {
  return {
    and: [
      { column: "scopeKind", op: "=", value: document.scopeKind },
      { column: "scopeSlug", op: "=", value: document.scopeSlug },
      { column: "entryId", op: "=", value: document.entryId },
    ],
  };
}

/** The columns `change` sets, by property name; the assignee and approval each as their columns. */
function toColumns(change: ReviewStateChange): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  if (change.stage !== undefined) columns.stage = change.stage;
  if (change.enteredAt !== undefined) columns.enteredAt = change.enteredAt;
  if (change.enteredBy !== undefined) columns.enteredBy = change.enteredBy;
  if (change.dueAt !== undefined) columns.dueAt = change.dueAt;
  if (change.definitionHash !== undefined) {
    columns.definitionHash = change.definitionHash;
  }
  if (change.assignee !== undefined) {
    columns.assigneeKind = change.assignee?.kind ?? null;
    columns.assigneeId = change.assignee?.id ?? null;
  }
  if (change.approval !== undefined) {
    columns.approvedVersionNo = change.approval?.versionNo ?? null;
    columns.approvedDigest = change.approval?.digest ?? null;
    columns.approvedBy = change.approval?.by ?? null;
    columns.approvedAt = change.approval?.at ?? null;
  }
  return columns;
}

/** Dialects return a timestamp as a Date, an ISO string or epoch milliseconds. */
function asDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function fromRow(row: ReviewStateRow): ReviewState {
  return {
    scopeKind: row.scopeKind,
    scopeSlug: row.scopeSlug,
    entryId: row.entryId,
    part: row.part,
    stage: row.stage,
    enteredAt: asDate(row.enteredAt),
    enteredBy: row.enteredBy,
    assignee:
      row.assigneeKind !== null && row.assigneeId !== null
        ? { kind: row.assigneeKind, id: row.assigneeId }
        : null,
    dueAt: row.dueAt === null ? null : asDate(row.dueAt),
    approval:
      row.approvedVersionNo !== null &&
      row.approvedDigest !== null &&
      row.approvedBy !== null &&
      row.approvedAt !== null
        ? {
            versionNo: Number(row.approvedVersionNo),
            digest: row.approvedDigest,
            by: row.approvedBy,
            at: asDate(row.approvedAt),
          }
        : null,
    definitionHash: row.definitionHash,
    revision: Number(row.revision),
  };
}
