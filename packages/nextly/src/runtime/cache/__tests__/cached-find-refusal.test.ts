/**
 * A cached read that comes to be refused by access replaces the answer it gave
 * while it was allowed.
 *
 * Next keeps a cached entry's earlier answer when reading it again throws, so
 * a refusal thrown there left the public reading what an owner had since taken
 * away. The cache below behaves as Next's does on that point: a miss keeps
 * nothing when the read throws, and an expired entry is served once more while
 * it is read again, keeping the earlier answer when that read throws.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../di/container", () => ({
  container: { has: () => false, get: () => undefined },
}));

import { NextlyError } from "../../../errors/nextly-error";
import { isReadRefusal } from "../../routing/miss-or-denied";
import { applyCache, type UnstableCache } from "../cached-find";

/** One entry's cache, as Next keeps it, and a way to expire it. */
function nextLikeCache() {
  let kept: { value: unknown } | undefined;
  let expired = false;
  const cache: UnstableCache =
    <T>(read: () => Promise<T>) =>
    async (): Promise<T> => {
      if (kept === undefined) {
        const value = await read();
        kept = { value };
        return value;
      }
      const served = kept.value as T;
      if (expired) {
        expired = false;
        // Read again behind the answer served now; a throw keeps the earlier
        // answer, as Next keeps it.
        await read().then(
          value => {
            kept = { value };
          },
          () => undefined
        );
      }
      return served;
    };
  return {
    cache,
    expire: () => {
      expired = true;
    },
  };
}

const options = { tags: ["nextly:posts"], keyParts: ["posts", "p1"] };

const refused = () =>
  NextlyError.authRequired({
    logContext: { reason: "read on posts requires an authenticated user" },
  });

/**
 * Counts every read of the current time (`new Date()` with no arguments, and
 * `Date.now()`) while it is on, as a Cache Components prerender refuses them
 * outside a cache scope.
 */
function watchClock() {
  const RealDate = Date;
  const clock = { on: false, reads: 0 };
  vi.stubGlobal(
    "Date",
    new Proxy(RealDate, {
      construct(target, args, newTarget) {
        if (clock.on && args.length === 0) clock.reads += 1;
        return Reflect.construct(target, args, newTarget) as object;
      },
      get(target, property, receiver) {
        if (property !== "now") return Reflect.get(target, property, receiver);
        return () => {
          if (clock.on) clock.reads += 1;
          return target.now();
        };
      },
    })
  );
  return clock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a cached read refused by access", () => {
  it("replaces the answer it gave while allowed, once read again", async () => {
    const { cache, expire } = nextLikeCache();
    let allowed = true;
    const reader = vi.fn(async () => {
      if (!allowed) throw refused();
      return { items: [{ id: "p1", title: "Hello" }] };
    });

    await expect(applyCache(cache, reader, options)).resolves.toEqual({
      items: [{ id: "p1", title: "Hello" }],
    });

    allowed = false;
    expire();
    // Served once more while it is read again, as Next serves an expired entry.
    await expect(applyCache(cache, reader, options)).resolves.toEqual({
      items: [{ id: "p1", title: "Hello" }],
    });

    const after = await applyCache(cache, reader, options).catch(
      (error: unknown) => error
    );
    expect(NextlyError.isCode(after, "AUTH_REQUIRED")).toBe(true);
    expect(after).toMatchObject({
      statusCode: 401,
      logContext: {
        kept: true,
        reason: "read on posts requires an authenticated user",
      },
    });
    // Answered from the cache: the refusal was not read again.
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it("keeps a denial the same way, as a 403", async () => {
    const { cache } = nextLikeCache();
    const reader = vi.fn(async () => {
      throw NextlyError.forbidden();
    });

    for (let read = 0; read < 2; read += 1) {
      const error = await applyCache(cache, reader, options).catch(
        (thrown: unknown) => thrown
      );
      expect(NextlyError.isCode(error, "FORBIDDEN")).toBe(true);
      expect(error).toMatchObject({ statusCode: 403 });
    }
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("keeps no other error: a fault read again leaves the earlier answer", async () => {
    const { cache, expire } = nextLikeCache();
    let failing = false;
    const reader = vi.fn(async () => {
      if (failing) throw NextlyError.databaseBusy();
      return "answer";
    });

    await applyCache(cache, reader, options);
    failing = true;
    expire();
    await applyCache(cache, reader, options);
    await expect(applyCache(cache, reader, options)).resolves.toBe("answer");
  });

  it("keeps the refusal's public data and message key", async () => {
    const { cache } = nextLikeCache();
    const reader = vi.fn(async () => {
      throw new NextlyError({
        code: "FORBIDDEN",
        publicMessage: "You need the read-posts permission.",
        publicData: { reason: "no-permission", permission: "read-posts" },
        messageKey: "errors.forbidden.permission",
      });
    });

    for (let read = 0; read < 2; read += 1) {
      await expect(applyCache(cache, reader, options)).rejects.toMatchObject({
        code: "FORBIDDEN",
        publicMessage: "You need the read-posts permission.",
        publicData: { reason: "no-permission", permission: "read-posts" },
        messageKey: "errors.forbidden.permission",
      });
    }
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("returns an answer shaped like a kept refusal as the answer", async () => {
    const { cache } = nextLikeCache();
    const lookalike = {
      kept: "refusal",
      refusal: { code: "FORBIDDEN", statusCode: 403, publicMessage: "no" },
      __nextlyKeptRefusal: { code: "FORBIDDEN" },
    };
    const reader = vi.fn(async () => lookalike);

    await expect(applyCache(cache, reader, options)).resolves.toEqual(
      lookalike
    );
    await expect(applyCache(cache, reader, options)).resolves.toEqual(
      lookalike
    );
  });

  it("files what it keeps apart from an earlier release's bare answers", async () => {
    const keys: string[][] = [];
    const recording: UnstableCache = (read, keyParts) => {
      keys.push(keyParts);
      return read;
    };
    await applyCache(recording, async () => "answer", options);
    expect(keys).toHaveLength(1);
    expect(keys[0]?.slice(0, options.keyParts.length)).toEqual(
      options.keyParts
    );
    expect(keys[0]).not.toEqual(options.keyParts);
  });

  it.each([
    ["an unverified email", () => NextlyError.emailNotVerified()],
    ["a failed CSRF check", () => NextlyError.csrfFailed()],
  ])("keeps no 403 that is not a denial: %s", async (_what, failure) => {
    const { cache } = nextLikeCache();
    const reader = vi.fn(async () => {
      throw failure();
    });

    await expect(applyCache(cache, reader, options)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(applyCache(cache, reader, options)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it("keeps no credential failure: an expired session is the caller's to fix", async () => {
    const { cache } = nextLikeCache();
    const reader = vi.fn(async () => {
      throw NextlyError.tokenExpired();
    });

    await expect(applyCache(cache, reader, options)).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
    });
    await expect(applyCache(cache, reader, options)).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
    });
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it("throws a kept refusal again without reading the clock, even when it is logged", async () => {
    const { cache } = nextLikeCache();
    let made = new Date(0);
    const reader = vi.fn(async () => {
      const refusal = refused();
      made = refusal.timestamp;
      throw refusal;
    });
    await applyCache(cache, reader, options).catch(() => undefined);

    // A hit: the reader is not run, so any time read here is the refusal's
    // own making, outside every cache, which a prerender refuses.
    const clock = watchClock();
    clock.on = true;
    const error = await applyCache(cache, reader, options).catch(
      (thrown: unknown) => thrown
    );
    clock.on = false;
    expect(reader).toHaveBeenCalledTimes(1);
    expect(clock.reads).toBe(0);

    // The same refusal every catch reads, class and methods included.
    expect(error).toBeInstanceOf(NextlyError);
    expect(NextlyError.is(error)).toBe(true);
    expect(isReadRefusal(error)).toBe(true);
    const kept = error as NextlyError;
    expect(kept).toMatchObject({
      name: "NextlyError",
      message: "Authentication required.",
      code: "AUTH_REQUIRED",
      statusCode: 401,
      publicMessage: "Authentication required.",
      logContext: {
        kept: true,
        reason: "read on posts requires an authenticated user",
      },
    });
    expect(kept.toResponseJSON("r1")).toEqual({
      code: "AUTH_REQUIRED",
      message: "Authentication required.",
      requestId: "r1",
    });

    // Inspecting it reads no clock either: a log line, a JSON copy, a spread.
    clock.on = true;
    const logged = kept.toLogJSON("r1");
    JSON.stringify(kept);
    void { ...kept };
    clock.on = false;
    expect(clock.reads).toBe(0);
    // Its time is the refusal's own, kept when it was made.
    expect(kept.timestamp).toBeInstanceOf(Date);
    expect(kept.timestamp.getTime()).toBe(made.getTime());
    expect(logged.timestamp).toBe(made.toISOString());
    // And its stack names the class and carries the frames that threw it.
    const lines = (kept.stack ?? "").split("\n");
    expect(lines[0]).toBe("NextlyError: Authentication required.");
    expect(lines.length).toBeGreaterThan(1);
  });
});
