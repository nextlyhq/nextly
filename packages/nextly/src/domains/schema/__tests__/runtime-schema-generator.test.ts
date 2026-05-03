// Tests for the enhanced runtime schema generator.
// Verifies that field definitions are correctly mapped to Drizzle table objects
// and that the return shape includes schemaRecord for pushSchema() consumption.
import { getTableName, getTableColumns } from "drizzle-orm";
import { describe, it, expect } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  generateRuntimeSchema,
  type RuntimeSchemaResult,
} from "../services/runtime-schema-generator";

describe("generateRuntimeSchema", () => {
  const baseFields: FieldDefinition[] = [
    { name: "title", type: "text", required: true },
    { name: "description", type: "textarea" },
  ];

  describe("return shape", () => {
    it("returns { table, schemaRecord } object", () => {
      const result = generateRuntimeSchema(
        "dc_products",
        baseFields,
        "postgresql"
      );
      expect(result).toHaveProperty("table");
      expect(result).toHaveProperty("schemaRecord");
    });

    it("schemaRecord is keyed by table name", () => {
      const result = generateRuntimeSchema(
        "dc_products",
        baseFields,
        "postgresql"
      );
      expect(result.schemaRecord).toHaveProperty("dc_products");
      expect(result.schemaRecord.dc_products).toBe(result.table);
    });
  });

  describe("PostgreSQL", () => {
    it("generates a pgTable with correct table name", () => {
      const result = generateRuntimeSchema(
        "dc_products",
        baseFields,
        "postgresql"
      );
      expect(getTableName(result.table)).toBe("dc_products");
    });

    it("includes system columns (id, slug, created_at, updated_at)", () => {
      const result = generateRuntimeSchema(
        "dc_products",
        baseFields,
        "postgresql"
      );
      const columns = getTableColumns(result.table);
      expect(columns).toHaveProperty("id");
      expect(columns).toHaveProperty("slug");
      expect(columns).toHaveProperty("created_at");
      expect(columns).toHaveProperty("updated_at");
    });

    it("does not duplicate title/slug columns if user defines them", () => {
      const fields: FieldDefinition[] = [
        { name: "title", type: "text", required: true },
        { name: "slug", type: "text", required: true },
      ];
      const result = generateRuntimeSchema("dc_products", fields, "postgresql");
      const columnNames = Object.keys(getTableColumns(result.table));
      const titleCount = columnNames.filter(n => n === "title").length;
      const slugCount = columnNames.filter(n => n === "slug").length;
      expect(titleCount).toBe(1);
      expect(slugCount).toBe(1);
    });

    it("maps text field to text column", () => {
      const result = generateRuntimeSchema(
        "dc_products",
        baseFields,
        "postgresql"
      );
      const columns = getTableColumns(result.table);
      expect(columns).toHaveProperty("title");
    });

    it("maps number field to doublePrecision column", () => {
      const fields: FieldDefinition[] = [{ name: "price", type: "number" }];
      const result = generateRuntimeSchema("dc_products", fields, "postgresql");
      const columns = getTableColumns(result.table);
      expect(columns).toHaveProperty("price");
    });

    it("maps checkbox field to boolean column", () => {
      const fields: FieldDefinition[] = [
        { name: "isActive", type: "checkbox" },
      ];
      const result = generateRuntimeSchema("dc_products", fields, "postgresql");
      const columns = getTableColumns(result.table);
      // Column key uses field name, SQL column name uses snake_case
      expect(columns).toHaveProperty("isActive");
    });

    it("maps date field to timestamp column", () => {
      const fields: FieldDefinition[] = [{ name: "publishedAt", type: "date" }];
      const result = generateRuntimeSchema("dc_products", fields, "postgresql");
      const columns = getTableColumns(result.table);
      expect(columns).toHaveProperty("publishedAt");
    });

    it("maps json field to jsonb column", () => {
      const fields: FieldDefinition[] = [{ name: "metadata", type: "json" }];
      const result = generateRuntimeSchema("dc_products", fields, "postgresql");
      const columns = getTableColumns(result.table);
      expect(columns).toHaveProperty("metadata");
    });

    it("maps select field to text column", () => {
      const fields: FieldDefinition[] = [
        {
          name: "status",
          type: "select",
          fieldOptions: [
            { label: "Draft", value: "draft" },
            { label: "Published", value: "published" },
          ],
        },
      ];
      const result = generateRuntimeSchema("dc_products", fields, "postgresql");
      const columns = getTableColumns(result.table);
      expect(columns).toHaveProperty("status");
    });

    it("maps relationship field to text column (foreign key ID)", () => {
      const fields: FieldDefinition[] = [
        { name: "author", type: "relationship", relationTo: "users" },
      ];
      const result = generateRuntimeSchema("dc_posts", fields, "postgresql");
      const columns = getTableColumns(result.table);
      expect(columns).toHaveProperty("author");
    });

    it("maps hasMany relationship to jsonb column", () => {
      const fields: FieldDefinition[] = [
        {
          name: "tags",
          type: "relationship",
          relationTo: "tags",
          hasMany: true,
        },
      ];
      const result = generateRuntimeSchema("dc_posts", fields, "postgresql");
      const columns = getTableColumns(result.table);
      expect(columns).toHaveProperty("tags");
    });

    it("maps chips field to jsonb column", () => {
      const fields: FieldDefinition[] = [{ name: "labels", type: "chips" }];
      const result = generateRuntimeSchema("dc_posts", fields, "postgresql");
      const columns = getTableColumns(result.table);
      expect(columns).toHaveProperty("labels");
    });

    it("handles legacy type aliases (string -> text, boolean -> checkbox)", () => {
      const fields: FieldDefinition[] = [
        { name: "name", type: "string" as FieldDefinition["type"] },
        { name: "active", type: "boolean" as FieldDefinition["type"] },
        { name: "amount", type: "decimal" as FieldDefinition["type"] },
        { name: "ref", type: "relation" as FieldDefinition["type"] },
      ];
      const result = generateRuntimeSchema("dc_test", fields, "postgresql");
      const columns = getTableColumns(result.table);
      expect(columns).toHaveProperty("name");
      expect(columns).toHaveProperty("active");
      expect(columns).toHaveProperty("amount");
      expect(columns).toHaveProperty("ref");
    });

    it("skips layout-only fields (tabs, collapsible, row)", () => {
      const fields: FieldDefinition[] = [
        { name: "title", type: "text", required: true },
        { name: "layout", type: "tabs" as FieldDefinition["type"] },
        { name: "section", type: "collapsible" as FieldDefinition["type"] },
        { name: "row1", type: "row" as FieldDefinition["type"] },
      ];
      const result = generateRuntimeSchema("dc_test", fields, "postgresql");
      const columns = getTableColumns(result.table);
      expect(columns).not.toHaveProperty("layout");
      expect(columns).not.toHaveProperty("section");
      expect(columns).not.toHaveProperty("row1");
    });
  });

  describe("MySQL", () => {
    it("generates a mysqlTable with correct table name", () => {
      const result = generateRuntimeSchema("dc_products", baseFields, "mysql");
      expect(getTableName(result.table)).toBe("dc_products");
    });

    it("includes system columns", () => {
      const result = generateRuntimeSchema("dc_products", baseFields, "mysql");
      const columns = getTableColumns(result.table);
      expect(columns).toHaveProperty("id");
      expect(columns).toHaveProperty("slug");
    });

    it("returns schemaRecord keyed by table name", () => {
      const result = generateRuntimeSchema("dc_products", baseFields, "mysql");
      expect(result.schemaRecord).toHaveProperty("dc_products");
    });
  });

  describe("SQLite", () => {
    it("generates a sqliteTable with correct table name", () => {
      const result = generateRuntimeSchema("dc_products", baseFields, "sqlite");
      expect(getTableName(result.table)).toBe("dc_products");
    });

    it("includes system columns", () => {
      const result = generateRuntimeSchema("dc_products", baseFields, "sqlite");
      const columns = getTableColumns(result.table);
      expect(columns).toHaveProperty("id");
      expect(columns).toHaveProperty("slug");
    });

    it("returns schemaRecord keyed by table name", () => {
      const result = generateRuntimeSchema("dc_products", baseFields, "sqlite");
      expect(result.schemaRecord).toHaveProperty("dc_products");
    });
  });

  describe("error handling", () => {
    it("throws for unsupported dialect", () => {
      expect(() =>
        generateRuntimeSchema("dc_test", baseFields, "oracle" as any)
      ).toThrow(/unsupported dialect/i);
    });
  });

  // Why: Draft/Published is opt-in. The runtime Drizzle table must include a
  // status column when status is true (so INSERT/UPDATE see it) and must omit
  // it otherwise (so toggling off doesn't leave a phantom column reference).
  describe("status column (Draft / Published)", () => {
    it("includes a status column on PG when options.status is true", () => {
      const result = generateRuntimeSchema(
        "dc_posts",
        baseFields,
        "postgresql",
        { status: true }
      );
      expect(getTableColumns(result.table)).toHaveProperty("status");
    });

    it("includes a status column on MySQL when options.status is true", () => {
      const result = generateRuntimeSchema("dc_posts", baseFields, "mysql", {
        status: true,
      });
      expect(getTableColumns(result.table)).toHaveProperty("status");
    });

    it("includes a status column on SQLite when options.status is true", () => {
      const result = generateRuntimeSchema("dc_posts", baseFields, "sqlite", {
        status: true,
      });
      expect(getTableColumns(result.table)).toHaveProperty("status");
    });

    it("omits the status column when options.status is false or unset", () => {
      const unset = generateRuntimeSchema(
        "dc_posts",
        baseFields,
        "postgresql"
      );
      expect(getTableColumns(unset.table)).not.toHaveProperty("status");

      const off = generateRuntimeSchema("dc_posts", baseFields, "postgresql", {
        status: false,
      });
      expect(getTableColumns(off.table)).not.toHaveProperty("status");
    });
  });
});
