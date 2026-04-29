/**
 * Direct API - Media Namespace Tests
 *
 * Tests: media.upload, media.find, media.findByID, media.update,
 *        media.delete, media.bulkDelete, media.folders.list, media.folders.create
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import type { Nextly } from "../nextly";

import { setupTestNextly, type TestMocks } from "./helpers/test-setup";

describe("Direct API - Media Operations", () => {
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

  describe("media.upload()", () => {
    it("should return uploaded file", async () => {
      const mockFile = {
        id: "media-1",
        filename: "image.jpg",
        originalFilename: "image.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        url: "/media/image.jpg",
        uploadedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mocks.mediaService.upload.mockResolvedValue(mockFile);

      const result = await nextly.media.upload({
        file: {
          data: Buffer.from("test"),
          name: "image.jpg",
          mimetype: "image/jpeg",
          size: 1024,
        },
        altText: "Test image",
      });

      expect(result).toEqual(mockFile);
      expect(mocks.mediaService.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          buffer: expect.any(Buffer),
          filename: "image.jpg",
          mimeType: "image/jpeg",
          size: 1024,
          altText: "Test image",
        }),
        expect.any(Object) // RequestContext
      );
    });

    it("should pass folder parameter", async () => {
      mocks.mediaService.upload.mockResolvedValue({ id: "m1" });

      await nextly.media.upload({
        file: {
          data: Buffer.from("test"),
          name: "doc.pdf",
          mimetype: "application/pdf",
          size: 2048,
        },
        folder: "folder-123",
      });

      expect(mocks.mediaService.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          folderId: "folder-123",
        }),
        expect.any(Object)
      );
    });

    it("should throw on upload failure", async () => {
      // Services throw NextlyError directly (post-PR-4); the namespace
      // passes it through unchanged after `convertServiceError` was deleted.
      mocks.mediaService.upload.mockRejectedValue(
        new NextlyError({
          code: "VALIDATION_ERROR",
          publicMessage: "File too large",
          statusCode: 400,
        })
      );

      await expect(
        nextly.media.upload({
          file: {
            data: Buffer.from("test"),
            name: "big.zip",
            mimetype: "application/zip",
            size: 999999999,
          },
        })
      ).rejects.toThrow(NextlyError);
    });
  });

  describe("media.find()", () => {
    it("should return paginated media files", async () => {
      const mockFiles = [
        { id: "m1", filename: "a.jpg", url: "/a.jpg" },
        { id: "m2", filename: "b.jpg", url: "/b.jpg" },
      ];
      mocks.mediaService.listMedia.mockResolvedValue({
        data: mockFiles,
        pagination: { total: 2, limit: 24, offset: 0, hasMore: false },
      });

      const result = await nextly.media.find();

      expect(result.docs).toEqual(mockFiles);
      expect(result.totalDocs).toBe(2);
      expect(result.limit).toBe(24); // default limit
    });

    it("should pass search, mimeType, folder, pagination, sorting", async () => {
      mocks.mediaService.listMedia.mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 10, offset: 0, hasMore: false },
      });

      await nextly.media.find({
        search: "photo",
        mimeType: "image",
        folder: "folder-1",
        limit: 10,
        page: 2,
        sortBy: "uploadedAt",
        sortOrder: "desc",
      });

      expect(mocks.mediaService.listMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          search: "photo",
          type: "image",
          folderId: "folder-1",
          pageSize: 10,
          page: 2,
          sortBy: "uploadedAt",
          sortOrder: "desc",
        }),
        expect.any(Object)
      );
    });

    it("should calculate pagination fields", async () => {
      mocks.mediaService.listMedia.mockResolvedValue({
        data: [],
        pagination: { total: 100, limit: 24, offset: 0, hasMore: true },
      });

      const result = await nextly.media.find({ limit: 24, page: 1 });

      expect(result.totalPages).toBe(5); // ceil(100/24) = 5
      expect(result.hasNextPage).toBe(true);
      expect(result.hasPrevPage).toBe(false);
    });
  });

  describe("media.findByID()", () => {
    it("should return media file", async () => {
      const mockFile = {
        id: "media-1",
        filename: "photo.jpg",
        url: "/photo.jpg",
      };
      mocks.mediaService.findById.mockResolvedValue(mockFile);

      const result = await nextly.media.findByID({ id: "media-1" });

      expect(result).toEqual(mockFile);
    });

    it("should return null with disableErrors when not found", async () => {
      mocks.mediaService.findById.mockRejectedValue(
        NextlyError.notFound({ logContext: { entity: "media" } })
      );

      const result = await nextly.media.findByID({
        id: "missing",
        disableErrors: true,
      });

      expect(result).toBeNull();
    });

    it("should throw on not found without disableErrors", async () => {
      mocks.mediaService.findById.mockRejectedValue(
        NextlyError.notFound({ logContext: { entity: "media" } })
      );

      await expect(
        nextly.media.findByID({ id: "missing" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("media.update()", () => {
    it("should return updated media file", async () => {
      const mockFile = { id: "m1", filename: "photo.jpg", altText: "Updated" };
      mocks.mediaService.update.mockResolvedValue(mockFile);

      const result = await nextly.media.update({
        id: "m1",
        data: { altText: "Updated", caption: "A photo" },
      });

      expect(result).toEqual(mockFile);
      expect(mocks.mediaService.update).toHaveBeenCalledWith(
        "m1",
        expect.objectContaining({
          altText: "Updated",
          caption: "A photo",
        }),
        expect.any(Object)
      );
    });

    it("should throw when id is missing", async () => {
      await expect(
        nextly.media.update({ id: "", data: { altText: "x" } })
      ).rejects.toThrow("'id' is required");
    });

    it("should pass all data fields", async () => {
      mocks.mediaService.update.mockResolvedValue({ id: "m1" });

      await nextly.media.update({
        id: "m1",
        data: {
          filename: "renamed.jpg",
          altText: "Alt",
          caption: "Caption",
          tags: ["a", "b"],
          folderId: "folder-1",
        },
      });

      expect(mocks.mediaService.update).toHaveBeenCalledWith(
        "m1",
        {
          filename: "renamed.jpg",
          altText: "Alt",
          caption: "Caption",
          tags: ["a", "b"],
          folderId: "folder-1",
        },
        expect.any(Object)
      );
    });
  });

  describe("media.delete()", () => {
    it("should return DeleteResult", async () => {
      mocks.mediaService.delete.mockResolvedValue(undefined);

      const result = await nextly.media.delete({ id: "m1" });

      expect(result).toEqual({ deleted: true, ids: ["m1"] });
    });

    it("should throw when id is missing", async () => {
      await expect(nextly.media.delete({ id: "" })).rejects.toThrow(
        "'id' is required"
      );
    });

    it("should throw on not found", async () => {
      // Services throw NextlyError directly (post-PR-4); the namespace
      // passes it through unchanged after `convertServiceError` was deleted.
      mocks.mediaService.delete.mockRejectedValue(
        NextlyError.notFound({ logContext: { entity: "media" } })
      );

      await expect(
        nextly.media.delete({ id: "missing" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("media.bulkDelete()", () => {
    it("should return bulk operation result", async () => {
      mocks.mediaService.bulkDelete.mockResolvedValue({
        totalItems: 3,
        successCount: 2,
        failureCount: 1,
        results: [
          { id: "m1", success: true },
          { id: "m2", success: true },
          { id: "m3", success: false, error: "Not found" },
        ],
      });

      const result = await nextly.media.bulkDelete({
        ids: ["m1", "m2", "m3"],
      });

      expect(result.successCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.success).toEqual(["m1", "m2"]);
      expect(result.failed).toEqual([{ id: "m3", error: "Not found" }]);
    });

    it("should return empty result for empty ids", async () => {
      const result = await nextly.media.bulkDelete({ ids: [] });

      expect(result.successCount).toBe(0);
      expect(result.success).toEqual([]);
      expect(mocks.mediaService.bulkDelete).not.toHaveBeenCalled();
    });
  });

  describe("media.folders.list()", () => {
    it("should return root folders when no parent", async () => {
      const mockFolders = [
        { id: "f1", name: "Photos" },
        { id: "f2", name: "Documents" },
      ];
      mocks.mediaService.listRootFolders.mockResolvedValue(mockFolders);

      const result = await nextly.media.folders.list();

      expect(result).toEqual(mockFolders);
      expect(mocks.mediaService.listRootFolders).toHaveBeenCalled();
    });

    it("should return subfolders when parent specified", async () => {
      const mockFolders = [{ id: "sub1", name: "Vacation" }];
      mocks.mediaService.listSubfolders.mockResolvedValue(mockFolders);

      const result = await nextly.media.folders.list({ parent: "f1" });

      expect(result).toEqual(mockFolders);
      expect(mocks.mediaService.listSubfolders).toHaveBeenCalledWith(
        "f1",
        expect.any(Object)
      );
    });
  });

  describe("media.folders.create()", () => {
    it("should return created folder", async () => {
      const mockFolder = {
        id: "f1",
        name: "Photos",
        createdAt: new Date().toISOString(),
      };
      mocks.mediaService.createFolder.mockResolvedValue(mockFolder);

      const result = await nextly.media.folders.create({ name: "Photos" });

      expect(result).toEqual(mockFolder);
      expect(mocks.mediaService.createFolder).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Photos",
          parentId: null,
        }),
        expect.any(Object)
      );
    });

    it("should pass all folder options", async () => {
      mocks.mediaService.createFolder.mockResolvedValue({ id: "f1" });

      await nextly.media.folders.create({
        name: "Vacation",
        description: "Holiday photos",
        color: "#ff0000",
        icon: "camera",
        parent: "parent-folder",
      });

      expect(mocks.mediaService.createFolder).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Vacation",
          description: "Holiday photos",
          color: "#ff0000",
          icon: "camera",
          parentId: "parent-folder",
        }),
        expect.any(Object)
      );
    });

    it("should throw when name is missing", async () => {
      await expect(nextly.media.folders.create({ name: "" })).rejects.toThrow(
        "'name' is required"
      );
    });
  });
});
