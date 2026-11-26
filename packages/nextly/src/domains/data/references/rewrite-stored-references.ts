/**
 * Every reference a site stores, rewritten by a map, so that no stored link
 * points at an id or an address the map moves.
 *
 * An import writes its entries first with their references still holding the
 * ids and addresses of the site they came from; once every entry has its new
 * id, this is the pass that points them at the new ones. So the ids the map
 * moves are ones this site does not hold: the rewrite reads every stored row,
 * and a moved id the site held itself would take the site's own links to that
 * item with it. A map moving one is refused before anything is read.
 *
 * A reference is stored in these places, and this reads each one:
 *
 *   - each collection's and each Single's row: the fields with a column
 *     there, those of a group with no name among them;
 *   - the translations table beside one, where its translatable values are;
 *   - each field group's table: an instance's own fields, and `_parent_id`
 *     when the instance belongs to a collection's entry the map moves;
 *   - `nextly_versions`: a collection's or Single's snapshot, walked as the
 *     document it is, and a collection version's `entry_id`, with the
 *     working-draft key made from it;
 *   - `nextly_release_members`: a collection member's `entry_id`, with the
 *     member key made from it.
 *
 * Values are read and rewritten by the one walk (`content-references`), so a
 * value is changed here exactly where a listing of its references shows one
 * the map names. Each table is read a page at a time, by its key after the
 * last one read, and a row is written only when something in it changed,
 * with only the columns that changed, each in the form it was read. Versions
 * of a plugin's pages (`scope_kind` "page") belong to the plugin, which takes
 * its own data through an archive, and are left as they are.
 *
 * A many-to-many junction is not read: its foreign keys hold only ids of rows
 * the site has, so no junction row can hold an id the map moves. An import
 * writes those links once both their entries exist.
 *
 * Two tables hold ids as a record of what already happened rather than as
 * content, and are left as they are too: the outbox of content events
 * (`nextly_events`), which says what each write sent or will send to
 * webhooks, and the source text translations were made from
 * (`nextly_translation_sources`), a copy of a past value named by its own
 * fingerprint.
 *
 * Everything runs on the `db` it is given, the caller's transaction, so the
 * rewrite commits or rolls back whole with the import that asked for it. The
 * record of which media items content uses is the caller's to rebuild once
 * the import ends (`nextly media reindex-usage` reads every document again).
 *
 * @module domains/data/references/rewrite-stored-references
 */

import type {
  SqlParam,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";

import type { FieldConfig } from "../../../collections/fields/types";
import { NextlyError } from "../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import { componentFieldHasColumn } from "../../field-groups/services/field-group-utils";
import {
  COMPANION_LOCALE_COLUMN,
  COMPANION_PARENT_COLUMN,
} from "../../i18n/companion-columns";
import {
  parseStoredJson,
  type FieldGroupSchemas,
} from "../../media/usage/media-references";
import { releaseMemberKey } from "../../releases/release-member-key";
import { RELEASE_MEMBERS_TABLE } from "../../releases/release-tables";
import {
  fieldProducesColumn,
  fieldsStoredOnRow,
  toSnakeCase,
} from "../../schema/services/field-column-descriptor";
import { workingDraftKey } from "../../versions/working-draft-key";

import { rewriteContentReferences } from "./content-references";
import type { PluginReferenceShapes } from "./plugin-reference-shapes";
import { mappedId, MEDIA_COLLECTION, type ReferenceMap } from "./reference-map";

/** One collection, Single or field group, and where its values are stored. */
export interface StoredEntity {
  slug: string;
  /** Its own table. */
  table: string;
  fields: readonly FieldConfig[];
  /**
   * The translations table beside it (`<table>_locales`), when its
   * translatable values are kept there; absent when it has none.
   */
  translationsTable?: string;
}

/** Everything a site keeps content in (`describeStoredContent`). */
export interface StoredContentSite {
  collections: readonly StoredEntity[];
  singles: readonly StoredEntity[];
  fieldGroups: readonly StoredEntity[];
}

/** The calls the rewrite makes: a transaction's. */
export type RewriteDb = Pick<TransactionContext, "select" | "update">;

/** What the rewrite reads and writes through. */
export interface RewriteStoredReferencesDeps {
  db: RewriteDb;
  site: StoredContentSite;
  /** The adapter's `maxParamsPerQuery`, which no statement passes. */
  maxParamsPerQuery: number;
  /** The shapes of the field types plugins add. */
  pluginShapes?: PluginReferenceShapes;
  /** How many rows one read pages through; 200 unless a caller says. */
  pageSize?: number;
}

/** What a rewrite changed. */
export interface RewriteStoredReferencesResult {
  /** The rows changed, by table; a table with none is not named. */
  changedRows: Record<string, number>;
}

type Row = Record<string, unknown>;

/** How many rows one read pages through, unless the caller says. */
const PAGE = 200;

/** What every part of the rewrite shares. */
interface Pass {
  deps: RewriteStoredReferencesDeps;
  map: ReferenceMap;
  schemas: FieldGroupSchemas;
  pageSize: number;
  changed: Record<string, number>;
}

function nameOf(field: FieldConfig): string {
  const name = (field as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

/** A row's value for a column, under the column's name or the field's. */
function readColumn(row: Row, column: string, name: string): unknown {
  return row[column] !== undefined ? row[column] : row[name];
}

function countChanged(pass: Pass, table: string): void {
  pass.changed[table] = (pass.changed[table] ?? 0) + 1;
}

/**
 * Every row of `table` with `columns`, a page at a time, in the order of
 * `keys` (the table's key), each page starting after the last row read, so
 * a write to a row already read never moves another one past the reader.
 */
async function* pagesOf(
  pass: Pass,
  table: string,
  columns: readonly string[],
  keys: readonly string[],
  where?: Parameters<RewriteDb["select"]>[1]
): AsyncGenerator<Row[]> {
  let after: Row | undefined;
  for (;;) {
    const afterLast =
      after === undefined
        ? []
        : [
            {
              or: keys.map((key, index) => ({
                and: [
                  ...keys.slice(0, index).map(earlier => ({
                    column: earlier,
                    op: "=" as const,
                    value: after?.[earlier] as SqlParam,
                  })),
                  {
                    column: key,
                    op: ">" as const,
                    value: after?.[key] as SqlParam,
                  },
                ],
              })),
            },
          ];
    const conditions = [...(where?.where ? [where.where] : []), ...afterLast];
    const rows = await pass.deps.db.select<Row>(table, {
      columns: [...new Set([...keys, ...columns])],
      ...(conditions.length > 0 ? { where: { and: conditions } } : {}),
      orderBy: keys.map(column => ({ column, direction: "asc" as const })),
      limit: pass.pageSize,
    });
    if (rows.length > 0) yield rows;
    if (rows.length < pass.pageSize) return;
    after = rows[rows.length - 1];
  }
}

/**
 * Write `changes` to the row `key` names, in as many statements as keep each
 * one within the adapter's parameter limit.
 */
async function writeRow(
  pass: Pass,
  table: string,
  key: Row,
  changes: Row
): Promise<void> {
  const where = {
    and: Object.entries(key).map(([column, value]) => ({
      column,
      op: "=" as const,
      value: value as SqlParam,
    })),
  };
  const entries = Object.entries(changes);
  const perStatement = Math.max(
    1,
    pass.deps.maxParamsPerQuery - Object.keys(key).length
  );
  for (let at = 0; at < entries.length; at += perStatement) {
    await pass.deps.db.update(
      table,
      Object.fromEntries(entries.slice(at, at + perStatement)),
      where
    );
  }
}

/** The named fields whose columns sit on a row, by the rule given. */
function columnFields(
  fields: readonly FieldConfig[],
  hasColumn: (field: FieldConfig) => boolean
): FieldConfig[] {
  return fieldsStoredOnRow(fields).filter(
    field => nameOf(field) !== "" && hasColumn(field)
  );
}

/**
 * The columns of `onRow` that `row` holds rewritten, in the form each was
 * read; empty when nothing in them changed. The walk is given every field,
 * so a group with no name finds its fields on the row.
 */
function rewrittenColumns(
  pass: Pass,
  fields: readonly FieldConfig[],
  onRow: readonly FieldConfig[],
  row: Row
): Row {
  const values: Row = {};
  for (const field of onRow) {
    const name = nameOf(field);
    values[name] = readColumn(row, toSnakeCase(name), name);
  }
  const next = rewriteContentReferences(fields, values, pass.map, {
    fieldGroupSchemas: pass.schemas,
    pluginShapes: pass.deps.pluginShapes,
  });
  const changes: Row = {};
  if (next === values) return changes;
  for (const field of onRow) {
    const name = nameOf(field);
    if (next[name] !== values[name]) changes[toSnakeCase(name)] = next[name];
  }
  return changes;
}

/**
 * The new id of a field-group instance's parent, when its parent is an entry
 * of a collection the map moves; `undefined` otherwise.
 */
function movedParent(
  pass: Pass,
  collectionOfTable: ReadonlyMap<string, string>,
  row: Row
): string | undefined {
  const { parentId, parentTable } = STORAGE_FORMAT.columns;
  const owner = collectionOfTable.get(String(row[parentTable]));
  return owner === undefined
    ? undefined
    : mappedId(pass.map, owner, String(row[parentId]));
}

/**
 * A collection's or Single's rows, or a field group's instances: the values
 * in their columns, and for an instance its parent's id when the parent is
 * an entry of a collection the map moves.
 */
async function rewriteEntityRows(
  pass: Pass,
  entity: StoredEntity,
  hasColumn: (field: FieldConfig) => boolean,
  collectionOfTable?: ReadonlyMap<string, string>
): Promise<void> {
  const onRow = columnFields(entity.fields, hasColumn);
  const { parentId, parentTable } = STORAGE_FORMAT.columns;
  const parentColumns = collectionOfTable ? [parentId, parentTable] : [];
  const columns = [...onRow.map(f => toSnakeCase(nameOf(f))), ...parentColumns];
  if (columns.length === 0) return;
  for await (const rows of pagesOf(pass, entity.table, columns, ["id"])) {
    for (const row of rows) {
      const changes = rewrittenColumns(pass, entity.fields, onRow, row);
      const moved = collectionOfTable
        ? movedParent(pass, collectionOfTable, row)
        : undefined;
      if (moved !== undefined) changes[parentId] = moved;
      if (Object.keys(changes).length === 0) continue;
      await writeRow(pass, entity.table, { id: row.id }, changes);
      countChanged(pass, entity.table);
    }
  }
  if (entity.translationsTable !== undefined) {
    await rewriteTranslations(pass, entity, entity.translationsTable, onRow);
  }
}

/**
 * The translated values beside an entity, one row per document and
 * language. The table holds only the translatable fields' columns; a read
 * asks for every field's and is given those there are.
 */
async function rewriteTranslations(
  pass: Pass,
  entity: StoredEntity,
  table: string,
  onRow: readonly FieldConfig[]
): Promise<void> {
  const columns = onRow.map(f => toSnakeCase(nameOf(f)));
  const key = [COMPANION_PARENT_COLUMN, COMPANION_LOCALE_COLUMN];
  for await (const rows of pagesOf(pass, table, columns, key)) {
    for (const row of rows) {
      const changes = rewrittenColumns(pass, entity.fields, onRow, row);
      if (Object.keys(changes).length === 0) continue;
      await writeRow(
        pass,
        table,
        Object.fromEntries(key.map(column => [column, row[column]])),
        changes
      );
      countChanged(pass, table);
    }
  }
}

/**
 * Each version of a collection's or Single's document: the snapshot walked
 * as the document it is, field groups and many-to-many lists inline, and a
 * collection version's entry id, with the working-draft key made from it.
 */
async function rewriteVersions(pass: Pass): Promise<void> {
  const { site } = pass.deps;
  const fieldsOf: VersionFields = {
    collection: new Map(site.collections.map(c => [c.slug, c.fields])),
    single: new Map(site.singles.map(s => [s.slug, s.fields])),
  };
  const pages = pagesOf(
    pass,
    VERSIONS_TABLE,
    ["scopeKind", "scopeSlug", "entryId", "locale", "draftKey", "snapshot"],
    ["id"],
    {
      where: {
        and: [
          { column: "scopeKind", op: "IN", value: ["collection", "single"] },
        ],
      },
    }
  );
  for await (const rows of pages) {
    for (const row of rows) {
      const changes = versionChanges(pass, fieldsOf, row);
      if (Object.keys(changes).length === 0) continue;
      await writeRow(pass, VERSIONS_TABLE, { id: row.id }, changes);
      countChanged(pass, VERSIONS_TABLE);
    }
  }
}

/** The fields of each collection and Single, by its slug. */
interface VersionFields {
  collection: ReadonlyMap<string, readonly FieldConfig[]>;
  single: ReadonlyMap<string, readonly FieldConfig[]>;
}

/**
 * What one version row becomes: its snapshot rewritten, and for a
 * collection's version whose entry moved, the entry's new id and, on a
 * working draft, the draft key made from it.
 */
function versionChanges(pass: Pass, fieldsOf: VersionFields, row: Row): Row {
  const scopeKind = row.scopeKind === "single" ? "single" : "collection";
  const scopeSlug = String(row.scopeSlug);
  const changes: Row = {};
  const fields = fieldsOf[scopeKind].get(scopeSlug);
  if (fields !== undefined) {
    const walked = rewriteSnapshot(pass, fields, row.snapshot);
    if (walked !== row.snapshot) changes.snapshot = walked;
  }
  // A Single's version names its one row, which an import never moves.
  if (scopeKind !== "collection") return changes;
  const entryId = mappedId(pass.map, scopeSlug, String(row.entryId));
  if (entryId === undefined) return changes;
  changes.entryId = entryId;
  if (row.draftKey !== null && row.draftKey !== undefined) {
    const locale = typeof row.locale === "string" ? row.locale : null;
    changes.draftKey = workingDraftKey(
      { scopeKind, scopeSlug, entryId },
      locale
    );
  }
  return changes;
}

/** A snapshot rewritten, kept as a string when the dialect stored it so. */
function rewriteSnapshot(
  pass: Pass,
  fields: readonly FieldConfig[],
  snapshot: unknown
): unknown {
  // Read as every stored JSON value is: a string that is not JSON is kept.
  const parsed = parseStoredJson(snapshot);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return snapshot;
  }
  const document = parsed as Row;
  const next = rewriteContentReferences(fields, document, pass.map, {
    fieldGroupSchemas: pass.schemas,
    pluginShapes: pass.deps.pluginShapes,
  });
  if (next === document) return snapshot;
  return typeof snapshot === "string" ? JSON.stringify(next) : next;
}

/** Each release member of a collection's entry the map moves. */
async function rewriteReleaseMembers(pass: Pass): Promise<void> {
  const pages = pagesOf(
    pass,
    RELEASE_MEMBERS_TABLE,
    ["releaseId", "scopeKind", "scopeSlug", "entryId", "locale"],
    ["id"],
    { where: { and: [{ column: "scopeKind", op: "=", value: "collection" }] } }
  );
  for await (const rows of pages) {
    for (const row of rows) {
      const scopeSlug = String(row.scopeSlug);
      const entryId = mappedId(pass.map, scopeSlug, String(row.entryId));
      if (entryId === undefined) continue;
      const locale = typeof row.locale === "string" ? row.locale : null;
      await writeRow(
        pass,
        RELEASE_MEMBERS_TABLE,
        { id: row.id },
        {
          entryId,
          // The key is made from the entry's id, so it moves with it.
          memberKey: releaseMemberKey(String(row.releaseId), {
            scopeKind: "collection",
            scopeSlug,
            entryId,
            locale,
          }),
        }
      );
      countChanged(pass, RELEASE_MEMBERS_TABLE);
    }
  }
}

/** The table media items are stored in. */
const MEDIA_TABLE = "media";

/**
 * Refuses, changing nothing, a map that moves an id the site holds itself, in
 * a collection or the media library: every stored link to that item, the
 * site's own among them, would be pointed at the new one. Asked a parameter
 * limit's worth of ids at a time.
 */
async function assertMovedIdsAreNotHeld(pass: Pass): Promise<void> {
  const tables = new Map<string, string>([
    ...pass.deps.site.collections.map(c => [c.slug, c.table] as const),
    [MEDIA_COLLECTION, MEDIA_TABLE],
  ]);
  const perQuery = Math.max(1, pass.deps.maxParamsPerQuery - 1);
  for (const [collection, moves] of pass.map.ids ?? []) {
    const table = tables.get(collection);
    if (table === undefined) continue;
    const moved = [...moves.keys()].filter(
      id => mappedId(pass.map, collection, id) !== undefined
    );
    for (let at = 0; at < moved.length; at += perQuery) {
      const held = await pass.deps.db.select<Row>(table, {
        columns: ["id"],
        where: {
          and: [
            { column: "id", op: "IN", value: moved.slice(at, at + perQuery) },
          ],
        },
        limit: 1,
      });
      if (held.length > 0) {
        throw NextlyError.conflict({
          reason: "state",
          message:
            "These references can't be rewritten: an id the import moves still belongs to an item on this site, whose own links would move with it.",
          logContext: { collection, id: String(held[0].id) },
        });
      }
    }
  }
}

/**
 * Rewrite every reference the site stores by `map`, on `deps.db`. A
 * reference the map does not name is kept as it is.
 */
export async function rewriteStoredReferences(
  deps: RewriteStoredReferencesDeps,
  map: ReferenceMap
): Promise<RewriteStoredReferencesResult> {
  const { site } = deps;
  const pass: Pass = {
    deps,
    map,
    schemas: new Map(
      site.fieldGroups.map(g => [g.slug, { fields: [...g.fields] }])
    ),
    pageSize: deps.pageSize ?? PAGE,
    changed: {},
  };
  await assertMovedIdsAreNotHeld(pass);
  for (const collection of site.collections) {
    await rewriteEntityRows(pass, collection, fieldProducesColumn);
  }
  for (const single of site.singles) {
    await rewriteEntityRows(pass, single, fieldProducesColumn);
  }
  // An instance's parent is named by its table; the map moves a collection's.
  const collectionOfTable = new Map(
    site.collections.map(c => [c.table, c.slug])
  );
  for (const group of site.fieldGroups) {
    await rewriteEntityRows(
      pass,
      group,
      componentFieldHasColumn,
      collectionOfTable
    );
  }
  await rewriteVersions(pass);
  await rewriteReleaseMembers(pass);
  return { changedRows: pass.changed };
}
