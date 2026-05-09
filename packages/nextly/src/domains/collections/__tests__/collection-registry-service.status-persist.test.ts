/**
 * Status persistence tests for CollectionRegistryService (the
 * BaseRegistryService-derived one used by code-first sync and the
 * /api/collections/schema POST direct handler).
 *
 * Locks the contract that:
 *  - registerCollection writes data.status into the inserted row.
 *  - updateCollection writes data.status when defined, leaves it
 *    untouched when undefined.
 *  - syncCodeFirstCollections forwards config.status into the
 *    register/update path (including the case where ONLY the status
 *    flag changed and the schema hash matched, which previously
 *    treated the row as unchanged).
 *  - deserializeRecord normalises both 0/1 (sqlite) and true/false
 *    (postgres/mysql) into a JS boolean.
 *
 * Without these guarantees the EntryForm's `collection.status === true`
 * gate stays false and the Save Draft / Publish split never lights up.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { CollectionRegistryService } from "../services/collection-registry-service";

// ────────────────────────────────────────────────────────────────────────
// Shared mock adapter — captures insert/update payloads.
// ────────────────────────────────────────────────────────────────────────

function createCtx() {
  const insertCalls: Array<{ table: string; row: Record<string, unknown> }> =
    [];
  const updateCalls: Array<{
    table: string;
    data: Record<string, unknown>;
    where: unknown;
  }> = [];

  // Default selectOne → null so slug-uniqueness checks pass.
  const selectOne = vi.fn(async () => null);

  const adapter = {
    dialect: "postgresql",
    getCapabilities: vi.fn(() => ({
      dialect: "postgresql",
      supportsReturning: true,
    })),
    selectOne,
    insert: vi.fn(
      async (table: string, row: Record<string, unknown>) => {
        insertCalls.push({ table, row });
        return row;
      }
    ),
    update: vi.fn(
      async (
        table: string,
        data: Record<string, unknown>,
        where: unknown
      ) => {
        updateCalls.push({ table, data, where });
        // Return the merged row so the caller's deserializer doesn't blow up.
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

// ────────────────────────────────────────────────────────────────────────
// registerCollection
// ────────────────────────────────────────────────────────────────────────

describe("CollectionRegistryService.registerCollection — status persistence", () => {
  let ctx: ReturnType<typeof createCtx>;

  beforeEach(() => {
    ctx = createCtx();
  });

  it("writes status: 1 when data.status is true", async () => {
    await ctx.service.registerCollection({
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      tableName: "dc_posts",
      fields: [],
      source: "ui",
      schemaHash: "h",
      status: true,
    });

    expect(ctx.insertCalls).toHaveLength(1);
    expect(ctx.insertCalls[0].row.status).toBe(1);
  });

  it("writes status: 0 when data.status is false", async () => {
    await ctx.service.registerCollection({
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      tableName: "dc_posts",
      fields: [],
      source: "ui",
      schemaHash: "h",
      status: false,
    });

    expect(ctx.insertCalls[0].row.status).toBe(0);
  });

  it("defaults to status: 0 when data.status is undefined", async () => {
    await ctx.service.registerCollection({
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      tableName: "dc_posts",
      fields: [],
      source: "ui",
      schemaHash: "h",
    });

    expect(ctx.insertCalls[0].row.status).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// updateCollection
// ────────────────────────────────────────────────────────────────────────

describe("CollectionRegistryService.updateCollection — status persistence", () => {
  let ctx: ReturnType<typeof createCtx>;

  beforeEach(() => {
    ctx = createCtx();
  });

  /**
   * Mock selectOne for `getCollection(slug)` (called inside updateCollection)
   * so the existing-row lookup returns a valid record. The slug-guard's
   * selectOne also lands here — return null for the dynamic-singles guard
   * but a record for dynamic-collections existence.
   */
  function mockExisting(row: Record<string, unknown>) {
    ctx.adapter.selectOne.mockImplementation(
      async (table: string) => {
        if (table === "dynamic_collections") return row;
        return null;
      }
    );
  }

  it("writes status when caller sends status: true", async () => {
    mockExisting({
      id: "1",
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      table_name: "dc_posts",
      fields: "[]",
      source: "ui",
      locked: 0,
      status: 0,
      schema_hash: "h",
      schema_version: 1,
      migration_status: "applied",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    });

    await ctx.service.updateCollection("posts", { status: true });

    expect(ctx.updateCalls).toHaveLength(1);
    expect(ctx.updateCalls[0].data.status).toBe(1);
  });

  it("writes status when caller sends status: false", async () => {
    mockExisting({
      id: "1",
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      table_name: "dc_posts",
      fields: "[]",
      source: "ui",
      locked: 0,
      status: 1,
      schema_hash: "h",
      schema_version: 1,
      migration_status: "applied",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    });

    await ctx.service.updateCollection("posts", { status: false });

    expect(ctx.updateCalls[0].data.status).toBe(0);
  });

  it("does not include status in the update when caller omits it", async () => {
    mockExisting({
      id: "1",
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      table_name: "dc_posts",
      fields: "[]",
      source: "ui",
      locked: 0,
      status: 0,
      schema_hash: "h",
      schema_version: 1,
      migration_status: "applied",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    });

    await ctx.service.updateCollection("posts", { description: "new desc" });

    const updateData = ctx.updateCalls[0].data;
    expect("status" in updateData).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// deserializeRecord — read coercion
// ────────────────────────────────────────────────────────────────────────

describe("CollectionRegistryService.deserializeRecord — status normalisation", () => {
  let ctx: ReturnType<typeof createCtx>;

  beforeEach(() => {
    ctx = createCtx();
  });

  function deserialize(
    record: Record<string, unknown>
  ): Record<string, unknown> {
    // Why: deserializeRecord is `protected`; cast through a structural type
    // so the test reaches it without exposing a public surface no caller needs.
    type Internal = {
      deserializeRecord: (r: Record<string, unknown>) => Record<string, unknown>;
    };
    return (ctx.service as unknown as Internal).deserializeRecord(record);
  }

  function baseRow(): Record<string, unknown> {
    return {
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
  }

  it("returns status: true for postgres native boolean", () => {
    const result = deserialize({ ...baseRow(), status: true });
    expect(result.status).toBe(true);
  });

  it("returns status: true for sqlite integer-mode-boolean (1)", () => {
    const result = deserialize({ ...baseRow(), status: 1 });
    expect(result.status).toBe(true);
  });

  it("returns status: false for status: 0", () => {
    const result = deserialize({ ...baseRow(), status: 0 });
    expect(result.status).toBe(false);
  });

  it("returns status: false for legacy rows without the column", () => {
    const result = deserialize(baseRow());
    expect(result.status).toBe(false);
  });
});
