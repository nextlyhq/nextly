import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "nextly/errors";

import { VercelBlobStorageAdapter } from "./adapter";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string) => ({
    pathname,
    contentType: "image/svg+xml",
    contentDisposition: 'attachment; filename="x.svg"',
    url: `https://test.public.blob.vercel-storage.com/${pathname}`,
    downloadUrl: `https://test.public.blob.vercel-storage.com/${pathname}?download=1`,
    etag: '"deadbeef"',
  })),
}));

describe("VercelBlobStorageAdapter — SVG handling", () => {
  const adapter = new VercelBlobStorageAdapter({
    token: "vercel_blob_rw_test_dummy_token_for_unit_tests",
    collections: { media: true },
  });

  it("accepts SVG uploads when caller sets contentDisposition: attachment", async () => {
    const buf = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>',
      "utf8"
    );
    const result = await adapter.upload(buf, {
      filename: "x.svg",
      mimeType: "image/svg+xml",
      contentDisposition: "attachment",
    });
    expect(result.url).toMatch(/\?download=1$/);
    expect(result.path).not.toMatch(/\?download=1$/);
  });

  it("returns the inline url when caller does not request attachment disposition", async () => {
    const buf = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>',
      "utf8"
    );
    const result = await adapter.upload(buf, {
      filename: "x.svg",
      mimeType: "image/svg+xml",
    });
    expect(result.url).not.toMatch(/\?download=1$/);
  });
});

describe("VercelBlobStorageAdapter — HTML rejection", () => {
  const adapter = new VercelBlobStorageAdapter({
    token: "vercel_blob_rw_test_dummy_token_for_unit_tests",
    collections: { media: true },
  });

  it("throws NextlyError.validation with UNSUPPORTED_FOR_BACKEND for HTML", async () => {
    const buf = Buffer.from("<!doctype html><html></html>", "utf8");
    await expect(
      adapter.upload(buf, { filename: "x.html", mimeType: "text/html" })
    ).rejects.toSatisfy((err: unknown) => {
      if (!NextlyError.is(err)) return false;
      if (err.code !== "VALIDATION_ERROR") return false;
      const data = err.publicData as { errors: { code: string }[] } | undefined;
      return data?.errors?.[0]?.code === "UNSUPPORTED_FOR_BACKEND";
    });
  });

  it("throws NextlyError.validation for application/xhtml+xml", async () => {
    const buf = Buffer.from("<html></html>", "utf8");
    await expect(
      adapter.upload(buf, {
        filename: "x.xhtml",
        mimeType: "application/xhtml+xml",
      })
    ).rejects.toSatisfy((err: unknown) => NextlyError.is(err));
  });
});
