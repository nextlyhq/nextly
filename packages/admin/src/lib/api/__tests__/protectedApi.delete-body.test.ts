/**
 * What `delete` puts on the wire when the caller supplies a body.
 *
 * Tested against `fetcher` rather than through a hook, because the decision
 * lives here: a caller that mocks `protectedApi` wholesale — which every hook
 * test does — never executes this line, so the behaviour was invisible from
 * every test that appeared to cover it.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { fetcherSpy } = vi.hoisted(() => ({ fetcherSpy: vi.fn() }));

vi.mock("../fetcher", () => ({ fetcher: fetcherSpy }));

import { protectedApi } from "../protectedApi";

/** The `init` object `delete` handed to the fetcher. */
function sentInit(): Record<string, unknown> {
  return (fetcherSpy.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  fetcherSpy.mockReset();
  fetcherSpy.mockResolvedValue(undefined);
});

describe("protectedApi.delete and the body it was given", () => {
  it("sends a body the caller supplied", async () => {
    // The positive control: without it, every assertion below is satisfied by a
    // `delete` that never sends a body at all.
    await protectedApi.delete("/x", { id: "a" });

    expect(sentInit().body).toBe(JSON.stringify({ id: "a" }));
  });

  it("sends a FALSY body rather than dropping it", async () => {
    // `false`, `0`, `""` and `null` are valid JSON a caller may mean to send. A
    // truthiness test dropped all four, so `delete` was the one verb that
    // silently disagreed with what it was passed — the handler received an
    // empty request while the caller believed it had sent a value.
    for (const body of [false, 0, "", null]) {
      fetcherSpy.mockReset();
      fetcherSpy.mockResolvedValue(undefined);
      await protectedApi.delete("/x", body);
      expect(sentInit().body).toBe(JSON.stringify(body));
    }
  });

  it("sends NO body when the caller supplied none", async () => {
    // The other half, and the reason the test is `!== undefined` rather than
    // "always send": a bodyless DELETE must stay bodyless.
    await protectedApi.delete("/x");

    expect(sentInit()).not.toHaveProperty("body");
  });
});
