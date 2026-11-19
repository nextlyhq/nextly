/**
 * The search by address sends the address in the request's JSON body and
 * never in its path or query, so no address bar, history, server log or
 * cache keyed by URL ever holds it.
 *
 * @module services/emailActivityApi.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetcherSpy } = vi.hoisted(() => ({ fetcherSpy: vi.fn() }));

vi.mock("../lib/api/fetcher", () => ({ fetcher: fetcherSpy }));

import { searchActivityByAddress } from "./emailActivityApi";

describe("searchActivityByAddress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts the address and the filters in the body, and never puts the address in the URL", async () => {
    const answer = { items: [], meta: {}, notice: "Older records…" };
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
