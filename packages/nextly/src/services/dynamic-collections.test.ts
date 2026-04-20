import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createTestDb, type TestDb } from "../__tests__/fixtures/db";
import { dynamicCollections } from "../database/schema/postgres";
import type { FieldDefinition } from "../schemas/dynamic-collections";

import { DynamicCollectionService } from "./dynamic-collections";

describe("DynamicCollectionService", () => {
  let testDb: TestDb;
  let service: DynamicCollectionService;

  beforeEach(async () => {
    testDb = await createTestDb();
    service = new DynamicCollectionService(testDb.db);
  });

  afterEach(async () => {
    await testDb.reset();
    testDb.close();
  });

  describe("listCollections() - Lazy Loading", () => {
    beforeEach(async () => {
      const collections = [
        {
          id: "col1",
          name: "posts",
          label: "Blog Posts",
          tableName: "dc_posts",
          description: "Blog posts collection",
          icon: "file-text",
          schemaDefinition: {
            fields: [
              { name: "title", type: "text", label: "Title" },
              { name: "body", type: "richtext", label: "Body" },
              { name: "author", type: "text", label: "Author" },
            ] as FieldDefinition[],
          },
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        },
        {
          id: "col2",
          name: "products",
          label: "Products",
          tableName: "dc_products",
          description: "Product catalog",
          icon: "shopping-cart",
          schemaDefinition: {
            fields: [
              { name: "name", type: "text", label: "Product Name" },
              { name: "price", type: "number", label: "Price" },
              { name: "sku", type: "text", label: "SKU" },
              { name: "category", type: "text", label: "Category" },
              { name: "inStock", type: "boolean", label: "In Stock" },
            ] as FieldDefinition[],
          },
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
        },
        {
          id: "col3",
          name: "customers",
          label: "Customers",
          tableName: "dc_customers",
          description: "Customer records",
          icon: "users",
          schemaDefinition: {
            fields: [
              { name: "email", type: "email", label: "Email" },
              { name: "fullName", type: "text", label: "Full Name" },
            ] as FieldDefinition[],
          },
          createdAt: new Date("2024-01-03"),
          updatedAt: new Date("2024-01-03"),
        },
      ];

      await testDb.db.insert(dynamicCollections).values(collections);
    });

    it("should exclude schemaDefinition when includeSchema is false", async () => {
      const result = await service.listCollections({ includeSchema: false });

      expect(result.collections).toHaveLength(3);
      expect(result.total).toBe(3);

      result.collections.forEach(collection => {
        expect(collection).not.toHaveProperty("schemaDefinition");
        expect(collection).toHaveProperty("id");
        expect(collection).toHaveProperty("name");
        expect(collection).toHaveProperty("label");
        expect(collection).toHaveProperty("tableName");
        expect(collection).toHaveProperty("description");
        expect(collection).toHaveProperty("icon");
        expect(collection).toHaveProperty("createdAt");
        expect(collection).toHaveProperty("updatedAt");
      });
    });

    it("should include schemaDefinition when includeSchema is true", async () => {
      const result = await service.listCollections({ includeSchema: true });

      expect(result.collections).toHaveLength(3);
      expect(result.total).toBe(3);

      result.collections.forEach(collection => {
        expect(collection).toHaveProperty("schemaDefinition");
        expect(collection.schemaDefinition).toHaveProperty("fields");
        expect(Array.isArray(collection.schemaDefinition.fields)).toBe(true);
      });

      expect(result.collections[0]?.schemaDefinition.fields).toHaveLength(2);
      expect(result.collections[1]?.schemaDefinition.fields).toHaveLength(5);
      expect(result.collections[2]?.schemaDefinition.fields).toHaveLength(3);
    });

    it("should include schemaDefinition by default (backward compatibility)", async () => {
      const result = await service.listCollections();

      expect(result.collections).toHaveLength(3);

      result.collections.forEach(collection => {
        expect(collection).toHaveProperty("schemaDefinition");
        expect(collection.schemaDefinition).toHaveProperty("fields");
      });
    });

    it("should work with pagination when includeSchema is false", async () => {
      const result = await service.listCollections({
        page: 1,
        pageSize: 2,
        includeSchema: false,
      });

      expect(result.collections).toHaveLength(2);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
      expect(result.totalPages).toBe(2);

      result.collections.forEach(collection => {
        expect(collection).not.toHaveProperty("schemaDefinition");
      });
    });

    // Skip search tests for SQLite (ilike is PostgreSQL-specific)
    // The service is designed for PostgreSQL/MySQL in production
    it.skip("should work with search when includeSchema is false", async () => {
      const result = await service.listCollections({
        search: "product",
        includeSchema: false,
      });

      expect(result.collections).toHaveLength(1);
      expect(result.collections[0]?.name).toBe("products");
      expect(result.collections[0]).not.toHaveProperty("schemaDefinition");
    });

    it("should work with sorting when includeSchema is false", async () => {
      const result = await service.listCollections({
        sortBy: "name",
        sortOrder: "asc",
        includeSchema: false,
      });

      expect(result.collections).toHaveLength(3);
      expect(result.collections[0]?.name).toBe("customers");
      expect(result.collections[1]?.name).toBe("posts");
      expect(result.collections[2]?.name).toBe("products");

      result.collections.forEach(collection => {
        expect(collection).not.toHaveProperty("schemaDefinition");
      });
    });

    // Skip search tests for SQLite (ilike is PostgreSQL-specific)
    it.skip("should work with all options combined when includeSchema is false", async () => {
      const result = await service.listCollections({
        page: 1,
        pageSize: 10,
        search: "o",
        sortBy: "name",
        sortOrder: "asc",
        includeSchema: false,
      });

      expect(result.collections).toHaveLength(2);
      expect(result.collections[0]?.name).toBe("posts");
      expect(result.collections[1]?.name).toBe("products");

      result.collections.forEach(collection => {
        expect(collection).not.toHaveProperty("schemaDefinition");
      });
    });

    // Skip search tests for SQLite (ilike is PostgreSQL-specific)
    it.skip("should work with all options combined when includeSchema is true", async () => {
      const result = await service.listCollections({
        page: 1,
        pageSize: 10,
        search: "o",
        sortBy: "name",
        sortOrder: "asc",
        includeSchema: true,
      });

      expect(result.collections).toHaveLength(2);
      expect(result.collections[0]?.name).toBe("posts");
      expect(result.collections[1]?.name).toBe("products");

      result.collections.forEach(collection => {
        expect(collection).toHaveProperty("schemaDefinition");
        expect(collection.schemaDefinition).toHaveProperty("fields");
      });
    });

    it("should return correct pagination metadata with includeSchema false", async () => {
      const moreCollections = Array.from({ length: 15 }, (_, i) => ({
        id: `col${i + 10}`,
        name: `collection${i + 10}`,
        label: `Collection ${i + 10}`,
        tableName: `dc_collection${i + 10}`,
        description: `Test collection ${i + 10}`,
        schemaDefinition: {
          fields: [
            { name: "field1", type: "text", label: "Field 1" },
          ] as FieldDefinition[],
        },
        createdAt: new Date(`2024-02-${String(i + 1).padStart(2, "0")}`),
        updatedAt: new Date(`2024-02-${String(i + 1).padStart(2, "0")}`),
      }));

      await testDb.db.insert(dynamicCollections).values(moreCollections);

      const result = await service.listCollections({
        page: 2,
        pageSize: 5,
        includeSchema: false,
      });

      expect(result.collections).toHaveLength(5);
      expect(result.total).toBe(18);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(5);
      expect(result.totalPages).toBe(4);

      result.collections.forEach(collection => {
        expect(collection).not.toHaveProperty("schemaDefinition");
      });
    });
  });
});
