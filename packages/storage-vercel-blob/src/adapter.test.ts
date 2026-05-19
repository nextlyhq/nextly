import { describe, expect, it } from "vitest";

import { NextlyError } from "nextly/errors";

import { VercelBlobStorageAdapter } from "./adapter";

describe("VercelBlobStorageAdapter — SVG/HTML rejection", () => {
  // Dummy token; the adapter throws before any `put()` network call.
  const adapter = new VercelBlobStorageAdapter({
    token: "vercel_blob_rw_test_dummy_token_for_unit_tests",
    collections: { media: true },
  });

  it("throws NextlyError.validation with UNSUPPORTED_FOR_BACKEND for SVG (image/svg+xml)", async () => {
    const buf = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" />',
      "utf8"
    );
    await expect(
      adapter.upload(buf, { filename: "x.svg", mimeType: "image/svg+xml" })
    ).rejects.toSatisfy((err: unknown) => {
      if (!NextlyError.is(err)) return false;
      if (err.code !== "VALIDATION_ERROR") return false;
      const data = err.publicData as
        | { errors: { code: string; path: string }[] }
        | undefined;
      return data?.errors?.[0]?.code === "UNSUPPORTED_FOR_BACKEND";
    });
  });

  it("throws NextlyError.validation for SVG detected by extension (mime=octet-stream)", async () => {
    const buf = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" />',
      "utf8"
    );
    await expect(
      adapter.upload(buf, {
        filename: "x.svg",
        mimeType: "application/octet-stream",
      })
    ).rejects.toSatisfy((err: unknown) => NextlyError.is(err));
  });

  it("throws NextlyError.validation for HTML uploads", async () => {
    const buf = Buffer.from("<!doctype html><html></html>", "utf8");
    await expect(
      adapter.upload(buf, { filename: "x.html", mimeType: "text/html" })
    ).rejects.toSatisfy((err: unknown) => NextlyError.is(err));
  });
});
