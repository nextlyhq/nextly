/**
 * Bring a trashed entry back as it was: its rows are put back in their
 * tables with the same ids, in every language, with its field-group rows,
 * its links, and the records about it the delete removed. Its version
 * history never left. Where it had been published it comes back as a draft,
 * so nothing reaches the public site until a person publishes it again.
 *
 * Where a unique value it held (its slug, most often) has been taken by
 * another entry since, nothing is written: the restore answers which values
 * conflict, and is asked again with new ones.
 *
 * @module domains/trash/restore-entry
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  TransactionContext,
  WhereClause,
} from "@nextlyhq/adapter-drizzle/types";
import { sql } from "drizzle-orm";

import type { RequestActor } from "../../auth/request-actor";
import { missingSchemaObject } from "../../database/missing-column";
import { NextlyError } from "../../errors";
import { MEDIA_USAGE_TABLE } from "../../schemas/media-usage/table-name";
import {
  TRASH_TABLE,
  type KeptLinks,
  type KeptRow,
  type TrashedEntry,
} from "../../schemas/trash";
import { STORAGE_FORMAT } from "../../schemas/storage-format";
import { recordWriteEvent } from "../content-events/write-event";
import { COMPANION_PARENT_COLUMN } from "../i18n/companion-columns";
import { fieldProducesColumn } from "../schema/field-rules";
import { recordMutationEvent } from "../webhooks/record-mutation-event";
import type { SensitiveFieldSource } from "../webhooks/sensitive-fields";

import { keptColumn, rowGivenBack } from "./kept-values";
import { readTrashRecord, type TrashRecord } from "./trash-records";

/** The status a restored entry takes where it had been published. */
const DRAFT = "draft";
const PUBLISHED = "published";

/** A field of the collection as the restore reads it. */
export interface RestoreField extends SensitiveFieldSource {
  name?: string;
  type?: unknown;
  options?: unknown;
  unique?: unknown;
  localized?: unknown;
}

/** The collection a trashed entry belonged to, as it is now. */
export interface RestoreCollection {
  tableName: string;
  fields: readonly RestoreField[];
}

/** What a restore reads besides the database. */
export interface RestoreDeps {
  adapter: Pick<
    DrizzleAdapter,
    "transaction" | "select" | "tableExistsThrough" | "getCapabilities"
  >;
  /** The collection `slug` as it is now; undefined where it is gone. */
  collectionOf(slug: string): Promise<RestoreCollection | undefined>;
}

/** One value another entry has taken since the item was trashed. */
export interface TrashConflict {
  /** The field whose value is taken. */
  field: string;
  /** The value the trashed entry held. */
  value: unknown;
  /** The language the value is in, for a translated field. */
  locale?: string;
}

/** What a restore is asked to do. */
export interface RestoreEntryInput {
  trashId: string;
  /**
   * New values for fields whose value was taken, by field name: put in
   * wherever the entry held the taken value.
   */
  values?: Readonly<Record<string, unknown>>;
  /** Who restores it. */
  actor: RequestActor;
  actorName?: string | null;
}

export type RestoreEntryResult =
  | { restored: true; collection: string; id: string }
  | { restored: false; conflicts: TrashConflict[] };

/** Whether `error` refuses a table this running instance has not registered. */
function isUnregisteredTable(error: unknown): boolean {
  return missingSchemaObject(error)?.object === "unregistered";
}

/** The kept rows of `table`, or none. */
function keptRowsOf(stored: TrashedEntry, table: string): KeptRow[] {
  return stored.tables.find(kept => kept.table === table)?.rows ?? [];
}

/** The fields whose value no two entries may share, by where they live. */
function uniqueFields(fields: readonly RestoreField[]): RestoreField[] {
  return fields.filter(
    field =>
      field.unique === true &&
      typeof field.name === "string" &&
      fieldProducesColumn(field)
  );
}

/**
 * A kept row with the values asked for put in where the row held a value
 * another entry has taken.
 */
function withNewValues(
  row: Record<string, unknown>,
  taken: readonly TrashConflict[],
  values: Readonly<Record<string, unknown>>,
  locale: string | undefined
): Record<string, unknown> {
  const out = { ...row };
  for (const conflict of taken) {
    if (conflict.locale !== locale) continue;
    if (Object.prototype.hasOwnProperty.call(values, conflict.field)) {
      out[conflict.field] = values[conflict.field];
    }
  }
  return out;
}

/** Whether another row of `table` than the entry's own holds `value`. */
async function valueTaken(
  tx: TransactionContext,
  table: string,
  where: WhereClause["and"]
): Promise<boolean> {
  const rows = await tx.select<{ id?: unknown }>(table, {
    where: { and: where },
    limit: 1,
  });
  return rows.length > 0;
}

/**
 * The unique values the entry held that another entry holds now, after the
 * values asked for are put in: on its own row, and, for a translated field,
 * on its row in each language.
 */
async function conflictsOf(
  tx: TransactionContext,
  record: TrashRecord,
  collection: RestoreCollection,
  values: Readonly<Record<string, unknown>>
): Promise<TrashConflict[]> {
  const conflicts: TrashConflict[] = [];
  const own = keptRowsOf(record.stored, collection.tableName)[0];
  const companion = `${collection.tableName}${STORAGE_FORMAT.companionSuffix}`;
  for (const field of uniqueFields(collection.fields)) {
    const name = String(field.name);
    const asked = Object.prototype.hasOwnProperty.call(values, name);
    // Asked only of the rows that hold the column: a translated field lives
    // in the language rows, not the entry's own.
    const ownHolds = own !== undefined && name in own;
    const ownValue = asked ? values[name] : own && keptColumn(own, name);
    if (ownHolds && ownValue !== undefined && ownValue !== null) {
      const taken = await valueTaken(tx, collection.tableName, [
        { column: name, op: "=", value: ownValue },
        { column: "id", op: "!=", value: record.itemId },
      ]);
      if (taken) conflicts.push({ field: name, value: ownValue });
    }
    for (const row of keptRowsOf(record.stored, companion)) {
      if (!(name in row)) continue;
      const locale = String(keptColumn(row, "_locale"));
      const value = asked ? values[name] : keptColumn(row, name);
      if (value === undefined || value === null) continue;
      try {
        const taken = await valueTaken(tx, companion, [
          { column: name, op: "=", value },
          { column: "_locale", op: "=", value: locale },
          { column: COMPANION_PARENT_COLUMN, op: "!=", value: record.itemId },
        ]);
        if (taken) conflicts.push({ field: name, value, locale });
      } catch (error) {
        // A companion without the column keeps the field on the main row,
        // which is asked above.
        if (!isUnregisteredTable(error)) throw error;
      }
    }
  }
  return conflicts;
}

/**
 * The row as it goes back: a published entry, or language, comes back as a
 * draft, and taken values are replaced by those asked for.
 */
function rowToPutBack(
  table: string,
  kept: KeptRow,
  collection: RestoreCollection,
  asked: { conflicts: readonly TrashConflict[]; values: Readonly<Record<string, unknown>> }
): Record<string, unknown> {
  const row = rowGivenBack(kept);
  const companion = `${collection.tableName}${STORAGE_FORMAT.companionSuffix}`;
  if (table === collection.tableName) {
    if (row.status === PUBLISHED) row.status = DRAFT;
    return withNewValues(row, asked.conflicts, asked.values, undefined);
  }
  if (table === companion) {
    if (row._status === PUBLISHED) row._status = DRAFT;
    return withNewValues(
      row,
      asked.conflicts,
      asked.values,
      String(row._locale)
    );
  }
  return row;
}

/** The ids of `table` among `ids` that are there now. */
async function idsPresent(
  tx: TransactionContext,
  table: string,
  ids: readonly string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  try {
    const rows = await tx.select<{ id: unknown }>(table, {
      where: { and: [{ column: "id", op: "IN", value: [...ids] }] },
      columns: ["id"],
    });
    return new Set(rows.map(row => String(row.id)));
  } catch (error) {
    if (isUnregisteredTable(error)) return new Set();
    throw error;
  }
}

/**
 * Put one kept table's rows back. A field group's table this instance no
 * longer registers held a field the collection has since dropped, and is
 * skipped; a core table not in the database yet is skipped too. A media
 * item's use is put back only where the item is still in the library.
 */
async function putBackTable(
  tx: TransactionContext,
  deps: RestoreDeps,
  table: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  let kept = rows;
  if (table.startsWith("nextly_")) {
    if (!(await deps.adapter.tableExistsThrough(tx, table))) return;
  }
  if (table === MEDIA_USAGE_TABLE) {
    const present = await idsPresent(
      tx,
      "media",
      rows.map(row => String(row.mediaId))
    );
    kept = rows.filter(row => present.has(String(row.mediaId)));
  }
  for (const row of kept) {
    try {
      await tx.insert(table, row);
    } catch (error) {
      if (isUnregisteredTable(error)) return;
      throw error;
    }
  }
}

/**
 * Put back the links one many-to-many field held, to the entries still
 * there, as the relationship service writes a link.
 */
async function putBackLinks(
  tx: TransactionContext,
  deps: RestoreDeps,
  links: KeptLinks,
  entryId: string,
  targetTable: string | undefined
): Promise<void> {
  if (targetTable === undefined) return;
  if (!(await deps.adapter.tableExistsThrough(tx, links.table))) return;
  const present = await idsPresent(tx, targetTable, links.targetIds);
  const { dialect } = deps.adapter.getCapabilities();
  const idColumn = sql.identifier("id");
  for (const targetId of links.targetIds) {
    if (!present.has(targetId)) continue;
    // SQLite keeps the junction's time as whole seconds; the others take a
    // date, as the relationship service binds it.
    const createdAt =
      dialect === "sqlite" ? Math.floor(Date.now() / 1000) : new Date();
    const conflict =
      dialect === "mysql"
        ? sql`ON DUPLICATE KEY UPDATE ${idColumn} = ${idColumn}`
        : sql`ON CONFLICT DO NOTHING`;
    await tx.runStatement(
      sql`INSERT INTO ${sql.identifier(links.table)} (${idColumn}, ${sql.identifier(links.sourceColumn)}, ${sql.identifier(links.targetColumn)}, ${sql.identifier("created_at")}) VALUES (${crypto.randomUUID()}, ${entryId}, ${targetId}, ${createdAt}) ${conflict}`
    );
  }
}

/** The entry as its created event carries it: as it was, now a draft. */
function documentAsRestored(
  record: TrashRecord
): Record<string, unknown> {
  const document = { ...record.stored.document };
  if (document.status === PUBLISHED) document.status = DRAFT;
  return document;
}

/**
 * Restore the trashed entry `input.trashId`. Refuses a record that is not in
 * the trash, and one whose collection is gone or stores its entries in
 * another table now; answers the conflicts, writing nothing, where a unique
 * value it held is taken.
 */
export async function restoreTrashedEntry(
  deps: RestoreDeps,
  input: RestoreEntryInput
): Promise<RestoreEntryResult> {
  // Read on the pool, before the transaction, with the collections it names:
  // their definitions are read on the pool too, never from inside it.
  const first = await readTrashRecord(deps.adapter, input.trashId);
  if (first === undefined || first.kind !== "entry") {
    throw NextlyError.notFound({
      logContext: { trashId: input.trashId },
    });
  }
  const collection = await deps.collectionOf(first.scopeSlug);
  const ownTable = first.stored.tables[0]?.table;
  if (collection === undefined || collection.tableName !== ownTable) {
    throw NextlyError.conflict({
      message: `The collection "${first.scopeSlug}" this entry belonged to is gone or stores its entries elsewhere now, so it cannot be restored.`,
      logContext: { trashId: input.trashId, table: ownTable },
    });
  }
  const targetTables = new Map<string, string | undefined>();
  for (const links of first.stored.links) {
    if (!targetTables.has(links.targetSlug)) {
      targetTables.set(
        links.targetSlug,
        (await deps.collectionOf(links.targetSlug))?.tableName
      );
    }
  }
  const values = input.values ?? {};

  return deps.adapter.transaction(async tx => {
    // Locked and read again: a restore or an emptying that committed since
    // the read above leaves nothing to restore.
    await tx.lockRow(TRASH_TABLE, input.trashId);
    const record = await readTrashRecord(tx, input.trashId);
    if (record === undefined) {
      throw NextlyError.notFound({ logContext: { trashId: input.trashId } });
    }
    if ((await idsPresent(tx, collection.tableName, [record.itemId])).size) {
      throw NextlyError.conflict({
        message: `An entry with the id "${record.itemId}" is in "${record.scopeSlug}" already, so this one cannot be restored under it.`,
        logContext: { trashId: input.trashId },
      });
    }
    // Asked with the new values put in: a value still taken, the entry's
    // own or a new one, is asked for again, and nothing is written.
    const conflicts = await conflictsOf(tx, record, collection, values);
    if (conflicts.length > 0) return { restored: false, conflicts };
    // Where the entry's own values are taken: where the new ones go.
    const taken = await conflictsOf(tx, record, collection, {});

    for (const kept of record.stored.tables) {
      await putBackTable(
        tx,
        deps,
        kept.table,
        kept.rows.map(row =>
          rowToPutBack(kept.table, row, collection, { conflicts: taken, values })
        )
      );
    }
    for (const links of record.stored.links) {
      await putBackLinks(
        tx,
        deps,
        links,
        record.itemId,
        targetTables.get(links.targetSlug)
      );
    }
    await tx.delete(TRASH_TABLE, {
      and: [{ column: "id", op: "=", value: record.id }],
    });

    // Its history goes on from where it was: the restore is its next event.
    await recordWriteEvent(
      tx,
      { adapter: deps.adapter },
      {
        subject: {
          kind: "collection",
          slug: record.scopeSlug,
          id: record.itemId,
        },
        kind: "restoredFromTrash",
        actor: input.actor,
        personName: input.actorName ?? null,
      }
    );
    // The site's created event, marked as a restore, in the same
    // transaction, so it is recorded exactly when the entry is back.
    await recordMutationEvent(tx, {
      type: "entry.created",
      resource: {
        kind: "entry",
        collection: record.scopeSlug,
        id: record.itemId,
      },
      data: documentAsRestored(record),
      previous: null,
      fields: collection.fields,
      actor: input.actor,
      restoredFrom: "trash",
    });
    return {
      restored: true,
      collection: record.scopeSlug,
      id: record.itemId,
    } as const;
  });
}
