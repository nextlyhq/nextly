import { describe, expect, it } from "vitest";

import { followChain } from "../chains";

/** Exact redirects as a map, read one hop at a time as the store reads them. */
function hops(map: Record<string, string>) {
  return async (path: string) => map[path] ?? null;
}

describe("following a redirect's To address to the end of its chain", () => {
  it("stops at once where the To address goes nowhere", async () => {
    expect(await followChain("/a", "/b", hops({}))).toEqual({
      final: "/b",
      path: ["/b"],
    });
  });

  it("goes straight to the end of a chain, in one hop", async () => {
    expect(
      await followChain("/a", "/b", hops({ "/b": "/c", "/c": "/d" }))
    ).toEqual({ final: "/d", path: ["/b", "/c", "/d"] });
  });

  it("refuses a redirect that comes back to its own From address", async () => {
    expect(
      await followChain("/a", "/b", hops({ "/b": "/c", "/c": "/a" }))
    ).toEqual({ error: "That makes a loop: /a → /b → /c → /a." });
  });

  it("refuses a To address already caught in a loop of its own", async () => {
    expect(
      await followChain("/a", "/b", hops({ "/b": "/c", "/c": "/b" }))
    ).toEqual({
      error: "/b is already part of a loop. Fix that redirect first.",
    });
  });

  it("follows no address on another site", async () => {
    const asked: string[] = [];
    const result = await followChain("/a", "https://example.com/x", async p => {
      asked.push(p);
      return null;
    });
    expect(result).toEqual({
      final: "https://example.com/x",
      path: ["https://example.com/x"],
    });
    expect(asked).toEqual([]);
  });

  it("stops following a pattern's To address, which is matched per request", async () => {
    const asked: string[] = [];
    await followChain("/a/*", "/b/*", async p => {
      asked.push(p);
      return null;
    });
    expect(asked).toEqual([]);
  });
});
