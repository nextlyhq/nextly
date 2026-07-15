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

import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

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
  migrationsDir: string
): Promise<MigrationSnapshot[]> {
  const metaDir = resolve(migrationsDir, "meta");

  try {
    const files = await readdir(metaDir);
    const snapshotFiles = files.filter(f => f.endsWith(".snapshot.json"));

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
        console.warn(
          `Warning: Could not read snapshot file ${file}: ${String(err)}`
        );
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

  const plural =
    collection.labels?.plural ??
    (singular.endsWith("s")
      ? `${singular}es`
      : singular.endsWith("y")
        ? `${singular.slice(0, -1)}ies`
        : `${singular}s`);

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
 * Get placeholder based on dialect and index
 */
function getPlaceholder(dialect: SupportedDialect, index: number): string {
  switch (dialect) {
    case "postgresql":
      return `$${index}`;
    case "mysql":
    case "sqlite":
      return "?";
    default:
      return "?";
  }
}

/**
 * Build placeholders array for a query
 */
function buildPlaceholders(dialect: SupportedDialect, count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    getPlaceholder(dialect, i + 1)
  );
}

/**
 * Generate a simple schema hash from the fields JSON
 */
function generateSchemaHash(fields: unknown[]): string {
  const str = JSON.stringify(fields);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(16, "0");
}

/**
 * Insert collection metadata into dynamic_collections table
 *
 * Actual schema (PostgreSQL):
 * - id, slug, labels (JSONB), table_name, description, fields, timestamps, admin,
 *   source, locked, config_path, schema_hash, schema_version, migration_status,
 *   last_migration_id, created_by, created_at, updated_at
 */
async function registerCollection(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  collection: SnapshotCollection
): Promise<void> {
  // Build the check query based on dialect
  const placeholder = getPlaceholder(dialect, 1);

  // Check if collection already exists
  const existingQuery = `SELECT id FROM dynamic_collections WHERE slug = ${placeholder}`;
  const existing = await adapter.executeQuery<{ id: string }>(existingQuery, [
    collection.slug,
  ]);

  if (existing && existing.length > 0) {
    // Collection already registered, skip
    return;
  }

  const { singular, plural } = normalizeCollection(collection);

  // Build labels JSONB object
  const labelsJson = JSON.stringify({
    singular,
    plural,
  });

  // Generate schema hash from fields
  const schemaHash = generateSchemaHash(collection.fields ?? []);

  // Build the insert query placeholders based on dialect (14 columns)
  // created_at and updated_at use DB defaults
  const placeholders = buildPlaceholders(dialect, 14);

  // Insert the collection metadata using adapter.executeQuery
  const insertQuery = `
      INSERT INTO dynamic_collections (
        id,
        slug,
        labels,
        table_name,
        description,
        fields,
        timestamps,
        admin,
        source,
        locked,
        config_path,
        schema_hash,
        schema_version,
        migration_status
      ) VALUES (${placeholders.join(", ")})
    `;

  await adapter.executeQuery(insertQuery, [
    randomUUID(), // id
    collection.slug, // slug
    labelsJson, // labels (JSONB)
    collection.tableName, // table_name
    collection.description ?? null, // description
    JSON.stringify(collection.fields ?? []), // fields (JSONB)
    collection.timestamps !== false ? true : false, // timestamps (boolean)
    JSON.stringify(collection.admin ?? {}), // admin (JSONB)
    "ui", // source (visual template collections are UI-editable)
    false, // locked
    null, // config_path
    schemaHash, // schema_hash
    1, // schema_version
    "applied", // migration_status
  ]);
}

/**
 * Insert single metadata into dynamic_singles table
 *
 * Actual schema (PostgreSQL/SQLite):
 * - id, slug, label, table_name, description, fields, admin, access_rules,
 *   source, locked, config_path, schema_hash, schema_version, migration_status,
 *   last_migration_id, created_by, created_at, updated_at
 */
async function registerSingle(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  single: SnapshotSingle
): Promise<void> {
  // Build the check query based on dialect
  const placeholder = getPlaceholder(dialect, 1);

  // Check if single already exists
  const existingQuery = `SELECT id FROM dynamic_singles WHERE slug = ${placeholder}`;
  const existing = await adapter.executeQuery<{ id: string }>(existingQuery, [
    single.slug,
  ]);

  if (existing && existing.length > 0) {
    // Single already registered, skip
    return;
  }

  const label = normalizeSingle(single);

  // Generate schema hash from fields
  const schemaHash = generateSchemaHash(single.fields ?? []);

  // Build the insert query placeholders based on dialect (14 columns)
  // created_at and updated_at use DB defaults
  const placeholders = buildPlaceholders(dialect, 14);

  // Insert the single metadata using adapter.executeQuery
  const insertQuery = `
      INSERT INTO dynamic_singles (
        id,
        slug,
        label,
        table_name,
        description,
        fields,
        admin,
        access_rules,
        source,
        locked,
        config_path,
        schema_hash,
        schema_version,
        migration_status
      ) VALUES (${placeholders.join(", ")})
    `;

  await adapter.executeQuery(insertQuery, [
    randomUUID(), // id
    single.slug, // slug
    label, // label
    single.tableName, // table_name
    single.description ?? null, // description
    JSON.stringify(single.fields ?? []), // fields (JSON/TEXT)
    JSON.stringify(single.admin ?? {}), // admin (JSON/TEXT)
    null, // access_rules
    "ui", // source (visual template singles are UI-editable)
    false, // locked
    null, // config_path
    schemaHash, // schema_hash
    1, // schema_version
    "applied", // migration_status
  ]);
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
  const snapshots = await readSnapshotFiles(migrationsDir);

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
    try {
      await registerCollection(typedAdapter, dialect, collection);
      collectionsRegistered++;
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
    try {
      await registerSingle(typedAdapter, dialect, single);
      singlesRegistered++;
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
