/**
 * Reads through the app's `"use cache"` function under Cache Components.
 *
 * `cachedRead` here stands in for the app's function: like the real one it
 * receives only the key, the tags and the lifetime, and reaches the reader
 * through `runRegisteredRead(key)`, holding one result per key as a cache would.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import * as logger from "../../../observability/logger";
import { applyCache, type UnstableCache } from "../cached-find";
import {
  type CachedRead,
  readThroughRegistered,
  runRegisteredRead,
  setCachedRead,
} from "../registered-read";

afterEach(() => {
  setCachedRead(undefined);
  vi.restoreAllMocks();
});

/** A deferred value, to hold a cached body open until a test releases it. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release = () => {};
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

describe("readThroughRegistered", () => {
  it("runs the registered reader inside the cached function, by key alone", async () => {
    const seen: unknown[][] = [];
    const cachedRead: CachedRead = async (key, tags, revalidate) => {
      seen.push([key, tags, revalidate]);
      return runRegisteredRead(key);
    };
    const result = await readThroughRegistered(
      cachedRead,
      '["posts","a"]',
      async () => ({ title: "A" }),
      ["nextly:posts"],
      false
    );
    expect(result).toEqual({ title: "A" });
    expect(seen).toEqual([['["posts","a"]', ["nextly:posts"], false]]);
  });

  it("keeps a key's reader while any request still holds it", async () => {
    // The first request's cached function waits; the second finishes first.
    // The first must still find a reader when its body runs, without falling
    // back to an uncached read.
    const warn = vi.fn();
    vi.spyOn(logger, "getNextlyLogger").mockReturnValue({
      error: vi.fn(),
      warn,
      info: vi.fn(),
      debug: vi.fn(),
    } as never);
    const gate = deferred();
    let calls = 0;
    const cachedRead: CachedRead = async key => {
      calls++;
      if (calls === 1) await gate.promise;
      return runRegisteredRead(key);
    };
    const first = readThroughRegistered(
      cachedRead,
      "k",
      async () => "first",
      [],
      false
    );
    const second = readThroughRegistered(
      cachedRead,
      "k",
      async () => "second",
      [],
      false
    );
    // Either reader answers the key; the point is that the first one finds one.
    expect(await second).toBeTypeOf("string");
    gate.release();
    expect(await first).toBeTypeOf("string");
    expect(warn).not.toHaveBeenCalled();
    // Once both are done, the key is released.
    expect(() => runRegisteredRead("k")).toThrow();
  });

  it("reads directly, and says so, when the cached function finds no reader", async () => {
    const warn = vi.fn();
    vi.spyOn(logger, "getNextlyLogger").mockReturnValue({
      error: vi.fn(),
      warn,
      info: vi.fn(),
      debug: vi.fn(),
    } as never);
    // A cached function that asks for a key nobody registered.
    const cachedRead: CachedRead = async () => runRegisteredRead("other");
    const result = await readThroughRegistered(
      cachedRead,
      "k",
      async () => "direct",
      [],
      false
    );
    expect(result).toBe("direct");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "cached-read-unregistered" })
    );
  });

  it("lets any other failure of the cached function through", async () => {
    const boom = new Error("cache handler down");
    const cachedRead: CachedRead = async () => {
      throw boom;
    };
    await expect(
      readThroughRegistered(cachedRead, "k", async () => "x", [], false)
    ).rejects.toBe(boom);
  });
});

describe("applyCache under Cache Components", () => {
  const unused: UnstableCache = () => () => {
    throw new Error("unstable_cache must not be used");
  };

  it("reads through the registered cached function, with the read's key and tags", async () => {
    const seen: unknown[][] = [];
    setCachedRead(async (key, tags, revalidate) => {
      seen.push([key, tags, revalidate]);
      return runRegisteredRead(key);
    });
    const result = await applyCache(unused, async () => ({ id: "x" }), {
      tags: ["nextly:posts"],
      keyParts: ["posts", "x"],
      revalidate: 60,
    });
    expect(result).toEqual({ id: "x" });
    expect(seen).toEqual([['["posts","x"]', ["nextly:posts"], 60]]);
  });

  it("stays on unstable_cache when no cached function is registered", async () => {
    const used: string[][] = [];
    const recording: UnstableCache = (cb, keyParts) => {
      used.push(keyParts);
      return cb;
    };
    await applyCache(recording, async () => ({ id: "y" }), {
      tags: ["nextly:posts"],
      keyParts: ["posts", "y"],
    });
    expect(used).toEqual([["posts", "y"]]);
  });
});
