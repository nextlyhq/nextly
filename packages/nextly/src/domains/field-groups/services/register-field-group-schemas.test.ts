/**
 * CLI entry points build a SchemaRegistry from the STATIC system tables, so `comp_` tables
 * are unaddressable by the ORM there. The orphan cleanup in `db:sync --remove-orphaned` and
 * `nextly prune` has to delete component rows, so it depends on this helper registering a
 * runtime schema for every component the database knows about.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { MIGRATION_TARGET } from "../migration/manifest";
import { forgetFieldGroupStorageNames } from "../storage/resolve-storage-names";

import { registerComponentSchemas } from "./register-field-group-schemas";

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

/**
 * Adapter returning `components` from whichever registry `tables` says is there.
 *
 * `listTables` is not decoration: the registry table is resolved from the
 * catalog because the storage migration renames it, so a double that cannot
 * answer what tables exist certifies a path production cannot take.
 */
function makeAdapter(
  components: Array<Record<string, unknown>>,
  tables: string[] = [STORAGE_FORMAT.registryTable]
) {
  return {
    dialect: "postgresql" as const,
    getCapabilities: () => ({ dialect: "postgresql" }),
    select: vi.fn().mockResolvedValue(components),
    selectOne: vi.fn().mockResolvedValue(null),
    executeQuery: vi.fn().mockResolvedValue([]),
    listTables: vi.fn().mockResolvedValue(tables),
    // The discriminator resolution introspects `information_schema` through the
    // Drizzle handle. An empty result is a truthful answer here — the catalog
    // describes none of these tables — and it exercises the documented fallback
    // to the spelling the DDL writes. Whether a REAL catalog steers the
    // generator to the migrated column is a question only a live server can
    // answer, and the three-dialect matrix asks it there.
    getDrizzle: () => ({ execute: async () => ({ rows: [] }) }),
  };
}

function componentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    slug: "hero",
    label: "Hero",
    table_name: "comp_hero",
    fields: JSON.stringify([{ name: "heading", type: "text" }]),
    source: "code",
    locked: 1,
    localized: 0,
    schema_hash: "h",
    schema_version: 1,
    migration_status: "applied",
    created_at: "2026-07-21T00:00:00.000Z",
    updated_at: "2026-07-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("registerComponentSchemas", () => {
  // The resolution is memoized per adapter; each fixture builds its own, and
  // this keeps a shared module instance from carrying one answer into the next.
  beforeEach(() => forgetFieldGroupStorageNames());

  it("registers a runtime schema for every component in the database", async () => {
    const adapter = makeAdapter([
      componentRow(),
      componentRow({ id: "c2", slug: "cta", table_name: "comp_cta" }),
    ]);
    const registry = { registerDynamicSchema: vi.fn() };

    const count = await registerComponentSchemas({
      adapter: adapter as never,
      registry: registry as never,
      dialect: "postgresql",
      logger: silentLogger as never,
    });

    expect(count).toBe(2);
    const registered = registry.registerDynamicSchema.mock.calls.map(c => c[0]);
    expect(registered).toContain("comp_hero");
    expect(registered).toContain("comp_cta");
  });

  it("registers the companion table for a localized component", async () => {
    // A localized component keeps translations in comp_<slug>_locales, and the sweep
    // deletes from it by instance id, so it must be addressable too.
    const adapter = makeAdapter([componentRow({ localized: 1 })]);
    const registry = { registerDynamicSchema: vi.fn() };

    await registerComponentSchemas({
      adapter: adapter as never,
      registry: registry as never,
      dialect: "postgresql",
      logger: silentLogger as never,
    });

    const registered = registry.registerDynamicSchema.mock.calls.map(c => c[0]);
    expect(registered).toContain("comp_hero");
    expect(registered).toContain("comp_hero_locales");
  });

  // 🔴 The whole reason this helper had to change. Before the registry name was
  // resolved it addressed `dynamic_components` by constant, so on a database
  // whose storage migration has run it read a table that no longer exists and
  // registered nothing at all — every field group unreadable, silently.
  it("reads the migrated registry on a database whose storage moved", async () => {
    const adapter = makeAdapter(
      [componentRow({ table_name: "fg_hero" })],
      [MIGRATION_TARGET.registryTable]
    );
    const registry = { registerDynamicSchema: vi.fn() };

    const count = await registerComponentSchemas({
      adapter: adapter as never,
      registry: registry as never,
      dialect: "postgresql",
      logger: silentLogger as never,
    });

    expect(adapter.select.mock.calls.map(call => call[0])).toEqual([
      MIGRATION_TARGET.registryTable,
    ]);
    expect(count).toBe(1);
    expect(registry.registerDynamicSchema.mock.calls.map(c => c[0])).toContain(
      "fg_hero"
    );
  });

  it("is a no-op when the database holds no components", async () => {
    const adapter = makeAdapter([]);
    const registry = { registerDynamicSchema: vi.fn() };

    const count = await registerComponentSchemas({
      adapter: adapter as never,
      registry: registry as never,
      dialect: "postgresql",
      logger: silentLogger as never,
    });

    expect(count).toBe(0);
    expect(registry.registerDynamicSchema).not.toHaveBeenCalled();
  });
});
