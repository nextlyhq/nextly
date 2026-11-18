/**
 * The registry record: written once for a database, by the first `nextly
 * migrate` run that finds none, naming the point the database was at then.
 *
 * A **point** is the newest applied app migration, by base name, or the
 * point before any app migration (`null`). Where that point has no registry
 * metadata (its snapshot predates recorded declarations, or there is no app
 * migration at all), the record keeps the **registry baseline** there: every
 * collection, Single and field group registry row, the slugs of the
 * permissions not orphaned, and each owned permission with its owner, as they
 * stood when the record was written. That
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

/**
 * One permission an owner declared (the app or a plugin), as it stood when
 * the record was written. Nextly's own and an entity's built-in permissions
 * have no owner and are kept as slugs alone.
 */
export interface BaselinePermission {
  slug: string;
  action: string;
  resource: string;
  name: string;
  description: string | null;
  permissionGroup: string | null;
  owner: string;
}

/** The registry and the live permissions at the record's point. */
export interface RegistryBaseline {
  /** Every registry row, by kind and then by slug. */
  collections: Record<string, BaselineRow>;
  singles: Record<string, BaselineRow>;
  fieldGroups: Record<string, BaselineRow>;
  /** The slugs of the permissions not orphaned, sorted. */
  permissions: string[];
  /**
   * Those of `permissions` an owner declared, each with its owner, sorted by
   * slug: what a later comparison reads an owner's permissions from, since
   * the live rows change with every development start and plugin install.
   * Absent from a record written before owners were kept, which cannot say
   * whose a slug was.
   */
  ownedPermissions?: BaselinePermission[];
}

/** The record as stored. */
export interface RegistryRecord {
  /** The newest applied app migration's base name, or null for the point before any. */
  point: string | null;
  /** The registry baseline, kept only where the point has no registry metadata. */
  baseline?: RegistryBaseline;
  /**
   * Each owned permission not orphaned when the record was written, kept
   * where there is no baseline to hold them: the point's snapshot may carry
   * the settings and still predate recording permissions, and a later
   * comparison then needs them as they stood. Absent from a record written
   * before owners were kept.
   */
  ownedPermissions?: BaselinePermission[];
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

/** Whether `value` is text, or null where the column allows none. */
const isTextOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

/**
 * Whether `value` is a list of owned permissions as the record keeps them:
 * every field the comparison reads, each of its stored type. One that lacks a
 * field is no record of a permission, and the record holding it is unreadable.
 */
function isOwnedPermissions(value: unknown): value is BaselinePermission[] {
  return (
    Array.isArray(value) &&
    value.every((row: unknown) => {
      if (typeof row !== "object" || row === null) return false;
      const p = row as Record<string, unknown>;
      return (
        typeof p.slug === "string" &&
        typeof p.action === "string" &&
        typeof p.resource === "string" &&
        typeof p.name === "string" &&
        isTextOrNull(p.description) &&
        isTextOrNull(p.permissionGroup) &&
        typeof p.owner === "string"
      );
    })
  );
}

/** Whether `value` is a list of slugs. */
const isSlugList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(slug => typeof slug === "string");

/** Whether `value` is an object, its fields not yet known. */
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** What each field of a stored baseline must hold for the baseline to be read. */
const BASELINE_FIELDS: Record<
  keyof RegistryBaseline,
  (value: unknown) => boolean
> = {
  collections: isRowsBySlug,
  singles: isRowsBySlug,
  fieldGroups: isRowsBySlug,
  permissions: isSlugList,
  ownedPermissions: value => value === undefined || isOwnedPermissions(value),
};

/** A stored value as an object: text is parsed, and text that is no JSON is nothing. */
function storedValue(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** The baseline `value` holds, or undefined where a field is not of its stored type. */
function decodeBaseline(value: unknown): RegistryBaseline | undefined {
  if (!isObject(value)) return undefined;
  const fields = Object.entries(BASELINE_FIELDS);
  if (!fields.every(([field, holds]) => holds(value[field]))) return undefined;
  const { collections, singles, fieldGroups, permissions, ownedPermissions } =
    value as unknown as RegistryBaseline;
  return {
    collections,
    singles,
    fieldGroups,
    permissions,
    ...(ownedPermissions === undefined ? {} : { ownedPermissions }),
  };
}

/** The record at `point` that keeps a baseline, or undefined where the baseline cannot be read. */
function recordWithBaseline(
  point: string | null,
  stored: unknown
): RegistryRecord | undefined {
  const baseline = decodeBaseline(stored);
  return baseline === undefined ? undefined : { point, baseline };
}

/** The record at `point` that keeps no baseline: the point alone, or with the owned permissions kept beside it. */
function recordWithoutBaseline(
  point: string | null,
  ownedPermissions: unknown
): RegistryRecord | undefined {
  if (ownedPermissions === undefined) return { point };
  return isOwnedPermissions(ownedPermissions)
    ? { point, ownedPermissions }
    : undefined;
}

/** The record a stored value holds, or undefined for anything else. */
function decodeRecord(raw: unknown): RegistryRecord | undefined {
  const value = storedValue(raw);
  if (!isObject(value)) return undefined;
  const { point, baseline, ownedPermissions } = value;
  if (!isTextOrNull(point)) return undefined;
  return baseline === undefined
    ? recordWithoutBaseline(point, ownedPermissions)
    : recordWithBaseline(point, baseline);
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

/** A permission row as stored, owned or not. */
export type LivePermission = Omit<BaselinePermission, "owner"> & {
  owner: string | null;
};

/**
 * The permissions not orphaned, as `db` holds them, sorted by slug. The one
 * read of them: the record is written from it, and a comparison with no
 * record of them to go by reads the same rows the same way.
 */
export async function livePermissions(
  db: unknown,
  dialect: SupportedDialect
): Promise<LivePermission[]> {
  const { permissions } = loadedDialect(dialect).tables;
  const live = (await (db as MetaDatabase)
    .select({
      slug: permissions.slug,
      action: permissions.action,
      resource: permissions.resource,
      name: permissions.name,
      description: permissions.description,
      permissionGroup: permissions.permissionGroup,
      owner: permissions.owner,
    })
    .from(permissions)
    .where(isNull(permissions.orphanedAt))) as LivePermission[];
  return live.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Those of `live` an owner declared. */
const ownedOf = (live: readonly LivePermission[]): BaselinePermission[] =>
  live.filter((row): row is BaselinePermission => row.owner !== null);

/**
 * Each owned permission not orphaned, as `db` holds them: what a record with
 * no baseline keeps (`RegistryRecord.ownedPermissions`).
 */
export async function takeOwnedPermissions(
  db: unknown,
  dialect: SupportedDialect
): Promise<BaselinePermission[]> {
  return ownedOf(await livePermissions(db, dialect));
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
  const live = await livePermissions(args.db, args.dialect);
  return {
    collections: rowsBySlug(collections),
    singles: rowsBySlug(singles),
    fieldGroups: rowsBySlug(fieldGroups),
    permissions: live.map(row => row.slug).sort(),
    ownedPermissions: ownedOf(live),
  };
}
