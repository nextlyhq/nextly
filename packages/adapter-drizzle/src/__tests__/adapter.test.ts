/**
 * Tests for DrizzleAdapter base class.
 *
 * @remarks
 * These tests verify the base adapter functionality using a mock implementation.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { DrizzleAdapter } from "../adapter";
import type {
  SupportedDialect,
  SqlParam,
  TransactionContext,
  TransactionOptions,
  DatabaseCapabilities,
} from "../types";

/**
 * Mock adapter implementation for testing.
 */
class MockAdapter extends DrizzleAdapter {
  readonly dialect: SupportedDialect = "postgresql";
  private connected = false;
  private mockData: Map<string, unknown[]> = new Map();

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.mockData.clear();
  }

  override isConnected(): boolean {
    return this.connected;
  }

  async executeQuery<T = unknown>(
    sql: string,
    params?: SqlParam[]
  ): Promise<T[]> {
    // Mock implementation - return mock data based on query
    // For INSERT/UPDATE/DELETE with RETURNING, return a mock record
    if (sql.includes("INSERT") || sql.includes("UPDATE")) {
      return [{ id: "mock-id", ...params } as T];
    }
    // For SELECT queries, return empty array
    return [];
  }

  async transaction<T>(
    callback: (ctx: TransactionContext) => Promise<T>,
    _options?: TransactionOptions
  ): Promise<T> {
    // Mock transaction context
    const ctx: TransactionContext = {
      execute: async <U = unknown>(
        sql: string,
        params?: SqlParam[]
      ): Promise<U[]> => {
        return this.executeQuery<U>(sql, params);
      },
      insert: async <U = unknown>(
        table: string,
        data: Record<string, unknown>,
        options?: InsertOptions
      ): Promise<U> => {
        return this.insert<U>(table, data, options);
      },
      insertMany: async <U = unknown>(
        table: string,
        data: Record<string, unknown>[],
        options?: InsertOptions
      ): Promise<U[]> => {
        return this.insertMany<U>(table, data, options);
      },
      select: async <U = unknown>(
        table: string,
        options?: SelectOptions
      ): Promise<U[]> => {
        return this.select<U>(table, options);
      },
      selectOne: async <U = unknown>(
        table: string,
        options?: SelectOptions
      ): Promise<U | null> => {
        return this.selectOne<U>(table, options);
      },
      update: async <U = unknown>(
        table: string,
        data: Record<string, unknown>,
        where: Parameters<typeof this.update>[2],
        options?: Parameters<typeof this.update>[3]
      ): Promise<U[]> => {
        return this.update<U>(table, data, where, options);
      },
      delete: async (
        table: string,
        where: Parameters<typeof this.delete>[1],
        options?: Parameters<typeof this.delete>[2]
      ): Promise<number> => {
        return this.delete(table, where, options);
      },
      upsert: async <U = unknown>(
        table: string,
        data: Record<string, unknown>,
        options: Parameters<typeof this.upsert>[2]
      ): Promise<U> => {
        return this.upsert<U>(table, data, options);
      },
      // Required by the TransactionContext contract; this mock does not run
      // Drizzle queries, so return an empty stub.
      getDrizzle: <U = unknown>(): U => ({}) as U,
    };

    return callback(ctx);
  }

  getCapabilities(): DatabaseCapabilities {
    return {
      dialect: "postgresql",
      supportsJsonb: true,
      supportsJson: true,
      supportsArrays: true,
      supportsGeneratedColumns: true,
      supportsFts: true,
      supportsIlike: true,
      supportsReturning: true,
      supportsSavepoints: true,
      supportsOnConflict: true,
      maxParamsPerQuery: 65535,
      maxIdentifierLength: 63,
    };
  }
}

describe("DrizzleAdapter", () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  describe("Connection Management", () => {
    it("should connect successfully", async () => {
      expect(adapter.isConnected()).toBe(false);
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
    });

    it("should disconnect successfully", async () => {
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it("should report correct dialect", () => {
      expect(adapter.dialect).toBe("postgresql");
    });
  });

  describe("Capabilities", () => {
    it("should return database capabilities", () => {
      const caps = adapter.getCapabilities();
      expect(caps.dialect).toBe("postgresql");
      expect(caps.supportsReturning).toBe(true);
      expect(caps.supportsJsonb).toBe(true);
      expect(caps.supportsSavepoints).toBe(true);
    });

    it("should have valid maxParamsPerQuery", () => {
      const caps = adapter.getCapabilities();
      expect(caps.maxParamsPerQuery).toBeGreaterThan(0);
    });
  });

  describe("TableResolver requirement", () => {
    it("should throw when select is called without TableResolver", async () => {
      // CRUD methods require setTableResolver() to be called during boot
      await expect(adapter.select("users")).rejects.toThrow(
        /not found in schema registry/
      );
    });

    it("should throw when insert is called without TableResolver", async () => {
      await expect(
        adapter.insert("users", { email: "test@example.com" })
      ).rejects.toThrow(/not found in schema registry/);
    });

    it("should throw when update is called without TableResolver", async () => {
      await expect(
        adapter.update(
          "users",
          { name: "Updated" },
          { and: [{ column: "id", op: "=", value: "1" }] }
        )
      ).rejects.toThrow(/not found in schema registry/);
    });

    it("should throw when delete is called without TableResolver", async () => {
      await expect(
        adapter.delete("users", {
          and: [{ column: "id", op: "=", value: "1" }],
        })
      ).rejects.toThrow(/not found in schema registry/);
    });
  });

  // Note: CRUD integration tests (insert, select, update, delete with actual Drizzle API)
  // are in packages/nextly/src/database/__tests__/integration/schema-push.integration.test.ts
  // Those tests run against a real PostgreSQL database with proper TableResolver setup.

  describe("Transaction Support", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it("should execute transaction callback", async () => {
      const result = await adapter.transaction(async _ctx => {
        return "transaction result";
      });

      expect(result).toBe("transaction result");
    });

    it("should provide transaction context with CRUD methods", async () => {
      await adapter.transaction(async ctx => {
        // Verify ctx has required methods
        expect(typeof ctx.execute).toBe("function");
        expect(typeof ctx.insert).toBe("function");
        expect(typeof ctx.select).toBe("function");
        expect(typeof ctx.update).toBe("function");
        expect(typeof ctx.delete).toBe("function");
      });
    });
  });

  describe("Pool Statistics", () => {
    it("should return null by default", () => {
      const stats = adapter.getPoolStats();
      expect(stats).toBeNull();
    });
  });

  describe("Error Handling", () => {
    it("should handle migration not implemented in base adapter", async () => {
      await expect(adapter.migrate([])).rejects.toThrow(
        "migrate() must be implemented by dialect-specific adapter"
      );
    });

    it("should handle rollback not implemented in base adapter", async () => {
      await expect(adapter.rollback()).rejects.toThrow(
        "rollback() must be implemented by dialect-specific adapter"
      );
    });

    it("should return empty migration status when no migrations table exists", async () => {
      // getMigrationStatus now returns empty result instead of throwing
      // when the __drizzle_migrations table doesn't exist
      const result = await adapter.getMigrationStatus();
      expect(result.applied).toEqual([]);
      expect(result.pending).toEqual([]);
      expect(result.current).toBeNull();
    });
  });

  describe("forUpdate lock safety", () => {
    // A SELECT ... FOR UPDATE row lock only holds for the life of a transaction.
    // Requesting one on the pooled connection is silent false safety — the lock
    // releases the instant the statement autocommits — so the adapter must reject
    // it rather than let a caller believe a row is guarded when it is not.
    class LockAdapter extends MockAdapter {
      // Minimal Drizzle stub: the guard throws during query construction (before
      // execution) in the rejection case, so select()/from() only need to be
      // chainable; the resolve case awaits this same chainable stub.
      override getDrizzle<U = unknown>(): U {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.select = self;
        chain.from = self;
        chain.where = self;
        chain.orderBy = self;
        chain.limit = self;
        chain.offset = self;
        chain.for = self;
        return chain as U;
      }
    }

    let lockAdapter: LockAdapter;

    beforeEach(() => {
      lockAdapter = new LockAdapter();
      // Any non-null table object routes select() through the Drizzle query path,
      // where the forUpdate handling lives.
      lockAdapter.setTableResolver({ getTable: () => ({}) } as never);
    });

    it("rejects forUpdate on the pooled connection (no transaction executor)", async () => {
      await expect(
        lockAdapter.select("posts", { forUpdate: true })
      ).rejects.toThrow(/forUpdate requires a transaction executor/);
    });

    it("allows forUpdate when a transaction executor is supplied", async () => {
      // Same options, but with the transaction executor the lock is meaningful,
      // so the guard passes and the query proceeds.
      await expect(
        lockAdapter.select(
          "posts",
          { forUpdate: true },
          lockAdapter.getDrizzle()
        )
      ).resolves.toBeDefined();
    });

    it("rejects forUpdate on the pooled connection for SQLite too", async () => {
      // On SQLite the lock IS the transaction (BEGIN IMMEDIATE), so a pooled
      // forUpdate takes no lock at all — it must fail fast like the row-locking
      // dialects rather than silently succeed with no serialization.
      class SqliteLockAdapter extends LockAdapter {
        override readonly dialect = "sqlite" as const;
      }
      const sqliteAdapter = new SqliteLockAdapter();
      sqliteAdapter.setTableResolver({ getTable: () => ({}) } as never);
      await expect(
        sqliteAdapter.select("posts", { forUpdate: true })
      ).rejects.toThrow(/forUpdate requires a transaction executor/);
    });
  });
});
