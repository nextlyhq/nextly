/**
 * Which migration files an earlier Schema Builder wrote, known by their whole
 * signature, since nothing inside such a file says who wrote it:
 *
 * (a) its name is a 13-digit millisecond timestamp, `_`, `create`, `update`,
 *     `i18n`, `status` or `drop`, `_`, the entity's name and `.sql`
 *     (`drop_comp_<slug>` for a field group);
 * (b) no snapshot stands beside it;
 * (c) it holds none of the lines `migrate:create` writes: the UP and DOWN
 *     section markers and the entity headers;
 * (d) every statement changes only that entity's own tables: its table, its
 *     translation table and its join tables.
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

import { hasExecutableText, splitSqlStatements } from "./split-sql";
import { isDownMarker, isUpMarker } from "./sql-sections";
import { tablesChangedIn } from "./statement-targets";

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

/** The entity a Builder file name gives, as its main table. */
function entityOf(verb: string, rest: string): { slug: string; table: string } {
  // Only a field group's drop carries its prefix; every other name is a collection's.
  if (verb === "drop" && rest.startsWith(STORAGE_FORMAT.tablePrefix)) {
    const slug = rest.slice(STORAGE_FORMAT.tablePrefix.length);
    return { slug, table: `${STORAGE_FORMAT.tablePrefix}${slug}` };
  }
  return { slug: rest, table: getTableName(rest) };
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

/** (d): whether every statement changes only `own`'s tables. */
function staysInEntity(own: string, file: MigrationFileFacts): boolean {
  const statements = splitSqlStatements(file.content, file.dialect).filter(
    statement => hasExecutableText(statement, file.dialect)
  );
  if (statements.length === 0) return false;
  return statements.every(statement => {
    const tables = tablesChangedIn(statement, file.dialect);
    return (
      tables !== undefined &&
      tables.length > 0 &&
      tables.every(table => isOwnTable(own, table))
    );
  });
}

/** Classify one file of the migrations folder by the Builder's signature. */
export function classifyMigrationFile(
  file: MigrationFileFacts
): MigrationFileKind {
  const named = BUILDER_FILE_NAME.exec(file.name);
  if (!named) return { kind: "ordinary" };
  const entity = entityOf(named[1], named[2]);

  const lacks: OldBuilderSignaturePart[] = [];
  if (file.hasSnapshot) lacks.push("snapshot");
  if (hasCreateHeader(file.content)) lacks.push("header");
  if (!staysInEntity(entity.table, file)) lacks.push("scope");

  return lacks.length === 0
    ? { kind: "old-builder", entity: entity.slug }
    : { kind: "partial", lacks };
}
