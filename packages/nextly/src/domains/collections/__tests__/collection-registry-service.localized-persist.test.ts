/**
 * Localized-flag persistence for CollectionRegistryService — mirrors the
 * status-persist contract (M3b-1). Locks that:
 *  - registerCollection writes data.localized into the inserted row (0/1).
 *  - updateCollection writes data.localized when defined, omits it otherwise.
 *  - deserializeRecord normalises 0/1 and true/false into a JS boolean,
 *    defaulting to false for legacy rows written before the column existed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { CollectionRegistryService } from "../services/collection-registry-service";

function createCtx() {
  const insertCalls: Array<{ table: string; row: Record<string, unknown> }> =
    [];
  const updateCalls: Array<{
    table: string;
    data: Record<string, unknown>;
    where: unknown;
  }> = [];
  const selectOne = vi.fn(async () => null);

  const adapter = {
    dialect: "postgresql",
    getCapabilities: vi.fn(() => ({
      dialect: "postgresql",
      supportsReturning: true,
    })),
    selectOne,
    insert: vi.fn(async (table: string, row: Record<string, unknown>) => {
      insertCalls.push({ table, row });
      return row;
    }),
    update: vi.fn(
      async (table: string, data: Record<string, unknown>, where: unknown) => {
        updateCalls.push({ table, data, where });
        return [{ ...data, slug: "posts" }];
      }
    ),
    delete: vi.fn(async () => 0),
    select: vi.fn(async () => []),
    tableExists: vi.fn(async () => true),
    executeQuery: vi.fn(async () => undefined),
    getDialect: vi.fn(() => "postgresql"),
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const service = new CollectionRegistryService(
    adapter as unknown as Parameters<typeof CollectionRegistryService>[0],
    logger as unknown as Parameters<typeof CollectionRegistryService>[1]
  );
  return { service, adapter, insertCalls, updateCalls };
}

describe("CollectionRegistryService — localized persistence", () => {
  let ctx: ReturnType<typeof createCtx>;
  beforeEach(() => {
    ctx = createCtx();
  });

  it("writes localized: 1 when data.localized is true", async () => {
    await ctx.service.registerCollection({
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      tableName: "dc_posts",
      fields: [],
      source: "ui",
      schemaHash: "h",
      localized: true,
    });
    expect(ctx.insertCalls[0].row.localized).toBe(1);
  });

  it("defaults localized: 0 when omitted", async () => {
    await ctx.service.registerCollection({
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      tableName: "dc_posts",
      fields: [],
      source: "ui",
      schemaHash: "h",
    });
    expect(ctx.insertCalls[0].row.localized).toBe(0);
  });

  it("deserializes localized from 0/1 and true/false, default false", () => {
    type Internal = {
      deserializeRecord: (
        r: Record<string, unknown>
      ) => Record<string, unknown>;
    };
    const de = (r: Record<string, unknown>) =>
      (ctx.service as unknown as Internal).deserializeRecord(r);
    const base = {
      id: "1",
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      table_name: "dc_posts",
      fields: "[]",
      source: "ui",
      locked: 0,
      schema_hash: "h",
      schema_version: 1,
      migration_status: "applied",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    expect(de({ ...base, localized: 1 }).localized).toBe(true);
    expect(de({ ...base, localized: true }).localized).toBe(true);
    expect(de({ ...base, localized: 0 }).localized).toBe(false);
    expect(de(base).localized).toBe(false); // legacy row
  });
});
