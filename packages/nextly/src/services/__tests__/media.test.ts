import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "../../__tests__/fixtures/db";
import type { TestDatabase } from "../../__tests__/fixtures/types";
import { MediaService } from "../media";

const mockStorageUpload = vi.fn().mockResolvedValue({
  url: "https://test.com/test-image.jpg",
  path: "test-image.jpg",
});
const mockStorageDelete = vi.fn().mockResolvedValue(undefined);
const mockStorageExists = vi.fn().mockResolvedValue(true);
const mockStorageGetPublicUrl = vi.fn(
  (path: string) => `https://test.com/${path}`
);
const mockStorageGetType = vi.fn().mockReturnValue("local");

const mockIsValidImage = vi.fn().mockResolvedValue(true);
const mockGetDimensions = vi
  .fn()
  .mockResolvedValue({ width: 1920, height: 1080 });
const mockGenerateThumbnail = vi.fn().mockResolvedValue({
  buffer: Buffer.from("thumbnail"),
  metadata: { width: 300, height: 300, format: "jpeg" },
});
const mockOptimizeImage = vi.fn().mockResolvedValue({
  buffer: Buffer.from("optimized"),
  metadata: { width: 1920, height: 1080, format: "webp" },
});

vi.mock("@nextly/storage", () => ({
  getMediaStorage: vi.fn(() => ({
    upload: mockStorageUpload,
    delete: mockStorageDelete,
    exists: mockStorageExists,
    getPublicUrl: mockStorageGetPublicUrl,
    getStorageType: mockStorageGetType,
  })),
  getImageProcessor: vi.fn(() => ({
    isValidImage: mockIsValidImage,
    getDimensions: mockGetDimensions,
    generateThumbnail: mockGenerateThumbnail,
    optimizeImage: mockOptimizeImage,
  })),
  // Pass-through retry utilities (don't mock, use real implementation)
  withRetry: vi.fn(async (fn, _options) => fn()),
  isTransientError: vi.fn(() => false),
}));

describe("MediaService", () => {
  let testDb: TestDatabase;
  let mediaService: MediaService;
  let testUserId: string;

  beforeEach(async () => {
    mockStorageUpload.mockClear();
    mockStorageUpload.mockResolvedValue({
      url: "https://test.com/test-image.jpg",
      path: "test-image.jpg",
    });
    mockStorageDelete.mockClear();
    mockStorageDelete.mockResolvedValue(undefined);
    mockStorageExists.mockClear();
    mockStorageExists.mockResolvedValue(true);
    mockStorageGetPublicUrl.mockClear();
    mockStorageGetType.mockClear();
    mockIsValidImage.mockClear();
    mockIsValidImage.mockResolvedValue(true);
    mockGetDimensions.mockClear();
    mockGetDimensions.mockResolvedValue({ width: 1920, height: 1080 });
    mockGenerateThumbnail.mockClear();
    mockGenerateThumbnail.mockResolvedValue({
      buffer: Buffer.from("thumbnail"),
      metadata: { width: 300, height: 300, format: "jpeg" },
    });
    mockOptimizeImage.mockClear();

    testDb = await createTestDb();
    mediaService = new MediaService(testDb.db, testDb.schema);

    testUserId = "test-user-001";
    await testDb.db.insert(testDb.schema.users).values({
      id: testUserId,
      email: "test@example.com",
      name: "Test User",
      passwordHash: "hash",
    });
  });

  describe("listMedia", () => {
    beforeEach(async () => {
      const now = new Date();
      await testDb.db.insert(testDb.schema.media).values([
        {
          id: "media-001",
          filename: "photo1.jpg",
          originalFilename: "vacation-photo.jpg",
          mimeType: "image/jpeg",
          size: 1024000,
          width: 1920,
          height: 1080,
          duration: null,
          url: "https://test.com/photo1.jpg",
          thumbnailUrl: "https://test.com/thumb_photo1.jpg",
          altText: "Vacation photo",
          caption: null,
          tags: null,
          uploadedBy: testUserId,
          uploadedAt: now,
          updatedAt: now,
        },
        {
          id: "media-002",
          filename: "document.pdf",
          originalFilename: "report.pdf",
          mimeType: "application/pdf",
          size: 512000,
          width: null,
          height: null,
          duration: null,
          url: "https://test.com/document.pdf",
          thumbnailUrl: null,
          altText: null,
          caption: null,
          tags: null,
          uploadedBy: testUserId,
          uploadedAt: new Date(now.getTime() + 1000),
          updatedAt: new Date(now.getTime() + 1000),
        },
        {
          id: "media-003",
          filename: "beach.jpg",
          originalFilename: "beach-sunset.jpg",
          mimeType: "image/jpeg",
          size: 2048000,
          width: 3840,
          height: 2160,
          duration: null,
          url: "https://test.com/beach.jpg",
          thumbnailUrl: "https://test.com/thumb_beach.jpg",
          altText: "Beach sunset",
          caption: "Beautiful sunset at the beach",
          tags: null,
          uploadedBy: testUserId,
          uploadedAt: new Date(now.getTime() + 2000),
          updatedAt: new Date(now.getTime() + 2000),
        },
      ]);
    });

    it("should list all media with default pagination", async () => {
      const result = await mediaService.listMedia();

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.data).toHaveLength(3);
      expect(result.meta).toEqual({
        total: 3,
        page: 1,
        pageSize: 24,
        totalPages: 1,
      });
    });

    it("should support pagination", async () => {
      const result = await mediaService.listMedia({ page: 1, pageSize: 2 });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.meta).toEqual({
        total: 3,
        page: 1,
        pageSize: 2,
        totalPages: 2,
      });
    });

    it("should search by filename and altText", async () => {
      const result = await mediaService.listMedia({ search: "beach" });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data![0].id).toBe("media-003");
    });

    it("should filter by media type", async () => {
      const result = await mediaService.listMedia({ type: "image" });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data!.every(m => m.mimeType.startsWith("image/"))).toBe(
        true
      );
    });

    it("should support sorting", async () => {
      const result = await mediaService.listMedia({
        sortBy: "size",
        sortOrder: "desc",
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
      expect(result.data![0].id).toBe("media-003");
    });
  });

  describe("getMediaById", () => {
    let mediaId: string;

    beforeEach(async () => {
      mediaId = "media-get-001";
      await testDb.db.insert(testDb.schema.media).values({
        id: mediaId,
        filename: "test.jpg",
        originalFilename: "test.jpg",
        mimeType: "image/jpeg",
        size: 1024000,
        width: 1920,
        height: 1080,
        duration: null,
        url: "https://test.com/test.jpg",
        thumbnailUrl: null,
        altText: null,
        caption: null,
        tags: null,
        uploadedBy: testUserId,
        uploadedAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it("should retrieve media by ID", async () => {
      const result = await mediaService.getMediaById(mediaId);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.data).toBeDefined();
      expect(result.data!.id).toBe(mediaId);
      expect(result.data!.filename).toBe("test.jpg");
    });

    it("should return 404 for non-existent media", async () => {
      const result = await mediaService.getMediaById("non-existent-id");

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
      expect(result.message).toBe("Media not found");
      expect(result.data).toBeNull();
    });
  });

  describe("uploadMedia", () => {
    it("should upload image with thumbnail generation", async () => {
      const buffer = Buffer.from("fake-image-data");
      const result = await mediaService.uploadMedia({
        file: buffer,
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        size: 1024000,
        uploadedBy: testUserId,
      });

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(201);
      expect(result.message).toBe("Media uploaded successfully");
      expect(result.data).toBeDefined();
      expect(result.data!.filename).toBe("test-image.jpg");
      expect(result.data!.originalFilename).toBe("photo.jpg");
      expect(result.data!.width).toBe(1920);
      expect(result.data!.height).toBe(1080);
      expect(result.data!.thumbnailUrl).toBeDefined();

      expect(mockStorageUpload).toHaveBeenCalledTimes(2);

      expect(mockIsValidImage).toHaveBeenCalledWith(buffer);
      expect(mockGetDimensions).toHaveBeenCalledWith(buffer);
      expect(mockGenerateThumbnail).toHaveBeenCalledWith(buffer);
    });

    it("should upload non-image files without thumbnail", async () => {
      const buffer = Buffer.from("fake-pdf-data");
      const result = await mediaService.uploadMedia({
        file: buffer,
        filename: "document.pdf",
        mimeType: "application/pdf",
        size: 512000,
        uploadedBy: testUserId,
      });

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(201);
      expect(result.data!.thumbnailUrl).toBeNull();

      expect(mockStorageUpload).toHaveBeenCalledTimes(1);

      expect(mockIsValidImage).not.toHaveBeenCalled();
      expect(mockGetDimensions).not.toHaveBeenCalled();
      expect(mockGenerateThumbnail).not.toHaveBeenCalled();
    });

    it("should reject files exceeding size limit", async () => {
      const buffer = Buffer.from("large-file");
      const result = await mediaService.uploadMedia({
        file: buffer,
        filename: "large.jpg",
        mimeType: "image/jpeg",
        size: 11 * 1024 * 1024, // 11MB (exceeds 10MB limit)
        uploadedBy: testUserId,
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.message).toContain("File too large");
      expect(result.data).toBeNull();
    });

    it("should reject invalid image files", async () => {
      mockIsValidImage.mockResolvedValueOnce(false);

      const buffer = Buffer.from("corrupted-image");
      const result = await mediaService.uploadMedia({
        file: buffer,
        filename: "corrupted.jpg",
        mimeType: "image/jpeg",
        size: 1024000,
        uploadedBy: testUserId,
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.message).toBe("Invalid image file");
      expect(result.data).toBeNull();
    });

    it("should continue upload if thumbnail generation fails", async () => {
      mockGenerateThumbnail.mockRejectedValueOnce(
        new Error("Thumbnail generation failed")
      );

      const buffer = Buffer.from("image-data");
      const result = await mediaService.uploadMedia({
        file: buffer,
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        size: 1024000,
        uploadedBy: testUserId,
      });

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(201);
      expect(result.data!.thumbnailUrl).toBeNull();
    });

    it("should handle storage upload errors", async () => {
      // Fail on second upload (original file, not thumbnail)
      mockStorageUpload
        .mockResolvedValueOnce({
          url: "https://test.com/thumb.jpg",
          path: "thumb.jpg",
        })
        .mockRejectedValueOnce(new Error("Storage upload failed"));

      const buffer = Buffer.from("image-data");
      const result = await mediaService.uploadMedia({
        file: buffer,
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        size: 1024000,
        uploadedBy: testUserId,
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.message).toBe("Failed to upload media");
      expect(result.data).toBeNull();
    });
  });

  describe("updateMedia", () => {
    let mediaId: string;

    beforeEach(async () => {
      mediaId = "media-update-001";
      await testDb.db.insert(testDb.schema.media).values({
        id: mediaId,
        filename: "test.jpg",
        originalFilename: "test.jpg",
        mimeType: "image/jpeg",
        size: 1024000,
        width: 1920,
        height: 1080,
        duration: null,
        url: "https://test.com/test.jpg",
        thumbnailUrl: null,
        altText: null,
        caption: null,
        tags: null,
        uploadedBy: testUserId,
        uploadedAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it("should update media metadata", async () => {
      const result = await mediaService.updateMedia(mediaId, {
        altText: "Updated alt text",
        caption: "Updated caption",
        tags: "tag1,tag2",
      });

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.message).toBe("Media updated successfully");
      expect(result.data!.altText).toBe("Updated alt text");
      expect(result.data!.caption).toBe("Updated caption");
      expect(result.data!.tags).toBe("tag1,tag2");
    });

    it("should return 404 for non-existent media", async () => {
      const result = await mediaService.updateMedia("non-existent-id", {
        altText: "New alt text",
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
      expect(result.message).toBe("Media not found");
      expect(result.data).toBeNull();
    });
  });

  describe("deleteMedia", () => {
    it("should delete media with thumbnail cleanup", async () => {
      const mediaId = "media-delete-001";
      await testDb.db.insert(testDb.schema.media).values({
        id: mediaId,
        filename: "test.jpg",
        originalFilename: "test.jpg",
        mimeType: "image/jpeg",
        size: 1024000,
        width: 1920,
        height: 1080,
        duration: null,
        url: "https://test.com/test.jpg",
        thumbnailUrl: "https://test.com/thumb_test.jpg",
        altText: null,
        caption: null,
        tags: null,
        uploadedBy: testUserId,
        uploadedAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await mediaService.deleteMedia(mediaId);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.message).toBe("Media deleted successfully");

      expect(mockStorageDelete).toHaveBeenCalledTimes(2);
      expect(mockStorageDelete).toHaveBeenCalledWith("test.jpg");
      expect(mockStorageDelete).toHaveBeenCalledWith("thumb_test.jpg");

      const check = await mediaService.getMediaById(mediaId);
      expect(check.success).toBe(false);
      expect(check.statusCode).toBe(404);
    });

    it("should return 404 for non-existent media", async () => {
      const result = await mediaService.deleteMedia("non-existent-id");

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
      expect(result.message).toBe("Media not found");
    });

    it("should continue deletion even if storage cleanup fails", async () => {
      mockStorageDelete.mockRejectedValueOnce(
        new Error("Storage delete failed")
      );

      const mediaId = "media-delete-002";
      await testDb.db.insert(testDb.schema.media).values({
        id: mediaId,
        filename: "test.jpg",
        originalFilename: "test.jpg",
        mimeType: "image/jpeg",
        size: 1024000,
        width: null,
        height: null,
        duration: null,
        url: "https://test.com/test.jpg",
        thumbnailUrl: null,
        altText: null,
        caption: null,
        tags: null,
        uploadedBy: testUserId,
        uploadedAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await mediaService.deleteMedia(mediaId);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);

      const check = await mediaService.getMediaById(mediaId);
      expect(check.success).toBe(false);
    });
  });

  describe("getStorageType", () => {
    it("should return current storage adapter type", () => {
      const storageType = mediaService.getStorageType();

      expect(storageType).toBe("local");
    });
  });
});
