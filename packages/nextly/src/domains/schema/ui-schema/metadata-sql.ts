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
 * KNOWN LIMITATION (v1): metadata-only edits produce no DDL operation, so no
 * migration is generated and the change is not propagated until a schema
 * change co-occurs. This covers labels, and equally the `status`, `localized`,
 * `versions`, `versionsMaxPerDoc` (retention), `revalidate` and `webhooks`
 * flags: changing one alone leaves the deployed registry row on its previous
 * value until the next migration for that table.
 *
 * `webhooks` and `versionsMaxPerDoc` carry the sharpest consequences of that
 * limitation. `webhooks` governs whether content reaches the outbox: turning
 * recording off in the Builder opts the development database out while a
 * deployed environment keeps recording and delivering until a schema change
 * ships alongside it. `versionsMaxPerDoc` governs how much history is kept:
 * lowering the cap (or leaving a finite one in place instead of "keep all") in
 * the Builder does not reach a deployed environment, which keeps pruning to its
 * old cap. Until metadata-only edits generate their own migration, an operator
 * who needs either change in production should set it in code-first config,
 * which is republished on every boot and needs no migration.
 *
 * @module domains/schema/ui-schema/metadata-sql
 * @since v0.0.3-alpha (Plan D2b)
 */
import { createHash } from "node:crypto";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { resolveBuilderRevalidate } from "../../../revalidation/builder-revalidate";
import type { UiSchemaEntity } from "../../../schemas/_zod/ui-schema";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import {
  toPluralLabel,
  toSingularLabel,
} from "../../../shared/lib/pluralization";
import { resolveBuilderVersions } from "../../versions/builder-versions";
import { resolveBuilderWebhooks } from "../../webhooks/builder-webhooks";
import { quoteIdent } from "../pipeline/sql-templates/identifier-quoting";
import { calculateSchemaHash } from "../services/schema-hash";
import { quoteSqlLiteral } from "../utils/sql-literal";

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
/**
 * A quoted SQL string literal for the target dialect.
 *
 * 🔴 DELEGATES rather than escaping here. This doubled apostrophes and left
 * backslashes alone, which is correct for PostgreSQL and SQLite and wrong for
 * MySQL, where a backslash introduces an escape. JSON is where that bites:
 * every `\d` in a field's validation pattern, and every encoded newline, is a
 * backslash pair that MySQL would consume -- changing the stored JSON or making
 * the statement invalid, after the table DDL in the same file has already run.
 *
 * `quoteSqlLiteral` is the answer this repository already has, and its own
 * docblock describes this exact failure. A second escaping rule beside it is
 * how the two came to disagree.
 */
function sqlStr(value: string, dialect: Dialect): string {
  return quoteSqlLiteral(value, dialect);
}

/** JSON value literal. PG casts to jsonb; MySQL/SQLite store the JSON text. */
function jsonLiteral(value: unknown, dialect: Dialect): string {
  const lit = sqlStr(JSON.stringify(value), dialect);
  return dialect === "postgresql" ? `${lit}::jsonb` : lit;
}

/**
 * The `versions` column value for a manifest entity.
 *
 * The column holds the resolved config every runtime reader tests, so the
 * manifest's boolean is normalized through the same mapping the Builder's write
 * paths use.
 */
function versionsLiteral(
  versions: boolean | undefined,
  maxPerDoc: number | false | undefined,
  dialect: Dialect
): string {
  const resolved = resolveBuilderVersions(versions, maxPerDoc);
  return resolved === null ? "NULL" : jsonLiteral(resolved, dialect);
}

/**
 * The `revalidate` column value for a manifest entity.
 *
 * The column holds the resolved `{ tags?, disable? }` config the write path
 * reads, so the manifest's on/off boolean is normalized through the same
 * mapping the Builder's write paths use: on → NULL (standard revalidation),
 * off → the disable config.
 */
function revalidateLiteral(
  revalidate: boolean | undefined,
  dialect: Dialect
): string {
  const resolved = resolveBuilderRevalidate(revalidate);
  return resolved === null ? "NULL" : jsonLiteral(resolved, dialect);
}

/**
 * The `webhooks` column value for a manifest entity.
 *
 * The column holds the resolved `{ record }` policy boot reads back, so the
 * manifest's on/off boolean is normalized through the same mapping the
 * Builder's write paths use: on → NULL (record, the default), off → the
 * stored opt-out.
 */
function webhooksLiteral(
  webhooks: boolean | undefined,
  dialect: Dialect
): string {
  const resolved = resolveBuilderWebhooks(webhooks);
  return resolved === null ? "NULL" : jsonLiteral(resolved, dialect);
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
/**
 * The `description` column value: the text, or NULL when the entity has none.
 *
 * 🔴 ALWAYS emitted, including when absent. A column left out of the upsert is
 * untouched by its `DO UPDATE SET`, so omitting it would make clearing a
 * description impossible to propagate -- the same reasoning `versions`,
 * `revalidate` and `webhooks` state beside their own columns.
 */
function descriptionLiteral(
  description: string | undefined | null,
  dialect: Dialect
): string {
  // 🔴 `null` as well as `undefined`. The create body reaches this unvalidated,
  // so a caller sending `description: null` — which is what "clear it" looks
  // like over JSON — otherwise reached `quoteSqlLiteral` and threw on `.replace`
  // of a non-string, turning a routine create into a 500.
  return description === undefined || description === null
    ? "NULL"
    : sqlStr(description, dialect);
}

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
  prefix: "dc_" | "single_" | typeof STORAGE_FORMAT.tablePrefix
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
    { name: "id", value: sqlStr(deterministicId(entity.slug), dialect) },
    { name: "slug", value: sqlStr(entity.slug, dialect) },
    { name: "labels", value: jsonLiteral(labels, dialect), update: true },
    {
      name: "description",
      value: descriptionLiteral(entity.description, dialect),
      update: true,
    },
    {
      // 🔴 COLLECTIONS ONLY. Stored hook configs travel with the row for the
      // same reason its fields do: the hook service reads them from here, so a
      // row without them runs none. `dynamic_singles` and the component
      // registry have NO such column, so emitting it there would name a column
      // that does not exist and fail every migration for those kinds.
      // NULL when absent, and always emitted, so removing every hook
      // propagates rather than leaving the previous set standing.
      name: "hooks",
      value:
        entity.hooks === undefined
          ? "NULL"
          : jsonLiteral(entity.hooks, dialect),
      update: true,
    },
    {
      name: "table_name",
      value: sqlStr(tableNameFor(entity.slug, "dc_"), dialect),
    },
    {
      name: "fields",
      value: jsonLiteral(entity.fields, dialect),
      update: true,
    },
    { name: "source", value: sqlStr("ui", dialect) },
    {
      name: "schema_hash",
      value: sqlStr(hashOf(entity), dialect),
      update: true,
    },
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
    {
      // Always written, including when off: turning the switch off has to clear
      // the column, and a column left out of the upsert is untouched by its
      // DO UPDATE SET.
      name: "versions",
      value: versionsLiteral(
        entity.versions,
        entity.versionsMaxPerDoc,
        dialect
      ),
      update: true,
    },
    {
      // Always written, including when off (same reason as versions): flipping
      // the switch off must clear the column, and a column left out of the
      // upsert is untouched by its DO UPDATE SET.
      name: "revalidate",
      value: revalidateLiteral(entity.revalidate, dialect),
      update: true,
    },
    {
      // Always written, including when recording is on (same reason as
      // revalidate): turning it off has to occupy the column, and a column left
      // out of the upsert is untouched by its DO UPDATE SET.
      name: "webhooks",
      value: webhooksLiteral(entity.webhooks, dialect),
      update: true,
    },
    { name: "migration_status", value: sqlStr("applied", dialect) },
  ];
  // 🔴 Emitted for every kind, because every registry table HAS this column —
  // checked per table rather than assumed. The shared manifest schema accepts
  // `icon`, `hidden`, `order` and `sidebarGroup` for singles and components as
  // well, so a builder that omitted the column let those settings validate,
  // deploy, and be ignored, leaving an entity visible that the manifest said
  // was hidden.
  //
  // CONDITIONAL, unlike `description`: an absent block leaves the stored value
  // alone rather than clearing it, which is what lets a manifest that says
  // nothing about presentation not erase it.
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
    { name: "id", value: sqlStr(deterministicId(entity.slug), dialect) },
    { name: "slug", value: sqlStr(entity.slug, dialect) },
    { name: "label", value: sqlStr(singular(entity), dialect), update: true },
    {
      name: "description",
      value: descriptionLiteral(entity.description, dialect),
      update: true,
    },
    {
      name: "table_name",
      value: sqlStr(tableNameFor(entity.slug, "single_"), dialect),
    },
    {
      name: "fields",
      value: jsonLiteral(entity.fields, dialect),
      update: true,
    },
    { name: "source", value: sqlStr("ui", dialect) },
    {
      name: "schema_hash",
      value: sqlStr(hashOf(entity), dialect),
      update: true,
    },
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
    {
      // Always written, including when off: turning the switch off has to clear
      // the column, and a column left out of the upsert is untouched by its
      // DO UPDATE SET.
      name: "versions",
      value: versionsLiteral(
        entity.versions,
        entity.versionsMaxPerDoc,
        dialect
      ),
      update: true,
    },
    {
      // Mirror the collection upsert: always written so flipping off clears it.
      name: "revalidate",
      value: revalidateLiteral(entity.revalidate, dialect),
      update: true,
    },
    {
      // Always written, including when recording is on (same reason as
      // revalidate): turning it off has to occupy the column, and a column left
      // out of the upsert is untouched by its DO UPDATE SET.
      name: "webhooks",
      value: webhooksLiteral(entity.webhooks, dialect),
      update: true,
    },
    { name: "migration_status", value: sqlStr("applied", dialect) },
  ];
  columns.push(...timestampColumns(dialect));
  if (entity.admin !== undefined) {
    columns.push({
      name: "admin",
      value: jsonLiteral(entity.admin, dialect),
      update: true,
    });
  }
  return buildUpsert("dynamic_singles", columns, dialect);
}

export function buildComponentMetadataUpsert(
  entity: UiSchemaEntity,
  dialect: Dialect
): string {
  const columns: Column[] = [
    { name: "id", value: sqlStr(deterministicId(entity.slug), dialect) },
    { name: "slug", value: sqlStr(entity.slug, dialect) },
    { name: "label", value: sqlStr(singular(entity), dialect), update: true },
    {
      name: "description",
      value: descriptionLiteral(entity.description, dialect),
      update: true,
    },
    {
      name: "table_name",
      value: sqlStr(
        tableNameFor(entity.slug, STORAGE_FORMAT.tablePrefix),
        dialect
      ),
    },
    {
      name: "fields",
      value: jsonLiteral(entity.fields, dialect),
      update: true,
    },
    { name: "source", value: sqlStr("ui", dialect) },
    {
      // Persist the Builder localized flag so boot reads the component as localized and
      // resolves/writes its companion `comp_<slug>_locales` fields; without it the registry
      // row stays localized=false and embedded reads/writes target the omitted main columns.
      name: "localized",
      value: boolLiteral(entity.localized === true, dialect),
      update: true,
    },
    {
      name: "schema_hash",
      value: sqlStr(hashOf(entity), dialect),
      update: true,
    },
    { name: "migration_status", value: sqlStr("applied", dialect) },
  ];
  columns.push(...timestampColumns(dialect));
  if (entity.admin !== undefined) {
    columns.push({
      name: "admin",
      value: jsonLiteral(entity.admin, dialect),
      update: true,
    });
  }
  return buildUpsert(STORAGE_FORMAT.registryTable, columns, dialect);
}
