/**
 * Read-side helpers: `nextlyTags` builds the same `nextly:*` scheme the write
 * side busts, and `cachedFind`/`applyCache` cache a read under a caller-scoped
 * key. Includes the two-user owner-only leak guard the F1 read-path design
 * requires: distinct callers must not share a cache entry.
 */
import { describe, expect, it, vi } from "vitest";

import { applyCache, type UnstableCache } from "../cached-find";
import { nextlySingleTags, nextlyTags } from "../nextly-tags";

describe("nextlyTags", () => {
  it("returns the collection tag for a listing read", () => {
    expect(nextlyTags("posts")).toEqual(["nextly:posts"]);
  });

  it("adds the id tag for an entry detail read (tagged by immutable id)", () => {
    expect(nextlyTags("posts", "42")).toEqual([
      "nextly:posts",
      "nextly:posts:id:42",
    ]);
  });

  it("adds the per-locale id tag when a locale is given", () => {
    expect(nextlyTags("posts", "42", "en")).toEqual([
      "nextly:posts",
      "nextly:posts:id:42",
      "nextly:posts:id:42:en",
    ]);
  });

  it("ignores a blank id / locale", () => {
    expect(nextlyTags("posts", "   ")).toEqual(["nextly:posts"]);
    expect(nextlyTags("posts", "42", "  ")).toEqual([
      "nextly:posts",
      "nextly:posts:id:42",
    ]);
  });

  it("builds the single tag", () => {
    expect(nextlySingleTags("header")).toEqual(["nextly:single:header"]);
  });
});

describe("applyCache (passthrough without Next)", () => {
  it("runs the reader directly and returns its result when no cache is present", async () => {
    const reader = vi.fn(async () => ({ id: "x" }));
    const result = await applyCache(null, reader, {
      tags: nextlyTags("posts"),
      keyParts: ["posts", "list"],
    });
    expect(result).toEqual({ id: "x" });
    expect(reader).toHaveBeenCalledTimes(1);
  });
});

describe("applyCache — key forwarding and per-caller isolation", () => {
  // A fake unstable_cache that memoises by keyParts, so the test can observe
  // exactly how cache identity is derived (the real thing needs a Next runtime).
  function memoizingUnstableCache(): {
    fn: UnstableCache;
    calls: { keyParts: string[]; tags?: string[] }[];
  } {
    const store = new Map<string, unknown>();
    const calls: { keyParts: string[]; tags?: string[] }[] = [];
    const fn: UnstableCache = (cb, keyParts, options) => {
      calls.push({ keyParts, tags: options.tags });
      return async () => {
        const key = JSON.stringify(keyParts);
        if (!store.has(key)) store.set(key, await cb());
        return store.get(key);
      };
    };
    return { fn, calls };
  }

  it("forwards keyParts and tags to unstable_cache", async () => {
    const cache = memoizingUnstableCache();
    await applyCache(cache.fn, async () => 1, {
      tags: ["nextly:posts"],
      keyParts: ["posts", "list", "user-a"],
      revalidate: 60,
    });
    expect(cache.calls[0]).toEqual({
      keyParts: ["posts", "list", "user-a"],
      tags: ["nextly:posts"],
    });
  });

  it("isolates two callers whose keyParts include their own id", async () => {
    const cache = memoizingUnstableCache();
    const opts = (userId: string) => ({
      tags: nextlyTags("orders"),
      keyParts: ["orders", "list", userId],
    });

    const a = await applyCache(cache.fn, async () => "a-rows", opts("user-a"));
    const b = await applyCache(cache.fn, async () => "b-rows", opts("user-b"));

    // Different keys → each caller sees only their own rows.
    expect(a).toBe("a-rows");
    expect(b).toBe("b-rows");
  });

  it("SHARES a cache entry when the caller is omitted — the leak the key guards against", async () => {
    const cache = memoizingUnstableCache();
    // Both callers use a stable key with no user id: the classic footgun.
    const sharedKey = {
      tags: nextlyTags("orders"),
      keyParts: ["orders", "list"],
    };

    const a = await applyCache(cache.fn, async () => "a-rows", sharedKey);
    const b = await applyCache(cache.fn, async () => "b-rows", sharedKey);

    // User B is served User A's cached rows — proving why an owner-scoped read
    // MUST put the caller's identity in keyParts.
    expect(a).toBe("a-rows");
    expect(b).toBe("a-rows");
  });
});
