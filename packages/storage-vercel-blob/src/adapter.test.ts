import { afterEach, describe, expect, it, vi } from "vitest";

import { head, BlobNotFoundError, BlobAccessError } from "@vercel/blob";
import { fetchStoredBytes } from "nextly/storage/fetch-stored-bytes";

import { NextlyError } from "nextly/errors";

import { VercelBlobStorageAdapter } from "./adapter";

vi.mock("nextly/storage/fetch-stored-bytes", () => ({
  fetchStoredBytes: vi.fn(),
}));

vi.mock("@vercel/blob", () => {
  /*
   * REAL classes, declared INSIDE the factory because `vi.mock` is hoisted
   * above every import and a class defined at module scope is not yet assigned
   * when the factory runs. The adapter discriminates with `instanceof` — the
   * SDK's own mechanism — so a mock rejecting with a plain object would leave
   * the not-found branch unreachable and these cases would describe an adapter
   * nobody ships.
   */
  class NotFound extends Error {}
  class Access extends Error {}
  return {
    put: vi.fn(async (pathname: string) => ({
      pathname,
      contentType: "image/svg+xml",
      contentDisposition: 'attachment; filename="x.svg"',
      url: `https://test.public.blob.vercel-storage.com/${pathname}`,
      downloadUrl: `https://test.public.blob.vercel-storage.com/${pathname}?download=1`,
      etag: '"deadbeef"',
    })),
    /*
     * No default behaviour: every case that reaches `head` ARRANGES it. A
     * default rejection would make "not found" the state a case reaches by
     * forgetting to set one up, which is the one outcome these tests exist to
     * tell apart from the others.
     */
    head: vi.fn(),
    BlobNotFoundError: NotFound,
    BlobAccessError: Access,
  };
});

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

describe("VercelBlobStorageAdapter — reading bytes back", () => {
  const adapter = new VercelBlobStorageAdapter({
    token: "vercel_blob_rw_test_dummy_token_for_unit_tests",
    collections: { media: true },
  });

  /*
   * The HELPER is mocked here, and the HTTP answers it turns into `null`, bytes
   * or an error are asserted in its own suite under `packages/nextly`. What is
   * only true at this layer is what a LOOKUP failure means and whether the
   * caller's bounds survive the trip — so those are what this asserts.
   */
  function found(): void {
    vi.mocked(head).mockResolvedValueOnce({
      url: "https://test.public.blob.vercel-storage.com/f.woff2",
      downloadUrl: "https://test.public.blob.vercel-storage.com/f.woff2?dl=1",
    } as unknown as Awaited<ReturnType<typeof head>>);
  }

  afterEach(() => {
    vi.mocked(head).mockReset();
    vi.mocked(fetchStoredBytes).mockReset();
  });

  it("returns what the helper read", async () => {
    found();
    vi.mocked(fetchStoredBytes).mockResolvedValueOnce(Buffer.from("hello"));
    expect((await adapter.read("f.woff2"))?.toString("utf8")).toBe("hello");
  });

  it("answers null for a blob that is not there", async () => {
    /*
     * Arranged with the NOT-FOUND class, which is what the service rejects
     * with for a missing key.
     *
     * ITS CONTROL IS "returns what the helper read" ABOVE, and this case is not
     * evidence without it: measured, a `read` returning `null` for every input
     * satisfies this assertion exactly. Declared rather than left to adjacency,
     * so deleting that case cannot quietly make this one meaningless.
     */
    vi.mocked(head).mockRejectedValueOnce(new BlobNotFoundError());
    expect(await adapter.read("gone.woff2")).toBeNull();
    // And the helper was never reached, so `null` came from the lookup.
    expect(vi.mocked(fetchStoredBytes)).not.toHaveBeenCalled();
  });

  it("THROWS a lookup failure that is not a missing blob", async () => {
    /*
     * The distinction the case above cannot make alone. `head` also rejects for
     * an expired token, a suspended store and a dropped connection, and none of
     * those says the blob was deleted — so folding every rejection into `null`
     * reports an outage as an absence, which a caller may answer by writing a
     * replacement over a file still sitting there.
     */
    vi.mocked(head).mockRejectedValueOnce(new BlobAccessError());
    const outcome = await adapter.read("f.woff2").then(
      value => value,
      (error: unknown) => error
    );
    expect(outcome).toBeInstanceOf(BlobAccessError);
  });

  it("hands the caller's bounds to the helper", async () => {
    /*
     * Asserted on the ARGUMENT rather than the result, because the result is
     * identical whether or not the bounds were forwarded — which is precisely
     * how this regresses unnoticed. The email attachment path depends on it:
     * before these bounds existed, implementing `read` moved that path off a
     * capped fetch onto one that buffered the whole object first.
     */
    found();
    vi.mocked(fetchStoredBytes).mockResolvedValueOnce(Buffer.from("x"));
    await adapter.read("f.woff2", { maxBytes: 4242 });
    expect(vi.mocked(fetchStoredBytes).mock.calls[0]?.[3]).toMatchObject({
      maxBytes: 4242,
    });
  });
});
