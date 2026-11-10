/**
 * Which migration files an earlier Schema Builder wrote, known by their whole
 * signature, since nothing inside such a file says who wrote it:
 *
 * (a) its name is a 13-digit millisecond timestamp, `_`, `create`, `update`,
 *     `i18n`, `status` or `drop`, `_`, the entity's name and `.sql`
 *     (`drop_comp_<slug>` for a field group, `drop_<N>_collections_<hash>`
 *     for a bulk delete, whose first line lists the collections the count
 *     and hash are derived from, `drop_user_ext` for the user-field table);
 * (b) no snapshot stands beside it, and no dialect variant of it
 *     (`<name>.mysql.sql`), which the Builder never wrote: a variant is
 *     never one of its files, and shares its base's ledger name;
 * (c) it holds none of the lines `migrate:create` writes: the UP and DOWN
 *     section markers and the entity headers;
 * (d) every statement changes only that entity's own tables: its table, its
 *     translation table and its join tables. A drop file holds DROP TABLEs
 *     only, of tables the Builder owns.
 *
 * A file meeting all four is an old Builder file, which every reader of the
 * folder treats as absent. One that has the name but fails another part is
 * "partial": it is judged as any migration with no snapshot, and the parts it
 * lacks are named so it is never skipped without a word.
 *
 * @module domains/schema/migrate/old-builder-files
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { CORE_TABLE_NAMES } from "../../../schemas/core-schema";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { getTableName } from "../../collections/services/collection-utils";
import {
  dropFileHeader,
  dropFileLabel,
} from "../../dynamic-collections/services/drop-file-name";
import { parseEntityHeaders } from "../migrate-create/entity-headers";
import { MANAGED_TABLE_PREFIXES } from "../pipeline/managed-tables";
import {
  indexNameForColumn,
  MAX_INDEX_NAME_LENGTH,
  uniqueIndexNameForColumn,
} from "../services/index-name";

import { dialectVariantOf } from "./dialect-variant";
import { hasExecutableText, splitSqlStatements } from "./split-sql";
import { isDownMarker, isUpMarker } from "./sql-sections";
import {
  archiveWriteOf,
  indexesDroppedBy,
  indexesRenamedBy,
  registryRowWrittenBy,
  tablesChangedIn,
  tablesDroppedBy,
} from "./statement-targets";

/** A part of the signature a Builder-named file can lack. */
export type OldBuilderSignaturePart =
  | "snapshot"
  | "variant"
  | "header"
  | "scope";

export type MigrationFileKind =
  | { kind: "old-builder"; entity: string }
  | { kind: "partial"; lacks: OldBuilderSignaturePart[] }
  | { kind: "ordinary" };

/** What the classification reads of one file in the migrations folder. */
export interface MigrationFileFacts {
  /** The file's base name, `.sql` included. */
  name: string;
  content: string;
  /** Whether `meta/<base name>.snapshot.json` stands beside it. */
  hasSnapshot: boolean;
  /**
   * Whether a dialect variant of it (`<base name>.mysql.sql`) stands beside
   * it. The Builder never wrote one, and the variant shares the migration's
   * ledger name, so such a file is the variant's migration too.
   */
  hasDialectVariant: boolean;
  dialect: SupportedDialect;
  /**
   * The junction tables the configuration and the Builder's manifest name
   * with `options.junctionTable`, by the collection whose own fields declare
   * them: nothing in such a name ties it to a collection, so a statement on
   * one stays inside the entity only when the entity itself declares it.
   * Omitted, none is declared, and a file touching such a table is partial.
   */
  declaredJunctions?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * The entity tables the configuration and the Builder's manifest declare.
   * An index named alone is traced to the entity's own table unless a longer
   * reading of its name is a declared table. Omitted, any longer reading named
   * like an entity's table defeats it, which fails closed.
   */
  declaredTables?: ReadonlySet<string>;
}

/** (a): the timestamp, the verb and the rest of the name the Builder gave it. */
const BUILDER_FILE_NAME = /^\d{13}_(create|update|i18n|status|drop)_(.+)\.sql$/;

/** A bulk delete's name: how many collections, then a hash of their names. */
const BULK_DROP_NAME = /^\d+_collections_[0-9a-f]{12}$/;

/** A bulk delete's first line, listing the collections it deletes. */
const BULK_DROP_HEADER = /^-- Drop dynamic collections: (.+)$/;

/** The shared table an earlier Builder kept a translation's values in. */
const ARCHIVE_TABLE = "nextly_i18n_archive";

/** The user-field table, dropped by name, not by any collection's slug. */
const USER_EXT_TABLE = "user_ext";

/** Where a collection is registered: the table its own registry row is in. */
const COLLECTION_REGISTRY = "dynamic_collections";

/**
 * The entity a Builder file name gives, which tables are its own, and the
 * registry table holding its own row, when a file of its may write one.
 */
interface NamedEntity {
  slug: string;
  owns: (table: string) => boolean;
  registry?: string;
  /**
   * The tables whose drop marks a drop file as this entity's delete: its own
   * main table, or for a bulk delete each named collection's. A table dropped with
   * one of them is the entity's when it can be no one else's
   * (`dropsKeepToEntity`).
   */
  anchors?: (table: string) => boolean;
}

/**
 * Every entity a Builder file name can give. A drop's name can be read more
 * than one way: a collection whose slug is `user_ext` or starts with `comp_`
 * gives the same name as the user-field table's or a field group's drop. Each
 * reading is tried, and the file is the entity's whose tables it keeps to
 * (`classifyMigrationFile`); the special reading comes first.
 */
function entitiesOf(
  verb: string,
  rest: string,
  content: string
): NamedEntity[] {
  const collection = collectionEntity(rest);
  if (verb !== "drop") return [collection];
  if (BULK_DROP_NAME.test(rest)) return bulkDropEntity(rest, content);
  if (rest === USER_EXT_TABLE) {
    return [
      {
        slug: rest,
        owns: table => table === USER_EXT_TABLE,
        anchors: table => table === USER_EXT_TABLE,
      },
      collection,
    ];
  }
  if (rest.startsWith(STORAGE_FORMAT.tablePrefix)) {
    const own = rest;
    return [
      {
        slug: rest.slice(STORAGE_FORMAT.tablePrefix.length),
        owns: table => isOwnTable(own, table),
        anchors: table => table === own,
      },
      collection,
    ];
  }
  return [collection];
}

/**
 * A bulk delete as the Builder wrote it: its first line names the collections
 * (`dropFileHeader`), and its name is the count and digest derived from that
 * list (`dropFileLabel`). Only then does it name those collections, and it may
 * drop their own tables and what can be no one else's beside them. A file
 * whose name and first line disagree, or with no such line, names none, so
 * every statement leaves the entity and the file is partial: nothing ties
 * such a name to any one set of tables.
 */
function bulkDropEntity(rest: string, content: string): NamedEntity[] {
  const header = BULK_DROP_HEADER.exec(content.split("\n", 1)[0] ?? "");
  const names = header?.[1].split(", ") ?? [];
  if (
    names.length < 2 ||
    new Set(names).size !== names.length ||
    dropFileHeader(names) !== header?.[0] ||
    dropFileLabel(names) !== rest
  ) {
    return [];
  }
  const mains = names.map(name => getTableName(name));
  return [
    {
      slug: rest,
      owns: table => mains.some(own => isOwnTable(own, table)),
      anchors: table => mains.includes(table),
    },
  ];
}

/**
 * The collection a name gives, whose create file may also upsert the
 * collection's own registry row.
 */
function collectionEntity(slug: string): NamedEntity {
  const own = getTableName(slug);
  return {
    slug,
    owns: table => isOwnTable(own, table),
    registry: COLLECTION_REGISTRY,
    anchors: table => table === own,
  };
}

/** Whether `name` starts with a table prefix only Nextly's entities use. */
function isEntityTableName(name: string): boolean {
  return MANAGED_TABLE_PREFIXES.some(prefix => name.startsWith(prefix));
}

/**
 * Whether `table` is one of the tables of the entity whose main table is
 * `own`: that table, its `_locales` translation table, or a join table
 * between it and another entity's table, named as `junctionTableNameBetween`
 * names one (both tables sorted, then the field). A table that merely starts
 * with the entity's name, another collection's `dc_posts_archive` for
 * `dc_posts`, is not one of them.
 */
function isOwnTable(own: string, table: string): boolean {
  if (table === own || table === `${own}_locales`) return true;
  if (table.startsWith(`${own}_`)) {
    return isEntityTableName(table.slice(own.length + 1));
  }
  const at = table.indexOf(`_${own}_`);
  return at > 0 && isEntityTableName(table.slice(0, at));
}

/** The two names an index on one column is given, by their prefix. */
const COLUMN_INDEX_NAMES = [
  { prefix: "idx_", name: indexNameForColumn },
  { prefix: "uq_", name: uniqueIndexNameForColumn },
] as const;

/**
 * Whether an index named alone (dropped, or renamed on PostgreSQL) is on one
 * of the entity's tables: its name is exactly the one-column index name,
 * plain or unique, of a table and some column, and the longest such table
 * the entity owns is not defeated by a longer reading.
 *
 * A name reads several ways when a column holds an underscore:
 * `idx_dc_posts_publish_date` is `dc_posts`' `publish_date` or a table
 * `dc_posts_publish`'s `date`. A longer reading defeats the entity's own only
 * when its table is declared (`declaredTables`), so `idx_dc_posts_archive_title`
 * is not `posts`' while a `posts-archive` collection exists. With nothing
 * declared, any longer reading named like an entity's table defeats it, which
 * fails closed. Shorter readings never do: a junction's index names the
 * junction, which can start with the other side's table
 * (`idx_dc_authors_dc_posts_writers_posts`).
 *
 * A name at the length bound, or holding a character outside ASCII, is not
 * traced: it may be a bounded one, its readable part cut short and a hash
 * appended.
 */
function isOwnIndex(
  owns: (table: string) => boolean,
  index: string,
  declaredTables: ReadonlySet<string> | undefined
): boolean {
  if (index.length >= MAX_INDEX_NAME_LENGTH || !/^[\x20-\x7e]*$/.test(index)) {
    return false;
  }
  const tables = tablesNamedBy(index);
  const [own] = tables.filter(owns).sort((a, b) => b.length - a.length);
  if (own === undefined) return false;
  const defeats = (table: string) =>
    !owns(table) &&
    (declaredTables === undefined
      ? isEntityTableName(table)
      : declaredTables.has(table));
  return !tables.some(table => table.length > own.length && defeats(table));
}

/**
 * Every table `index` is exactly the one-column index name of, plain or
 * unique, for some column: each split of its name past the prefix into a
 * table and a column that the naming gives back as `index`.
 */
function tablesNamedBy(index: string): string[] {
  const tables: string[] = [];
  for (const { prefix, name } of COLUMN_INDEX_NAMES) {
    if (!index.startsWith(prefix)) continue;
    const rest = index.slice(prefix.length);
    for (let at = rest.indexOf("_"); at > 0; at = rest.indexOf("_", at + 1)) {
      const column = rest.slice(at + 1);
      if (column !== "" && name(rest.slice(0, at), column) === index) {
        tables.push(rest.slice(0, at));
      }
    }
  }
  return tables;
}

/** (c): whether the content carries any line `migrate:create` writes. */
function hasCreateHeader(content: string): boolean {
  const headers = parseEntityHeaders(content);
  if (
    headers.scoped ||
    headers.collections.length > 0 ||
    headers.singles.length > 0 ||
    headers.components.length > 0
  ) {
    return true;
  }
  return content
    .split("\n")
    .some(line => isUpMarker(line.trim()) || isDownMarker(line.trim()));
}

/**
 * Whether `statement` writes the entity's own registry row: a row of its
 * registry table keyed on its own slug, read exactly. A slug the scan cannot
 * read exactly is not the entity's, so such a file is partial.
 */
function writesOwnRegistryRow(
  entity: NamedEntity,
  statement: string,
  dialect: SupportedDialect
): boolean {
  if (entity.registry === undefined) return false;
  const row = registryRowWrittenBy(statement, dialect);
  return row?.table === entity.registry && row.slug === entity.slug;
}

/**
 * (d): whether every statement changes only the entity's own tables, drops
 * an index traced to one of them by name, or writes its own registry row; an
 * `_i18n_` or `_update_` file may also keep the entity's own translated
 * values in the shared archive (`keepsOwnValues`). A drop file is held to more: every
 * statement must be a DROP TABLE, since that is all the Builder ever wrote
 * into one.
 */
function staysInEntity(
  entity: NamedEntity,
  verb: string,
  file: MigrationFileFacts
): boolean {
  const statements = splitSqlStatements(file.content, file.dialect).filter(
    statement => hasExecutableText(statement, file.dialect)
  );
  if (statements.length === 0) return false;
  // A name read as one of the entity's tables (a junction-shaped one) that
  // is another entity's declared table is that entity's: only the entity's
  // own main table may be both.
  const declaredElsewhere = (table: string) =>
    file.declaredTables?.has(table) === true &&
    entity.anchors?.(table) !== true;
  const owns = (table: string) =>
    (entity.owns(table) && !declaredElsewhere(table)) ||
    file.declaredJunctions?.get(entity.slug)?.has(table) === true;
  if (verb === "drop") {
    return dropsKeepToEntity(entity, statements, file.dialect, owns);
  }
  return statements.every(statement => {
    if (writesOwnRegistryRow(entity, statement, file.dialect)) return true;
    // `_i18n_` turned translation off; `_update_` moved a field out of it.
    const archives = verb === "i18n" || verb === "update";
    if (archives && keepsOwnValues(entity, statement, file, owns)) {
      return true;
    }
    const indexes =
      indexesDroppedBy(statement, file.dialect) ??
      indexesRenamedBy(statement, file.dialect);
    if (indexes !== undefined) {
      return indexes.every(index =>
        isOwnIndex(owns, index, file.declaredTables)
      );
    }
    const tables = tablesChangedIn(statement, file.dialect);
    return tables !== undefined && tables.length > 0 && tables.every(owns);
  });
}

/**
 * Whether `statement` keeps the entity's own translated values in the shared
 * archive, as an earlier Builder's `_i18n_` or `_update_` file did before
 * dropping a translation: the archive created if absent, or the values copied into it
 * under the entity's own slug from its own tables (and the archive itself,
 * which the copy reads to skip a value already kept).
 */
function keepsOwnValues(
  entity: NamedEntity,
  statement: string,
  file: MigrationFileFacts,
  owns: (table: string) => boolean
): boolean {
  const write = archiveWriteOf(statement, file.dialect);
  if (write === undefined) return false;
  if (write.kind === "create") return true;
  return (
    write.slug === entity.slug &&
    write.reads.every(table => owns(table) || table === ARCHIVE_TABLE)
  );
}

/**
 * Whether every statement of a drop file is a DROP TABLE of the entity's own
 * tables. A delete removes the collection from the manifest, so a custom
 * junction it drops is declared by nothing once the file exists: a table
 * dropped alongside the entity's own main table is the entity's too, when its
 * name can be no other entity's (`mayBeEntityCompanion`).
 */
function dropsKeepToEntity(
  entity: NamedEntity,
  statements: readonly string[],
  dialect: SupportedDialect,
  owns: (table: string) => boolean
): boolean {
  const dropped = statements.map(statement =>
    tablesDroppedBy(statement, dialect)
  );
  if (dropped.some(tables => tables === undefined || tables.length === 0)) {
    return false;
  }
  const tables = dropped.flatMap(list => list ?? []);
  const dropsMain = entity.anchors !== undefined && tables.some(entity.anchors);
  return tables.every(
    table => owns(table) || (dropsMain && mayBeEntityCompanion(table))
  );
}

/**
 * Whether a table's name can belong to no entity but the one a drop file
 * deletes: no prefix only entities' tables carry, not the user-field table,
 * and not Nextly's own: a core table, or any name in its `nextly_` namespace.
 */
function mayBeEntityCompanion(table: string): boolean {
  return (
    !isEntityTableName(table) &&
    table !== USER_EXT_TABLE &&
    !table.startsWith("nextly_") &&
    !CORE_TABLE_NAMES.includes(table)
  );
}

/**
 * Whether a file name is one an earlier Schema Builder gave, part (a) of the
 * signature: the files worth reading to classify.
 */
export function hasOldBuilderName(name: string): boolean {
  // A dialect variant is never one: the Builder wrote one file per change.
  return BUILDER_FILE_NAME.test(name) && dialectVariantOf(name) === undefined;
}

/** Classify one file of the migrations folder by the Builder's signature. */
export function classifyMigrationFile(
  file: MigrationFileFacts
): MigrationFileKind {
  const named = hasOldBuilderName(file.name)
    ? BUILDER_FILE_NAME.exec(file.name)
    : null;
  if (!named) return { kind: "ordinary" };
  const [, verb, rest] = named;
  // The one reading of the name whose tables every statement keeps to.
  const entity = entitiesOf(verb, rest, file.content).find(candidate =>
    staysInEntity(candidate, verb, file)
  );

  const lacks: OldBuilderSignaturePart[] = [];
  if (file.hasSnapshot) lacks.push("snapshot");
  if (file.hasDialectVariant) lacks.push("variant");
  if (hasCreateHeader(file.content)) lacks.push("header");
  if (entity === undefined) lacks.push("scope");

  return entity !== undefined && lacks.length === 0
    ? { kind: "old-builder", entity: entity.slug }
    : { kind: "partial", lacks };
}
