/**
 * CLI entry points build a SchemaRegistry from the STATIC system tables, so `comp_` tables
 * are unaddressable by the ORM there. The orphan cleanup in `db:sync --remove-orphaned` and
 * `nextly prune` has to delete component rows, so it depends on this helper registering a
 * runtime schema for every component the database knows about.
 */

import { describe, expect, it, vi } from "vitest";

import { registerComponentSchemas } from "./register-component-schemas";

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

/** Adapter returning `components` from the `dynamic_components` registry table. */
function makeAdapter(components: Array<Record<string, unknown>>) {
  return {
    dialect: "postgresql",
    getCapabilities: () => ({ dialect: "postgresql" }),
    select: vi.fn().mockResolvedValue(components),
    selectOne: vi.fn().mockResolvedValue(null),
    executeQuery: vi.fn().mockResolvedValue([]),
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
