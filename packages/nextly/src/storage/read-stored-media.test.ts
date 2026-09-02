/**
 * That both routes to a stored object refuse in the SAME vocabulary.
 *
 * The translation is the whole point of this module. Which route runs is a
 * property of the adapter rather than of the request, so a caller that has to
 * know which one it got before it can read the failure will eventually read it
 * wrongly — and has: implementing `read` on the cloud adapters moved the email
 * attachment path off the bounded fetch onto an unbounded buffer, with nothing
 * in that change mentioning email.
 *
 * @module storage/read-stored-media.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SafeFetchError } from "../utils/validate-external-url";

import { DEFAULT_READ_TIMEOUT_MS } from "./fetch-stored-bytes";
import { isStorageReadTimeout, isStorageReadTooLarge } from "./read-errors";
import {
  readStoredMediaBytes,
  StoredMediaUnreachableError,
} from "./read-stored-media";

const safeFetch = vi.hoisted(() => vi.fn());
vi.mock("../utils/validate-external-url", async importOriginal => {
  // Partial: `SafeFetchError` stays REAL, because the translation below keys on
  // `instanceof`, and a stubbed class would make this suite pass against an
  // implementation that never recognises the error it is meant to translate.
  const actual =
    await importOriginal<typeof import("../utils/validate-external-url")>();
  return { ...actual, safeFetch };
});

/** A backend that cannot hand back its own bytes, so the URL route runs. */
const urlOnly = { getPublicUrl: (p: string) => `https://cdn.test/${p}` };

beforeEach(() => {
  safeFetch.mockReset();
});

describe("reading a stored object", () => {
  it("calls the adapter's read AS A METHOD, keeping its receiver", async () => {
    /*
     * A real adapter is a class instance whose `read` reaches for `this` — the
     * local one resolves the path through a private method, the cloud ones
     * reach their client and config. Handed over detached the call throws
     * inside the adapter, which catches it and reports every existing object as
     * missing.
     *
     * A `vi.fn()` CANNOT show this: it has no receiver to lose, so every case
     * below passes against a reader that strips it. The double here reads its
     * answer off `this`, which is the only shape that fails when the receiver
     * goes.
     */
    const storage = {
      bytes: "from-the-instance",
      read(this: { bytes: string }): Promise<Buffer | null> {
        return Promise.resolve(Buffer.from(this.bytes, "utf8"));
      },
      getPublicUrl: vi.fn(),
    };

    const bytes = await readStoredMediaBytes(storage, "f.woff2", 1000);
    expect(bytes?.toString("utf8")).toBe("from-the-instance");
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("asks an adapter that CAN read, and does not fetch", async () => {
    const storage = {
      read: vi.fn().mockResolvedValue(Buffer.from("native")),
      getPublicUrl: vi.fn(),
    };
    const bytes = await readStoredMediaBytes(storage, "f.woff2", 1000);

    // `?.` rather than a non-null assertion: `null` is now a real answer from
    // this function, and a case that read it as bytes would say "undefined"
    // instead of failing on the absence.
    expect(bytes?.toString("utf8")).toBe("native");
    // The cap travels INTO the adapter: checked on the way back, the memory it
    // exists to save has already been spent.
    expect(storage.read).toHaveBeenCalledWith("f.woff2", { maxBytes: 1000 });
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("falls back to the URL when the adapter cannot read", async () => {
    safeFetch.mockResolvedValue(new Response("fetched"));
    const bytes = await readStoredMediaBytes(urlOnly, "f.woff2", 1000);

    expect(bytes?.toString("utf8")).toBe("fetched");
    expect(safeFetch).toHaveBeenCalledWith("https://cdn.test/f.woff2", {
      maxResponseBytes: 1000,
    });
  });

  it("does not build an address out of an address", async () => {
    // Vercel Blob records the full public URL as the stored path, so asking for
    // a public URL for one produces `https://cdn.test/https://...`.
    safeFetch.mockResolvedValue(new Response("ok"));
    const getPublicUrl = vi.fn();
    await readStoredMediaBytes(
      { getPublicUrl },
      "https://blob.test/f.woff2",
      1000
    );

    expect(safeFetch.mock.calls[0]?.[0]).toBe("https://blob.test/f.woff2");
    expect(getPublicUrl).not.toHaveBeenCalled();
  });

  it("refuses an over-cap FETCH in the same words as an over-cap READ", async () => {
    /*
     * The property this module exists for. Left as a `SafeFetchError`, an
     * over-cap fetch is a DIFFERENT error from an over-cap read of the very
     * same object, and every caller would have to know which backend it
     * happened to be talking to before it could tell a size problem from an
     * outage.
     */
    safeFetch.mockRejectedValue(
      // status 200: the object itself was oversized, which is the ONLY shape
      // that means "too large". See the case below for the other one.
      new SafeFetchError(
        "too big",
        "https://cdn.test/big.woff2",
        "response-too-large",
        200
      )
    );

    const outcome = await readStoredMediaBytes(urlOnly, "big.woff2", 10).then(
      value => value,
      (error: unknown) => error
    );
    expect(isStorageReadTooLarge(outcome)).toBe(true);
  });

  it("reports a FALLBACK deadline as the same timeout a native read gives", async () => {
    /*
     * A deadline is a deadline whichever route hit it. Left as a
     * `SafeFetchError`, the fallback's timeout reached the route as
     * `EXTERNAL_REQUEST_FAILED`/502 while the native read's became
     * `STORAGE_READ_TIMEOUT`/504 — so whether a caller retried depended on
     * whether the adapter happened to implement `read`, which describes the
     * deployment rather than what went wrong.
     */
    safeFetch.mockRejectedValue(
      new SafeFetchError("slow", "https://cdn.test/f.woff2", "timeout")
    );

    const outcome = await readStoredMediaBytes(urlOnly, "f.woff2", 1000).then(
      value => value,
      (error: unknown) => error
    );
    expect(isStorageReadTimeout(outcome)).toBe(true);
    expect((outcome as { timeoutMs?: number }).timeoutMs).toBe(
      DEFAULT_READ_TIMEOUT_MS
    );
  });

  it("passes a fetch failure that is NOT about size straight through", async () => {
    /*
     * The control for the case above: a translation that answered
     * `StorageReadTooLargeError` for every fetch failure would satisfy it while
     * telling the caller an unreachable host was an oversized file.
     */
    // `decode-failed`, deliberately: `timeout` is translated now, and `too
    // large` is the case above — this needs a reason that is neither, or it
    // stops being a pass-through control at all.
    const refused = new SafeFetchError(
      "could not decode",
      "https://cdn.test/f.woff2",
      "decode-failed"
    );
    safeFetch.mockRejectedValue(refused);

    const outcome = await readStoredMediaBytes(urlOnly, "f.woff2", 10).then(
      value => value,
      (error: unknown) => error
    );
    expect(outcome).toBe(refused);
    expect(isStorageReadTooLarge(outcome)).toBe(false);
  });

  it("keeps a 404 whose error page was itself over the cap as absence", async () => {
    /*
     * `safeFetch` caps while buffering, so a verbose 404 page raises before a
     * `Response` exists and the status check never runs — the object is still
     * gone, and reporting that as a fault tells a caller to retry what will
     * never come back.
     *
     * Uncovered until now, and a refactor turned it back into an error without
     * a single case going red.
     */
    safeFetch.mockRejectedValue(
      new SafeFetchError(
        "too big",
        "https://cdn.test/f.woff2",
        "response-too-large",
        404
      )
    );

    await expect(
      readStoredMediaBytes(urlOnly, "f.woff2", 10)
    ).resolves.toBeNull();
  });

  it("does NOT call an over-cap ERROR PAGE an oversized file", async () => {
    /*
     * `safeFetch` caps while buffering, so a verbose 500 page raises
     * `response-too-large` before this code sees a status — and the object it
     * was asking about may be perfectly small. Translating on the reason alone
     * reports a backend outage as the author's file being too big, which is a
     * cause they would act on, wrongly.
     *
     * This is the control for the case above: a translation keyed on the reason
     * satisfies that one and fails this one.
     */
    safeFetch.mockRejectedValue(
      new SafeFetchError(
        "too big",
        "https://cdn.test/f.woff2",
        "response-too-large",
        500
      )
    );

    const outcome = await readStoredMediaBytes(urlOnly, "f.woff2", 10).then(
      value => value,
      (error: unknown) => error
    );
    expect(isStorageReadTooLarge(outcome)).toBe(false);
  });

  it("takes a read-capable adapter's null as the answer, without fetching", async () => {
    /*
     * An adapter that implements `read` is authoritative about absence. Asking
     * its public URL afterwards answers a different question badly: the local
     * adapter's URL is a relative `/uploads/...` path, which `safeFetch`
     * refuses as invalid, so a missing file came back as a blocked external URL
     * rather than as missing.
     *
     * Asserted on `safeFetch` NEVER BEING CALLED, not on the `null` — a
     * fallback that also ends in absence returns `null` too, which is how this
     * hid: the outcome is identical and the route it took is not.
     */
    const storage = {
      read: vi.fn().mockResolvedValue(null),
      getPublicUrl: vi.fn(() => "/uploads/f.woff2"),
    };

    await expect(
      readStoredMediaBytes(storage, "f.woff2", 1000)
    ).resolves.toBeNull();
    expect(safeFetch).not.toHaveBeenCalled();
    expect(storage.getPublicUrl).not.toHaveBeenCalled();
  });

  it("translates an adapter's own deadline into this package's error", async () => {
    /*
     * Adapters in sibling packages bound their reads with
     * `AbortSignal.timeout`, which rejects with a platform `DOMException` this
     * package can neither construct nor extend. Passed through, the route's
     * error handler sees no `NextlyError` and answers 500 — an internal fault —
     * for a backend that simply did not reply, which a caller and a gateway
     * would both retry if they could read it as such.
     */
    const platformTimeout = Object.assign(new Error("aborted"), {
      name: "TimeoutError",
    });
    const storage = {
      read: vi.fn().mockRejectedValue(platformTimeout),
      getPublicUrl: vi.fn(),
    };

    const outcome = await readStoredMediaBytes(storage, "f.woff2", 1000).then(
      value => value,
      (error: unknown) => error
    );
    expect(isStorageReadTimeout(outcome)).toBe(true);
    // NOT the raw platform error, which is what carried the 500.
    expect(outcome).not.toBe(platformTimeout);
    /*
     * The DEADLINE, not the cap. Two numbers behind one positional signature:
     * passing the byte cap here logged a timeout of 10,485,760 ms for a read
     * that waited 30,000 — a figure an operator reading the 504 would take at
     * face value while investigating something that never happened.
     */
    expect((outcome as { timeoutMs?: number }).timeoutMs).toBe(
      DEFAULT_READ_TIMEOUT_MS
    );
    expect((outcome as { timeoutMs?: number }).timeoutMs).not.toBe(1000);
  });

  it("passes a NON-timeout adapter failure through unchanged", async () => {
    /*
     * The control: a translation that renamed every adapter rejection would
     * satisfy the case above while reporting a credential failure as a
     * retryable timeout, which a caller would retry forever.
     */
    const outage = new Error("bucket unreachable");
    const storage = {
      read: vi.fn().mockRejectedValue(outage),
      getPublicUrl: vi.fn(),
    };

    const outcome = await readStoredMediaBytes(storage, "f.woff2", 1000).then(
      value => value,
      (error: unknown) => error
    );
    expect(outcome).toBe(outage);
    expect(isStorageReadTimeout(outcome)).toBe(false);
  });

  it("treats a KEY beginning with http as a key, not an address", async () => {
    /*
     * `http-font.woff2` is a valid object name, and reading it as an address
     * sends it to `safeFetch`, which refuses it — so an ordinary file became
     * unservable on exactly the read-less adapters this fallback exists for.
     *
     * Asserted on which ADDRESS was fetched, since both routes end in a fetch
     * and the outcome alone cannot say which string was used.
     */
    safeFetch.mockResolvedValue(new Response("ok"));
    await readStoredMediaBytes(urlOnly, "http-font.woff2", 1000);

    expect(safeFetch.mock.calls[0]?.[0]).toBe(
      "https://cdn.test/http-font.woff2"
    );
  });

  it("reports a MISSING object as absence, not as an outage", async () => {
    /*
     * A row can outlive its object — a lifecycle rule, a manual cleanup, a
     * concurrent delete. Calling that an upstream failure tells a caller to
     * retry something that will never come back, and reaches a visitor as a
     * 502 for a font that is simply gone, on a response cacheable for a year.
     *
     * Its control is the case below, which fails if every non-2xx started
     * reading as absence; this one fails only when the two are folded.
     */
    safeFetch.mockResolvedValue(new Response("gone", { status: 404 }));

    await expect(
      readStoredMediaBytes(urlOnly, "f.woff2", 1000)
    ).resolves.toBeNull();
  });

  it("reports a non-2xx as unreachable, carrying the status", async () => {
    safeFetch.mockResolvedValue(new Response("nope", { status: 503 }));

    const outcome = await readStoredMediaBytes(urlOnly, "f.woff2", 1000).then(
      value => value,
      (error: unknown) => error
    );
    expect(outcome).toBeInstanceOf(StoredMediaUnreachableError);
    // The status travels, because an API route answering a visitor and an
    // attachment path answering an author owe different explanations for it.
    expect((outcome as StoredMediaUnreachableError).status).toBe(503);
  });
});
