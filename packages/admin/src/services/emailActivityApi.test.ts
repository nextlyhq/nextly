/**
 * The search by address sends the address in the request's JSON body and
 * never in its path or query, so no address bar, history, server log or
 * cache keyed by URL ever holds it. A queued email's Retry and Cancel post to
 * that email's own routes, its id escaped into the path.
 *
 * @module services/emailActivityApi.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetcherSpy } = vi.hoisted(() => ({ fetcherSpy: vi.fn() }));

vi.mock("../lib/api/fetcher", () => ({ fetcher: fetcherSpy }));

import {
  cancelQueuedEmail,
  retryQueuedEmail,
  searchActivityByAddress,
} from "./emailActivityApi";

describe("searchActivityByAddress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts the address and the filters in the body, and never puts the address in the URL", async () => {
    const answer = { items: [], meta: { notice: "Older records…" } };
    fetcherSpy.mockResolvedValue(answer);
    const result = await searchActivityByAddress({
      address: "ada@example.test",
      status: "failed",
      from: "2026-11-12T12:00:00.000Z",
      limit: 50,
    });
    expect(result).toBe(answer);
    const [path, init, isProtected] = fetcherSpy.mock.calls[0];
    expect(path).toBe("/email-deliveries/search");
    expect(path).not.toContain("ada");
    expect(isProtected).toBe(true);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      address: "ada@example.test",
      status: "failed",
      from: "2026-11-12T12:00:00.000Z",
      limit: 50,
    });
  });
});

describe("a queued email's Retry and Cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetcherSpy.mockResolvedValue({
      message: "Done.",
      item: { id: "q 1", state: "failed" },
    });
  });

  it("posts each to its own route for that email, escaping the id, with no body", async () => {
    await retryQueuedEmail("q 1/x");
    await cancelQueuedEmail("q 1/x");
    expect(fetcherSpy.mock.calls).toEqual([
      ["/email-deliveries/queued/q%201%2Fx/retry", { method: "POST" }, true],
      ["/email-deliveries/queued/q%201%2Fx/cancel", { method: "POST" }, true],
    ]);
  });
});
