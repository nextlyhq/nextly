/**
 * The links to a private file: what each binds, and how long it lasts.
 *
 * Signed for real here, offline with stand-in credentials, and the URL read
 * back, as in `presigned-upload.test.ts`: a parameter S3 is told is signed is
 * one it enforces. The broken implementation these separate it from is the
 * public signer, which writes the adapter's own caching and ACL (a year of
 * public caching, by default) and answers a download however the object was
 * stored.
 */
import { describe, expect, it } from "vitest";

import { S3StorageAdapter } from "./adapter";
import type { S3StorageConfig } from "./types";

function adapter(extra: Partial<S3StorageConfig> = {}): S3StorageAdapter {
  return new S3StorageAdapter({
    bucket: "test-bucket",
    region: "us-east-1",
    // Stand-in credentials: signing is local arithmetic, and nothing is sent.
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "stand-in-secret-for-signing-only",
    collections: {},
    ...extra,
  });
}

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

function signedHeaders(url: string): string[] {
  return params(url).get("X-Amz-SignedHeaders")?.split(";") ?? [];
}

const KEY = "files/contracts/0b8a3c1e-6f00-4c1d-9a7e-2f5d6c7b8a90";

describe("a private file's upload link", () => {
  it("writes the object private and never cached, whatever the adapter's own settings", async () => {
    const data = await adapter({
      acl: "public-read",
      cacheControl: "public, max-age=31536000",
    }).getPrivateUploadUrl(KEY, "application/pdf", {
      contentLength: 2048,
      expiresIn: 300,
    });
    expect(data.path).toBe(KEY);
    expect(new URL(data.uploadUrl).pathname).toBe(`/${KEY}`);
    expect(params(data.uploadUrl).get("x-amz-acl")).toBe("private");
    expect(data.headers).toEqual({
      "Content-Type": "application/pdf",
      "Cache-Control": "private, no-store",
    });
    expect(signedHeaders(data.uploadUrl)).toEqual(
      expect.arrayContaining([
        "content-type",
        "content-length",
        "cache-control",
      ])
    );

    // Control: the same adapter's public upload link writes its own settings.
    const pub = await adapter({
      acl: "public-read",
      cacheControl: "public, max-age=31536000",
    }).getPresignedUploadUrl(KEY, "application/pdf", 300, {
      contentLength: 2048,
    });
    expect(params(pub.uploadUrl).get("x-amz-acl")).toBe("public-read");
    expect(pub.headers?.["Cache-Control"]).toBe("public, max-age=31536000");
  });

  it("lasts no longer than asked, nor than the configured lifetime", async () => {
    const asked = await adapter().getPrivateUploadUrl(KEY, "application/pdf", {
      contentLength: 10,
      expiresIn: 120,
    });
    expect(params(asked.uploadUrl).get("X-Amz-Expires")).toBe("120");
    const capped = await adapter({
      signedUrlExpiresIn: 60,
    }).getPrivateUploadUrl(KEY, "application/pdf", {
      contentLength: 10,
      expiresIn: 300,
    });
    expect(params(capped.uploadUrl).get("X-Amz-Expires")).toBe("60");
  });

  it("is signed on R2 with no public URL configured", async () => {
    const r2 = adapter({
      region: "auto",
      endpoint: "https://acct.eu.r2.cloudflarestorage.com",
    });
    const data = await r2.getPrivateUploadUrl(KEY, "application/pdf", {
      contentLength: 10,
      expiresIn: 300,
    });
    expect(new URL(data.uploadUrl).host).toContain("r2.cloudflarestorage.com");
    // R2 has no ACLs; none is sent.
    expect(params(data.uploadUrl).get("x-amz-acl")).toBeNull();
  });
});

describe("a private file's download link", () => {
  it("answers as an attachment that no cache may keep, for as long as asked", async () => {
    const url = await adapter().getPrivateDownloadUrl(KEY, {
      expiresIn: 60,
      contentDisposition: `attachment; filename="note.pdf"`,
      contentType: "application/pdf",
    });
    const query = params(url);
    expect(query.get("response-content-disposition")).toBe(
      `attachment; filename="note.pdf"`
    );
    expect(query.get("response-cache-control")).toBe("private, no-store");
    expect(query.get("response-content-type")).toBe("application/pdf");
    expect(query.get("X-Amz-Expires")).toBe("60");
  });

  it("lasts no longer than the configured lifetime", async () => {
    const url = await adapter({ signedUrlExpiresIn: 30 }).getPrivateDownloadUrl(
      KEY,
      { expiresIn: 60, contentDisposition: "attachment" }
    );
    expect(params(url).get("X-Amz-Expires")).toBe("30");
  });
});
