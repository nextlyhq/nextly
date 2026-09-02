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

import { isStorageReadTooLarge } from "./read-errors";
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
  it("asks an adapter that CAN read, and does not fetch", async () => {
    const storage = {
      read: vi.fn().mockResolvedValue(Buffer.from("native")),
      getPublicUrl: vi.fn(),
    };
    const bytes = await readStoredMediaBytes(storage, "f.woff2", 1000);

    expect(bytes.toString("utf8")).toBe("native");
    // The cap travels INTO the adapter: checked on the way back, the memory it
    // exists to save has already been spent.
    expect(storage.read).toHaveBeenCalledWith("f.woff2", { maxBytes: 1000 });
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("falls back to the URL when the adapter cannot read", async () => {
    safeFetch.mockResolvedValue(new Response("fetched"));
    const bytes = await readStoredMediaBytes(urlOnly, "f.woff2", 1000);

    expect(bytes.toString("utf8")).toBe("fetched");
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

  it("passes a fetch failure that is NOT about size straight through", async () => {
    /*
     * The control for the case above: a translation that answered
     * `StorageReadTooLargeError` for every fetch failure would satisfy it while
     * telling the caller an unreachable host was an oversized file.
     */
    const refused = new SafeFetchError(
      "timed out",
      "https://cdn.test/f.woff2",
      "timeout"
    );
    safeFetch.mockRejectedValue(refused);

    const outcome = await readStoredMediaBytes(urlOnly, "f.woff2", 10).then(
      value => value,
      (error: unknown) => error
    );
    expect(outcome).toBe(refused);
    expect(isStorageReadTooLarge(outcome)).toBe(false);
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
