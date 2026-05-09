// Tests for SchemaRegistry - manages all Drizzle table objects
// (static system tables + dynamic collections) for boot-time loading.
import { describe, it, expect, beforeEach } from "vitest";

import { SchemaRegistry } from "../schema-registry";

describe("SchemaRegistry", () => {
  let registry: SchemaRegistry;

  beforeEach(() => {
    registry = new SchemaRegistry("postgresql");
  });

  describe("constructor", () => {
    it("stores the dialect", () => {
      expect(registry.getDialect()).toBe("postgresql");
    });

    it("works with mysql dialect", () => {
      const mysqlRegistry = new SchemaRegistry("mysql");
      expect(mysqlRegistry.getDialect()).toBe("mysql");
    });

    it("works with sqlite dialect", () => {
      const sqliteRegistry = new SchemaRegistry("sqlite");
      expect(sqliteRegistry.getDialect()).toBe("sqlite");
    });
  });

  describe("registerStaticSchemas", () => {
    it("stores static schemas", () => {
      const mockSchema = {
        users: { _name: "users" },
        accounts: { _name: "accounts" },
      };
      registry.registerStaticSchemas(mockSchema);
      const all = registry.getAllSchemas();
      expect(all).toHaveProperty("users");
      expect(all).toHaveProperty("accounts");
    });
  });

  describe("registerDynamicSchema", () => {
    it("adds a dynamic collection schema", () => {
      const mockTable = { _name: "dc_products" };
      registry.registerDynamicSchema("dc_products", mockTable);
      expect(registry.getTable("dc_products")).toBe(mockTable);
    });

    it("overwrites existing schema for same table name", () => {
      const table1 = { _name: "dc_products", version: 1 };
      const table2 = { _name: "dc_products", version: 2 };
      registry.registerDynamicSchema("dc_products", table1);
      registry.registerDynamicSchema("dc_products", table2);
      expect(registry.getTable("dc_products")).toBe(table2);
    });
  });

  describe("getTable", () => {
    it("returns null for unknown table", () => {
      expect(registry.getTable("nonexistent")).toBeNull();
    });

    it("finds static tables", () => {
      const mockSchema = { users: { _name: "users" } };
      registry.registerStaticSchemas(mockSchema);
      expect(registry.getTable("users")).toBe(mockSchema.users);
    });

    it("finds dynamic tables", () => {
      const mockTable = { _name: "dc_posts" };
      registry.registerDynamicSchema("dc_posts", mockTable);
      expect(registry.getTable("dc_posts")).toBe(mockTable);
    });
  });

  describe("getAllSchemas", () => {
    it("merges static and dynamic schemas", () => {
      registry.registerStaticSchemas({ users: { _name: "users" } });
      registry.registerDynamicSchema("dc_products", { _name: "dc_products" });
      const all = registry.getAllSchemas();
      expect(Object.keys(all)).toContain("users");
      expect(Object.keys(all)).toContain("dc_products");
    });

    it("dynamic schemas override static with same key", () => {
      registry.registerStaticSchemas({ myTable: { source: "static" } });
      registry.registerDynamicSchema("myTable", { source: "dynamic" });
      const all = registry.getAllSchemas();
      expect((all.myTable as any).source).toBe("dynamic");
    });
  });

  describe("getDynamicTableNames", () => {
    it("returns only dynamic table names", () => {
      registry.registerStaticSchemas({ users: {} });
      registry.registerDynamicSchema("dc_products", {});
      registry.registerDynamicSchema("dc_posts", {});
      const names = registry.getDynamicTableNames();
      expect(names).toContain("dc_products");
      expect(names).toContain("dc_posts");
      expect(names).not.toContain("users");
    });

    it("returns empty array when no dynamic schemas", () => {
      expect(registry.getDynamicTableNames()).toEqual([]);
    });
  });

  describe("hasTable", () => {
    it("returns true for static tables", () => {
      registry.registerStaticSchemas({ users: {} });
      expect(registry.hasTable("users")).toBe(true);
    });

    it("returns true for dynamic tables", () => {
      registry.registerDynamicSchema("dc_products", {});
      expect(registry.hasTable("dc_products")).toBe(true);
    });

    it("returns false for unknown tables", () => {
      expect(registry.hasTable("nonexistent")).toBe(false);
    });
  });

  describe("clear", () => {
    it("removes all dynamic schemas", () => {
      registry.registerDynamicSchema("dc_products", {});
      registry.clear();
      expect(registry.getTable("dc_products")).toBeNull();
    });

    it("keeps static schemas", () => {
      registry.registerStaticSchemas({ users: { _name: "users" } });
      registry.registerDynamicSchema("dc_products", {});
      registry.clear();
      expect(registry.getTable("users")).not.toBeNull();
      expect(registry.getTable("dc_products")).toBeNull();
    });
  });
});
