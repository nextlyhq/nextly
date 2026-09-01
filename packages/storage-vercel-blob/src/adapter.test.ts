import { afterEach, describe, expect, it, vi } from "vitest";

import { head, BlobNotFoundError, BlobAccessError } from "@vercel/blob";

import { NextlyError } from "nextly/errors";

import { VercelBlobStorageAdapter } from "./adapter";

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

  /** The found case: `head` resolves and the CDN serves the bytes. */
  function blobExists(body: string): void {
    vi.mocked(head).mockResolvedValueOnce({
      url: "https://test.public.blob.vercel-storage.com/f.woff2",
      downloadUrl: "https://test.public.blob.vercel-storage.com/f.woff2?dl=1",
    } as unknown as Awaited<ReturnType<typeof head>>);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 }))
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(head).mockReset();
  });

  it("returns the stored bytes", async () => {
    blobExists("hello");
    const bytes = await adapter.read("f.woff2");
    expect(bytes?.toString("utf8")).toBe("hello");
  });

  it("answers null for a blob that is not there", async () => {
    /*
     * Arranged explicitly with the NOT-FOUND class, which is what the service
     * rejects with for a missing key. No `fetch` is stubbed, so a version that
     * skipped the lookup and fetched anyway would fail here rather than pass
     * quietly.
     *
     * ITS CONTROL IS "returns the stored bytes" ABOVE, and this case is not
     * evidence without it: measured, a `read` that returns `null` for every
     * input satisfies this assertion exactly. The positive case is what proves
     * `null` here means "not found" rather than "this method never answers".
     * Declared rather than left to adjacency, so deleting that case cannot
     * quietly make this one meaningless.
     */
    vi.mocked(head).mockRejectedValueOnce(new BlobNotFoundError());
    expect(await adapter.read("gone.woff2")).toBeNull();
  });

  it("THROWS a lookup failure that is not a missing blob", async () => {
    /*
     * The distinction the not-found case cannot make on its own. `head` also
     * rejects for an expired token, a suspended store and a dropped
     * connection, and none of those says the blob was deleted — so folding
     * every rejection into `null` reports an outage as an absence, which a
     * caller may answer by writing a replacement over a file still sitting
     * there.
     *
     * Paired with the case below it deliberately: together they say the
     * adapter keys on the CLASS rather than on the mere fact of a rejection.
     */
    vi.mocked(head).mockRejectedValueOnce(new BlobAccessError());

    const outcome = await adapter.read("f.woff2").then(
      value => value,
      (error: unknown) => error
    );
    expect(outcome).toBeInstanceOf(BlobAccessError);
    expect(outcome).not.toBeNull();
  });

  it("answers null when the blob disappears between lookup and fetch", async () => {
    /*
     * These stores are remote and concurrent, so a blob can be deleted after
     * its address resolves and before the CDN is asked for it. That is an
     * ordinary race with an ordinary answer — the object is not there — and
     * reporting it as a server failure would make a caller handle an error for
     * something its own contract already has a value for.
     */
    vi.mocked(head).mockResolvedValueOnce({
      url: "https://test.public.blob.vercel-storage.com/f.woff2",
      downloadUrl: "https://test.public.blob.vercel-storage.com/f.woff2?dl=1",
    } as unknown as Awaited<ReturnType<typeof head>>);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 }))
    );

    expect(await adapter.read("f.woff2")).toBeNull();
  });

  it("THROWS when the fetch fails after the blob resolved", async () => {
    /*
     * The property that separates absence from a transport failure, and the
     * reason the fetch sits outside the not-found catch. A dropped connection
     * to a blob whose metadata just resolved is not a deletion — reporting it
     * as `null` invites a caller to treat a live file as gone and write a
     * replacement over it.
     */
    vi.mocked(head).mockResolvedValueOnce({
      url: "https://test.public.blob.vercel-storage.com/f.woff2",
      downloadUrl: "https://test.public.blob.vercel-storage.com/f.woff2?dl=1",
    } as unknown as Awaited<ReturnType<typeof head>>);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    );

    /*
     * Asserted on the error's CODE rather than its text. The status and the key
     * deliberately do not reach the public message — they are the things that
     * must not travel to whoever asked for the file — so matching on prose
     * would either fail here or pressure that message into leaking them back.
     */
    const failure = await adapter.read("f.woff2").then(
      value => value,
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(NextlyError);
    expect((failure as NextlyError).code).toBe("INTERNAL_ERROR");
    /*
     * And explicitly NOT the absence answer, which is the whole point: a
     * `toThrow` alone passes on any rejection, while returning `null` here is
     * the specific wrong behaviour this case exists to rule out.
     */
    expect(failure).not.toBeNull();
  });
});
