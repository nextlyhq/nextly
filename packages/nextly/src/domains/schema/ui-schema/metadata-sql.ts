/**
 * Per-dialect metadata-row upsert SQL for UI-built entities (spec §4.12.7).
 *
 * `migrate:create` appends one of these statements per UI-built entity whose
 * data table is touched in a migration, so that after `nextly migrate` runs in
 * production the collection/single/component appears in the admin UI — the
 * `dynamic_collections` / `dynamic_singles` / `dynamic_components` metadata row
 * is created/updated by the same committed `.sql` that creates the data table.
 *
 * The row is built to match what the runtime would write: `schema_hash` reuses
 * the runtime `calculateSchemaHash`; `fields` is stored 1:1; labels derive from
 * the slug via the shared helpers. `id` is derived deterministically from the
 * slug so the committed SQL is byte-stable.
 *
 * KNOWN LIMITATION (v1): label-only edits produce no DDL operation, so no
 * migration is generated and the label change is not propagated until a schema
 * change co-occurs.
 *
 * @module domains/schema/ui-schema/metadata-sql
 * @since v0.0.3-alpha (Plan D2b)
 */
import { createHash } from "node:crypto";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { UiSchemaEntity } from "../../../schemas/_zod/ui-schema";
import {
  toPluralLabel,
  toSingularLabel,
} from "../../../shared/lib/pluralization";
import { quoteIdent } from "../pipeline/sql-templates/identifier-quoting";
import { calculateSchemaHash } from "../services/schema-hash";

type Dialect = SupportedDialect;

/** Deterministic UUID-shaped id from a slug (stable committed SQL). */
function deterministicId(slug: string): string {
  const hex = createHash("sha256").update(`ui:${slug}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** SQL single-quoted string literal (standard single-quote doubling). */
function sqlStr(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** JSON value literal. PG casts to jsonb; MySQL/SQLite store the JSON text. */
function jsonLiteral(value: unknown, dialect: Dialect): string {
  const lit = sqlStr(JSON.stringify(value));
  return dialect === "postgresql" ? `${lit}::jsonb` : lit;
}

/** Boolean literal: integer on SQLite, keyword elsewhere. */
function boolLiteral(value: boolean, dialect: Dialect): string {
  if (dialect === "sqlite") return value ? "1" : "0";
  return value ? "true" : "false";
}

/**
 * "Now" SQL expression per dialect. created_at/updated_at use Drizzle
 * `$defaultFn` (app-level, NO DB default), so a raw INSERT must set them or
 * NOT NULL fails. SQLite stores epoch-ms integers; PG/MySQL use timestamps.
 */
function nowExpr(dialect: Dialect): string {
  if (dialect === "sqlite")
    return "CAST(strftime('%s','now') AS INTEGER) * 1000";
  if (dialect === "mysql") return "NOW(3)";
  return "now()";
}

/** created_at + updated_at columns (set explicitly — no usable DB default). */
function timestampColumns(dialect: Dialect): Column[] {
  const now = nowExpr(dialect);
  return [
    { name: "created_at", value: now },
    { name: "updated_at", value: now, update: true },
  ];
}

interface Column {
  name: string;
  value: string;
  /** Whether this column is updated on conflict (mutable). */
  update?: boolean;
}

/** Assemble an INSERT … upsert for the given dialect. */
function buildUpsert(
  table: string,
  columns: Column[],
  dialect: Dialect
): string {
  const idents = columns.map(c => quoteIdent(c.name, dialect)).join(", ");
  const values = columns.map(c => c.value).join(", ");
  const insert = `INSERT INTO ${quoteIdent(table, dialect)} (${idents}) VALUES (${values})`;
  const updatable = columns.filter(c => c.update);

  if (dialect === "mysql") {
    const sets = updatable
      .map(
        c =>
          `${quoteIdent(c.name, dialect)} = VALUES(${quoteIdent(c.name, dialect)})`
      )
      .join(", ");
    return `${insert} ON DUPLICATE KEY UPDATE ${sets}`;
  }

  const sets = updatable
    .map(
      c =>
        `${quoteIdent(c.name, dialect)} = EXCLUDED.${quoteIdent(c.name, dialect)}`
    )
    .join(", ");
  return `${insert} ON CONFLICT (${quoteIdent("slug", dialect)}) DO UPDATE SET ${sets}`;
}

function tableNameFor(
  slug: string,
  prefix: "dc_" | "single_" | "comp_"
): string {
  return `${prefix}${slug.replace(/-/g, "_")}`;
}

function singular(entity: UiSchemaEntity): string {
  return entity.labels?.singular ?? toSingularLabel(entity.slug);
}

function hashOf(entity: UiSchemaEntity): string {
  return calculateSchemaHash(
    entity.fields as unknown as Parameters<typeof calculateSchemaHash>[0]
  );
}

export function buildCollectionMetadataUpsert(
  entity: UiSchemaEntity,
  dialect: Dialect
): string {
  const labels = {
    singular: singular(entity),
    plural: entity.labels?.plural ?? toPluralLabel(entity.slug),
  };
  const columns: Column[] = [
    { name: "id", value: sqlStr(deterministicId(entity.slug)) },
    { name: "slug", value: sqlStr(entity.slug) },
    { name: "labels", value: jsonLiteral(labels, dialect), update: true },
    { name: "table_name", value: sqlStr(tableNameFor(entity.slug, "dc_")) },
    {
      name: "fields",
      value: jsonLiteral(entity.fields, dialect),
      update: true,
    },
    { name: "source", value: sqlStr("ui") },
    { name: "schema_hash", value: sqlStr(hashOf(entity)), update: true },
    {
      name: "status",
      value: boolLiteral(entity.status === true, dialect),
      update: true,
    },
    {
      // Persist the localization flag so boot's loadDynamicTables registers the
      // companion runtime table; without it the registry row stays localized=false
      // and a Builder-localized collection never resolves its _locales fields.
      name: "localized",
      value: boolLiteral(entity.localized === true, dialect),
      update: true,
    },
    { name: "migration_status", value: sqlStr("applied") },
  ];
  if (entity.admin !== undefined) {
    columns.push({
      name: "admin",
      value: jsonLiteral(entity.admin, dialect),
      update: true,
    });
  }
  columns.push(...timestampColumns(dialect));
  return buildUpsert("dynamic_collections", columns, dialect);
}

export function buildSingleMetadataUpsert(
  entity: UiSchemaEntity,
  dialect: Dialect
): string {
  const columns: Column[] = [
    { name: "id", value: sqlStr(deterministicId(entity.slug)) },
    { name: "slug", value: sqlStr(entity.slug) },
    { name: "label", value: sqlStr(singular(entity)), update: true },
    {
      name: "table_name",
      value: sqlStr(tableNameFor(entity.slug, "single_")),
    },
    {
      name: "fields",
      value: jsonLiteral(entity.fields, dialect),
      update: true,
    },
    { name: "source", value: sqlStr("ui") },
    { name: "schema_hash", value: sqlStr(hashOf(entity)), update: true },
    {
      name: "status",
      value: boolLiteral(entity.status === true, dialect),
      update: true,
    },
    {
      // Mirror the collection upsert: persist the flag so the registry row and
      // boot-time companion registration reflect the single's config.
      name: "localized",
      value: boolLiteral(entity.localized === true, dialect),
      update: true,
    },
    { name: "migration_status", value: sqlStr("applied") },
  ];
  columns.push(...timestampColumns(dialect));
  return buildUpsert("dynamic_singles", columns, dialect);
}

export function buildComponentMetadataUpsert(
  entity: UiSchemaEntity,
  dialect: Dialect
): string {
  const columns: Column[] = [
    { name: "id", value: sqlStr(deterministicId(entity.slug)) },
    { name: "slug", value: sqlStr(entity.slug) },
    { name: "label", value: sqlStr(singular(entity)), update: true },
    { name: "table_name", value: sqlStr(tableNameFor(entity.slug, "comp_")) },
    {
      name: "fields",
      value: jsonLiteral(entity.fields, dialect),
      update: true,
    },
    { name: "source", value: sqlStr("ui") },
    {
      // Persist the Builder localized flag so boot reads the component as localized and
      // resolves/writes its companion `comp_<slug>_locales` fields; without it the registry
      // row stays localized=false and embedded reads/writes target the omitted main columns.
      name: "localized",
      value: boolLiteral(entity.localized === true, dialect),
      update: true,
    },
    { name: "schema_hash", value: sqlStr(hashOf(entity)), update: true },
    { name: "migration_status", value: sqlStr("applied") },
  ];
  columns.push(...timestampColumns(dialect));
  return buildUpsert("dynamic_components", columns, dialect);
}
