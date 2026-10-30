import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { head, BlobNotFoundError, BlobAccessError } from "@vercel/blob";
import { fetchStoredBytes } from "nextly/storage/fetch-stored-bytes";

import { NextlyError } from "nextly/errors";

import { VercelBlobStorageAdapter } from "./adapter";
import { vercelBlobStorage } from "./plugin";

vi.mock("nextly/storage/fetch-stored-bytes", async importOriginal => {
  /*
   * Only `fetchStoredBytes` is faked. `withDeadline` and the default timeout
   * stay REAL: the racer is the mechanism one case below is about, and a stubbed
   * default would make `AbortSignal.timeout` receive `undefined` — which throws,
   * and would have these cases failing for a reason unrelated to the adapter.
   */
  const actual =
    await importOriginal<typeof import("nextly/storage/fetch-stored-bytes")>();
  return { ...actual, fetchStoredBytes: vi.fn() };
});

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
    list: vi.fn(),
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

  it("starts ONE deadline before the lookup and shares it with the fetch", async () => {
    /*
     * `head` runs first and can stall exactly as the fetch can. A deadline that
     * begins only at the fetch leaves the lookup unbounded, so a read outlives
     * what the caller was promised — by roughly double, since each phase would
     * get its own full budget.
     *
     * Asserted as the SAME object reaching both, which is the property: two
     * signals would satisfy "a signal was passed" while restarting the clock.
     */
    found();
    vi.mocked(fetchStoredBytes).mockResolvedValueOnce(Buffer.from("x"));
    await adapter.read("f.woff2", { timeoutMs: 1234 });

    const lookupSignal = (
      vi.mocked(head).mock.calls[0]?.[1] as { abortSignal?: AbortSignal }
    )?.abortSignal;
    const fetchSignal = vi.mocked(fetchStoredBytes).mock.calls[0]?.[4];

    expect(lookupSignal).toBeInstanceOf(AbortSignal);
    expect(fetchSignal).toBe(lookupSignal);
  });

  it("bounds the lookup even when the caller named NO deadline", async () => {
    /*
     * This case previously asserted the opposite, and in doing so locked in the
     * defect: `safeFetch` applies a default deadline of its own, so a caller
     * stating none was bounded for the FETCH and unbounded for the LOOKUP. That
     * is the commonest call — the email path supplies only a byte cap — so the
     * default was exactly the path with no bound at all.
     */
    found();
    vi.mocked(fetchStoredBytes).mockResolvedValueOnce(Buffer.from("x"));
    await adapter.read("f.woff2");

    const lookupSignal = (
      vi.mocked(head).mock.calls[0]?.[1] as { abortSignal?: AbortSignal }
    )?.abortSignal;
    expect(lookupSignal).toBeInstanceOf(AbortSignal);
    // And still ONE signal across both phases, not a fresh clock per phase.
    expect(vi.mocked(fetchStoredBytes).mock.calls[0]?.[4]).toBe(lookupSignal);
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

/*
 * A media record keeps the original's stored path and URL but only the URL of
 * the thumbnail made at upload, so a delete works the thumbnail's path out
 * from them: on Vercel Blob it relies on a stored path being the blob's own
 * URL, the empty prefix. This holds the adapter to that.
 */
describe("VercelBlobStorageAdapter — a stored path is its URL", () => {
  const adapter = new VercelBlobStorageAdapter({
    token: "vercel_blob_rw_test_dummy_token_for_unit_tests",
    collections: { media: true },
  });

  it("returns the blob's URL as its path, for the original and its thumbnail", async () => {
    for (const filename of ["photo.png", "thumb_photo.png"]) {
      const result = await adapter.upload(Buffer.from("x"), {
        filename,
        mimeType: "image/png",
        collection: "media",
      });

      expect(result.path).toBe(result.url);
      expect(adapter.getPublicUrl(result.path)).toBe(result.url);
    }
  });
});

// Searching the store for left-behind files reads every page of it, and
// names each blob by its URL, which is its stored path here.
describe("VercelBlobStorageAdapter — list", () => {
  const adapter = new VercelBlobStorageAdapter({
    token: "vercel_blob_rw_test_dummy_token_for_unit_tests",
    collections: { media: true },
  });

  it("names every blob on every page, by URL and upload time", async () => {
    const { list } = await import("@vercel/blob");
    const time = new Date("2026-10-18T10:00:00Z");
    const blob = (name: string) => ({
      url: `https://test.public.blob.vercel-storage.com/${name}`,
      pathname: name,
      size: 1,
      uploadedAt: time,
    });
    vi.mocked(list)
      .mockResolvedValueOnce({
        blobs: [blob("photo-2.png")],
        hasMore: true,
        cursor: "next",
      } as never)
      .mockResolvedValueOnce({
        blobs: [blob("thumb_x-1.png")],
        hasMore: false,
      } as never);

    const listed = [];
    for await (const entry of adapter.list()) listed.push(entry);

    expect(listed).toEqual([
      {
        path: "https://test.public.blob.vercel-storage.com/photo-2.png",
        lastModified: time,
      },
      {
        path: "https://test.public.blob.vercel-storage.com/thumb_x-1.png",
        lastModified: time,
      },
    ]);
    expect(vi.mocked(list).mock.calls[1]?.[0]).toMatchObject({
      cursor: "next",
    });
  });
});

/*
 * The factory runs while the host's config file is evaluated, so construction
 * is the config load: a throw there stops every command, including the
 * schema-only ones that never reach storage. The credential check belongs to
 * the first storage operation instead. The cases are ordered: the first is
 * the config load itself, the second is the refusal at the moment storage is
 * actually used, the third is the environment fallback still resolving — at
 * use, not before.
 */
describe("VercelBlobStorageAdapter — credentials are checked at first use", () => {
  beforeEach(() => {
    /*
     * Stubbed to EMPTY rather than deleted: an empty value is falsy to the
     * adapter's resolution, and a stub keeps a developer's real token from
     * turning the refusal cases green.
     */
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("constructs the factory and adapter with no token anywhere", () => {
    const plugin = vercelBlobStorage({ collections: { media: true } });
    expect(plugin.adapter).not.toBeNull();
  });

  it("refuses the first storage operation with today's message", async () => {
    const plugin = vercelBlobStorage({ collections: { media: true } });
    const outcome = await plugin.adapter
      .upload(Buffer.from("x"), { filename: "a.png", mimeType: "image/png" })
      .then(
        value => value,
        (error: unknown) => error
      );
    /*
     * On the MESSAGE, not merely that something threw: the contract is that
     * the operator sees today's refusal — naming the variable to set — at
     * the moment of the use, so a generic failure would be a different
     * answer wearing the same pass.
     */
    expect((outcome as Error).message).toContain("token is required");
    expect((outcome as Error).message).toContain("BLOB_READ_WRITE_TOKEN");
  });

  it("resolves the token from the environment at first use", async () => {
    /*
     * The positive control for the refusal above: a config that omits the
     * token but an environment that supplies it must serve the operation —
     * without it, an implementation that never checked at all would pass
     * every other case in this block.
     */
    vi.stubEnv(
      "BLOB_READ_WRITE_TOKEN",
      "vercel_blob_rw_test_dummy_token_for_unit_tests"
    );
    const plugin = vercelBlobStorage({ collections: { media: true } });
    const result = await plugin.adapter.upload(Buffer.from("x"), {
      filename: "a.png",
      mimeType: "image/png",
    });
    expect(result.url).toContain("test.public.blob.vercel-storage.com");
  });

  it("refuses exists() instead of answering false when the token is absent", async () => {
    /*
     * `exists` wraps `head` in a catch that answers `false`, because that is
     * what a lookup failure means about the blob. The credential check is a
     * precondition, not a lookup result: if it ran inside the catch's reach,
     * a missing token would be reported as the blob simply not being there —
     * which an upload path would act on. Asserted on the REFUSAL escaping,
     * so an implementation that hoists the check passes and one that leaves
     * it inside the try fails.
     */
    const plugin = vercelBlobStorage({ collections: { media: true } });
    const outcome = await plugin.adapter.exists("a.png").then(
      value => value,
      (error: unknown) => error
    );
    expect((outcome as Error).message).toContain("token is required");
  });

  it("refuses getMetadata() instead of answering null when the token is absent", async () => {
    /*
     * The metadata variant of the case above: the same catch answers `null`,
     * and `null` here means "no such blob", not "no credential".
     */
    const plugin = vercelBlobStorage({ collections: { media: true } });
    const outcome = await plugin.adapter.getMetadata("a.png").then(
      value => value,
      (error: unknown) => error
    );
    expect((outcome as Error).message).toContain("token is required");
  });
});
