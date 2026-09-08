import { beforeEach, describe, expect, it, vi } from "vitest";

// `TestDb` is the fixture's own return type (`Awaited<ReturnType<typeof
// createTestDb>>`), so this annotation tracks the helper instead of
// restating its shape.
import {
  createTestDb,
  testLogger,
  type TestDb,
} from "../../__tests__/fixtures/db";
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
  let testDb: TestDb;
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
    mediaService = new MediaService(testDb.adapter, testLogger);

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
        limit: 24,
        totalPages: 1,
      });
    });

    it("should support pagination", async () => {
      const result = await mediaService.listMedia({ page: 1, limit: 2 });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.meta).toEqual({
        total: 3,
        page: 1,
        limit: 2,
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
      // Real bytes: the gate measures the buffer rather than reading the
      // `size` beside it, so a small buffer declaring 11MB is now accepted.
      const buffer = Buffer.alloc(11 * 1024 * 1024);
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

    it("refuses by the BYTES, not by the size the caller declared", async () => {
      /*
       * `uploadMedia` is exported, so the buffer and the `size` beside it are
       * two claims a caller can make disagree. Trusting the declared one let a
       * caller past a cap its bytes exceeded, and wrote a row that misdescribed
       * its own object — which every later reader then has to distrust.
       */
      const result = await mediaService.uploadMedia({
        file: Buffer.alloc(11 * 1024 * 1024),
        filename: "big.jpg",
        mimeType: "image/jpeg",
        // Declared as one byte.
        size: 1,
        uploadedBy: testUserId,
      });

      expect(result.statusCode).toBe(400);
      expect(result.message).toContain("File too large");
    });

    it("records the size of the bytes it stored, not the declared one", async () => {
      /*
       * Declared deliberately UNEQUAL to the buffer. A row that repeated the
       * caller's number would describe an object that is not there, and this
       * harness writes a real row, so the persisted value is observable.
       */
      const buffer = Buffer.from("a short but honest payload");
      const result = await mediaService.uploadMedia({
        file: buffer,
        filename: "small.jpg",
        mimeType: "image/jpeg",
        size: 999_999,
        uploadedBy: testUserId,
      });

      expect(result.success).toBe(true);
      expect(buffer.length).not.toBe(999_999);
      expect(result.data?.size).toBe(buffer.length);
    });

    it("should reject invalid image files", async () => {
      // "invalid" is a POSITIVE finding that the buffer is not an image, which
      // is the only validity result that may refuse an upload.
      mockIsValidImage.mockResolvedValueOnce("invalid");

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

    it("accepts the upload when image processing is unavailable", async () => {
      // "unknown" means this install has no image processing, so the check
      // never ran. Refusing on it would answer "Invalid image file" to a user
      // whose file is fine, blaming them for a package missing from the
      // server -- and the magic-byte gate has already accepted the upload.
      mockIsValidImage.mockResolvedValueOnce("unknown");

      const buffer = Buffer.from("a perfectly good image");
      const result = await mediaService.uploadMedia({
        file: buffer,
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        uploadedBy: testUserId,
      });

      expect(result.message).not.toBe("Invalid image file");
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
      // The bucket travels with the path: `storage.delete(path, "media")`.
      // A single-argument assertion passes only while the call has exactly one,
      // so it silently stopped describing this call when the bucket was added.
      expect(mockStorageDelete).toHaveBeenCalledWith("test.jpg", "media");
      expect(mockStorageDelete).toHaveBeenCalledWith("thumb_test.jpg", "media");

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

  describe("the size cap the installation configured", () => {
    /*
     * This writer sits UNDER the validator on every path — the unified service
     * wraps it, and the published server action calls it directly — so a cap of
     * its own refuses, from the inside, a file the configured policy has already
     * allowed, and names a limit the install never set.
     *
     * Real bytes throughout. The gate measures the buffer rather than the `size`
     * beside it, so a small buffer declaring a large size no longer reaches it.
     */
    const ONE_MB = 1024 * 1024;

    /** The writer as its constructors build it, carrying a configured cap. */
    function writerWithCap(maxUploadBytes: number | undefined): MediaService {
      return new MediaService(
        testDb.adapter,
        testLogger,
        undefined,
        undefined,
        maxUploadBytes
      );
    }

    async function upload(service: MediaService, bytes: number) {
      return service.uploadMedia({
        file: Buffer.alloc(bytes, 0x61),
        filename: "payload.bin",
        mimeType: "application/octet-stream",
        size: bytes,
        uploadedBy: testUserId,
      });
    }

    it("refuses past the INSTALL's limit, naming that limit", async () => {
      const result = await upload(writerWithCap(ONE_MB), 2 * ONE_MB);

      expect(result.statusCode).toBe(400);
      // The install's number, not this module's built-in 10MB.
      expect(result.message).toContain("1MB");
    });

    it("accepts what that same cap allows", async () => {
      /*
       * Without this, the case above is equally satisfied by a writer that
       * refuses every upload.
       */
      const result = await upload(writerWithCap(ONE_MB), 1024);

      expect(result.success).toBe(true);
    });

    it("accepts the REFUSED file when no cap was configured", async () => {
      /*
       * The control that makes the refusal above attributable. The same bytes
       * are under the built-in 10MB default, so a service refusing them for any
       * reason other than the injected cap would refuse them here too — and the
       * first case would prove nothing about which number decided.
       */
      const result = await upload(writerWithCap(undefined), 2 * ONE_MB);

      expect(result.success).toBe(true);
    });
  });

  describe("getStorageType", () => {
    it("should return current storage adapter type", () => {
      const storageType = mediaService.getStorageType();

      expect(storageType).toBe("local");
    });
  });
});
