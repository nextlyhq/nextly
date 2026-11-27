/**
 * Reading and removing the trash's records.
 *
 * A record leaves the trash for good when it is emptied or when its purge
 * date passes. The item's history, kept whole while it was in the trash,
 * ends then: its `deleted` event is recorded, and the history is kept for
 * the activity log's window from it, as a delete's always was.
 *
 * @module domains/trash/trash-records
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  TransactionContext,
  WhereClause,
} from "@nextlyhq/adapter-drizzle/types";

import { SYSTEM_ACTOR, type RequestActor } from "../../auth/request-actor";
import {
  TRASH_TABLE,
  type TrashedEntry,
  type TrashKind,
} from "../../schemas/trash";
import { recordWriteEvent } from "../content-events/write-event";

/** One trash record, its stored rows parsed. */
export interface TrashRecord {
  id: string;
  kind: TrashKind;
  scopeSlug: string;
  itemId: string;
  label: string | null;
  stored: TrashedEntry;
  trashedByKind: string | null;
  trashedById: string | null;
  trashedByName: string | null;
  trashedAt: Date;
  purgeAt: Date;
}

/** A record as a list shows it: everything but its stored rows. */
export type TrashListItem = Omit<TrashRecord, "stored">;

/** The columns a list reads: never the stored rows, which can be large. */
const LIST_COLUMNS = [
  "id",
  "kind",
  "scopeSlug",
  "itemId",
  "label",
  "trashedByKind",
  "trashedById",
  "trashedByName",
  "trashedAt",
  "purgeAt",
] as const;

/** A read the pool and a transaction both answer. */
type TrashReader = Pick<TransactionContext, "select">;

/** A date column as a `Date`, whichever way the driver gave it. */
function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

/** A row of the list's columns, typed. */
function listItemOf(row: Record<string, unknown>): TrashListItem {
  return {
    id: String(row.id),
    kind: row.kind as TrashKind,
    scopeSlug: String(row.scopeSlug),
    itemId: String(row.itemId),
    label: (row.label as string | null) ?? null,
    trashedByKind: (row.trashedByKind as string | null) ?? null,
    trashedById: (row.trashedById as string | null) ?? null,
    trashedByName: (row.trashedByName as string | null) ?? null,
    trashedAt: asDate(row.trashedAt),
    purgeAt: asDate(row.purgeAt),
  };
}

/** The record `trashId`, its stored rows parsed; undefined when not there. */
export async function readTrashRecord(
  db: TrashReader,
  trashId: string
): Promise<TrashRecord | undefined> {
  const [row] = await db.select<Record<string, unknown>>(TRASH_TABLE, {
    where: { and: [{ column: "id", op: "=", value: trashId }] },
    limit: 1,
  });
  if (row === undefined) return undefined;
  // SQLite keeps the JSON as text.
  const stored = (
    typeof row.stored === "string" ? JSON.parse(row.stored) : row.stored
  ) as TrashedEntry;
  return { ...listItemOf(row), stored };
}

/** Which records a list or an emptying takes. */
export interface TrashSelection {
  /** The collections it takes; every collection where left out. */
  collections?: readonly string[];
  /** The item ids it takes; every item where left out. */
  itemIds?: readonly string[];
  /** The record ids it takes; every record where left out. */
  ids?: readonly string[];
  /** Only records whose purge date is at or before this. */
  purgeDueBy?: Date;
}

/** The where clause of `selection`; undefined for the whole trash. */
function whereOf(selection: TrashSelection): WhereClause | undefined {
  const and: NonNullable<WhereClause["and"]> = [];
  if (selection.collections !== undefined) {
    and.push({ column: "scopeSlug", op: "IN", value: [...selection.collections] });
  }
  if (selection.itemIds !== undefined) {
    and.push({ column: "itemId", op: "IN", value: [...selection.itemIds] });
  }
  if (selection.ids !== undefined) {
    and.push({ column: "id", op: "IN", value: [...selection.ids] });
  }
  if (selection.purgeDueBy !== undefined) {
    and.push({ column: "purgeAt", op: "<=", value: selection.purgeDueBy });
  }
  return and.length === 0 ? undefined : { and };
}

/** Whether a selection names an empty set of something, so takes nothing. */
function selectsNothing(selection: TrashSelection): boolean {
  return (
    selection.collections?.length === 0 ||
    selection.itemIds?.length === 0 ||
    selection.ids?.length === 0
  );
}

/** A page of the trash, newest first, with how many records it holds. */
export async function listTrash(
  db: Pick<DrizzleAdapter, "select" | "count">,
  selection: TrashSelection,
  page: { limit: number; offset: number }
): Promise<{ items: TrashListItem[]; total: number }> {
  if (selectsNothing(selection)) return { items: [], total: 0 };
  const where = whereOf(selection);
  const rows = await db.select<Record<string, unknown>>(TRASH_TABLE, {
    columns: [...LIST_COLUMNS],
    ...(where === undefined ? {} : { where }),
    orderBy: [
      { column: "trashedAt", direction: "desc" },
      { column: "id", direction: "asc" },
    ],
    limit: page.limit,
    offset: page.offset,
  });
  const total = await db.count(
    TRASH_TABLE,
    where === undefined ? undefined : { where }
  );
  return { items: rows.map(listItemOf), total };
}

/** Records removed per transaction, so one emptying never holds a long lock. */
const REMOVE_BATCH = 100;

/** What removing records for good records, and by whom. */
export interface RemoveFromTrashOptions {
  /** Who emptied the trash; the system for the daily clean-up. */
  actor?: RequestActor;
  actorName?: string | null;
}

/**
 * Remove the records `selection` takes for good, in batches, recording each
 * entry's `deleted` event in the same transaction as its record's removal.
 * Returns the records removed.
 */
export async function removeFromTrash(
  db: Pick<DrizzleAdapter, "select" | "transaction" | "getCapabilities">,
  selection: TrashSelection,
  options: RemoveFromTrashOptions = {}
): Promise<TrashListItem[]> {
  if (selectsNothing(selection)) return [];
  const removed: TrashListItem[] = [];
  const where = whereOf(selection);
  for (;;) {
    const batch = await db.select<Record<string, unknown>>(TRASH_TABLE, {
      columns: [...LIST_COLUMNS],
      ...(where === undefined ? {} : { where }),
      orderBy: [{ column: "id", direction: "asc" }],
      limit: REMOVE_BATCH,
    });
    if (batch.length === 0) break;
    const items = batch.map(listItemOf);
    await db.transaction(async tx => {
      for (const item of items) {
        const gone = await tx.delete(TRASH_TABLE, {
          and: [{ column: "id", op: "=", value: item.id }],
        });
        // Restored or removed by another caller since the read: nothing of
        // its history ends here.
        if (gone === 0) continue;
        if (item.kind === "entry") {
          await recordWriteEvent(
            tx,
            { adapter: db },
            {
              subject: {
                kind: "collection",
                slug: item.scopeSlug,
                id: item.itemId,
              },
              kind: "deleted",
              actor: options.actor ?? SYSTEM_ACTOR,
              personName: options.actorName ?? null,
            }
          );
        }
        removed.push(item);
      }
    });
    if (batch.length < REMOVE_BATCH) break;
  }
  return removed;
}

/**
 * The daily clean-up: remove every record past its purge date, as of `now`.
 * Safe to run again: a record already removed is not there to remove twice.
 */
export async function purgeExpiredTrash(
  db: Pick<
    DrizzleAdapter,
    "select" | "transaction" | "getCapabilities" | "tableExists"
  >,
  now: Date = new Date()
): Promise<TrashListItem[]> {
  // A database the trash has not reached yet has nothing to clean up.
  if (!(await db.tableExists(TRASH_TABLE))) return [];
  return removeFromTrash(db, { purgeDueBy: now });
}
