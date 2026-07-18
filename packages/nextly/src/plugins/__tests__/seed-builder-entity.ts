/**
 * Test helper — seed a UI-Builder entity onto an already-booted adapter.
 *
 * Mirrors what the admin Builder does when a user creates a collection: write
 * the `dynamic_collections` registry row (`source: "ui"`) and create the
 * physical `dc_<slug>` table via the same `DynamicCollectionSchemaService` the
 * dispatcher/dev-server use. Used by the plugin-access integration tests to
 * simulate "a collection that exists only because the user made it in the UI",
 * so a subsequent boot with a plugin can extend/relate to it.
 *
 * Requires the system tables to already exist — call AFTER a first boot (the
 * `dynamic_collections` table is created during `registerServices`). The
 * two-phase integration tests boot once (no plugins) to create system tables,
 * seed here, `clearServices()` (which does NOT disconnect the adapter), then
 * boot again with the plugin.
 *
 * @module plugins/__tests__/seed-builder-entity
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { ComponentRegistryService } from "../../domains/components/services/component-registry-service";
import { ComponentSchemaService } from "../../domains/components/services/component-schema-service";
import {
  type CollectionMetadata,
  DynamicCollectionRegistryService,
} from "../../domains/dynamic-collections/services/dynamic-collection-registry-service";
import { DynamicCollectionSchemaService } from "../../domains/dynamic-collections/services/dynamic-collection-schema-service";
import { SingleRegistryService } from "../../domains/singles/services/single-registry-service";
import type { FieldConfig } from "../../collections/fields/types";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import type { Logger } from "../../services/shared";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Reserved fields the schema service auto-adds; never user/plugin-owned. */
const RESERVED = new Set([
  "id",
  "title",
  "slug",
  "created_at",
  "updated_at",
  "created_by",
]);

export interface SeedBuilderCollectionOptions {
  slug: string;
  /** User-defined fields (reserved names are dropped, as the real create flow does). */
  fields: Array<
    { name: string; type: string; source?: string } & Record<string, unknown>
  >;
  /** Draft/Published flag — adds a `status` system column when true. */
  status?: boolean;
}

/**
 * Create the `dc_<slug>` table + `dynamic_collections` row for a UI collection.
 * Returns the slug + resolved physical table name.
 */
export async function seedBuilderCollection(
  adapter: DrizzleAdapter,
  opts: SeedBuilderCollectionOptions
): Promise<{ slug: string; tableName: string }> {
  const slug = opts.slug.toLowerCase();
  const tableName = `dc_${slug}`;

  // Only non-reserved fields are user-defined; the schema service auto-adds
  // id/title/slug/timestamps (and status when hasStatus).
  const userFields = opts.fields
    .map(f => ({ ...f, name: f.name.toLowerCase() }))
    .filter(f => !RESERVED.has(f.name))
    // Tag as a user field so the reconciler can tell user vs plugin provenance.
    .map(f => ({ source: "ui", ...f })) as unknown as FieldDefinition[];

  const schemaService = new DynamicCollectionSchemaService(
    undefined,
    adapter.getCapabilities().dialect
  );
  const migrationSQL = schemaService.generateMigrationSQL(
    tableName,
    userFields,
    {
      hasStatus: opts.status === true,
    }
  );
  await executeStatements(adapter, migrationSQL);

  const metadata: CollectionMetadata = {
    id: `seed_${slug}`,
    slug,
    tableName,
    labels: { singular: slug, plural: `${slug}s` },
    fields: userFields,
    timestamps: true,
    source: "ui",
    locked: false,
    status: opts.status === true,
    schemaHash: `seed_${slug}`,
    schemaVersion: 1,
    migrationStatus: "applied",
  };

  const registry = new DynamicCollectionRegistryService(adapter, silentLogger);
  await registry.registerCollection(metadata);

  return { slug, tableName };
}

/**
 * Create the `single_<slug>` table + `dynamic_singles` row for a UI single.
 */
export async function seedBuilderSingle(
  adapter: DrizzleAdapter,
  opts: SeedBuilderCollectionOptions
): Promise<{ slug: string; tableName: string }> {
  const slug = opts.slug.toLowerCase();
  const tableName = `single_${slug}`;

  const userFields = opts.fields
    .map(f => ({ ...f, name: f.name.toLowerCase() }))
    .filter(f => !RESERVED.has(f.name))
    .map(f => ({ source: "ui", ...f })) as unknown as FieldDefinition[];

  const schemaService = new DynamicCollectionSchemaService(
    undefined,
    adapter.getCapabilities().dialect
  );
  const migrationSQL = schemaService.generateMigrationSQL(
    tableName,
    userFields,
    {
      isSingle: true,
      hasStatus: opts.status === true,
    }
  );
  await executeStatements(adapter, migrationSQL);

  const registry = new SingleRegistryService(adapter, silentLogger);
  await registry.registerSingle({
    slug,
    label: slug,
    tableName,
    fields: userFields as unknown as FieldConfig[],
    source: "ui",
    status: opts.status === true,
    schemaHash: `seed_${slug}`,
  });

  return { slug, tableName };
}

/**
 * Create the `comp_<slug>` table + `dynamic_components` row for a UI component.
 */
export async function seedBuilderComponent(
  adapter: DrizzleAdapter,
  opts: SeedBuilderCollectionOptions
): Promise<{ slug: string; tableName: string }> {
  const slug = opts.slug.toLowerCase();
  const tableName = `comp_${slug}`;
  const dialect = adapter.getCapabilities().dialect;

  const userFields = opts.fields
    .map(f => ({ ...f, name: f.name.toLowerCase() }))
    .filter(f => !RESERVED.has(f.name))
    .map(f => ({ source: "ui", ...f })) as unknown as FieldConfig[];

  const schemaService = new ComponentSchemaService(dialect);
  const migrationSQL = schemaService.generateMigrationSQL(
    tableName,
    userFields
  );
  await executeStatements(adapter, migrationSQL);

  const registry = new ComponentRegistryService(adapter, silentLogger);
  await registry.registerComponent({
    slug,
    label: slug,
    tableName,
    fields: userFields,
    source: "ui",
    schemaHash: `seed_${slug}`,
  });

  return { slug, tableName };
}

/** Split generated migration SQL into statements and run them one at a time. */
async function executeStatements(
  adapter: DrizzleAdapter,
  migrationSQL: string
): Promise<void> {
  const statements = migrationSQL
    .split("--> statement-breakpoint")
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const statement of statements) {
    const clean = statement
      .split("\n")
      .filter(line => !line.trim().startsWith("--"))
      .join("\n")
      .trim();
    if (clean) {
      await adapter.executeQuery(clean);
    }
  }
}
