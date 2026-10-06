/**
 * The headers the shared fetcher sends when a caller adds one of its own.
 *
 * A plugin write adds `x-csrf-token`. The caller's headers used to replace the
 * fetcher's defaults wholesale, so the JSON body of any write that added a
 * header went out without its content type.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { protectedApi } from "../protectedApi";

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sentHeaders(): Headers {
  const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
  return new Headers(init?.headers);
}

describe("fetcher headers", () => {
  it("keeps the JSON content type beside a header the caller adds", async () => {
    await protectedApi.post(
      "/plugins/@acme/p/notes",
      { text: "hi" },
      { headers: { "x-csrf-token": "t" } }
    );

    const headers = sentHeaders();
    expect(headers.get("x-csrf-token")).toBe("t");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("lets the caller's header win over a default it names", async () => {
    // The control: a fetcher that ignored the caller's headers altogether
    // would pass the content-type assertion above.
    await protectedApi.post(
      "/anything",
      {},
      { headers: { "Content-Type": "application/merge-patch+json" } }
    );

    expect(sentHeaders().get("content-type")).toBe(
      "application/merge-patch+json"
    );
  });
});
