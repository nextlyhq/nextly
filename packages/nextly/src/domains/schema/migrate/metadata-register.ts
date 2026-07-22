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
import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

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

/**
 * Collection definition from migration snapshot
 */
export interface SnapshotCollection {
  slug: string;
  tableName: string;
  labels?: {
    singular?: string;
    plural?: string;
  };
  description?: string;
  fields: unknown[];
  admin?: unknown;
  dbName?: string;
  status?: boolean;
  timestamps?: boolean;
}

/**
 * Single definition from migration snapshot
 */
export interface SnapshotSingle {
  slug: string;
  tableName: string;
  labels?: {
    singular?: string;
    plural?: string;
  };
  description?: string;
  fields: unknown[];
  admin?: unknown;
  dbName?: string;
  status?: boolean;
}

/**
 * Migration snapshot file structure
 */
export interface MigrationSnapshot {
  version?: number;
  collections?: SnapshotCollection[];
  singles?: SnapshotSingle[];
}

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
 * Read all migration snapshot files from the migrations/meta directory
 */
async function readSnapshotFiles(
  migrationsDir: string,
  logger?: { warn?: (msg: string) => void }
): Promise<MigrationSnapshot[]> {
  const metaDir = resolve(migrationsDir, "meta");

  try {
    const files = await readdir(metaDir);
    // Sort files lexicographically to ensure deterministic "later snapshot wins" behavior
    const snapshotFiles = files
      .filter(f => f.endsWith(".snapshot.json"))
      .sort();

    if (snapshotFiles.length === 0) {
      return [];
    }

    const snapshots: MigrationSnapshot[] = [];

    for (const file of snapshotFiles) {
      try {
        const filePath = join(metaDir, file);
        const content = await readFile(filePath, "utf-8");
        const snapshot = JSON.parse(content) as MigrationSnapshot;
        snapshots.push(snapshot);
      } catch (err) {
        // Skip invalid snapshot files but continue processing others
        logger?.warn?.(`Could not read snapshot file ${file}: ${String(err)}`);
      }
    }

    return snapshots;
  } catch (_err) {
    // Meta directory doesn't exist or isn't readable
    return [];
  }
}

/**
 * Merge collections from multiple snapshots
 * Later snapshots override earlier ones for the same slug
 */
function mergeCollections(
  snapshots: MigrationSnapshot[]
): SnapshotCollection[] {
  const collectionMap = new Map<string, SnapshotCollection>();

  for (const snapshot of snapshots) {
    for (const collection of snapshot.collections ?? []) {
      if (collection.slug) {
        collectionMap.set(collection.slug, collection);
      }
    }
  }

  return Array.from(collectionMap.values());
}

/**
 * Merge singles from multiple snapshots
 */
function mergeSingles(snapshots: MigrationSnapshot[]): SnapshotSingle[] {
  const singleMap = new Map<string, SnapshotSingle>();

  for (const snapshot of snapshots) {
    for (const single of snapshot.singles ?? []) {
      if (single.slug) {
        singleMap.set(single.slug, single);
      }
    }
  }

  return Array.from(singleMap.values());
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
  const snapshots = await readSnapshotFiles(migrationsDir, logger);

  if (snapshots.length === 0) {
    logger.debug?.("[Migration Metadata] No snapshot files found");
    return { collectionsRegistered: 0, singlesRegistered: 0 };
  }

  logger.debug?.(
    `[Migration Metadata] Found ${snapshots.length} snapshot file(s)`
  );

  // Step 2: Merge collections and singles from all snapshots
  const collections = mergeCollections(snapshots);
  const singles = mergeSingles(snapshots);

  // Step 3: Register each collection
  let collectionsRegistered = 0;
  for (const collection of collections) {
    // A snapshot can carry a name that has since become reserved (a system
    // resource). Registering it would recreate the permission collision the
    // create/rename paths now refuse, so it is skipped rather than replayed.
    // Skipped, not thrown: this runs at boot, and one stale snapshot entry must
    // not take the whole application down.
    if (isReservedResourceSlug(collection.slug)) {
      logger.warn?.(
        `[Migration Metadata] Skipping collection "${collection.slug}": the name is reserved by Nextly and must be renamed.`
      );
      continue;
    }
    try {
      const inserted = await registerCollection(
        typedAdapter,
        dialect,
        collection
      );
      if (inserted) collectionsRegistered++;
      logger.debug?.(
        `[Migration Metadata] Registered collection: ${collection.slug}`
      );
    } catch (err) {
      logger.warn?.(
        `[Migration Metadata] Failed to register collection ${collection.slug}: ${String(err)}`
      );
    }
  }

  // Step 4: Register each single
  let singlesRegistered = 0;
  for (const single of singles) {
    // Same as collections: a reserved name in a snapshot is skipped, not
    // replayed, so it cannot recreate the permission collision.
    if (isReservedResourceSlug(single.slug)) {
      logger.warn?.(
        `[Migration Metadata] Skipping single "${single.slug}": the name is reserved by Nextly and must be renamed.`
      );
      continue;
    }
    try {
      const inserted = await registerSingle(typedAdapter, dialect, single);
      if (inserted) singlesRegistered++;
      logger.debug?.(`[Migration Metadata] Registered single: ${single.slug}`);
    } catch (err) {
      logger.warn?.(
        `[Migration Metadata] Failed to register single ${single.slug}: ${String(err)}`
      );
    }
  }

  if (collectionsRegistered > 0 || singlesRegistered > 0) {
    logger.info?.(
      `[Migration Metadata] Registered ${collectionsRegistered} collection(s), ${singlesRegistered} single(s) from migrations`
    );
  }

  return { collectionsRegistered, singlesRegistered };
}
