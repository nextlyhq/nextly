/**
 * Direct API - Collection Operations Tests
 *
 * Tests: find, findByID, create, update, delete, count, bulkDelete, duplicate
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";

import { NextlyError, NotFoundError } from "../errors";
import type { Nextly } from "../nextly";

import {
  setupTestNextly,
  resetMocks,
  type TestMocks,
} from "./helpers/test-setup";

describe("Direct API - Collection Operations", () => {
  let nextly: Nextly;
  let mocks: TestMocks;
  let cleanup: () => void;

  beforeEach(() => {
    const setup = setupTestNextly();
    nextly = setup.nextly;
    mocks = setup.mocks;
    cleanup = setup.cleanup;
  });

  afterAll(() => {
    cleanup?.();
  });

  describe("find()", () => {
    it("should return paginated response on success", async () => {
      const mockResult = {
        success: true,
        statusCode: 200,
        message: "OK",
        data: {
          docs: [
            { id: "1", title: "Post 1" },
            { id: "2", title: "Post 2" },
          ],
          totalDocs: 2,
          limit: 10,
          page: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
          nextPage: null,
          prevPage: null,
          pagingCounter: 1,
        },
      };
      mocks.collectionsHandler.listEntries.mockResolvedValue(mockResult);

      const result = await nextly.find({ collection: "posts" });

      expect(result).toEqual(mockResult.data);
      expect(mocks.collectionsHandler.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionName: "posts",
          overrideAccess: true,
        })
      );
    });

    it("should pass where, limit, page, sort, depth, select", async () => {
      mocks.collectionsHandler.listEntries.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: {
          docs: [],
          totalDocs: 0,
          limit: 5,
          page: 2,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: true,
          nextPage: null,
          prevPage: 1,
          pagingCounter: 6,
        },
      });

      await nextly.find({
        collection: "posts",
        where: { status: { equals: "published" } },
        limit: 5,
        page: 2,
        sort: "-createdAt",
        depth: 3,
        select: { title: true, content: true },
      });

      expect(mocks.collectionsHandler.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionName: "posts",
          where: { status: { equals: "published" } },
          limit: 5,
          page: 2,
          sort: "-createdAt",
          depth: 3,
          select: { title: true, content: true },
        })
      );
    });

    it("should throw NextlyError on failure", async () => {
      mocks.collectionsHandler.listEntries.mockResolvedValue({
        success: false,
        statusCode: 500,
        message: "Database error",
        data: null,
      });

      await expect(nextly.find({ collection: "posts" })).rejects.toThrow(
        NextlyError
      );
    });
  });

  describe("findByID()", () => {
    it("should return document on success", async () => {
      const mockDoc = { id: "post-123", title: "Hello" };
      mocks.collectionsHandler.getEntry.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: mockDoc,
      });

      const result = await nextly.findByID({
        collection: "posts",
        id: "post-123",
      });

      expect(result).toEqual(mockDoc);
      expect(mocks.collectionsHandler.getEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionName: "posts",
          entryId: "post-123",
          overrideAccess: true,
        })
      );
    });

    it("should return null with disableErrors when not found", async () => {
      mocks.collectionsHandler.getEntry.mockResolvedValue({
        success: false,
        statusCode: 404,
        message: "Not found",
        data: null,
      });

      const result = await nextly.findByID({
        collection: "posts",
        id: "missing",
        disableErrors: true,
      });

      expect(result).toBeNull();
    });

    it("should throw NotFoundError without disableErrors", async () => {
      mocks.collectionsHandler.getEntry.mockResolvedValue({
        success: false,
        statusCode: 404,
        message: "Not found",
        data: null,
      });

      await expect(
        nextly.findByID({ collection: "posts", id: "missing" })
      ).rejects.toThrow(NotFoundError);
    });

    it("should pass depth and select options", async () => {
      mocks.collectionsHandler.getEntry.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: { id: "1" },
      });

      await nextly.findByID({
        collection: "posts",
        id: "1",
        depth: 2,
        select: { title: true },
      });

      expect(mocks.collectionsHandler.getEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          depth: 2,
          select: { title: true },
        })
      );
    });
  });

  describe("create()", () => {
    it("should return created document", async () => {
      const mockDoc = { id: "new-1", title: "New Post" };
      mocks.collectionsHandler.createEntry.mockResolvedValue({
        success: true,
        statusCode: 201,
        message: "Created",
        data: mockDoc,
      });

      const result = await nextly.create({
        collection: "posts",
        data: { title: "New Post" },
      });

      expect(result).toEqual(mockDoc);
      expect(mocks.collectionsHandler.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionName: "posts",
          overrideAccess: true,
        }),
        { title: "New Post" }
      );
    });

    it("should throw on failure", async () => {
      mocks.collectionsHandler.createEntry.mockResolvedValue({
        success: false,
        statusCode: 400,
        message: "Validation failed",
        data: null,
      });

      await expect(
        nextly.create({ collection: "posts", data: {} })
      ).rejects.toThrow(NextlyError);
    });

    it("should pass user context when provided", async () => {
      mocks.collectionsHandler.createEntry.mockResolvedValue({
        success: true,
        statusCode: 201,
        message: "Created",
        data: { id: "1" },
      });

      await nextly.create({
        collection: "posts",
        data: { title: "Test" },
        overrideAccess: false,
        user: { id: "user-1", role: "editor" },
      });

      expect(mocks.collectionsHandler.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          overrideAccess: false,
          user: { id: "user-1", role: "editor" },
        }),
        { title: "Test" }
      );
    });
  });

  describe("update()", () => {
    it("should update by ID and return updated document", async () => {
      const mockDoc = { id: "post-1", title: "Updated" };
      mocks.collectionsHandler.updateEntry.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "Updated",
        data: mockDoc,
      });

      const result = await nextly.update({
        collection: "posts",
        id: "post-1",
        data: { title: "Updated" },
      });

      expect(result).toEqual(mockDoc);
      expect(mocks.collectionsHandler.updateEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionName: "posts",
          entryId: "post-1",
        }),
        { title: "Updated" }
      );
    });

    it("should update by where clause", async () => {
      mocks.collectionsHandler.bulkUpdateByQuery.mockResolvedValue({
        success: ["post-1"],
        failed: [],
        successCount: 1,
        failedCount: 0,
      });
      mocks.collectionsHandler.getEntry.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: { id: "post-1", status: "published" },
      });

      const result = await nextly.update({
        collection: "posts",
        where: { status: { equals: "draft" } },
        data: { status: "published" },
      });

      expect(result).toEqual({ id: "post-1", status: "published" });
    });

    it("should throw when neither id nor where provided", async () => {
      await expect(
        nextly.update({
          collection: "posts",
          data: { title: "test" },
        })
      ).rejects.toThrow("Either 'id' or 'where' clause is required");
    });

    it("should throw NotFoundError when where matches nothing", async () => {
      mocks.collectionsHandler.bulkUpdateByQuery.mockResolvedValue({
        success: [],
        failed: [],
        successCount: 0,
        failedCount: 0,
      });

      await expect(
        nextly.update({
          collection: "posts",
          where: { status: { equals: "nonexistent" } },
          data: { title: "test" },
        })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("delete()", () => {
    it("should delete by ID and return result", async () => {
      mocks.collectionsHandler.deleteEntry.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "Deleted",
        data: null,
      });

      const result = await nextly.delete({
        collection: "posts",
        id: "post-1",
      });

      expect(result).toEqual({ deleted: true, ids: ["post-1"] });
    });

    it("should delete by where clause", async () => {
      mocks.collectionsHandler.bulkDeleteByQuery.mockResolvedValue({
        success: ["post-1", "post-2"],
        failed: [],
        successCount: 2,
        failedCount: 0,
      });

      const result = await nextly.delete({
        collection: "posts",
        where: { status: { equals: "archived" } },
      });

      expect(result).toEqual({ deleted: true, ids: ["post-1", "post-2"] });
    });

    it("should throw when neither id nor where provided", async () => {
      await expect(nextly.delete({ collection: "posts" })).rejects.toThrow(
        "Either 'id' or 'where' clause is required"
      );
    });

    it("should throw on failure", async () => {
      mocks.collectionsHandler.deleteEntry.mockResolvedValue({
        success: false,
        statusCode: 404,
        message: "Not found",
        data: null,
      });

      await expect(
        nextly.delete({ collection: "posts", id: "missing" })
      ).rejects.toThrow(NextlyError);
    });
  });

  describe("count()", () => {
    it("should return count result", async () => {
      const mockCount = { totalDocs: 42 };
      mocks.collectionsHandler.countEntries.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: mockCount,
      });

      const result = await nextly.count({ collection: "posts" });

      expect(result).toEqual(mockCount);
    });

    it("should pass where clause", async () => {
      mocks.collectionsHandler.countEntries.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: { totalDocs: 5 },
      });

      await nextly.count({
        collection: "posts",
        where: { status: { equals: "published" } },
      });

      expect(mocks.collectionsHandler.countEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionName: "posts",
          where: { status: { equals: "published" } },
        })
      );
    });

    it("should throw on failure", async () => {
      mocks.collectionsHandler.countEntries.mockResolvedValue({
        success: false,
        statusCode: 500,
        message: "Database error",
        data: null,
      });

      await expect(nextly.count({ collection: "posts" })).rejects.toThrow(
        NextlyError
      );
    });
  });

  describe("bulkDelete()", () => {
    it("should return bulk operation result", async () => {
      const mockResult = {
        success: ["post-1", "post-2"],
        failed: [],
        successCount: 2,
        failedCount: 0,
      };
      mocks.collectionsHandler.bulkDeleteEntries.mockResolvedValue(mockResult);

      const result = await nextly.bulkDelete({
        collection: "posts",
        ids: ["post-1", "post-2"],
      });

      expect(result).toEqual(mockResult);
    });

    it("should pass ids and config", async () => {
      mocks.collectionsHandler.bulkDeleteEntries.mockResolvedValue({
        success: [],
        failed: [],
        successCount: 0,
        failedCount: 0,
      });

      await nextly.bulkDelete({
        collection: "posts",
        ids: ["a", "b", "c"],
        overrideAccess: false,
        user: { id: "user-1" },
      });

      expect(mocks.collectionsHandler.bulkDeleteEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionName: "posts",
          ids: ["a", "b", "c"],
          overrideAccess: false,
          user: { id: "user-1", role: undefined },
        })
      );
    });

    it("should handle partial success", async () => {
      const mockResult = {
        success: ["post-1"],
        failed: ["post-2"],
        successCount: 1,
        failedCount: 1,
      };
      mocks.collectionsHandler.bulkDeleteEntries.mockResolvedValue(mockResult);

      const result = await nextly.bulkDelete({
        collection: "posts",
        ids: ["post-1", "post-2"],
      });

      expect(result.successCount).toBe(1);
      expect(result.failedCount).toBe(1);
    });
  });

  describe("duplicate()", () => {
    it("should return duplicated document", async () => {
      const mockDoc = { id: "post-copy", title: "Hello" };
      mocks.collectionsHandler.duplicateEntry.mockResolvedValue({
        success: true,
        statusCode: 201,
        message: "Duplicated",
        data: mockDoc,
      });

      const result = await nextly.duplicate({
        collection: "posts",
        id: "post-1",
      });

      expect(result).toEqual(mockDoc);
    });

    it("should pass overrides", async () => {
      mocks.collectionsHandler.duplicateEntry.mockResolvedValue({
        success: true,
        statusCode: 201,
        message: "Duplicated",
        data: { id: "copy", title: "Copy of Original" },
      });

      await nextly.duplicate({
        collection: "posts",
        id: "post-1",
        overrides: { title: "Copy of Original" },
      });

      expect(mocks.collectionsHandler.duplicateEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionName: "posts",
          entryId: "post-1",
          overrides: { title: "Copy of Original" },
        })
      );
    });

    it("should throw on failure", async () => {
      mocks.collectionsHandler.duplicateEntry.mockResolvedValue({
        success: false,
        statusCode: 404,
        message: "Source not found",
        data: null,
      });

      await expect(
        nextly.duplicate({ collection: "posts", id: "missing" })
      ).rejects.toThrow(NextlyError);
    });
  });
});
