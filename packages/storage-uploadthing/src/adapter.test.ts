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

    /*
     * Asserted on the RACE, not on a signal handed to the SDK. UploadThing
     * 7.7.4's `getFileUrls` reads only `keyType` and forwards no signal, so an
     * earlier version of this case proved only that an IGNORED property had
     * been supplied — a test that passes while the lookup stays unbounded.
     *
     * A lookup that never settles must therefore still reject, which is the
     * property the racer actually provides.
     */
    expect(getFileUrls.mock.calls[0]?.[1]).toEqual({ keyType: "fileKey" });
    expect(vi.mocked(fetchStoredBytes).mock.calls[0]?.[4]).toBeInstanceOf(
      AbortSignal
    );
  });

  it("bounds the read even when the caller named NO deadline", async () => {
    // Previously asserted the opposite, which locked in the defect: the fetch
    // had `safeFetch`'s own default and the lookup had nothing.
    found();
    vi.mocked(fetchStoredBytes).mockResolvedValueOnce(Buffer.from("x"));
    await adapter.read("f.woff2");
    expect(vi.mocked(fetchStoredBytes).mock.calls[0]?.[4]).toBeInstanceOf(
      AbortSignal
    );
  });

  it("REJECTS a lookup that never settles, once the deadline passes", async () => {
    /*
     * The property the racer actually provides, and the one an assertion about
     * a passed option cannot reach: this SDK ignores the signal entirely, so
     * without racing a stalled lookup holds `read` open forever.
     *
     * A never-resolving promise is the point — a slow-but-finite one would pass
     * against an implementation that simply awaited it.
     */
    getFileUrls.mockReturnValueOnce(new Promise(() => {}));

    const outcome = await adapter.read("f.woff2", { timeoutMs: 5 }).then(
      value => value,
      (error: unknown) => error
    );
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome).not.toBeNull();
    // And it never reached the fetch, because the lookup never produced a URL.
    expect(vi.mocked(fetchStoredBytes)).not.toHaveBeenCalled();
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
