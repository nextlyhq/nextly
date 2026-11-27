/**
 * Move an entry to the trash, on the delete's own transaction: every row it
 * stores is copied into one trash record before the delete removes them, so
 * the delete goes on exactly as before and every read path, which reads the
 * entry's tables, finds it gone without a filter it could forget.
 *
 * A database that has no trash table yet (`nextly migrate` creates it) keeps
 * deletes permanent, as they were, and says so once.
 *
 * @module domains/trash/move-to-trash
 */
import { randomUUID } from "node:crypto";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import type { RequestActor } from "../../auth/request-actor";
import { getService } from "../../di/service-access";
import { TRASH_TABLE } from "../../schemas/trash";
import { sanitizedChange } from "../webhooks/envelope";
import {
  sensitiveFieldPaths,
  type SensitiveFieldSource,
} from "../webhooks/sensitive-fields";

import { captureEntry, type CapturedField } from "./capture-entry";
import { fieldHasReadRule } from "./field-read-rule";
import { trashActorColumns } from "./trash-actor";

/** How long an item stays in the trash before it leaves for good. */
const TRASH_KEEP_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The longest a list's label is kept, in characters. */
const MAX_LABEL = 255;

/** Whether a core table is in the database, asked on a transaction. */
export interface TrashTableProbe {
  tableExistsThrough(tx: TransactionContext, table: string): Promise<boolean>;
}

/** Where the once-only notice of a database without the trash goes. */
export interface TrashLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

/** What one entry's move to the trash needs to know. */
export interface MoveEntryToTrashInput {
  collection: string;
  tableName: string;
  entryId: string;
  fields: readonly CapturedField[];
  /**
   * The schema with its field groups expanded, as the deleted event reads it:
   * the document is kept without the values it strips (hidden and password
   * fields, at any depth), so a restore's event can never carry them.
   */
  sensitiveFields: readonly SensitiveFieldSource[];
  /** The entry in the shape a read gives it, as its deleted event carries it. */
  document: Record<string, unknown>;
  /** Who deleted it, as the delete records it. */
  actor: RequestActor;
  /** The person's name, where a person deleted it. */
  actorName?: string | null;
  /** When it was deleted; now unless a test fixes the clock. */
  now?: Date;
}

/** Whether the entry went to the trash, and its record's id when it did. */
export type MoveEntryToTrashResult =
  | { trashed: true; trashId: string }
  | { trashed: false };

let warnedNoTrash = false;

/**
 * What a list names the item by: its title, else its name, else its slug,
 * as text, cut to the column's length. A field with a read rule of its own
 * is passed over: the list is shown to whoever may read the collection, and
 * the rule cannot be judged for a row that is gone.
 */
function trashLabelOf(
  collection: string,
  document: Record<string, unknown>,
  fields: readonly CapturedField[]
): string | null {
  for (const key of ["title", "name", "slug"]) {
    if (fieldHasReadRule(collection, key, fields)) continue;
    const value = document[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.length > MAX_LABEL ? value.slice(0, MAX_LABEL) : value;
    }
  }
  return null;
}

/**
 * Copy every row of `input.entryId` into a trash record on `tx`, before the
 * delete removes them. Answers `trashed: false`, with nothing written, where
 * the database has no trash table yet, and where the entry's row is not there.
 */
export async function moveEntryToTrash(
  tx: TransactionContext,
  db: TrashTableProbe,
  input: MoveEntryToTrashInput,
  logger?: TrashLogger
): Promise<MoveEntryToTrashResult> {
  // A catalogue read on the delete's own connection: a statement against a
  // missing table would abort the transaction on PostgreSQL.
  if (!(await db.tableExistsThrough(tx, TRASH_TABLE))) {
    if (!warnedNoTrash) {
      warnedNoTrash = true;
      logger?.warn(
        "Deleted entries are removed for good: this database has no trash yet. Run `nextly migrate` to keep them in the trash for 30 days.",
        { table: TRASH_TABLE }
      );
    }
    return { trashed: false };
  }
  // Every field group's table, read on the delete's transaction as the
  // delete's own walk reads it.
  const fieldGroupTables = await getService(
    "fieldGroupRegistryService"
  ).getAllTableNames(tx.getDrizzle());
  const captured = await captureEntry(tx, {
    collection: input.collection,
    tableName: input.tableName,
    entryId: input.entryId,
    fields: input.fields,
    fieldGroupTables,
    tableExists: table => db.tableExistsThrough(tx, table),
  });
  if (captured === undefined) return { trashed: false };
  const trashedAt = input.now ?? new Date();
  const trashId = randomUUID();
  await tx.insert(TRASH_TABLE, {
    id: trashId,
    kind: "entry",
    scopeSlug: input.collection,
    itemId: input.entryId,
    label: trashLabelOf(input.collection, input.document, input.fields),
    stored: {
      ...captured,
      document: sanitizedChange({
        data: input.document,
        sensitiveFields: sensitiveFieldPaths(input.sensitiveFields),
      }).data,
    },
    storageKey: null,
    madePrivate: false,
    ...trashActorColumns(input.actor, input.actorName ?? null),
    // Set once the delete records its history event, below the copy.
    deletedEventId: null,
    trashedAt,
    purgeAt: new Date(trashedAt.getTime() + TRASH_KEEP_DAYS * DAY_MS),
  });
  return { trashed: true, trashId };
}

/**
 * Record on the trash record `trashId` the history event that recorded its
 * entry's deletion, on the delete's own transaction: the life a restore goes
 * on with, and whose history retention keeps while the entry is in the trash.
 */
export async function noteTrashedEntryDeletion(
  tx: TransactionContext,
  trashId: string,
  deletedEventId: string
): Promise<void> {
  await tx.update(
    TRASH_TABLE,
    { deletedEventId },
    { and: [{ column: "id", op: "=", value: trashId }] }
  );
}
