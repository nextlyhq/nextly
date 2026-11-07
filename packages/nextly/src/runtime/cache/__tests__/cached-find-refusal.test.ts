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
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../di/container", () => ({
  container: { has: () => false, get: () => undefined },
}));

import { NextlyError } from "../../../errors/nextly-error";
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
});
