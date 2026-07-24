/**
 * Focal-point crop regeneration must be content-addressed: new variants are
 * written to fresh keys, the row is committed pointing at them, and only THEN
 * are the superseded old variants deleted — so a rollback or a lost update race
 * never leaves the committed row referencing bytes that were already deleted.
 *
 * These use hand-rolled collaborators (no real DB) to pin the delete ORDERING
 * and the rollback/void cleanup, which are the correctness contract of the fix.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteSpy = vi.fn(async () => {});
const calls: string[] = [];

const storageMock = {
  getAdapterForCollection: () => ({
    read: async () => Buffer.from("original-image-bytes"),
  }),
  upload: async () => ({ url: "http://x/new", path: "NEW/thumb.webp" }),
  delete: async (path: string) => {
    calls.push(`delete:${path}`);
    return deleteSpy(path);
  },
};

vi.mock("@nextly/storage", () => ({
  getMediaStorage: () => storageMock,
  getImageProcessor: () => ({}),
  withRetry: (fn: () => unknown) => fn(),
  isTransientError: () => false,
  // The regenerated variants land on a fresh, unique key.
  generateImageSizes: async () => ({
    thumbnail: {
      path: "NEW/thumb.webp",
      url: "http://x/new",
      width: 100,
      height: 100,
    },
  }),
  deleteImageSizes: async () => {},
}));

vi.mock("../../domains/webhooks/record-mutation-event", () => ({
  recordMutationEvent: async () => {},
}));

vi.mock("../image-size", () => ({
  ImageSizeService: class {
    async getActiveSizeConfigs() {
      return [{ name: "thumbnail", width: 100, height: 100 }];
    }
  },
}));

import { MediaService } from "../media";

const OLD_PATH = "OLD/thumb.webp";
const NEW_PATH = "NEW/thumb.webp";

const existingMedia = {
  id: "m1",
  mimeType: "image/png",
  filename: "m1.png",
  originalFilename: "m1.png",
  sizes: { thumbnail: { path: OLD_PATH, url: "http://x/old" } },
};

function makeAdapter(txBehavior: "commit" | "throw" | "row-gone") {
  const tx = {
    lockRow: async () => {},
    select: async () => (txBehavior === "row-gone" ? [] : [existingMedia]),
    update: async () => {
      calls.push("update");
    },
  };
  return {
    dialect: "sqlite" as const,
    getDrizzle: () => ({}),
    transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => {
      const result = await fn(tx);
      if (txBehavior === "throw") throw new Error("db write failed");
      return result;
    },
  };
}

function makeService(txBehavior: "commit" | "throw" | "row-gone") {
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  const service = new MediaService(
    makeAdapter(txBehavior) as never,
    logger as never
  );
  // getMediaById is the pre-transaction existence read; stub it to the image.
  vi.spyOn(
    service as unknown as { getMediaById: () => Promise<unknown> },
    "getMediaById"
  ).mockResolvedValue({ success: true, statusCode: 200, data: existingMedia });
  return service;
}

describe("MediaService focal-point regeneration ordering", () => {
  beforeEach(() => {
    calls.length = 0;
    deleteSpy.mockClear();
  });

  it("deletes the old variant only AFTER the row commits, and never the new one", async () => {
    const service = makeService("commit");
    const res = await service.updateMedia("m1", { focalX: 0.5 });

    expect(res.success).toBe(true);
    // The old path is deleted, the new path (now referenced by the row) is not.
    expect(deleteSpy).toHaveBeenCalledWith(OLD_PATH);
    expect(deleteSpy).not.toHaveBeenCalledWith(NEW_PATH);
    // Ordering: the delete happens strictly after the committing update.
    expect(calls.indexOf("update")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf(`delete:${OLD_PATH}`)).toBeGreaterThan(
      calls.indexOf("update")
    );
  });

  it("cleans up the new (orphaned) variant and keeps the old one when the write fails", async () => {
    const service = makeService("throw");
    const res = await service.updateMedia("m1", { focalX: 0.5 });

    expect(res.success).toBe(false);
    // The freshly-uploaded new variant is deleted; the old one is untouched.
    expect(deleteSpy).toHaveBeenCalledWith(NEW_PATH);
    expect(deleteSpy).not.toHaveBeenCalledWith(OLD_PATH);
  });

  it("cleans up the new variant when the row was concurrently deleted", async () => {
    const service = makeService("row-gone");
    const res = await service.updateMedia("m1", { focalX: 0.5 });

    expect(res.statusCode).toBe(404);
    expect(deleteSpy).toHaveBeenCalledWith(NEW_PATH);
    expect(deleteSpy).not.toHaveBeenCalledWith(OLD_PATH);
  });
});
