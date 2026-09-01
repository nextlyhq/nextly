/**
 * What `read` means when the bucket answers, and when it does not.
 *
 * The first tests in this package. `read` is where that matters most: it is the
 * one method whose contract is a DISTINCTION — a key that is absent answers
 * `null`, a backend that cannot answer throws — and a distinction is exactly
 * what goes wrong silently, because both outcomes look like an ordinary result
 * at the call site.
 *
 * @module adapter.test
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { S3Client } from "@aws-sdk/client-s3";

import { S3StorageAdapter } from "./adapter";

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    send = vi.fn();
  }
  /*
   * The commands are inert carriers here: the adapter builds one and hands it
   * to `send`, and every assertion below is about what `send` answers. Faking
   * them as plain objects keeps the test about the adapter's branching rather
   * than about the SDK's request shapes.
   */
  return {
    S3Client,
    GetObjectCommand: class {},
    HeadObjectCommand: class {},
    PutObjectCommand: class {},
    DeleteObjectCommand: class {},
    DeleteObjectsCommand: class {},
  };
});
vi.mock("@aws-sdk/lib-storage", () => ({ Upload: class {} }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn() }));

/** A `send` that behaves however a case needs, reachable from the assertions. */
function adapterWithSend(): {
  adapter: S3StorageAdapter;
  send: ReturnType<typeof vi.fn>;
} {
  const adapter = new S3StorageAdapter({
    bucket: "test-bucket",
    region: "us-east-1",
  });
  // The client the adapter built for itself, so the stub is the one it uses.
  const send = (adapter as unknown as { client: { send: typeof vi.fn } }).client
    .send as unknown as ReturnType<typeof vi.fn>;
  return { adapter, send };
}

/** A `GetObject` response body, in the shape the SDK's stream exposes. */
function body(bytes: string): {
  transformToByteArray: () => Promise<Uint8Array>;
} {
  return {
    transformToByteArray: async () => new TextEncoder().encode(bytes),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("S3StorageAdapter.read", () => {
  it("returns the object's bytes", async () => {
    const { adapter, send } = adapterWithSend();
    send.mockResolvedValueOnce({ Body: body("hello"), ContentLength: 5 });
    expect((await adapter.read("f.woff2"))?.toString("utf8")).toBe("hello");
  });

  it("answers null for a key that is not in the bucket", async () => {
    /*
     * ITS CONTROL IS "returns the object's bytes" ABOVE. On its own this case
     * is satisfied by a `read` that answers `null` for every input, so the
     * positive case is what makes this `null` mean "absent" rather than "this
     * method never answers". Declared rather than left to adjacency.
     */
    const { adapter, send } = adapterWithSend();
    const missing = Object.assign(new Error("Not Found"), {
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });
    send.mockRejectedValueOnce(missing);
    expect(await adapter.read("gone.woff2")).toBeNull();
  });

  it("THROWS when the BUCKET is missing, rather than reporting the key absent", async () => {
    /*
     * The distinction the case above cannot make, and the reason `read` does
     * not simply reuse the adapter's existing not-found predicate: that
     * predicate treats ANY 404 as a missing object, and `NoSuchBucket` is a
     * 404. A deleted, renamed or mistyped bucket would therefore report every
     * key in it as absent — a configuration failure wearing the costume of an
     * ordinary miss, which is the confusion this method exists to prevent.
     */
    const { adapter, send } = adapterWithSend();
    const noBucket = Object.assign(new Error("The bucket does not exist"), {
      name: "NoSuchBucket",
      $metadata: { httpStatusCode: 404 },
    });
    send.mockRejectedValueOnce(noBucket);

    const outcome = await adapter.read("f.woff2").then(
      value => value,
      (error: unknown) => error
    );
    expect(outcome).toBe(noBucket);
    expect(outcome).not.toBeNull();
  });

  it("refuses an object larger than the caller's cap BEFORE downloading it", async () => {
    /*
     * Asserted on the reported length rather than on the body, because the
     * point is that the body is never pulled: `transformToByteArray` buffers
     * the whole object, so a cap enforced afterwards has already paid the cost
     * it exists to avoid. The email attachment path is the caller that has a
     * configured limit of its own.
     */
    const { adapter, send } = adapterWithSend();
    const stream = body("x".repeat(50));
    const spy = vi.spyOn(stream, "transformToByteArray");
    send.mockResolvedValueOnce({ Body: stream, ContentLength: 50 });

    await expect(adapter.read("big.woff2", { maxBytes: 10 })).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("reads an object that fits under the cap", async () => {
    // The control for the case above: without it, a `read` that refused every
    // bounded call would satisfy the refusal assertion perfectly.
    const { adapter, send } = adapterWithSend();
    send.mockResolvedValueOnce({ Body: body("small"), ContentLength: 5 });
    expect(
      (await adapter.read("ok.woff2", { maxBytes: 10 }))?.toString("utf8")
    ).toBe("small");
  });

  it("answers an empty buffer for a zero-byte object, not null", async () => {
    /*
     * A stored empty file is not a missing one. Collapsing them would let a
     * caller cleaning up "missing" keys delete a real object.
     */
    const { adapter, send } = adapterWithSend();
    send.mockResolvedValueOnce({ Body: undefined, ContentLength: 0 });
    const bytes = await adapter.read("empty.bin");
    expect(bytes).not.toBeNull();
    expect(bytes?.length).toBe(0);
  });
});

// The mocked client class, referenced so the import is not flagged as unused.
void S3Client;
