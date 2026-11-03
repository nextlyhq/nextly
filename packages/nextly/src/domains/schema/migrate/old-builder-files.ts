/**
 * Which migration files an earlier Schema Builder wrote, known by their whole
 * signature, since nothing inside such a file says who wrote it:
 *
 * (a) its name is a 13-digit millisecond timestamp, `_`, `create`, `update`,
 *     `i18n`, `status` or `drop`, `_`, the entity's name and `.sql`
 *     (`drop_comp_<slug>` for a field group, `drop_<N>_collections_<hash>`
 *     for a bulk delete, `drop_user_ext` for the user-field table);
 * (b) no snapshot stands beside it;
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

import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { getTableName } from "../../collections/services/collection-utils";
import { parseEntityHeaders } from "../migrate-create/format-file";
import { MANAGED_TABLE_PREFIXES } from "../pipeline/managed-tables";
import {
  indexNameForColumn,
  MAX_INDEX_NAME_LENGTH,
  uniqueIndexNameForColumn,
} from "../services/index-name";

import { hasExecutableText, splitSqlStatements } from "./split-sql";
import { isDownMarker, isUpMarker } from "./sql-sections";
import {
  indexesDroppedBy,
  registryRowWrittenBy,
  tablesChangedIn,
  tablesDroppedBy,
} from "./statement-targets";

/** A part of the signature a Builder-named file can lack. */
export type OldBuilderSignaturePart = "snapshot" | "header" | "scope";

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
  dialect: SupportedDialect;
}

/** (a): the timestamp, the verb and the rest of the name the Builder gave it. */
const BUILDER_FILE_NAME = /^\d{13}_(create|update|i18n|status|drop)_(.+)\.sql$/;

/** A bulk delete's name: how many collections, then a hash of their names. */
const BULK_DROP_NAME = /^\d+_collections_[0-9a-f]{12}$/;

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
}

function entityOf(verb: string, rest: string): NamedEntity {
  if (verb === "drop") {
    // A bulk delete names no one collection: every table it drops must be
    // some Builder collection's, and only collections' tables carry `dc_`.
    if (BULK_DROP_NAME.test(rest)) {
      return { slug: rest, owns: table => table.startsWith("dc_") };
    }
    if (rest === USER_EXT_TABLE) {
      return { slug: rest, owns: table => table === USER_EXT_TABLE };
    }
    // Only a field group's drop carries its prefix; every other name is a collection's.
    if (rest.startsWith(STORAGE_FORMAT.tablePrefix)) {
      const own = rest;
      return {
        slug: rest.slice(STORAGE_FORMAT.tablePrefix.length),
        owns: table => isOwnTable(own, table),
      };
    }
  }
  // Every other file is a collection's, and a create file may also upsert
  // the collection's own registry row.
  const own = getTableName(rest);
  return {
    slug: rest,
    owns: table => isOwnTable(own, table),
    registry: COLLECTION_REGISTRY,
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
 * Whether an index dropped by name alone is on one of the entity's tables:
 * its name is exactly the one-column index name, plain or unique, of an own
 * table and some column. Two kinds of name are not traced, so a file
 * dropping one is partial:
 *
 * - one at the length bound, or holding a character outside ASCII, which may
 *   be a bounded name: its readable part cut short and a hash appended, so
 *   the table it names may be a prefix of the real one;
 * - one another entity's table also explains (`idx_dc_posts_archive_title` is
 *   `dc_posts`' `archive_title` or `dc_posts_archive`'s `title`).
 */
function isOwnIndex(entity: NamedEntity, index: string): boolean {
  if (index.length >= MAX_INDEX_NAME_LENGTH || !/^[\x20-\x7e]*$/.test(index)) {
    return false;
  }
  let owned = false;
  for (const { prefix, name } of COLUMN_INDEX_NAMES) {
    if (!index.startsWith(prefix)) continue;
    const rest = index.slice(prefix.length);
    for (let at = rest.indexOf("_"); at > 0; at = rest.indexOf("_", at + 1)) {
      const table = rest.slice(0, at);
      const column = rest.slice(at + 1);
      if (column === "" || name(table, column) !== index) continue;
      if (entity.owns(table)) owned = true;
      else if (isEntityTableName(table)) return false;
    }
  }
  return owned;
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
 * an index traced to one of them by name, or writes its own registry row. A drop file is held to more: every statement
 * must be a DROP TABLE, since that is all the Builder ever wrote into one.
 */
function staysInEntity(
  entity: NamedEntity,
  dropOnly: boolean,
  file: MigrationFileFacts
): boolean {
  const statements = splitSqlStatements(file.content, file.dialect).filter(
    statement => hasExecutableText(statement, file.dialect)
  );
  if (statements.length === 0) return false;
  const read = dropOnly ? tablesDroppedBy : tablesChangedIn;
  return statements.every(statement => {
    if (!dropOnly && writesOwnRegistryRow(entity, statement, file.dialect)) {
      return true;
    }
    const indexes = dropOnly
      ? undefined
      : indexesDroppedBy(statement, file.dialect);
    if (indexes !== undefined) {
      return indexes.every(index => isOwnIndex(entity, index));
    }
    const tables = read(statement, file.dialect);
    return (
      tables !== undefined &&
      tables.length > 0 &&
      tables.every(table => entity.owns(table))
    );
  });
}

/**
 * Whether a file name is one an earlier Schema Builder gave, part (a) of the
 * signature: the files worth reading to classify.
 */
export function hasOldBuilderName(name: string): boolean {
  return BUILDER_FILE_NAME.test(name);
}

/** Classify one file of the migrations folder by the Builder's signature. */
export function classifyMigrationFile(
  file: MigrationFileFacts
): MigrationFileKind {
  const named = BUILDER_FILE_NAME.exec(file.name);
  if (!named) return { kind: "ordinary" };
  const [, verb, rest] = named;
  const entity = entityOf(verb, rest);

  const lacks: OldBuilderSignaturePart[] = [];
  if (file.hasSnapshot) lacks.push("snapshot");
  if (hasCreateHeader(file.content)) lacks.push("header");
  if (!staysInEntity(entity, verb === "drop", file)) lacks.push("scope");

  return lacks.length === 0
    ? { kind: "old-builder", entity: entity.slug }
    : { kind: "partial", lacks };
}
