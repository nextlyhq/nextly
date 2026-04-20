/**
 * Tests for main package index exports
 */

import { describe, it, expect } from "vitest";

import { DrizzleAdapter, version } from "../index";
import * as indexExports from "../index";

describe("@nextly/adapter-drizzle - Main Index Exports", () => {
  describe("version", () => {
    it("should export package version", () => {
      expect(version).toBe("0.1.0");
      expect(typeof version).toBe("string");
    });
  });

  describe("DrizzleAdapter", () => {
    it("should export DrizzleAdapter class", () => {
      expect(DrizzleAdapter).toBeDefined();
      expect(typeof DrizzleAdapter).toBe("function");
    });

    it("should have default CRUD methods in prototype", () => {
      const proto = DrizzleAdapter.prototype;
      expect(proto.select).toBeDefined();
      expect(proto.selectOne).toBeDefined();
      expect(proto.insert).toBeDefined();
      expect(proto.insertMany).toBeDefined();
      expect(proto.update).toBeDefined();
      expect(proto.delete).toBeDefined();
      expect(proto.upsert).toBeDefined();
    });

    it("should have connection methods in prototype", () => {
      const proto = DrizzleAdapter.prototype;
      expect(proto.isConnected).toBeDefined();
      expect(proto.getPoolStats).toBeDefined();
    });
  });

  describe("Tree-shaking verification", () => {
    it("should only export DrizzleAdapter and version from main index", () => {
      const exportedKeys = Object.keys(indexExports);
      expect(exportedKeys).toContain("DrizzleAdapter");
      expect(exportedKeys).toContain("version");
      // Should not export other utilities
      expect(exportedKeys).toHaveLength(2);
    });

    it("should not export QueryBuilder from main index", () => {
      expect((indexExports as any).QueryBuilder).toBeUndefined();
    });

    it("should not export migration utilities from main index", () => {
      expect((indexExports as any).calculateChecksum).toBeUndefined();
      expect((indexExports as any).sortMigrations).toBeUndefined();
      expect((indexExports as any).migrationHelpers).toBeUndefined();
    });

    it("should not export type utilities from main index", () => {
      expect((indexExports as any).DatabaseCapabilities).toBeUndefined();
      expect((indexExports as any).TransactionContext).toBeUndefined();
      expect((indexExports as any).WhereClause).toBeUndefined();
    });
  });
});
