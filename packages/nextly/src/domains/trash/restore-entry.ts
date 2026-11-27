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
  SqlParam,
  TransactionContext,
  WhereClause,
} from "@nextlyhq/adapter-drizzle/types";

import type { RequestActor } from "../../auth/request-actor";
import { toDbError } from "../../database/errors";
import { missingSchemaObject } from "../../database/missing-column";
import { NextlyError } from "../../errors";
import { WHOLE_DOCUMENT, withWriteParts } from "../../hooks/hook-language";
import { DASHBOARD_PINS_TABLE } from "../../schemas/dashboard-pins/table-name";
import { MEDIA_USAGE_TABLE } from "../../schemas/media-usage/table-name";
import { STORAGE_FORMAT } from "../../schemas/storage-format";
import {
  TRASH_TABLE,
  type KeptRow,
  type TrashedEntry,
} from "../../schemas/trash";
import { VERSION_VIEWS_TABLE } from "../../schemas/version-views";
import { VERSIONS_TABLE } from "../../schemas/versions/types";
import { reopenEndedLife } from "../content-events/reopen-life";
import { recordWriteEvent } from "../content-events/write-event";
import { COMPANION_PARENT_COLUMN } from "../i18n/companion-columns";
import {
  builderColumnIsUnique,
  fieldProducesColumn,
} from "../schema/field-rules";
import { fieldsStoredOnRow } from "../schema/services/field-column-descriptor";
import { recordMutationEvent } from "../webhooks/record-mutation-event";
import type { SensitiveFieldSource } from "../webhooks/sensitive-fields";

import { fieldHasReadRule } from "./field-read-rule";
import { keptColumn, rowGivenBack } from "./kept-values";
import {
  idsPresent,
  putBackIncoming,
  putBackLinks,
  relationsGone,
  relationTargetsOf,
} from "./put-back-references";
import { readTrashRecord, type TrashRecord } from "./trash-records";

/** The status a restored entry takes where it had been published. */
const DRAFT = "draft";
const PUBLISHED = "published";

/**
 * A field of the collection as the restore reads it: what the site's event
 * strips by, and whether its value is unique.
 */
export type RestoreField = SensitiveFieldSource & {
  options?: unknown;
  unique?: unknown;
};

/** The collection a trashed entry belonged to, as it is now. */
export interface RestoreCollection {
  tableName: string;
  fields: readonly RestoreField[];
  /**
   * Whether it has the Draft/Published lifecycle: only then is `status` its
   * system column, which a restore puts back as a draft. Without it a field
   * named `status` is the author's own, kept as it was.
   */
  lifecycle: boolean;
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
  /**
   * The value the trashed entry held; left out where the field has its own
   * read rule, which a restore cannot judge for a row that is not there.
   */
  value?: unknown;
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

/**
 * What a restore could not put back as it was: links to or from entries
 * deleted since, and its own relation fields whose target was deleted since,
 * put back empty. Present only where there is any.
 */
export interface NotPutBack {
  links: number;
  relationsCleared: string[];
}

export type RestoreEntryResult =
  | {
      restored: true;
      collection: string;
      id: string;
      notPutBack?: NotPutBack;
    }
  | { restored: false; conflicts: TrashConflict[] };

/** Whether `error` refuses a table this running instance has not registered. */
function isUnregisteredTable(error: unknown): boolean {
  return missingSchemaObject(error)?.object === "unregistered";
}

/** The kept rows of `table`, or none. */
function keptRowsOf(stored: TrashedEntry, table: string): KeptRow[] {
  return stored.tables.find(kept => kept.table === table)?.rows ?? [];
}

/** The system slug, which every collection holding it indexes as unique. */
const SLUG = "slug";

/**
 * The names of the fields whose value no two entries may share, by where:
 * on the entry's own row, those declared unique and the slug, whose column
 * there is unique whatever its field declares; in the language rows, those
 * declared unique. Fields inside a group with no name are stored on the row
 * too.
 */
function uniqueFieldNames(
  fields: readonly RestoreField[],
  onOwnRow: boolean
): string[] {
  const names = new Set<string>(onOwnRow ? [SLUG] : []);
  for (const field of fieldsStoredOnRow(fields)) {
    // The rule the column's unique constraint is made by: declared unique,
    // or a one-to-one relation, unique by its kind.
    if (
      builderColumnIsUnique(field) &&
      typeof field.name === "string" &&
      fieldProducesColumn(field)
    ) {
      names.add(field.name);
    }
  }
  return [...names];
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

/**
 * A kept value as a statement parameter: a scalar or a date as itself, and
 * anything else (a JSON value) as its JSON text, which is how a unique
 * column holding one would compare.
 */
function asParam(value: unknown): SqlParam {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Date
  ) {
    return value;
  }
  return JSON.stringify(value);
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

/** One kept row that may hold a unique value, and the language it is in. */
interface UniquePlace {
  table: string;
  row: KeptRow;
  /** Set for a row of the language table. */
  locale?: string;
}

/** The entry's own row and its rows in each language, where kept. */
function placesOf(
  record: TrashRecord,
  collection: RestoreCollection
): UniquePlace[] {
  const companion = `${collection.tableName}${STORAGE_FORMAT.companionSuffix}`;
  return [
    ...keptRowsOf(record.stored, collection.tableName)
      .slice(0, 1)
      .map(row => ({ table: collection.tableName, row })),
    ...keptRowsOf(record.stored, companion).map(row => ({
      table: companion,
      row,
      locale: String(keptColumn(row, "_locale")),
    })),
  ];
}

/**
 * Whether another entry holds `value` in `name` where `place` would put it
 * back: on another row of the entry's table, or on another entry's row in
 * the same language.
 */
async function conflictAt(
  tx: TransactionContext,
  place: UniquePlace,
  name: string,
  value: unknown,
  itemId: string
): Promise<TrashConflict | undefined> {
  if (value === undefined || value === null) return undefined;
  const where: NonNullable<WhereClause["and"]> =
    place.locale === undefined
      ? [
          { column: name, op: "=", value: asParam(value) },
          { column: "id", op: "!=", value: itemId },
        ]
      : [
          { column: name, op: "=", value: asParam(value) },
          { column: "_locale", op: "=", value: place.locale },
          { column: COMPANION_PARENT_COLUMN, op: "!=", value: itemId },
        ];
  if (!(await valueTaken(tx, place.table, where))) return undefined;
  return place.locale === undefined
    ? { field: name, value }
    : { field: name, value, locale: place.locale };
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
  const places = placesOf(record, collection);
  for (const place of places) {
    for (const name of uniqueFieldNames(
      collection.fields,
      place.locale === undefined
    )) {
      const asked = Object.prototype.hasOwnProperty.call(values, name);
      // Asked only of the rows that hold the column: a translated field lives
      // in the language rows, not the entry's own.
      if (!(name in place.row)) continue;
      const value = asked ? values[name] : keptColumn(place.row, name);
      const conflict = await conflictAt(tx, place, name, value, record.itemId);
      if (conflict !== undefined) conflicts.push(conflict);
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
  collection: RestoreCollection & { slug: string },
  asked: {
    conflicts: readonly TrashConflict[];
    values: Readonly<Record<string, unknown>>;
    /** The entry's relation fields whose target is gone, put back empty. */
    cleared: readonly string[];
  }
): Record<string, unknown> {
  const row = rowGivenBack(kept);
  const companion = `${collection.tableName}${STORAGE_FORMAT.companionSuffix}`;
  if (table === collection.tableName) {
    asDraft(row, "status", collection.lifecycle);
    for (const field of asked.cleared) row[field] = null;
    return withNewValues(row, asked.conflicts, asked.values, undefined);
  }
  if (table === companion) {
    asDraft(row, "_status", collection.lifecycle);
    return withNewValues(
      row,
      asked.conflicts,
      asked.values,
      String(row._locale)
    );
  }
  if (table.startsWith("nextly_")) underSlug(row, collection.slug);
  return row;
}

/**
 * A published row's lifecycle column put back as a draft, where the
 * collection has the lifecycle: without it, the column is the author's own.
 */
function asDraft(
  row: Record<string, unknown>,
  column: string,
  lifecycle: boolean
): void {
  if (lifecycle && row[column] === PUBLISHED) row[column] = DRAFT;
}

/**
 * A record kept about the entry names its collection by the slug it has now,
 * which a rename since moved the trash record to.
 */
function underSlug(row: Record<string, unknown>, slug: string): void {
  for (const column of ["scopeSlug", "targetSlug", "subjectSlug"]) {
    if (column in row) row[column] = slug;
  }
}

/**
 * The rows of `table` to put back: a media item's use only where the item
 * is still in the library, since its row there is what the use points at,
 * and no row that is there already.
 */
async function rowsStillValid(
  tx: TransactionContext,
  table: string,
  rows: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  if (table === MEDIA_USAGE_TABLE) {
    const present = await idsPresent(
      tx,
      "media",
      rows.map(row => String(row.mediaId))
    );
    return rows.filter(row => present.has(String(row.mediaId)));
  }
  const person = PERSON_OWNED[table];
  if (person !== undefined) return rowsOfPeopleStillThere(tx, rows, person);
  // A field-group row the delete left in place, under a field the
  // collection has since dropped, is there still: it is not written twice.
  if (table.startsWith("nextly_") || rows.some(row => !("id" in row))) {
    return rows;
  }
  const there = await idsPresent(
    tx,
    table,
    rows.map(row => String(row.id))
  );
  return rows.filter(row => !there.has(String(row.id)));
}

/**
 * The kept tables whose rows belong to one person, and the column naming
 * them: a reader's dashboard pin and "last looked at" marker, and an author's
 * recovery point. Deleting the person removes these (the pin through its
 * foreign key, the others by the deletion itself), so a restore puts back
 * only those of people still there: never one the deletion removed on
 * purpose, and never one the foreign key would refuse.
 */
const PERSON_OWNED: Readonly<Record<string, string>> = {
  [DASHBOARD_PINS_TABLE]: "userId",
  [VERSION_VIEWS_TABLE]: "userId",
  [VERSIONS_TABLE]: "createdBy",
};

/** The people's table. */
const USERS_TABLE = "users";

/**
 * `rows` whose person, named in `column`, is still there. A row naming no
 * one (a working draft, say, or a recovery point made with no signed-in
 * author) is kept.
 */
async function rowsOfPeopleStillThere(
  tx: TransactionContext,
  rows: Record<string, unknown>[],
  column: string
): Promise<Record<string, unknown>[]> {
  const named = (row: Record<string, unknown>): string | undefined => {
    const value = row[column];
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const people = rows.map(named).filter((id): id is string => id !== undefined);
  const present = await idsPresent(tx, USERS_TABLE, people);
  return rows.filter(row => {
    const id = named(row);
    return id === undefined || present.has(id);
  });
}

/**
 * Refuses, as a conflict the caller can act on, a row the table no longer
 * takes as it was stored: a column dropped or renamed since the delete, or a
 * required one added. The transaction rolls back, so nothing is written and
 * the entry stays in the trash, whole.
 */
function refuseFieldsChangedSince(
  deps: RestoreDeps,
  table: string,
  error: unknown
): void {
  const dialect = deps.adapter.getCapabilities().dialect;
  if (
    missingSchemaObject(error)?.object === "column" ||
    toDbError(dialect, error).kind === "not-null-violation"
  ) {
    throw NextlyError.conflict({
      message:
        "This entry's collection has changed its fields since the entry was deleted, so it cannot be put back as it was stored. It stays in the trash.",
      logContext: { table, reason: "restore-fields-changed" },
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Put one row back. Answers false, writing nothing, for a table no longer in
 * the database, which held a field the collection has since dropped. A table
 * still there but not loaded by this process would lose its rows if skipped,
 * so the restore stops instead and nothing is written.
 */
async function putBackRow(
  tx: TransactionContext,
  deps: RestoreDeps,
  table: string,
  row: Record<string, unknown>
): Promise<boolean> {
  try {
    await tx.insert(table, row);
    return true;
  } catch (error) {
    refuseFieldsChangedSince(deps, table, error);
    if (!isUnregisteredTable(error)) throw error;
    // The refusal comes before any statement, so the transaction is still
    // usable to ask.
    if (!(await deps.adapter.tableExistsThrough(tx, table))) return false;
    throw NextlyError.internal({
      logContext: { reason: "restore-table-not-loaded", table },
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Put one kept table's rows back. A core table not in the database yet is
 * skipped, as is a table gone since (`putBackRow`).
 */
async function putBackTable(
  tx: TransactionContext,
  deps: RestoreDeps,
  table: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  if (
    table.startsWith("nextly_") &&
    !(await deps.adapter.tableExistsThrough(tx, table))
  ) {
    return;
  }
  for (const row of await rowsStillValid(tx, table, rows)) {
    if (!(await putBackRow(tx, deps, table, row))) return;
  }
}

/** The entry as its created event carries it: as it was, now a draft. */
function documentAsRestored(
  record: TrashRecord,
  restored: {
    lifecycle: boolean;
    cleared: readonly string[];
    taken: readonly TrashConflict[];
    values: Readonly<Record<string, unknown>>;
  }
): Record<string, unknown> {
  const document = { ...record.stored.document };
  if (restored.lifecycle && document.status === PUBLISHED) {
    document.status = DRAFT;
  }
  for (const field of restored.cleared) document[field] = null;
  // The new values that replaced taken ones, as the rows hold them now.
  for (const conflict of restored.taken) {
    if (
      Object.prototype.hasOwnProperty.call(restored.values, conflict.field) &&
      conflict.field in document
    ) {
      document[conflict.field] = restored.values[conflict.field];
    }
  }
  return document;
}

/**
 * The collections a restore reads before its transaction: the tables the
 * entry's links and relation fields point into, each read on the pool.
 */
async function targetTablesOf(
  deps: RestoreDeps,
  record: TrashRecord,
  targets: ReadonlyMap<string, string>
): Promise<Map<string, string | undefined>> {
  const tables = new Map<string, string | undefined>();
  const slugs = [
    ...record.stored.links.map(links => links.targetSlug),
    ...targets.values(),
  ];
  for (const slug of slugs) {
    if (!tables.has(slug)) {
      tables.set(slug, (await deps.collectionOf(slug))?.tableName);
    }
  }
  return tables;
}

/**
 * The conflicts as the caller is answered: a value is left out where its
 * field has its own read rule, which no row is there to judge.
 */
function conflictsAnswered(
  collection: string,
  conflicts: readonly TrashConflict[],
  fields: readonly RestoreField[]
): TrashConflict[] {
  return conflicts.map(conflict => {
    if (!fieldHasReadRule(collection, conflict.field, fields)) return conflict;
    const { value: _hidden, ...rest } = conflict;
    return rest;
  });
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
  const targets = relationTargetsOf(collection.fields);
  const targetTables = await targetTablesOf(deps, first, targets);
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
    if (conflicts.length > 0) {
      return {
        restored: false,
        conflicts: conflictsAnswered(
          record.scopeSlug,
          conflicts,
          collection.fields
        ),
      };
    }
    // Where the entry's own values are taken: where the new ones go.
    const taken = await conflictsOf(tx, record, collection, {});
    const own = keptRowsOf(record.stored, collection.tableName)[0];
    const cleared =
      own === undefined
        ? []
        : await relationsGone(tx, rowGivenBack(own), targets, targetTables);

    for (const kept of record.stored.tables) {
      await putBackTable(
        tx,
        deps,
        kept.table,
        kept.rows.map(row =>
          rowToPutBack(
            kept.table,
            row,
            { ...collection, slug: record.scopeSlug },
            {
              conflicts: taken,
              values,
              cleared,
            }
          )
        )
      );
    }
    let linksLeftOut = 0;
    for (const links of record.stored.links) {
      linksLeftOut += await putBackLinks(
        tx,
        deps.adapter,
        links,
        record.itemId,
        targetTables.get(links.targetSlug)
      );
    }
    linksLeftOut += await putBackIncoming(
      tx,
      deps.adapter,
      record.stored.incoming ?? [],
      record.itemId
    );
    await tx.delete(TRASH_TABLE, {
      and: [{ column: "id", op: "=", value: record.id }],
    });

    // Its history goes on from where it was: the life its deletion ended is
    // its current one again, and the restore is its next event.
    if (record.deletedEventId !== null) {
      await reopenEndedLife(tx, record.deletedEventId);
    }
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
    // transaction, so it is recorded exactly when the entry is back. The
    // document was kept without its sensitive values.
    // Every language and the shared fields came back, as a create's do.
    await withWriteParts(WHOLE_DOCUMENT, () =>
      recordMutationEvent(tx, {
        type: "entry.created",
        resource: {
          kind: "entry",
          collection: record.scopeSlug,
          id: record.itemId,
        },
        data: documentAsRestored(record, {
          lifecycle: collection.lifecycle,
          cleared,
          taken,
          values,
        }),
        previous: null,
        fields: collection.fields,
        actor: input.actor,
        restoredFrom: "trash",
      })
    );
    return {
      restored: true,
      collection: record.scopeSlug,
      id: record.itemId,
      ...(linksLeftOut > 0 || cleared.length > 0
        ? { notPutBack: { links: linksLeftOut, relationsCleared: cleared } }
        : {}),
    } as const;
  });
}
