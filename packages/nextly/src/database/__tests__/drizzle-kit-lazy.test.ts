// Tests for the lazy drizzle-kit per-dialect accessor.
// What: verifies the async accessors return functions and cache correctly.
// Why: drizzle-kit-lazy.ts is the single chokepoint between Nextly and
// drizzle-kit v1's payload/* per-dialect modules. The caches must survive
// across calls (single load per dialect per process) so callers can rely
// on fast subsequent lookups under Turbopack HMR.
//
// Note: this test loads the real drizzle-kit payload modules (no mocks).
// drizzle-kit is a regular dependency, so createRequire resolves cleanly
// in Node-based vitest.

import { describe, it, expect, beforeEach } from "vitest";

import {
  getPgDrizzleKit,
  getMySQLDrizzleKit,
  getSQLiteDrizzleKit,
  getDrizzleKitForDialect,
} from "../drizzle-kit-lazy";

// Why typed cache shape: the lazy module stashes its caches on globalThis
// so they survive Turbopack HMR module re-execution. Tests inspect the
// cache slots to confirm the load-once invariant. v1 loads one module PER
// DIALECT (payload/postgres, payload/mysql, payload/sqlite) instead of the
// removed pre-v1 single-module kit API.
type DrizzleKitCacheSlots = {
  __nextly_drizzleKitPgMod?: unknown;
  __nextly_drizzleKitMySqlMod?: unknown;
  __nextly_drizzleKitSqliteMod?: unknown;
  __nextly_drizzleKitPg?: unknown;
  __nextly_drizzleKitMySQL?: unknown;
  __nextly_drizzleKitSQLite?: unknown;
};

describe("drizzle-kit-lazy", () => {
  beforeEach(() => {
    // Reset caches between tests so each starts clean. Without this, the
    // first test loads the modules and subsequent tests cannot verify
    // load-once behavior.
    const g = globalThis as DrizzleKitCacheSlots;
    g.__nextly_drizzleKitPgMod = undefined;
    g.__nextly_drizzleKitMySqlMod = undefined;
    g.__nextly_drizzleKitSqliteMod = undefined;
    g.__nextly_drizzleKitPg = undefined;
    g.__nextly_drizzleKitMySQL = undefined;
    g.__nextly_drizzleKitSQLite = undefined;
  });

  describe("getPgDrizzleKit (PostgreSQL)", () => {
    it("returns pushSchema function", async () => {
      const kit = await getPgDrizzleKit();
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("returns generateDrizzleJson function", async () => {
      const kit = await getPgDrizzleKit();
      expect(typeof kit.generateDrizzleJson).toBe("function");
    });

    it("returns generateMigration function", async () => {
      const kit = await getPgDrizzleKit();
      expect(typeof kit.generateMigration).toBe("function");
    });

    it("does NOT expose upSnapshot (dropped per D-2.1 — zero production callers)", async () => {
      const kit = await getPgDrizzleKit();
      expect(kit).not.toHaveProperty("upSnapshot");
    });
  });

  describe("getMySQLDrizzleKit", () => {
    it("returns pushSchema function for MySQL", async () => {
      const kit = await getMySQLDrizzleKit();
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("returns generateDrizzleJson function for MySQL", async () => {
      const kit = await getMySQLDrizzleKit();
      expect(typeof kit.generateDrizzleJson).toBe("function");
    });

    it("returns generateMigration function for MySQL", async () => {
      const kit = await getMySQLDrizzleKit();
      expect(typeof kit.generateMigration).toBe("function");
    });
  });

  describe("getSQLiteDrizzleKit", () => {
    it("returns pushSchema function for SQLite", async () => {
      const kit = await getSQLiteDrizzleKit();
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("returns generateDrizzleJson function for SQLite", async () => {
      const kit = await getSQLiteDrizzleKit();
      expect(typeof kit.generateDrizzleJson).toBe("function");
    });

    it("returns generateMigration function for SQLite", async () => {
      const kit = await getSQLiteDrizzleKit();
      expect(typeof kit.generateMigration).toBe("function");
    });
  });

  describe("getDrizzleKitForDialect", () => {
    it("returns PostgreSQL kit for 'postgresql'", async () => {
      const kit = await getDrizzleKitForDialect("postgresql");
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("returns MySQL kit for 'mysql'", async () => {
      const kit = await getDrizzleKitForDialect("mysql");
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("returns SQLite kit for 'sqlite'", async () => {
      const kit = await getDrizzleKitForDialect("sqlite");
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("dispatches to the same instance as the dedicated accessor", async () => {
      // Why: confirms the dispatcher is a thin wrapper, not a parallel
      // load path. If the dispatcher reloaded drizzle-kit independently,
      // the returned objects would be distinct.
      const viaDispatcher = await getDrizzleKitForDialect("postgresql");
      const viaDirect = await getPgDrizzleKit();
      expect(viaDispatcher).toBe(viaDirect);
    });
  });

  describe("globalThis cache behavior", () => {
    it("caches the PG kit so repeated calls return the same instance", async () => {
      const a = await getPgDrizzleKit();
      const b = await getPgDrizzleKit();
      expect(a).toBe(b);
    });

    it("caches the MySQL kit", async () => {
      const a = await getMySQLDrizzleKit();
      const b = await getMySQLDrizzleKit();
      expect(a).toBe(b);
    });

    it("caches the SQLite kit", async () => {
      const a = await getSQLiteDrizzleKit();
      const b = await getSQLiteDrizzleKit();
      expect(a).toBe(b);
    });

    it("loads each per-dialect module exactly once and only on demand", async () => {
      // Why: v1 splits the kit per dialect; a consumer app has ONE dialect,
      // so accessing PG must not load the mysql/sqlite modules (they pull
      // dialect-specific dep trees).
      const g = globalThis as DrizzleKitCacheSlots;
      await getPgDrizzleKit();
      expect(g.__nextly_drizzleKitPgMod).toBeDefined();
      expect(g.__nextly_drizzleKitMySqlMod).toBeUndefined();
      expect(g.__nextly_drizzleKitSqliteMod).toBeUndefined();

      await getMySQLDrizzleKit();
      await getSQLiteDrizzleKit();
      expect(g.__nextly_drizzleKitMySqlMod).toBeDefined();
      expect(g.__nextly_drizzleKitSqliteMod).toBeDefined();
    });

    it("populates the per-dialect cache slot on first access", async () => {
      const g = globalThis as DrizzleKitCacheSlots;
      expect(g.__nextly_drizzleKitPg).toBeUndefined();
      await getPgDrizzleKit();
      expect(g.__nextly_drizzleKitPg).toBeDefined();
    });
  });
});
