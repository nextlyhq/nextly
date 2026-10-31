/**
 * In production without nextly's cache handlers, a cached public read is kept
 * at most a minute, and nextly says so once. With them, and outside
 * production, the read keeps its lifetime. Whether Next.js serves `"use cache"`
 * through nextly's handler is read from Next.js's own registry, as the
 * installed Next.js fills it.
 */
import {
  initializeCacheHandlers,
  setCacheHandler,
} from "next/dist/server/use-cache/handlers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setNextlyLogger } from "../../../observability/logger";
import { applyCache, type UnstableCache } from "../cached-find";
import IncrementalHandler from "../incremental-cache-handler";
import { registerCachedRead, setCachedRead } from "../registered-read";
import {
  publicReadLifetime,
  UNSHARED_READ_LIFETIME_SECONDS,
} from "../shared-handlers";
import useCacheHandler from "../use-cache-handler";

const warn = vi.fn();

/** Forgets what this process learnt, Next.js's registry included. */
function reset() {
  const global = globalThis as Record<string | symbol, unknown>;
  delete global.__nextly_incremental_handler_in_use;
  delete global.__nextly_unshared_reads_warned;
  for (const key of Object.getOwnPropertySymbols(global)) {
    if (Symbol.keyFor(key)?.startsWith("@next/cache-handlers")) {
      delete global[key];
    }
  }
}

beforeEach(() => {
  reset();
  warn.mockReset();
  const ignore = () => undefined;
  setNextlyLogger({ warn, error: ignore, info: ignore, debug: ignore });
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => {
  vi.unstubAllEnvs();
  setCachedRead(undefined);
  setNextlyLogger(undefined);
  reset();
});

describe("a cached public read without nextly's cache handlers, in production", () => {
  it("is kept at most a minute, whatever it asked for", () => {
    expect(publicReadLifetime(false, false)).toBe(
      UNSHARED_READ_LIFETIME_SECONDS
    );
    expect(publicReadLifetime(300, false)).toBe(UNSHARED_READ_LIFETIME_SECONDS);
    expect(publicReadLifetime(30, false)).toBe(30);
    expect(publicReadLifetime(false, true)).toBe(
      UNSHARED_READ_LIFETIME_SECONDS
    );
  });

  it("is said once per process, with the settings that lift it", () => {
    for (let i = 0; i < 50; i++) publicReadLifetime(false, i % 2 === 0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({
      kind: "cache-handlers-not-shared",
    });
    const message = String(warn.mock.calls[0][0].message);
    expect(message).toContain('require.resolve("nextly/cache-handler")');
    expect(message).toContain('require.resolve("nextly/cache-handlers")');
  });

  it("is bounded where cachedFind gives it its lifetime", async () => {
    const asked: unknown[] = [];
    const unstableCache: UnstableCache =
      (fn, _keyParts, options) =>
      (...args) => {
        asked.push(options.revalidate);
        return fn(...args);
      };
    await applyCache(unstableCache, async () => "row", {
      keyParts: ["notes"],
      tags: ["nextly:notes"],
    });
    expect(asked).toEqual([UNSHARED_READ_LIFETIME_SECONDS]);
  });

  it('is bounded through the app\'s "use cache" function too', async () => {
    const asked: unknown[] = [];
    registerCachedRead(async (_key, _tags, revalidate) => {
      asked.push(revalidate);
      return "row";
    }, "true");
    await applyCache(null, async () => "row", {
      keyParts: ["notes"],
      tags: ["nextly:notes"],
    });
    expect(asked).toEqual([UNSHARED_READ_LIFETIME_SECONDS]);
  });
});

describe("a cached public read nextly's cache handlers serve", () => {
  it("keeps its lifetime once Next.js constructs nextly's incremental handler", () => {
    new IncrementalHandler();
    expect(publicReadLifetime(false, false)).toBe(false);
    expect(publicReadLifetime(300, false)).toBe(300);
    expect(warn).not.toHaveBeenCalled();
  });

  it('under Cache Components, keeps its lifetime only while Next.js serves "use cache" through nextly\'s handler too', () => {
    new IncrementalHandler();
    // Next.js's own default handler: nextly's is not in use.
    initializeCacheHandlers(0);
    expect(publicReadLifetime(false, true)).toBe(
      UNSHARED_READ_LIFETIME_SECONDS
    );

    setCacheHandler("default", useCacheHandler);
    expect(publicReadLifetime(false, true)).toBe(false);
  });

  it("under Cache Components, is still bounded without the incremental handler, which holds the pages", () => {
    initializeCacheHandlers(0);
    setCacheHandler("default", useCacheHandler);
    expect(publicReadLifetime(false, true)).toBe(
      UNSHARED_READ_LIFETIME_SECONDS
    );
  });
});

describe("a cached public read outside production", () => {
  it("keeps its lifetime, and nothing is said: one process sees every write it makes", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(publicReadLifetime(false, false)).toBe(false);
    expect(publicReadLifetime(300, true)).toBe(300);
    expect(warn).not.toHaveBeenCalled();
  });
});
