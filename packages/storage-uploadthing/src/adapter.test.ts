/**
 * What `read` does with a key lookup, and with the caller's bounds.
 *
 * The first tests in this package. The HTTP half is asserted in the helper's own
 * suite under `packages/nextly`; what is only true here is that a lookup failure
 * PROPAGATES rather than reading as absence, and that one deadline covers the
 * lookup as well as the fetch.
 *
 * @module adapter.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchStoredBytes } from "nextly/storage/fetch-stored-bytes";

import { UploadthingStorageAdapter } from "./adapter";

vi.mock("nextly/storage/fetch-stored-bytes", () => ({
  fetchStoredBytes: vi.fn(),
}));

const getFileUrls = vi.fn();
vi.mock("uploadthing/server", () => ({
  UTApi: class {
    getFileUrls = getFileUrls;
  },
}));

const adapter = new UploadthingStorageAdapter({ token: "ut_test_dummy" });

afterEach(() => {
  getFileUrls.mockReset();
  vi.mocked(fetchStoredBytes).mockReset();
});

/** A lookup that resolves to one usable URL. */
function found(): void {
  getFileUrls.mockResolvedValueOnce({
    data: [{ key: "f.woff2", url: "https://utfs.test/f.woff2" }],
  });
}

describe("UploadthingStorageAdapter.read", () => {
  it("returns what the helper read", async () => {
    found();
    vi.mocked(fetchStoredBytes).mockResolvedValueOnce(Buffer.from("hello"));
    expect((await adapter.read("f.woff2"))?.toString("utf8")).toBe("hello");
  });

  it("answers null for a key the batch lookup does not return", async () => {
    /*
     * A missing key comes back as an EMPTY `data` array rather than as a
     * rejection, which is why this branch exists at all.
     *
     * ITS CONTROL IS "returns what the helper read" ABOVE: on its own this is
     * satisfied by a `read` answering `null` for every input.
     */
    getFileUrls.mockResolvedValueOnce({ data: [] });
    expect(await adapter.read("gone.woff2")).toBeNull();
    expect(vi.mocked(fetchStoredBytes)).not.toHaveBeenCalled();
  });

  it("PROPAGATES a lookup failure instead of calling the file absent", async () => {
    /*
     * An invalid token, an outage or a dropped connection says nothing about
     * whether the file exists. Folding those into `null` tells a caller it was
     * deleted, and a caller acting on that writes a replacement over a file
     * still sitting there — which is why there is no catch around the lookup.
     */
    const outage = new Error("service unavailable");
    getFileUrls.mockRejectedValueOnce(outage);

    const outcome = await adapter.read("f.woff2").then(
      value => value,
      (error: unknown) => error
    );
    expect(outcome).toBe(outage);
    expect(outcome).not.toBeNull();
  });

  it("starts ONE deadline before the lookup and shares it with the fetch", async () => {
    /*
     * The lookup runs first and can stall exactly as the fetch can, so a
     * deadline beginning at the fetch leaves it unbounded — and each phase
     * would get its own full budget, letting a read outlive what the caller was
     * promised by roughly double.
     *
     * Asserted as the SAME object reaching both: two signals would satisfy "a
     * signal was passed" while restarting the clock.
     */
    found();
    vi.mocked(fetchStoredBytes).mockResolvedValueOnce(Buffer.from("x"));
    await adapter.read("f.woff2", { timeoutMs: 1234 });

    const lookupSignal = (
      getFileUrls.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined
    )?.signal;
    expect(lookupSignal).toBeInstanceOf(AbortSignal);
    expect(vi.mocked(fetchStoredBytes).mock.calls[0]?.[4]).toBe(lookupSignal);
  });

  it("passes no signal when the caller named no deadline", async () => {
    // The control: an adapter that always made a signal would satisfy the case
    // above while ignoring what the caller actually asked for.
    found();
    vi.mocked(fetchStoredBytes).mockResolvedValueOnce(Buffer.from("x"));
    await adapter.read("f.woff2");
    expect(vi.mocked(fetchStoredBytes).mock.calls[0]?.[4]).toBeUndefined();
  });

  it("hands the caller's bounds to the helper", async () => {
    // Asserted on the ARGUMENT, because the result is identical whether or not
    // the bounds were forwarded — which is how this regresses unnoticed.
    found();
    vi.mocked(fetchStoredBytes).mockResolvedValueOnce(Buffer.from("x"));
    await adapter.read("f.woff2", { maxBytes: 4242 });
    expect(vi.mocked(fetchStoredBytes).mock.calls[0]?.[3]).toMatchObject({
      maxBytes: 4242,
    });
  });
});
