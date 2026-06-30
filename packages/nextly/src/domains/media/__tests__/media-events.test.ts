/**
 * media.* post-commit lifecycle events (D69 / B5).
 *
 * Verifies that `MediaService` emits best-effort `media.*` events at its
 * success boundaries:
 *   - `upload`  → `media.uploaded` with `{ mediaId, filename }`
 *   - `delete`  → `media.deleted`  with `{ mediaId }`
 *
 * The emits are observe-only, post-commit, and must never alter the operation's
 * result. This is a unit test: the service is constructed with mocked legacy
 * services (mirroring `media-service-edge-cases.test.ts`) and we subscribe to
 * the global event bus to capture the emitted payloads.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { getEventBus, resetEventBus } from "../../../events/event-bus";
import { UploadValidator } from "../../../services/upload-validation";
import { MediaService } from "../services/media-service";
import type { UploadMediaInput } from "../services/media-service";

function successResult<T>(data: T) {
  return { success: true, statusCode: 200, message: "OK", data };
}

const context = {
  user: { id: "user-001", email: "test@example.com" },
  locale: "en",
};

describe("MediaService — media.* post-commit events (D69)", () => {
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
    resetEventBus();

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
      new UploadValidator(undefined),
      true,
      silentLogger
    );
  });

  it("upload emits media.uploaded with { mediaId, filename }", async () => {
    mockLegacyMedia.uploadMedia.mockResolvedValue(
      successResult({
        id: "m1",
        filename: "f.png",
        originalFilename: "f.png",
        mimeType: "image/png",
        size: 1024,
        url: "https://test.com/f.png",
        uploadedAt: new Date(),
        updatedAt: new Date(),
      })
    );

    const events: Array<Record<string, unknown>> = [];
    getEventBus().on<Record<string, unknown>>("media.uploaded", e => {
      events.push(e.payload);
    });

    const input: UploadMediaInput = {
      buffer: Buffer.from("a fake but non-empty image payload"),
      filename: "f.png",
      mimeType: "image/png",
      size: 1024,
    };

    const result = await service.upload(input, context);
    await getEventBus().settle();

    // Behavior unchanged: upload still returns the mapped MediaFile.
    expect(result.id).toBe("m1");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ mediaId: "m1", filename: "f.png" });
  });

  it("delete emits media.deleted with { mediaId }", async () => {
    mockLegacyMedia.deleteMedia.mockResolvedValue(successResult(null));

    const events: Array<Record<string, unknown>> = [];
    getEventBus().on<Record<string, unknown>>("media.deleted", e => {
      events.push(e.payload);
    });

    await service.delete("m1", context);
    await getEventBus().settle();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ mediaId: "m1" });
  });
});
