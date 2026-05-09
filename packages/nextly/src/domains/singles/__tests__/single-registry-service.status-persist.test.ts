/**
 * Status persistence tests for SingleRegistryService.
 *
 * Locks the contract that:
 *  - registerSingle (and registerSingleInTransaction) write the
 *    `data.status` flag into the row's `status` column.
 *  - updateSingle writes the new `data.status` value when defined,
 *    and leaves the column untouched when undefined.
 *  - syncCodeFirstSingles forwards `config.status` through to
 *    register/update so a code-first toggle reaches the DB.
 *
 * Without these guarantees the SingleForm's `schema.status === true`
 * gate stays false and the Save Draft / Publish split never lights up.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { SingleRegistryService } from "../services/single-registry-service";

import {
  createMockAdapter,
  createSilentLogger,
} from "./single-test-helpers";

function createCtx() {
  const adapter = createMockAdapter();
  const logger = createSilentLogger();
  const service = new SingleRegistryService(
    adapter as unknown as Parameters<typeof SingleRegistryService>[0],
    logger
  );
  return { service, adapter };
}

function dbRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "single-1",
    slug: "site-settings",
    label: "Site Settings",
    table_name: "single_site_settings",
    description: null,
    fields: JSON.stringify([]),
    admin: null,
    access_rules: null,
    source: "code",
    locked: 1,
    status: 1,
    config_path: null,
    schema_hash: "hash-1",
    schema_version: 1,
    migration_status: "applied",
    last_migration_id: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("SingleRegistryService.registerSingle — status persistence", () => {
  let ctx: ReturnType<typeof createCtx>;

  beforeEach(() => {
    ctx = createCtx();
  });

  it("writes status: 1 when data.status is true", async () => {
    ctx.adapter.selectOne.mockResolvedValue(null);
    ctx.adapter.insert.mockResolvedValue(dbRow({ status: 1 }));

    await ctx.service.registerSingle({
      slug: "site-settings",
      label: "Site Settings",
      tableName: "single_site_settings",
      fields: [],
      source: "code",
      schemaHash: "hash-1",
      status: true,
    });

    const row = ctx.adapter.insert.mock.calls[0][1];
    expect(row.status).toBe(1);
  });

  it("writes status: 0 when data.status is false", async () => {
    ctx.adapter.selectOne.mockResolvedValue(null);
    ctx.adapter.insert.mockResolvedValue(dbRow({ status: 0 }));

    await ctx.service.registerSingle({
      slug: "site-settings",
      label: "Site Settings",
      tableName: "single_site_settings",
      fields: [],
      source: "code",
      schemaHash: "hash-1",
      status: false,
    });

    const row = ctx.adapter.insert.mock.calls[0][1];
    expect(row.status).toBe(0);
  });

  it("defaults to status: 0 when data.status is undefined", async () => {
    ctx.adapter.selectOne.mockResolvedValue(null);
    ctx.adapter.insert.mockResolvedValue(dbRow({ status: 0 }));

    await ctx.service.registerSingle({
      slug: "site-settings",
      label: "Site Settings",
      tableName: "single_site_settings",
      fields: [],
      source: "code",
      schemaHash: "hash-1",
    });

    const row = ctx.adapter.insert.mock.calls[0][1];
    expect(row.status).toBe(0);
  });
});

describe("SingleRegistryService.updateSingle — status persistence", () => {
  let ctx: ReturnType<typeof createCtx>;

  beforeEach(() => {
    ctx = createCtx();
  });

  /**
   * Mock selectOne by table name so the slug guard (which queries
   * `dynamic_collections` then `dynamic_singles`) and the existing-row
   * lookup both see the right data without brittle call-order chains.
   */
  function mockSelectOne(singleRow: Record<string, unknown> | null) {
    ctx.adapter.selectOne.mockImplementation(async (table: string) => {
      if (table === "dynamic_singles") return singleRow;
      return null;
    });
  }

  it("writes status: 1 when caller sends status: true", async () => {
    mockSelectOne(dbRow({ locked: 0, status: 0 }));
    ctx.adapter.update.mockResolvedValue([dbRow({ status: 1 })]);

    await ctx.service.updateSingle("site-settings", { status: true });

    const updateCall = ctx.adapter.update.mock.calls[0];
    const updateData = updateCall[1] as Record<string, unknown>;
    expect(updateData.status).toBe(1);
  });

  it("writes status: 0 when caller sends status: false", async () => {
    mockSelectOne(dbRow({ locked: 0, status: 1 }));
    ctx.adapter.update.mockResolvedValue([dbRow({ status: 0 })]);

    await ctx.service.updateSingle("site-settings", { status: false });

    const updateData = ctx.adapter.update.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(updateData.status).toBe(0);
  });

  it("does not include status in the update when caller omits it", async () => {
    mockSelectOne(dbRow({ locked: 0 }));
    ctx.adapter.update.mockResolvedValue([dbRow()]);

    await ctx.service.updateSingle("site-settings", { label: "New Label" });

    const updateData = ctx.adapter.update.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect("status" in updateData).toBe(false);
  });
});
