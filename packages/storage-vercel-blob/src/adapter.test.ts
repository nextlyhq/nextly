import { afterEach, describe, expect, it, vi } from "vitest";

import { head } from "@vercel/blob";

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
  /*
   * Rejects by default, because that is what the service does for a blob that
   * is not there and it is the branch `read` folds into `null`. A test wanting
   * the found case says so, which keeps "not found" from being the state a
   * case reaches by forgetting to arrange one.
   */
  head: vi.fn(async () => {
    throw new Error("blob not found");
  }),
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
     * `head` rejects by default, which is what the service does for a missing
     * key. No `fetch` is stubbed, so a version that skipped the lookup and
     * fetched anyway would fail here rather than pass quietly.
     *
     * ITS CONTROL IS "returns the stored bytes" ABOVE, and this case is not
     * evidence without it: measured, a `read` that returns `null` for every
     * input satisfies this assertion exactly. The positive case is what proves
     * `null` here means "not found" rather than "this method never answers".
     * Declared rather than left to adjacency, so deleting that case cannot
     * quietly make this one meaningless.
     */
    expect(await adapter.read("gone.woff2")).toBeNull();
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
