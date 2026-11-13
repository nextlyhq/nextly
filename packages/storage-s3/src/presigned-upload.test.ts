/**
 * A signed direct upload binds what was checked: its type and exact size.
 *
 * The bytes go from the browser to the bucket without passing Nextly's upload
 * checks, so the signature is what makes S3 refuse a different file. Signed
 * for real here (signing runs offline, with stand-in credentials), and the URL
 * read back: a header S3 is told is signed is one it compares.
 *
 * @module presigned-upload.test
 */
import { describe, expect, it } from "vitest";

import { S3StorageAdapter } from "./adapter";

function adapter(signedUrlExpiresIn?: number): S3StorageAdapter {
  return new S3StorageAdapter({
    bucket: "test-bucket",
    region: "us-east-1",
    // Stand-in credentials: signing is local arithmetic, and nothing is sent.
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "stand-in-secret-for-signing-only",
    ...(signedUrlExpiresIn !== undefined ? { signedUrlExpiresIn } : {}),
  });
}

function signedHeaders(url: string): string[] {
  return new URL(url).searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];
}

describe("S3 pre-signed upload", () => {
  it("signs the content type and the exact length", async () => {
    const data = await adapter().getPresignedUploadUrl(
      "media/photo.jpg",
      "image/jpeg",
      undefined,
      { contentLength: 2048 }
    );
    expect(data.method).toBe("PUT");
    expect(signedHeaders(data.uploadUrl)).toEqual(
      expect.arrayContaining(["content-length", "content-type"])
    );
  });

  it("gives a URL no longer than the configured lifetime, whatever is asked", async () => {
    const data = await adapter(300).getPresignedUploadUrl(
      "media/photo.jpg",
      "image/jpeg",
      86_400,
      { contentLength: 2048 }
    );
    expect(new URL(data.uploadUrl).searchParams.get("X-Amz-Expires")).toBe(
      "300"
    );
    const shorter = await adapter(300).getPresignedUploadUrl(
      "media/photo.jpg",
      "image/jpeg",
      60,
      { contentLength: 2048 }
    );
    expect(new URL(shorter.uploadUrl).searchParams.get("X-Amz-Expires")).toBe(
      "60"
    );
  });
});
