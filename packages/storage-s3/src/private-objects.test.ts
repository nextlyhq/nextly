/**
 * Private objects in an S3 bucket: how they are written, read back and
 * described, and when the adapter says it can keep them private at all.
 *
 * The SDK is faked here, and every assertion is on what the adapter asks of
 * it. The broken implementation each case separates it from is the public
 * path: `upload` names the key after the file, keeps that name in the
 * object's metadata, caches it publicly for a year, and on R2 refuses for
 * want of a public URL only after the object is already stored.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { keepsFilesPrivate } from "nextly/storage";

import { S3StorageAdapter } from "./adapter";
import type { S3StorageConfig } from "./types";

const sdk = vi.hoisted(() => ({
  /** Every multipart upload started, with the parameters it was given. */
  uploads: [] as Array<{
    params: Record<string, unknown>;
    done: () => Promise<unknown>;
  }>,
}));

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    send = vi.fn();
  }
  // Commands keep what they were built with, for the assertions to read.
  class Command {
    constructor(readonly input: Record<string, unknown>) {}
  }
  return {
    S3Client,
    GetObjectCommand: class extends Command {},
    HeadObjectCommand: class extends Command {},
    PutObjectCommand: class extends Command {},
    DeleteObjectCommand: class extends Command {},
    DeleteObjectsCommand: class extends Command {},
    ListObjectsV2Command: class extends Command {},
  };
});
vi.mock("@aws-sdk/lib-storage", () => ({
  Upload: class {
    done = vi.fn(async () => ({}));
    constructor(options: { params: Record<string, unknown> }) {
      sdk.uploads.push({ params: options.params, done: this.done });
    }
  },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn() }));

const KEY = "files/contracts/0b8a3c1e-6f00-4c1d-9a7e-2f5d6c7b8a90";
const R2 = {
  region: "auto",
  endpoint: "https://acct.eu.r2.cloudflarestorage.com",
};

function adapterWith(extra: Partial<S3StorageConfig> = {}) {
  const adapter = new S3StorageAdapter({
    bucket: "test-bucket",
    region: "us-east-1",
    collections: {},
    ...extra,
  });
  const send = adapter.getClient().send as unknown as ReturnType<typeof vi.fn>;
  return { adapter, send };
}

function notFound(name = "NotFound") {
  return Object.assign(new Error(name), {
    name,
    $metadata: { httpStatusCode: 404 },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sdk.uploads.length = 0;
});

describe("whether the adapter can keep files private", () => {
  it("says yes with no public URL, and no when one is configured", () => {
    const privateBucket = adapterWith(R2).adapter;
    expect(privateBucket.getInfo().supportsPrivateFiles).toBe(true);
    expect(keepsFilesPrivate(privateBucket)).toBe(true);

    // A public URL serves every key in the bucket, a private one included.
    const publicBucket = adapterWith({
      ...R2,
      publicUrl: "https://pub-abc.r2.dev",
    }).adapter;
    expect(publicBucket.getInfo().supportsPrivateFiles).toBe(false);
    expect(keepsFilesPrivate(publicBucket)).toBe(false);
  });
});

describe("S3StorageAdapter.putPrivate", () => {
  it("writes at exactly the key, private and never cached, keeping no file name", async () => {
    const { adapter } = adapterWith({
      acl: "public-read",
      contentDisposition: "attachment",
    });
    await adapter.putPrivate(KEY, Buffer.from("%PDF-1.7"), {
      mimeType: "application/pdf",
    });
    expect(sdk.uploads).toHaveLength(1);
    const { params, done } = sdk.uploads[0];
    expect(done).toHaveBeenCalledOnce();
    expect(params).toEqual({
      Bucket: "test-bucket",
      Key: KEY,
      Body: Buffer.from("%PDF-1.7"),
      ContentType: "application/pdf",
      CacheControl: "private, no-store",
      ACL: "private",
    });
  });

  it("stores on R2 with no public URL configured, and sends no ACL there", async () => {
    const { adapter } = adapterWith(R2);
    await adapter.putPrivate(KEY, Buffer.from("x"), {
      mimeType: "application/pdf",
    });
    expect(sdk.uploads[0].done).toHaveBeenCalledOnce();
    expect(sdk.uploads[0].params).not.toHaveProperty("ACL");
  });
});

describe("a public upload on R2 with no public URL", () => {
  it("refuses BEFORE the object is written, leaving nothing in the bucket", async () => {
    const { adapter, send } = adapterWith(R2);
    await expect(
      adapter.upload(Buffer.from("x"), {
        filename: "a.jpg",
        mimeType: "image/jpeg",
      })
    ).rejects.toThrow(/requires publicUrl/);
    expect(sdk.uploads).toHaveLength(0);

    await expect(
      adapter.uploadAt("media/a-400.webp", Buffer.from("x"), {
        mimeType: "image/webp",
      })
    ).rejects.toThrow(/requires publicUrl/);
    expect(send).not.toHaveBeenCalled();

    // Control: with a public URL the same upload is written and answered.
    const withUrl = adapterWith({
      ...R2,
      publicUrl: "https://pub-abc.r2.dev",
    }).adapter;
    const result = await withUrl.upload(Buffer.from("x"), {
      filename: "a.jpg",
      mimeType: "image/jpeg",
    });
    expect(sdk.uploads).toHaveLength(1);
    expect(result.url).toBe(`https://pub-abc.r2.dev/${result.path}`);
  });
});

describe("S3StorageAdapter.head", () => {
  it("answers the stored size and type without reading the object", async () => {
    const { adapter, send } = adapterWith();
    const lastModified = new Date("2026-11-20T10:00:00Z");
    send.mockResolvedValueOnce({
      ContentLength: 2048,
      ContentType: "application/pdf",
      LastModified: lastModified,
    });
    expect(await adapter.head(KEY)).toEqual({
      size: 2048,
      contentType: "application/pdf",
      lastModified,
    });
    expect(send.mock.calls[0][0].input).toEqual({
      Bucket: "test-bucket",
      Key: KEY,
    });
  });

  it("answers null for a key that is not there, and throws for a missing bucket", async () => {
    const { adapter, send } = adapterWith();
    send.mockRejectedValueOnce(notFound());
    expect(await adapter.head(KEY)).toBeNull();
    const noBucket = notFound("NoSuchBucket");
    send.mockRejectedValueOnce(noBucket);
    await expect(adapter.head(KEY)).rejects.toBe(noBucket);
  });

  it("refuses to report a size the bucket did not give, rather than zero", async () => {
    const { adapter, send } = adapterWith();
    send.mockResolvedValueOnce({ ContentType: "application/pdf" });
    await expect(adapter.head(KEY)).rejects.toThrow(
      /did not report the object's size/
    );
  });
});

describe("S3StorageAdapter.readStream", () => {
  function webBody(text: string) {
    return { transformToWebStream: () => new Blob([text]).stream() };
  }

  it("streams the object's bytes", async () => {
    const { adapter, send } = adapterWith();
    send.mockResolvedValueOnce({ Body: webBody("%PDF-1.7 stored") });
    const stream = await adapter.readStream(KEY);
    expect(stream).not.toBeNull();
    expect(await new Response(stream).text()).toBe("%PDF-1.7 stored");
  });

  it("answers null for a missing key, an empty stream for an empty object, and throws for a missing bucket", async () => {
    const { adapter, send } = adapterWith();
    send.mockRejectedValueOnce(notFound());
    expect(await adapter.readStream(KEY)).toBeNull();
    send.mockResolvedValueOnce({});
    expect(await new Response(await adapter.readStream(KEY)).text()).toBe("");
    const noBucket = notFound("NoSuchBucket");
    send.mockRejectedValueOnce(noBucket);
    await expect(adapter.readStream(KEY)).rejects.toBe(noBucket);
  });

  it("gives up on a bucket that does not answer in time, and never cuts off a body once it has", async () => {
    vi.useFakeTimers();
    try {
      const { adapter, send } = adapterWith();
      // A bucket that answers: its signal must stay live after the deadline.
      send.mockResolvedValueOnce({ Body: webBody("ok") });
      await adapter.readStream(KEY, { timeoutMs: 1000 });
      const answeredSignal = send.mock.calls[0][1].abortSignal as AbortSignal;
      vi.advanceTimersByTime(5000);
      expect(answeredSignal.aborted).toBe(false);

      // A bucket that never answers: the request is aborted at the deadline.
      send.mockImplementationOnce(
        (_command: unknown, options: { abortSignal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.abortSignal.addEventListener("abort", () =>
              reject(new Error("aborted"))
            );
          })
      );
      const pending = adapter.readStream(KEY, { timeoutMs: 1000 });
      const stalledSignal = send.mock.calls[1][1].abortSignal as AbortSignal;
      expect(stalledSignal.aborted).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(stalledSignal.aborted).toBe(true);
      await expect(pending).rejects.toThrow("aborted");
    } finally {
      vi.useRealTimers();
    }
  });
});
