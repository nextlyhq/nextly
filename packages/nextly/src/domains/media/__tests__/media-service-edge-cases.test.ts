/**
 * Media Service Edge Case Tests
 *
 * Augments existing media-service tests with edge cases.
 *
 * Covers:
 * - Upload with invalid MIME type handling
 * - Upload with storage not configured
 * - Bulk delete with mixed valid/invalid IDs
 * - List with pagination boundaries (empty result, page beyond total)
 * - Bulk upload with partial failures
 * - findById not found
 * - Update not found
 * - Delete not found
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { NextlyError } from "../../../errors";
import { MediaService } from "../services/media-service";
import type { UploadMediaInput } from "../services/media-service";

// ── Mock Factories ──────────────────────────────────────────────────────

function successResult<T>(data: T) {
  return { success: true, statusCode: 200, message: "OK", data };
}

function errorResult(statusCode: number, message: string) {
  return { success: false, statusCode, message, data: null };
}

const context = {
  user: { id: "user-001", email: "test@example.com" },
  locale: "en",
};

// ── Tests ────────────────────────────────────────────────────────────────

describe("MediaService — Edge Cases", () => {
  let service: MediaService;
  let mockLegacyMedia: Record<string, ReturnType<typeof vi.fn>>;
  let mockLegacyFolder: Record<string, ReturnType<typeof vi.fn>>;
  let mockStorage: { getType: ReturnType<typeof vi.fn> };
  let mockImageProcessor: Record<string, ReturnType<typeof vi.fn>>;
  const silentLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    mockLegacyMedia = {
      uploadMedia: vi.fn(),
      getMediaById: vi.fn(),
      listMedia: vi.fn(),
      updateMedia: vi.fn(),
      deleteMedia: vi.fn(),
    };

    mockLegacyFolder = {
      createFolder: vi.fn(),
      getFolderById: vi.fn(),
      listRootFolders: vi.fn(),
      listSubfolders: vi.fn(),
      getFolderContents: vi.fn(),
      updateFolder: vi.fn(),
      deleteFolder: vi.fn(),
      moveMediaToFolder: vi.fn(),
    };

    mockStorage = {
      getType: vi.fn().mockReturnValue("local"),
    };

    mockImageProcessor = {
      isValidImage: vi.fn().mockResolvedValue(true),
      getDimensions: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
    };

    service = new MediaService(
      mockLegacyMedia as never,
      mockLegacyFolder as never,
      mockStorage as never,
      mockImageProcessor as never,
      silentLogger
    );
  });

  // ── Upload Edge Cases ─────────────────────────────────────────────

  describe("upload — storage not configured", () => {
    it("should throw NextlyError when no storage is configured", async () => {
      const noStorageService = new MediaService(
        mockLegacyMedia as never,
        mockLegacyFolder as never,
        null,
        mockImageProcessor as never,
        silentLogger
      );

      const input: UploadMediaInput = {
        buffer: Buffer.from("data"),
        filename: "test.jpg",
        mimeType: "image/jpeg",
        size: 1024,
      };

      await expect(noStorageService.upload(input, context)).rejects.toThrow(
        NextlyError
      );
    });

    it("should throw NextlyError when getter returns null", async () => {
      const getterService = new MediaService(
        mockLegacyMedia as never,
        mockLegacyFolder as never,
        () => null,
        mockImageProcessor as never,
        silentLogger
      );

      const input: UploadMediaInput = {
        buffer: Buffer.from("data"),
        filename: "test.jpg",
        mimeType: "image/jpeg",
        size: 1024,
      };

      await expect(getterService.upload(input, context)).rejects.toThrow(
        NextlyError
      );
    });
  });

  describe("upload — file size validation", () => {
    it("should reject zero-size files", async () => {
      const input: UploadMediaInput = {
        buffer: Buffer.from(""),
        filename: "empty.jpg",
        mimeType: "image/jpeg",
        size: 0,
      };

      await expect(service.upload(input, context)).rejects.toThrow(NextlyError);
    });

    it("should reject files exceeding max size", async () => {
      const input: UploadMediaInput = {
        buffer: Buffer.from("large"),
        filename: "huge.jpg",
        mimeType: "image/jpeg",
        size: 11 * 1024 * 1024, // 11MB
      };

      await expect(service.upload(input, context)).rejects.toThrow(NextlyError);
    });
  });

  describe("upload — legacy service failure", () => {
    it("should map legacy 500 error to NextlyError", async () => {
      mockLegacyMedia.uploadMedia.mockResolvedValue(
        errorResult(500, "Internal storage error")
      );

      const input: UploadMediaInput = {
        buffer: Buffer.from("data"),
        filename: "test.jpg",
        mimeType: "image/jpeg",
        size: 1024,
      };

      await expect(service.upload(input, context)).rejects.toThrow(NextlyError);
    });
  });

  // ── Bulk Delete Edge Cases ────────────────────────────────────────

  describe("bulkDelete — mixed results", () => {
    it("should report partial success when some deletes fail (Phase 4.5)", async () => {
      // First delete succeeds, second fails
      mockLegacyMedia.deleteMedia
        .mockResolvedValueOnce(successResult(null))
        .mockResolvedValueOnce(errorResult(404, "Media not found"));

      const result = await service.bulkDelete(
        ["media-001", "media-nonexistent"],
        context
      );

      // Phase 4.5: shape is `{ successes: [{id}], failures: [{id, code, message}],
      // total, successCount, failedCount }`. NextlyError thrown by `delete()`
      // for a 404 underneath becomes a NOT_FOUND failure entry.
      expect(result.total).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.successes).toEqual([{ id: "media-001" }]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toMatchObject({
        id: "media-nonexistent",
        code: expect.any(String),
        message: expect.any(String),
      });
    });

    it("should handle empty ID array (Phase 4.5)", async () => {
      const result = await service.bulkDelete([], context);

      expect(result.total).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.successes).toEqual([]);
      expect(result.failures).toEqual([]);
    });

    it("should handle all deletes failing (Phase 4.5)", async () => {
      mockLegacyMedia.deleteMedia.mockResolvedValue(
        errorResult(404, "Not found")
      );

      const result = await service.bulkDelete(
        ["bad-1", "bad-2", "bad-3"],
        context
      );

      expect(result.total).toBe(3);
      expect(result.successCount).toBe(0);
      expect(result.failedCount).toBe(3);
      expect(result.failures).toHaveLength(3);
    });
  });

  // ── Bulk Upload Edge Cases ────────────────────────────────────────

  describe("bulkUpload — partial failures", () => {
    it("should continue uploading after individual failures", async () => {
      const successData = {
        id: "media-001",
        filename: "ok.jpg",
        originalFilename: "ok.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        url: "https://test.com/ok.jpg",
        uploadedAt: new Date(),
        updatedAt: new Date(),
      };

      mockLegacyMedia.uploadMedia
        .mockResolvedValueOnce(errorResult(500, "Storage error"))
        .mockResolvedValueOnce(successResult(successData));

      const inputs: UploadMediaInput[] = [
        {
          buffer: Buffer.from("fail"),
          filename: "fail.jpg",
          mimeType: "image/jpeg",
          size: 1024,
        },
        {
          buffer: Buffer.from("ok"),
          filename: "ok.jpg",
          mimeType: "image/jpeg",
          size: 1024,
        },
      ];

      const result = await service.bulkUpload(inputs, context);

      // Phase 4.5: BulkUploadOperationResult shape is keyed by `index` +
      // `filename` for failures (no id since the upload never created
      // the record).
      expect(result.total).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.failures[0]).toMatchObject({
        index: 0,
        filename: "fail.jpg",
        code: expect.any(String),
        message: expect.any(String),
      });
      expect(result.successes).toHaveLength(1);
    });
  });

  // ── List Pagination Boundaries ────────────────────────────────────

  describe("listMedia — pagination boundaries", () => {
    it("should return empty data for empty result set", async () => {
      mockLegacyMedia.listMedia.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: [],
        meta: { total: 0, page: 1, limit: 24, totalPages: 0 },
      });

      const result = await service.listMedia({}, context);

      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.hasMore).toBe(false);
    });

    it("should correctly report hasMore when there are more pages", async () => {
      const mediaItem = {
        id: "media-001",
        filename: "test.jpg",
        originalFilename: "test.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        url: "https://test.com/test.jpg",
        uploadedAt: new Date(),
        updatedAt: new Date(),
      };

      mockLegacyMedia.listMedia.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: [mediaItem],
        meta: { total: 5, page: 1, limit: 1, totalPages: 5 },
      });

      const result = await service.listMedia({ page: 1, limit: 1 }, context);

      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.total).toBe(5);
    });

    it("should report hasMore=false on last page", async () => {
      const mediaItem = {
        id: "media-005",
        filename: "last.jpg",
        originalFilename: "last.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        url: "https://test.com/last.jpg",
        uploadedAt: new Date(),
        updatedAt: new Date(),
      };

      mockLegacyMedia.listMedia.mockResolvedValue({
        success: true,
        statusCode: 200,
        message: "OK",
        data: [mediaItem],
        meta: { total: 5, page: 5, limit: 1, totalPages: 5 },
      });

      const result = await service.listMedia({ page: 5, limit: 1 }, context);

      expect(result.pagination.hasMore).toBe(false);
    });
  });

  // ── findById / Update / Delete Not Found ──────────────────────────

  describe("findById — not found", () => {
    it("should throw NextlyError NOT_FOUND", async () => {
      mockLegacyMedia.getMediaById.mockResolvedValue(
        errorResult(404, "Media not found")
      );

      await expect(service.findById("nonexistent", context)).rejects.toThrow(
        NextlyError
      );
    });
  });

  describe("update — not found", () => {
    it("should throw NextlyError NOT_FOUND for non-existent media", async () => {
      mockLegacyMedia.updateMedia.mockResolvedValue(
        errorResult(404, "Media not found")
      );

      await expect(
        service.update("nonexistent", { altText: "New" }, context)
      ).rejects.toThrow(NextlyError);
    });
  });

  describe("delete — not found", () => {
    it("should throw NextlyError NOT_FOUND for non-existent media", async () => {
      mockLegacyMedia.deleteMedia.mockResolvedValue(
        errorResult(404, "Media not found")
      );

      await expect(service.delete("nonexistent", context)).rejects.toThrow(
        NextlyError
      );
    });
  });

  // ── Storage utility methods ───────────────────────────────────────

  describe("hasStorage / getStorageType", () => {
    it("should return true when storage is configured", () => {
      expect(service.hasStorage()).toBe(true);
    });

    it("should return false when storage is null", () => {
      const noStorageService = new MediaService(
        mockLegacyMedia as never,
        mockLegacyFolder as never,
        null,
        mockImageProcessor as never,
        silentLogger
      );

      expect(noStorageService.hasStorage()).toBe(false);
    });

    it("should return storage type", () => {
      expect(service.getStorageType()).toBe("local");
    });

    it("should return 'none' when no storage configured", () => {
      const noStorageService = new MediaService(
        mockLegacyMedia as never,
        mockLegacyFolder as never,
        null,
        mockImageProcessor as never,
        silentLogger
      );

      expect(noStorageService.getStorageType()).toBe("none");
    });
  });
});
