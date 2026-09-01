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
import { fetchStoredBytes } from "./fetch-stored-bytes";
import { safeFetch } from "../utils/validate-external-url";

vi.mock("../utils/validate-external-url", () => ({
  safeFetch: vi.fn(),
}));

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
