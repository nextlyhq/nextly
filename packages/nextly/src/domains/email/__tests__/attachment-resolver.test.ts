import { describe, expect, it, vi } from "vitest";

import { EmailErrorCode } from "../errors";
import { resolveAttachments } from "../services/attachment-resolver";
import type {
  AttachmentMediaRecord,
  ResolveAttachmentsDeps,
} from "../services/attachment-resolver";

type DepsOverrides = Partial<ResolveAttachmentsDeps>;

function makeDeps(overrides?: DepsOverrides): ResolveAttachmentsDeps {
  return {
    limits: { maxCount: 10, maxTotalBytes: 20 * 1024 * 1024 },
    findMedia: vi.fn().mockResolvedValue({
      filename: "storage/invoice.pdf",
      originalFilename: "invoice.pdf",
      mimeType: "application/pdf",
    } satisfies AttachmentMediaRecord),
    readBytes: vi.fn().mockResolvedValue(Buffer.from("pdf-bytes")),
    ...overrides,
  };
}

describe("resolveAttachments", () => {
  it("returns [] for empty input", async () => {
    const deps = makeDeps();
    const result = await resolveAttachments([], deps);
    expect(result).toEqual([]);
    expect(deps.findMedia).not.toHaveBeenCalled();
  });

  it("resolves one attachment with media's originalFilename", async () => {
    const deps = makeDeps();
    const result = await resolveAttachments([{ mediaId: "m1" }], deps);
    expect(result).toEqual([
      {
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        content: Buffer.from("pdf-bytes"),
      },
    ]);
  });

  it("uses input.filename when provided", async () => {
    const deps = makeDeps();
    const [a] = await resolveAttachments(
      [{ mediaId: "m1", filename: "custom.pdf" }],
      deps
    );
    expect(a.filename).toBe("custom.pdf");
  });

  it("throws COUNT_EXCEEDED when inputs > maxCount, before any I/O", async () => {
    const deps = makeDeps({ limits: { maxCount: 2, maxTotalBytes: 1e9 } });
    const inputs = Array.from({ length: 3 }, (_, i) => ({
      mediaId: `m${i}`,
    }));
    await expect(resolveAttachments(inputs, deps)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [{ code: EmailErrorCode.ATTACHMENT_COUNT_EXCEEDED }],
      },
    });
    expect(deps.findMedia).not.toHaveBeenCalled();
    expect(deps.readBytes).not.toHaveBeenCalled();
  });

  it("throws MEDIA_NOT_FOUND when findMedia returns null — readBytes not called", async () => {
    const deps = makeDeps({ findMedia: vi.fn().mockResolvedValue(null) });
    await expect(
      resolveAttachments([{ mediaId: "missing" }], deps)
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [{ code: EmailErrorCode.ATTACHMENT_MEDIA_NOT_FOUND }],
      },
    });
    expect(deps.readBytes).not.toHaveBeenCalled();
  });

  it("throws STORAGE_READ_FAILED when readBytes throws", async () => {
    const deps = makeDeps({
      readBytes: vi.fn().mockRejectedValue(new Error("disk gone")),
    });
    await expect(
      resolveAttachments([{ mediaId: "m1" }], deps)
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      logContext: {
        emailAttachmentCode: EmailErrorCode.ATTACHMENT_STORAGE_READ_FAILED,
      },
    });
  });

  it("throws SIZE_EXCEEDED when total bytes cross the cap", async () => {
    const big = Buffer.alloc(6 * 1024 * 1024); // 6 MiB each
    const deps = makeDeps({
      limits: { maxCount: 10, maxTotalBytes: 10 * 1024 * 1024 }, // 10 MiB
      readBytes: vi.fn().mockResolvedValue(big),
    });
    await expect(
      resolveAttachments([{ mediaId: "a" }, { mediaId: "b" }], deps)
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [{ code: EmailErrorCode.ATTACHMENT_SIZE_EXCEEDED }],
      },
    });
  });

  it("stops at the first failing attachment — remaining not touched", async () => {
    const findMedia = vi
      .fn()
      .mockResolvedValueOnce({
        filename: "ok.bin",
        originalFilename: "ok.bin",
        mimeType: "application/octet-stream",
      })
      .mockResolvedValueOnce(null);
    const deps = makeDeps({ findMedia });
    await expect(
      resolveAttachments(
        [{ mediaId: "ok" }, { mediaId: "bad" }, { mediaId: "never-reached" }],
        deps
      )
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [{ code: EmailErrorCode.ATTACHMENT_MEDIA_NOT_FOUND }],
      },
    });
    expect(findMedia).toHaveBeenCalledTimes(2);
  });
});
