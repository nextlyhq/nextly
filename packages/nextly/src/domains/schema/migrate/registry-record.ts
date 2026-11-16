/**
 * The registry record: written once for a database, by the first `nextly
 * migrate` run that finds none, naming the point the database was at then.
 *
 * A **point** is the newest applied app migration, by base name, or the
 * point before any app migration (`null`). Where that point has no registry
 * metadata (its snapshot predates recorded declarations, or there is no app
 * migration at all), the record keeps the **registry baseline** there: every
 * collection, Single and field group registry row, and the slugs of the
 * permissions not orphaned, as they stood when the record was written. That
 * baseline is what the registry is at the record's point, since no snapshot
 * says so. Where the point's snapshot carries the metadata, the record keeps
 * no baseline.
 *
 * Stored as one `nextly_meta` row. This module is the only one that spells
 * its key, and it writes it only on the Drizzle handle of the transaction
 * that writes what the record says was written, so the record never commits
 * apart from it. The record is written once and never rewritten: a second
 * write fails on the row already there.
 *
 * @module domains/schema/migrate/registry-record
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { eq, isNull, type SQL } from "drizzle-orm";

import { loadedDialect } from "../../../database/dialect-tables";
import { NextlyError } from "../../../errors/nextly-error";
import type { Logger } from "../../../shared/types";
import { CollectionRegistryService } from "../../collections/services/collection-registry-service";
import { FieldGroupRegistryService } from "../../field-groups/services/field-group-registry-service";
import { SingleRegistryService } from "../../singles/services/single-registry-service";

/** The `nextly_meta` key the registry record is stored under. */
const REGISTRY_RECORD_KEY = "registry_record";

/** A registry row as stored, its dates as ISO text. */
export type BaselineRow = Record<string, unknown>;

/** The registry and the live permissions at the record's point. */
export interface RegistryBaseline {
  /** Every registry row, by kind and then by slug. */
  collections: Record<string, BaselineRow>;
  singles: Record<string, BaselineRow>;
  fieldGroups: Record<string, BaselineRow>;
  /** The slugs of the permissions not orphaned, sorted. */
  permissions: string[];
}

/** The record as stored. */
export interface RegistryRecord {
  /** The newest applied app migration's base name, or null for the point before any. */
  point: string | null;
  /** The registry baseline, kept only where the point has no registry metadata. */
  baseline?: RegistryBaseline;
}

/** The `nextly_meta` handle this module reads and writes through. */
interface MetaDatabase {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: SQL): PromiseLike<Record<string, unknown>[]> & {
        limit(count: number): PromiseLike<{ value: unknown }[]>;
      };
    };
  };
  insert(table: unknown): {
    values(values: Record<string, unknown>): PromiseLike<unknown>;
  };
}

/** The dialect's `nextly_meta` table and the condition naming the record's row. */
function recordRow(dialect: SupportedDialect) {
  const table = loadedDialect(dialect).tables.nextlyMeta;
  return { table, isRecord: eq(table.key, REGISTRY_RECORD_KEY) };
}

/** Whether `value` is an object of rows by slug. */
function isRowsBySlug(value: unknown): value is Record<string, BaselineRow> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      row => typeof row === "object" && row !== null && !Array.isArray(row)
    )
  );
}

/** The record a stored value holds, or undefined for anything else. */
function decodeRecord(raw: unknown): RegistryRecord | undefined {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (typeof value !== "object" || value === null) return undefined;
  const { point, baseline } = value as Record<string, unknown>;
  if (point !== null && typeof point !== "string") return undefined;
  if (baseline === undefined) return { point };
  if (typeof baseline !== "object" || baseline === null) return undefined;
  const b = baseline as Record<string, unknown>;
  if (
    !isRowsBySlug(b.collections) ||
    !isRowsBySlug(b.singles) ||
    !isRowsBySlug(b.fieldGroups) ||
    !Array.isArray(b.permissions) ||
    !b.permissions.every(slug => typeof slug === "string")
  ) {
    return undefined;
  }
  return {
    point,
    baseline: {
      collections: b.collections,
      singles: b.singles,
      fieldGroups: b.fieldGroups,
      permissions: b.permissions,
    },
  };
}

/**
 * The stored record on `db`, a Drizzle handle, or undefined where none is
 * stored. The caller asks only where `nextly_meta` exists. A row holding
 * something that is not a record is refused rather than read as absent:
 * read as absent, the run would take it for a first run and write the
 * registry from the configuration again.
 */
export async function readRegistryRecord(
  db: unknown,
  dialect: SupportedDialect
): Promise<RegistryRecord | undefined> {
  const { table, isRecord } = recordRow(dialect);
  const rows = await (db as MetaDatabase)
    .select({ value: table.value })
    .from(table)
    .where(isRecord)
    .limit(1);
  if (rows.length === 0) return undefined;
  const record = decodeRecord(rows[0].value);
  if (record === undefined) {
    throw NextlyError.internal({
      logContext: {
        reason: `the stored registry record (nextly_meta "${REGISTRY_RECORD_KEY}") cannot be read`,
      },
    });
  }
  return record;
}

/**
 * Store `record` on `db`, the Drizzle handle of the transaction that writes
 * what it says was written. A plain insert: a record already stored makes it
 * fail, and the transaction with it, so a record is never rewritten.
 */
export async function storeRegistryRecord(
  db: unknown,
  dialect: SupportedDialect,
  record: RegistryRecord
): Promise<void> {
  const { table } = recordRow(dialect);
  await (db as MetaDatabase).insert(table).values({
    key: REGISTRY_RECORD_KEY,
    // JSON text, as the schema version is stored: PostgreSQL and MySQL keep
    // it as a JSON string, and it is read back whichever form comes.
    value: JSON.stringify(record),
    updatedAt: new Date(),
  });
}

/** A registry table's rows by slug, as stored, made JSON-safe. */
function rowsBySlug(
  rows: readonly { slug: string }[]
): Record<string, BaselineRow> {
  const bySlug: Record<string, BaselineRow> = {};
  for (const row of [...rows].sort((a, b) => a.slug.localeCompare(b.slug))) {
    // Through JSON, so a date reads back as the text it is stored as.
    bySlug[row.slug] = JSON.parse(JSON.stringify(row)) as BaselineRow;
  }
  return bySlug;
}

/**
 * The registry baseline as the database stands: every registry row through
 * its registry service, and the permissions not orphaned. Read through
 * `adapter` and `db`; inside a registry write both read on its transaction
 * (`writeRegistryRows`), so the baseline is what that transaction commits.
 */
export async function takeRegistryBaseline(args: {
  adapter: DrizzleAdapter;
  db: unknown;
  dialect: SupportedDialect;
  logger: Logger;
}): Promise<RegistryBaseline> {
  const { adapter, logger } = args;
  const collections = await new CollectionRegistryService(
    adapter,
    logger
  ).getAllCollections();
  const singles = await new SingleRegistryService(
    adapter,
    logger
  ).getAllSingles();
  const fieldGroups = await new FieldGroupRegistryService(
    adapter,
    logger
  ).getAllComponents();
  const { permissions } = loadedDialect(args.dialect).tables;
  const live = (await (args.db as MetaDatabase)
    .select({ slug: permissions.slug })
    .from(permissions)
    .where(isNull(permissions.orphanedAt))) as { slug: string }[];
  return {
    collections: rowsBySlug(collections),
    singles: rowsBySlug(singles),
    fieldGroups: rowsBySlug(fieldGroups),
    permissions: live.map(row => row.slug).sort(),
  };
}
