/**
 * The URL-backed read, tested where it lives.
 *
 * This moved out of the Vercel adapter's suite deliberately. That suite stubbed
 * the global `fetch`, which stopped reaching anything the moment this helper
 * started going through `safeFetch` — and a stub nothing calls does not fail
 * loudly, it just leaves the assertions describing a request that was never
 * made. Each layer is asserted where its mechanism is: the ADAPTER decides what
 * a lookup failure means, and THIS decides what an HTTP answer means.
 *
 * @module storage/fetch-stored-bytes.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../errors/nextly-error";
import {
  fetchStoredBytes,
  resolveReadBounds,
  DEFAULT_READ_MAX_BYTES,
  DEFAULT_READ_TIMEOUT_MS,
} from "./fetch-stored-bytes";
import { safeFetch, SafeFetchError } from "../utils/validate-external-url";
import { isStorageReadTooLarge } from "./read-errors";

vi.mock("../utils/validate-external-url", async importOriginal => {
  /*
   * Only `safeFetch` is faked. `SafeFetchError` stays REAL, because the code
   * under test discriminates on it — a stubbed class would make the branch
   * unreachable and these cases would describe a helper nobody ships.
   */
  const actual =
    await importOriginal<typeof import("../utils/validate-external-url")>();
  return { ...actual, safeFetch: vi.fn() };
});

const URL_ = "https://cdn.example.test/f.woff2";

beforeEach(() => {
  vi.mocked(safeFetch).mockReset();
});

describe("reading a stored object over HTTP", () => {
  it("returns the bytes the store served", async () => {
    vi.mocked(safeFetch).mockResolvedValueOnce(
      new Response("hello", { status: 200 })
    );
    const bytes = await fetchStoredBytes(URL_, "f.woff2", "Test");
    expect(bytes?.toString("utf8")).toBe("hello");
  });

  it("answers null for a 404, which is absence rather than a fault", async () => {
    /*
     * The object can be deleted between the lookup that resolved its address
     * and this request. That race has an ordinary answer — it is not there —
     * and reporting it as a server failure would make a caller handle an error
     * for something its own contract already has a value for.
     */
    vi.mocked(safeFetch).mockResolvedValueOnce(
      new Response("", { status: 404 })
    );
    expect(await fetchStoredBytes(URL_, "f.woff2", "Test")).toBeNull();
  });

  it("THROWS for a non-OK status that is not 404", async () => {
    /*
     * The discriminating half. A 5xx says nothing about whether the object
     * exists, so folding it into `null` tells a caller the file is gone and
     * invites it to write a replacement over one that is still there.
     *
     * Asserted on the CODE rather than the message: the status and the key go
     * to the log side deliberately, since neither should travel to whoever
     * asked for the file.
     */
    vi.mocked(safeFetch).mockResolvedValueOnce(
      new Response("nope", { status: 500 })
    );
    const outcome = await fetchStoredBytes(URL_, "f.woff2", "Test").then(
      value => value,
      (error: unknown) => error
    );
    expect(outcome).toBeInstanceOf(NextlyError);
    expect((outcome as NextlyError).code).toBe("INTERNAL_ERROR");
  });

  it("translates safeFetch's over-cap refusal into the storage one", async () => {
    /*
     * Both routes must refuse in ONE vocabulary. `safeFetch` raises its own
     * error with a `reason`, and S3 raises the SDK's — so a caller wanting to
     * tell "too large" from "could not read" would otherwise have to know which
     * adapter answered, which is the thing an adapter contract exists to stop.
     *
     * The email attachment path is the caller that acts on the difference: it
     * answers this refusal with a size error the author can fix, and wraps
     * anything else as an opaque storage failure.
     */
    vi.mocked(safeFetch).mockRejectedValueOnce(
      new SafeFetchError("too large", URL_, "response-too-large", 200)
    );
    const outcome = await fetchStoredBytes(URL_, "f.woff2", "Test", {
      maxBytes: 10,
    }).then(
      value => value,
      (error: unknown) => error
    );
    expect(isStorageReadTooLarge(outcome)).toBe(true);
  });

  it("does NOT call a failed response oversized, however big its body", async () => {
    /*
     * A 500 page or an error document can itself exceed the cap, and
     * `safeFetch` refuses while buffering — before this code sees any status.
     * Translating on the reason alone reported a backend outage as "your file
     * is too big", which is worse than an opaque failure: it names a cause the
     * author would act on, wrongly.
     */
    vi.mocked(safeFetch).mockRejectedValueOnce(
      new SafeFetchError("too large", URL_, "response-too-large", 500)
    );
    const outcome = await fetchStoredBytes(URL_, "f.woff2", "Test", {
      maxBytes: 10,
    }).then(
      value => value,
      (error: unknown) => error
    );
    expect(isStorageReadTooLarge(outcome)).toBe(false);
    expect(outcome).toBeInstanceOf(SafeFetchError);
  });

  it("answers null for a 404 whose ERROR PAGE blew the cap", async () => {
    /*
     * `safeFetch` caps while buffering, so a verbose CDN 404 page raises before
     * a `Response` exists — and the `status === 404` check further down is
     * never reached. The object is still gone, which is an ordinary answer this
     * contract has a value for; it must not become an error because the page
     * explaining it was long.
     */
    vi.mocked(safeFetch).mockRejectedValueOnce(
      new SafeFetchError("too large", URL_, "response-too-large", 404)
    );
    expect(
      await fetchStoredBytes(URL_, "f.woff2", "Test", { maxBytes: 10 })
    ).toBeNull();
  });

  it("does not translate when no status arrived at all", async () => {
    /*
     * Absence means "not known", never "was a success". A failure that happened
     * before any status — a dropped connection mid-buffer — says nothing about
     * whether the object was oversized, so it stays untranslated.
     */
    vi.mocked(safeFetch).mockRejectedValueOnce(
      new SafeFetchError("too large", URL_, "response-too-large")
    );
    const outcome = await fetchStoredBytes(URL_, "f.woff2", "Test", {
      maxBytes: 10,
    }).then(
      value => value,
      (error: unknown) => error
    );
    expect(isStorageReadTooLarge(outcome)).toBe(false);
  });

  it("passes a NON-cap fetch failure through untranslated", async () => {
    /*
     * The control for the case above. Translating every `SafeFetchError` would
     * report a timeout or a refused address as "your file is too big", which is
     * a confident wrong diagnosis rather than a missing one.
     */
    vi.mocked(safeFetch).mockRejectedValueOnce(
      new SafeFetchError("slow", URL_, "timeout")
    );
    const outcome = await fetchStoredBytes(URL_, "f.woff2", "Test", {
      maxBytes: 10,
    }).then(
      value => value,
      (error: unknown) => error
    );
    expect(isStorageReadTooLarge(outcome)).toBe(false);
    expect(outcome).toBeInstanceOf(SafeFetchError);
  });

  it("hands the caller's bounds down rather than imposing its own", async () => {
    /*
     * What makes the email attachment path correct again. That caller has a
     * configured limit, and before these bounds existed the cloud adapters
     * buffered the whole object and checked its size afterwards.
     *
     * Asserted on the ARGUMENTS `safeFetch` received rather than on the result,
     * because the result is identical whether or not the bounds were forwarded
     * — which is exactly how this would regress unnoticed.
     */
    vi.mocked(safeFetch).mockResolvedValueOnce(new Response("x"));
    await fetchStoredBytes(URL_, "f.woff2", "Test", {
      maxBytes: 1234,
      timeoutMs: 5678,
    });
    expect(vi.mocked(safeFetch).mock.calls[0]?.[1]).toMatchObject({
      maxResponseBytes: 1234,
      timeoutMs: 5678,
    });
  });

  it("omits absent bounds instead of sending undefined ones", async () => {
    /*
     * `safeFetch` holds the defaults — 10 MiB and 30 seconds. Passing an
     * explicit `undefined` overrides a default with nothing in some option
     * shapes, so the keys are left out entirely when the caller stated none.
     * That is what keeps one set of numbers in the tree rather than two.
     */
    vi.mocked(safeFetch).mockResolvedValueOnce(new Response("x"));
    await fetchStoredBytes(URL_, "f.woff2", "Test");
    const options = vi.mocked(safeFetch).mock.calls[0]?.[1] ?? {};
    expect("maxResponseBytes" in options).toBe(false);
    expect("timeoutMs" in options).toBe(false);
  });
});

describe("the bounds a read runs under", () => {
  it("fills BOTH defaults when the caller names neither", () => {
    /*
     * The promise `StorageReadOptions` makes. It is asserted here rather than
     * through an adapter because every adapter now asks this one function — and
     * the defect it replaces was four implementations disagreeing: the
     * URL-backed pair inherited `safeFetch`'s cap and deadline for free while
     * local and S3, which never touch `safeFetch`, applied neither.
     *
     * Measured: removing these defaults broke NO adapter test, because every
     * one of them passes an explicit bound. This is the case that fires.
     */
    expect(resolveReadBounds()).toEqual({
      maxBytes: DEFAULT_READ_MAX_BYTES,
      timeoutMs: DEFAULT_READ_TIMEOUT_MS,
    });
    expect(resolveReadBounds({})).toEqual({
      maxBytes: DEFAULT_READ_MAX_BYTES,
      timeoutMs: DEFAULT_READ_TIMEOUT_MS,
    });
  });

  it("lets a caller override either bound independently", () => {
    // The control: a resolver that ignored its argument would satisfy the case
    // above perfectly while discarding every limit a caller set.
    expect(resolveReadBounds({ maxBytes: 7 })).toEqual({
      maxBytes: 7,
      timeoutMs: DEFAULT_READ_TIMEOUT_MS,
    });
    expect(resolveReadBounds({ timeoutMs: 9 })).toEqual({
      maxBytes: DEFAULT_READ_MAX_BYTES,
      timeoutMs: 9,
    });
  });

  it("defaults to the SAME numbers safeFetch uses, not a second copy", () => {
    // Two spellings of one default agree today and drift the first time either
    // is tuned, so these are the fetch layer's own constants re-exported.
    expect(DEFAULT_READ_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(DEFAULT_READ_TIMEOUT_MS).toBe(30_000);
  });
});
