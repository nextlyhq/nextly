// Tests for the drizzle-kit/api ESM-safe wrapper.
// Verifies that all programmatic API functions are accessible
// via createRequire() workaround for the ESM import bug.
import { describe, it, expect } from "vitest";

import {
  requireDrizzleKit,
  requireDrizzleKitMySQL,
  requireDrizzleKitSQLite,
  requireDrizzleKitForDialect,
} from "../drizzle-kit-api";

describe("drizzle-kit-api wrapper", () => {
  describe("requireDrizzleKit (PostgreSQL)", () => {
    it("returns pushSchema function", () => {
      const kit = requireDrizzleKit();
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("returns generateDrizzleJson function", () => {
      const kit = requireDrizzleKit();
      expect(typeof kit.generateDrizzleJson).toBe("function");
    });

    it("returns generateMigration function", () => {
      const kit = requireDrizzleKit();
      expect(typeof kit.generateMigration).toBe("function");
    });

    it("returns upSnapshot function", () => {
      const kit = requireDrizzleKit();
      expect(typeof kit.upSnapshot).toBe("function");
    });
  });

  describe("requireDrizzleKitMySQL", () => {
    it("returns pushSchema function for MySQL", () => {
      const kit = requireDrizzleKitMySQL();
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("returns generateDrizzleJson function for MySQL", () => {
      const kit = requireDrizzleKitMySQL();
      expect(typeof kit.generateDrizzleJson).toBe("function");
    });

    it("returns generateMigration function for MySQL", () => {
      const kit = requireDrizzleKitMySQL();
      expect(typeof kit.generateMigration).toBe("function");
    });
  });

  describe("requireDrizzleKitSQLite", () => {
    it("returns pushSchema function for SQLite", () => {
      const kit = requireDrizzleKitSQLite();
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("returns generateDrizzleJson function for SQLite", () => {
      const kit = requireDrizzleKitSQLite();
      expect(typeof kit.generateDrizzleJson).toBe("function");
    });

    it("returns generateMigration function for SQLite", () => {
      const kit = requireDrizzleKitSQLite();
      expect(typeof kit.generateMigration).toBe("function");
    });
  });

  describe("requireDrizzleKitForDialect", () => {
    it("returns PostgreSQL kit for 'postgresql'", () => {
      const kit = requireDrizzleKitForDialect("postgresql");
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("returns MySQL kit for 'mysql'", () => {
      const kit = requireDrizzleKitForDialect("mysql");
      expect(typeof kit.pushSchema).toBe("function");
    });

    it("returns SQLite kit for 'sqlite'", () => {
      const kit = requireDrizzleKitForDialect("sqlite");
      expect(typeof kit.pushSchema).toBe("function");
    });
  });

  describe("caching", () => {
    it("returns the same functions on repeated calls", () => {
      const kit1 = requireDrizzleKit();
      const kit2 = requireDrizzleKit();
      expect(kit1.pushSchema).toBe(kit2.pushSchema);
    });

    it("caches MySQL kit", () => {
      const kit1 = requireDrizzleKitMySQL();
      const kit2 = requireDrizzleKitMySQL();
      expect(kit1.pushSchema).toBe(kit2.pushSchema);
    });

    it("caches SQLite kit", () => {
      const kit1 = requireDrizzleKitSQLite();
      const kit2 = requireDrizzleKitSQLite();
      expect(kit1.pushSchema).toBe(kit2.pushSchema);
    });
  });
});
