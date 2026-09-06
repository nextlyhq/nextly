/**
 * Migration Metadata Registration Service
 *
 * Registers collections and singles from migration snapshot files into Nextly's
 * metadata system (dynamic_collections and dynamic_singles tables).
 *
 * This bridges the gap between SQL migrations (which create physical tables)
 * and Nextly's collection registry (which needs metadata to function).
 *
 * Use Case: Visual approach with migrations
 * - Migrations create tables via SQL
 * - Snapshots define the schema metadata
 * - This service registers the metadata so Nextly can query the collections
 *
 * @module domains/schema/migrate/metadata-register
 */

import { createHash, randomUUID } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { eq } from "drizzle-orm";

import type { FieldConfig } from "@nextly/collections";
import {
  dynamicCollectionsMysql,
  dynamicCollectionsSqlite,
  dynamicCollectionsPg,
} from "@nextly/schemas/dynamic-collections";
import type { CollectionAdminConfig } from "@nextly/schemas/dynamic-collections/types";
import { dynamicSinglesMysql } from "@nextly/schemas/dynamic-singles/mysql";
import { dynamicSinglesPg } from "@nextly/schemas/dynamic-singles/postgres";
import { dynamicSinglesSqlite } from "@nextly/schemas/dynamic-singles/sqlite";

import type { SingleAdminOptions } from "../../../config";
import { isReservedResourceSlug } from "../../../schemas/_zod/rbac";
import { simplePluralize } from "../../../shared/lib/pluralization";

import {
  loadSnapshots,
  newestApplied,
  type LoadedSnapshot,
  type SnapshotCollection,
  type SnapshotSingle,
} from "./snapshot-source";

/**
 * Minimal Drizzle database interface for the operations needed in metadata registration.
 * Provides type safety for getDrizzle calls without relying on dialect-specific types.
 */
interface DrizzleDatabase {
  select(): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(n: number): Promise<unknown[]>;
      };
    };
  };
  insert(table: unknown): {
    values(data: unknown): Promise<unknown[]>;
  };
}

/*
 * The snapshot shapes and the reader that produces them live in
 * `snapshot-source`, because the pending sweep asks the same directory the same
 * question. Re-exported here so existing importers of this module keep working.
 */
export type {
  SnapshotCollection,
  SnapshotSingle,
  MigrationSnapshot,
} from "./snapshot-source";

/**
 * Options for registering collections from migrations
 */
export interface RegisterFromMigrationsOptions {
  /**
   * Path to the migrations directory
   */
  migrationsDir: string;

  /**
   * Database adapter for executing SQL
   */
  adapter: unknown;

  /**
   * Database dialect (postgres, mysql, sqlite)
   */
  dialect: SupportedDialect;

  /**
   * Whether the migration a snapshot belongs to has actually been applied.
   *
   * 🔴 Registration inserts entities as `applied`, so without this it asserts
   * something it has not checked. Every `*.snapshot.json` in the directory is
   * read and merged, including snapshots for migrations a `--step N` run has
   * not reached — and those entities are then exposed as applied while their
   * tables may not exist, beyond the reach of the pending sweep that would
   * otherwise repair them, because they are no longer pending.
   *
   * Called with the LEDGER filename, which is the migration group's `.sql`
   * name rather than a dialect variant: `runFileMigrations` records
   * `0001_x.sql` whether it executed `0001_x.sql` or `0001_x.mysql.sql`, and
   * the snapshot beside it is `meta/0001_x.snapshot.json`.
   *
   * 🔴 Answering it decides a SLUG, not a file. A slug is registered only when
   * the newest snapshot describing it is applied, because that snapshot is the
   * shape registration would write. Deciding per file instead registers the
   * newest APPLIED shape of a slug whose later migration is still pending, and
   * nothing ever revisits it: {@link registerCollection} and
   * {@link registerSingle} insert once and return early forever after, so the
   * row keeps the intermediate shape after the later migration lands.
   *
   * Withholding the row until its shape settles is the opposite trade from the
   * localized-companion provisioning in the migrate command, which skips
   * wholesale while anything is pending. That rule exists because provisioning
   * early makes a later migration's unconditional `CREATE TABLE` fail — a hard
   * collision with no equivalent here, where the only cost of registering an
   * entity whose migrations have all run is nothing at all. So this withholds
   * per slug rather than per run, and an entity settled by the migrations that
   * did apply is registered normally.
   *
   * OPTIONAL, and omitting it means "register everything". That is correct for
   * the dev boot path, which applies every pending migration immediately
   * before registering, so no unapplied snapshot can exist for it to skip. Any
   * caller that registers WITHOUT having just applied everything must pass it.
   */
  isApplied?: (ledgerFilename: string) => Promise<boolean>;

  /**
   * Logger for output
   */
  logger?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
    debug?: (msg: string) => void;
  };
}

/**
 * Merge collections from multiple snapshots
 * Later snapshots override earlier ones for the same slug
 */
function mergeCollections(
  loaded: LoadedSnapshot[],
  logger?: { debug?: (msg: string) => void }
): SnapshotCollection[] {
  return newestApplied(loaded, s => s.collections, logger);
}

/**
 * Merge singles from multiple snapshots
 */
function mergeSingles(
  loaded: LoadedSnapshot[],
  logger?: { debug?: (msg: string) => void }
): SnapshotSingle[] {
  return newestApplied(loaded, s => s.singles, logger);
}

/**
 * Generate labels from slug if not provided
 */
function normalizeCollection(collection: SnapshotCollection): {
  singular: string;
  plural: string;
} {
  const singular =
    collection.labels?.singular ??
    collection.slug
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");

  const plural = collection.labels?.plural ?? simplePluralize(singular);

  return { singular, plural };
}

/**
 * Generate single label from slug if not provided
 */
function normalizeSingle(single: SnapshotSingle): string {
  return (
    single.labels?.singular ??
    single.slug
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

/**
 * Generate a schema hash from the fields JSON using SHA-256.
 * This is stored in dynamic_collections.schema_hash and used to detect
 * schema changes for migration purposes.
 */
function generateSchemaHash(fields: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

/**
 * Get the correct dynamic collections schema based on dialect
 */
function getDynamicCollectionsSchema(dialect: SupportedDialect) {
  switch (dialect) {
    case "mysql":
      return dynamicCollectionsMysql;
    case "sqlite":
      return dynamicCollectionsSqlite;
    case "postgresql":
      return dynamicCollectionsPg;
  }
}

/**
 * Get the correct dynamic singles schema based on dialect
 */
function getDynamicSinglesSchema(dialect: SupportedDialect) {
  switch (dialect) {
    case "mysql":
      return dynamicSinglesMysql;
    case "sqlite":
      return dynamicSinglesSqlite;
    case "postgresql":
      return dynamicSinglesPg;
  }
}

/**
 * Insert collection metadata into dynamic_collections table
 *
 * Uses Drizzle ORM for type-safe inserts that are checked against the
 * actual schema definition. This prevents silent drift if columns change.
 *
 * @returns true if inserted, false if already exists
 */
async function registerCollection(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  collection: SnapshotCollection
): Promise<boolean> {
  const schema = getDynamicCollectionsSchema(dialect);
  // getDrizzle returns untyped Drizzle instance; schema is passed to query ops
  const db = adapter.getDrizzle<DrizzleDatabase>();

  // Check if collection already exists using Drizzle
  const existing = await db
    .select()
    .from(schema)
    .where(eq(schema.slug, collection.slug))
    .limit(1);

  if (existing.length > 0) {
    // Collection already registered, skip
    return false;
  }

  const { singular, plural } = normalizeCollection(collection);
  const schemaHash = generateSchemaHash(collection.fields ?? []);

  // Insert using Drizzle - type-checked against the actual schema!
  await db.insert(schema).values({
    id: randomUUID(),
    slug: collection.slug,
    labels: { singular, plural },
    tableName: collection.tableName,
    description: collection.description ?? null,
    fields: (collection.fields ?? []) as FieldConfig[],
    timestamps: collection.timestamps !== false,
    status: collection.status ?? true,
    admin: (collection.admin ?? {}) as CollectionAdminConfig,
    source: "ui",
    locked: false,
    configPath: null,
    schemaHash,
    schemaVersion: 1,
    migrationStatus: "applied",
  });
  return true;
}

/**
 * Insert single metadata into dynamic_singles table
 *
 * Uses Drizzle ORM for type-safe inserts that are checked against the
 * actual schema definition. This prevents silent drift if columns change.
 *
 * @returns true if inserted, false if already exists
 */
async function registerSingle(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  single: SnapshotSingle
): Promise<boolean> {
  const schema = getDynamicSinglesSchema(dialect);
  // getDrizzle returns untyped Drizzle instance; schema is passed to query ops
  const db = adapter.getDrizzle<DrizzleDatabase>();

  // Check if single already exists using Drizzle
  const existing = await db
    .select()
    .from(schema)
    .where(eq(schema.slug, single.slug))
    .limit(1);

  if (existing.length > 0) {
    // Single already registered, skip
    return false;
  }

  const label = normalizeSingle(single);
  const schemaHash = generateSchemaHash(single.fields ?? []);

  // Insert using Drizzle - type-checked against the actual schema!
  await db.insert(schema).values({
    id: randomUUID(),
    slug: single.slug,
    label,
    tableName: single.tableName,
    description: single.description ?? null,
    fields: (single.fields ?? []) as FieldConfig[],
    status: single.status ?? true,
    admin: (single.admin ?? {}) as SingleAdminOptions,
    accessRules: null,
    source: "ui",
    locked: false,
    configPath: null,
    schemaHash,
    schemaVersion: 1,
    migrationStatus: "applied",
  });
  return true;
}

/**
 * Register collections and singles from migration snapshots
 *
 * This function reads snapshot files from migrations/meta/ and registers
 * the collections and singles in Nextly's metadata system.
 *
 * @param options - Registration options
 */
/**
 * Insert each entity of one kind, counting what was new.
 *
 * The two kinds are registered by identical logic — skip a reserved name, try
 * the insert, keep going past a failure — so it is written once and given the
 * insert to call. Two copies agreeing today is how one of them later stops
 * skipping reserved names, or stops surviving a failed row, without anything
 * saying so.
 */
async function registerEach<T extends { slug: string }>(
  entries: T[],
  kind: "collection" | "single",
  insert: (entry: T) => Promise<boolean>,
  logger: NonNullable<RegisterFromMigrationsOptions["logger"]>
): Promise<number> {
  let registered = 0;

  for (const entry of entries) {
    // A snapshot can carry a name that has since become reserved (a system
    // resource). Registering it would recreate the permission collision the
    // create/rename paths now refuse, so it is skipped rather than replayed.
    // Skipped, not thrown: this runs at boot, and one stale snapshot entry must
    // not take the whole application down.
    if (isReservedResourceSlug(entry.slug)) {
      logger.warn?.(
        `[Migration Metadata] Skipping ${kind} "${entry.slug}": the name is reserved by Nextly and must be renamed.`
      );
      continue;
    }

    try {
      if (await insert(entry)) registered += 1;
      logger.debug?.(`[Migration Metadata] Registered ${kind}: ${entry.slug}`);
    } catch (err) {
      // Per entity: one row that cannot be written must not cost the rest
      // their registration.
      logger.warn?.(
        `[Migration Metadata] Failed to register ${kind} ${entry.slug}: ${String(err)}`
      );
    }
  }

  return registered;
}

export async function registerFromMigrations(
  options: RegisterFromMigrationsOptions
): Promise<{
  collectionsRegistered: number;
  singlesRegistered: number;
}> {
  const { migrationsDir, adapter, dialect, logger = console } = options;

  // Cast adapter to DrizzleAdapter since the options type uses unknown
  const typedAdapter = adapter as DrizzleAdapter;

  // Step 1: Read all snapshot files
  const snapshots = await loadSnapshots({
    migrationsDir,
    logger,
    isApplied: options.isApplied,
  });

  if (snapshots.length === 0) {
    logger.debug?.("[Migration Metadata] No snapshot files found");
    return { collectionsRegistered: 0, singlesRegistered: 0 };
  }

  logger.debug?.(
    `[Migration Metadata] Found ${snapshots.length} snapshot file(s)`
  );

  // Step 2: Merge collections and singles from all snapshots
  const collections = mergeCollections(snapshots, logger);
  const singles = mergeSingles(snapshots, logger);

  // Step 3: Register each entity, by kind.
  const collectionsRegistered = await registerEach(
    collections,
    "collection",
    entry => registerCollection(typedAdapter, dialect, entry),
    logger
  );
  const singlesRegistered = await registerEach(
    singles,
    "single",
    entry => registerSingle(typedAdapter, dialect, entry),
    logger
  );

  if (collectionsRegistered > 0 || singlesRegistered > 0) {
    logger.info?.(
      `[Migration Metadata] Registered ${collectionsRegistered} collection(s), ${singlesRegistered} single(s) from migrations`
    );
  }

  return { collectionsRegistered, singlesRegistered };
}
