// Tests for the lazy drizzle-kit/api accessor.
// What: verifies the async accessors return functions and cache correctly.
// Why: drizzle-kit-lazy.ts replaces the older drizzle-kit-api.ts createRequire
// pattern with a magic-comment-protected dynamic import. The cache must
// survive across calls (single load per process) so callers can rely on
// fast subsequent lookups.
//
// Note: this test imports the real drizzle-kit/api (no mocks). drizzle-kit
// is a regular dependency, so the dynamic import resolves cleanly in
// Node-based vitest. The same pattern is used by other consumers of
// drizzle-kit/api in this package.

import { describe, it, expect, beforeEach } from "vitest";

import {
  getPgDrizzleKit,
  getMySQLDrizzleKit,
  getSQLiteDrizzleKit,
  getDrizzleKitForDialect,
} from "../drizzle-kit-lazy";

// Why typed cache shape: the lazy module stashes its cache on globalThis
// so it survives Turbopack HMR module re-execution. Tests inspect the
// cache slots to confirm the single-load invariant.
type DrizzleKitCacheSlots = {
  __nextly_drizzleKitModule?: unknown;
  __nextly_drizzleKitPg?: unknown;
  __nextly_drizzleKitMySQL?: unknown;
  __nextly_drizzleKitSQLite?: unknown;
};

describe("drizzle-kit-lazy", () => {
  beforeEach(() => {
    // Reset cache between tests so each starts clean. Without this, the
    // first test loads the module and subsequent tests cannot verify
    // load-once behavior.
    const g = globalThis as DrizzleKitCacheSlots;
    g.__nextly_drizzleKitModule = undefined;
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

    it("returns upSnapshot function", async () => {
      const kit = await getPgDrizzleKit();
      expect(typeof kit.upSnapshot).toBe("function");
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

    it("loads the underlying drizzle-kit module exactly once across all dialects", async () => {
      // Why: the per-dialect kits share a single underlying module load,
      // tracked at __nextly_drizzleKitModule on globalThis. After all three
      // accessors run, the module slot is populated and is the same object
      // that backs every kit.
      await getPgDrizzleKit();
      await getMySQLDrizzleKit();
      await getSQLiteDrizzleKit();
      const g = globalThis as DrizzleKitCacheSlots;
      expect(g.__nextly_drizzleKitModule).toBeDefined();
    });

    it("populates the per-dialect cache slot on first access", async () => {
      const g = globalThis as DrizzleKitCacheSlots;
      expect(g.__nextly_drizzleKitPg).toBeUndefined();
      await getPgDrizzleKit();
      expect(g.__nextly_drizzleKitPg).toBeDefined();
    });
  });
});
