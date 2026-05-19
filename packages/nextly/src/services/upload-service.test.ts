import { describe, expect, it } from "vitest";

import { NextlyError } from "../errors";
import type {
  IStorageAdapter,
  UploadOptions,
  UploadResult,
} from "../storage/types";

import { UploadService } from "./upload-service";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function stubStorage(): IStorageAdapter {
  return {
    upload: async (
      _buf: Buffer,
      opts: UploadOptions
    ): Promise<UploadResult> => ({
      url: `/uploads/${opts.filename}`,
      path: `uploads/${opts.filename}`,
    }),
    delete: async () => {},
    exists: async () => false,
    getPublicUrl: (p: string) => `/uploads/${p}`,
    getType: () => "test",
  };
}

describe("UploadService.upload — throws NextlyError on validation failure", () => {
  it("throws NextlyError.validation for blocked extension", async () => {
    const svc = new UploadService(stubStorage());
    await expect(
      svc.upload(PNG, { filename: "evil.html", mimeType: "image/png" })
    ).rejects.toSatisfy(NextlyError.isValidation);
  });

  it("throws NextlyError.validation for hard-blocked MIME", async () => {
    const svc = new UploadService(stubStorage());
    await expect(
      svc.upload(PNG, { filename: "x.png", mimeType: "text/html" })
    ).rejects.toSatisfy(NextlyError.isValidation);
  });

  it("error payload uses canonical { path, code, message } shape", async () => {
    const svc = new UploadService(stubStorage());
    let caught: unknown;
    try {
      await svc.upload(PNG, { filename: "evil.html", mimeType: "image/png" });
    } catch (err) {
      caught = err;
    }
    expect(NextlyError.isValidation(caught)).toBe(true);
    if (NextlyError.is(caught)) {
      const data = caught.publicData as
        | { errors: { path: string; code: string; message: string }[] }
        | undefined;
      expect(data?.errors?.[0]).toMatchObject({
        path: "file",
        code: "EXTENSION_BLOCKED",
      });
    }
  });

  it("returns success with absolute URL for a legitimate PNG", async () => {
    const svc = new UploadService(stubStorage());
    const r = await svc.upload(PNG, {
      filename: "logo.png",
      mimeType: "image/png",
    });
    expect(r.success).toBe(true);
    expect(r.data?.filename).toBe("logo.png");
  });

  it("still returns the result-shape for storage-layer 5xx (unchanged)", async () => {
    const badStorage: IStorageAdapter = {
      ...stubStorage(),
      upload: async () => {
        throw new Error("storage down");
      },
    };
    const svc = new UploadService(badStorage);
    const r = await svc.upload(PNG, {
      filename: "logo.png",
      mimeType: "image/png",
    });
    expect(r.success).toBe(false);
    expect(r.statusCode).toBe(500);
  });

  it("emits the nextly.upload.rejected telemetry event on validation failure", async () => {
    const events: Array<{ msg: string; ctx: Record<string, unknown> }> = [];
    const noop = (): void => {};
    const svc = new UploadService(stubStorage(), {
      logger: {
        debug: noop,
        info: noop,
        warn: (msg, ctx) => events.push({ msg, ctx: ctx ?? {} }),
        error: noop,
      },
    });

    await expect(
      svc.upload(PNG, { filename: "evil.html", mimeType: "image/png" })
    ).rejects.toSatisfy(NextlyError.isValidation);

    const rejection = events.find(
      e => e.ctx.event === "nextly.upload.rejected"
    );
    expect(rejection).toBeDefined();
    expect(rejection?.ctx.code).toBe("EXTENSION_BLOCKED");
    expect(rejection?.ctx.route).toBe("upload-service.upload");
  });
});
