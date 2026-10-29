/**
 * The Next cache adapter maps intents to `next/cache` calls with a fake module
 * (no real Next runtime), no-ops when the module is absent, never throws, and
 * hands off what it could not expire.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { withSideEffectWarnings } from "../../../hooks/side-effect-warnings";
import {
  setExpiryHandoff,
  takePendingExpiries,
} from "../../../revalidation/expiry-handoff";
import type { RevalidationIntent } from "../../../revalidation/types";
import {
  CACHE_EXPIRY_DEFERRED,
  HANDOFF_TIMEOUT_MS,
  DEFERRED_EXPIRY_NOTICE,
  MAX_TAGS_PER_WRITE,
  NextCacheRevalidator,
  nextCacheFrom,
  tagsToExpire,
  type NextCacheModule,
} from "../next-cache-revalidator";

function fakeNextCache() {
  return {
    revalidateTag:
      vi.fn<(tag: string, profile?: string | { expire?: number }) => void>(),
    revalidatePath: vi.fn<(path: string, type?: "page" | "layout") => void>(),
  } satisfies NextCacheModule;
}

describe("NextCacheRevalidator", () => {
  it("busts every tag in every intent via revalidateTag", async () => {
    const next = fakeNextCache();
    const revalidator = new NextCacheRevalidator(() => next);
    const intents: RevalidationIntent[] = [
      { tags: ["nextly:posts", "nextly:posts:id:1"] },
      { tags: ["nextly:single:header"] },
    ];

    revalidator.flush(intents);

    expect(next.revalidateTag).toHaveBeenCalledTimes(3);
    // The { expire: 0 } profile expires immediately (an unpublish/delete stops
    // being served on the next request) and silences the Next 16 single-arg
    // deprecation warning; ignored on Next 14/15.
    const immediate = { expire: 0 };
    expect(next.revalidateTag).toHaveBeenCalledWith("nextly:posts", immediate);
    expect(next.revalidateTag).toHaveBeenCalledWith(
      "nextly:posts:id:1",
      immediate
    );
    expect(next.revalidateTag).toHaveBeenCalledWith(
      "nextly:single:header",
      immediate
    );
  });

  it("revalidates path targets with their type", async () => {
    const next = fakeNextCache();
    const revalidator = new NextCacheRevalidator(() => next);

    revalidator.flush([
      {
        tags: ["nextly:posts:id:1"],
        paths: [{ path: "/blog/[slug]", type: "page" }, { path: "/blog/old" }],
      },
    ]);

    expect(next.revalidatePath).toHaveBeenCalledWith("/blog/[slug]", "page");
    expect(next.revalidatePath).toHaveBeenCalledWith("/blog/old", undefined);
  });

  it("no-ops when next/cache is unavailable", async () => {
    const revalidator = new NextCacheRevalidator(() => null);
    // Must not throw when there is no Next cache to talk to.
    expect(() => revalidator.flush([{ tags: ["nextly:posts"] }])).not.toThrow();
  });

  it("keeps a committed write when next/cache keeps throwing, and hands the tags off", async () => {
    const next = fakeNextCache();
    // revalidateTag throws outside a request scope (a CLI/background write).
    next.revalidateTag.mockImplementation(() => {
      throw new Error("static generation store missing");
    });
    const handoff = { handOff: vi.fn() };
    const revalidator = new NextCacheRevalidator(
      () => next,
      () => handoff
    );

    const outcome = await revalidator.flush([{ tags: ["a", "b"] }]);
    // Each tag is tried twice, and one throwing tag does not stop the rest.
    expect(next.revalidateTag).toHaveBeenCalledTimes(4);
    expect(outcome).toEqual({ deferredTags: ["a", "b"] });
    expect(handoff.handOff).toHaveBeenCalledWith(
      ["a", "b"],
      "static generation store missing"
    );
  });

  it("does not throw when next/cache cannot be resolved", async () => {
    const revalidator = new NextCacheRevalidator(() => {
      throw Object.assign(
        new Error("Cannot find module './incremental-cache'"),
        {
          code: "MODULE_NOT_FOUND",
        }
      );
    });

    expect(() => revalidator.flush([{ tags: ["a"] }])).not.toThrow();
  });

  it("does not throw when next/cache lacks an export it calls", async () => {
    const revalidator = new NextCacheRevalidator(() =>
      nextCacheFrom({ revalidateTag: () => undefined })
    );

    expect(() => revalidator.flush([{ tags: ["a"] }])).not.toThrow();
  });
});

/*
 * An expiry that fails is retried once and, failing again, handed to the
 * out-of-request path; the write it follows is never undone. In a Server Action
 * the tag is expired with `updateTag`, so the acting user reads their own write;
 * anywhere else Next.js refuses `updateTag` and the tag goes through
 * `revalidateTag(tag, { expire: 0 })`.
 */
describe("NextCacheRevalidator, when an expiry fails or the context differs", () => {
  const OUTSIDE = new Error(
    "updateTag can only be called from within a Server Action. To invalidate cache tags in Route Handlers or other contexts, use revalidateTag instead."
  );

  it("retries a tag that fails once, and hands nothing off", async () => {
    const next = fakeNextCache();
    next.revalidateTag.mockImplementationOnce(() => {
      throw new Error("flaky cache handler");
    });
    const handoff = { handOff: vi.fn() };
    const outcome = await new NextCacheRevalidator(
      () => next,
      () => handoff
    ).flush([{ tags: ["a"] }]);

    expect(next.revalidateTag).toHaveBeenCalledTimes(2);
    expect(outcome).toBeUndefined();
    expect(handoff.handOff).not.toHaveBeenCalled();
  });

  it("hands off only the tags that failed twice", async () => {
    const next = fakeNextCache();
    next.revalidateTag.mockImplementation(tag => {
      if (tag === "b") throw new Error("cache handler down");
    });
    const handoff = { handOff: vi.fn() };
    const outcome = await new NextCacheRevalidator(
      () => next,
      () => handoff
    ).flush([{ tags: ["a", "b", "c"] }]);

    expect(outcome).toEqual({ deferredTags: ["b"] });
    expect(handoff.handOff).toHaveBeenCalledWith(["b"], "cache handler down");
  });

  it("expires with updateTag in a Server Action, and does not also revalidate", async () => {
    const next = {
      ...fakeNextCache(),
      updateTag: vi.fn<(tag: string) => void>(),
    };
    new NextCacheRevalidator(() => next).flush([
      { tags: ["nextly:posts", "nextly:posts:id:1"] },
    ]);

    expect(next.updateTag.mock.calls).toEqual([
      ["nextly:posts"],
      ["nextly:posts:id:1"],
    ]);
    expect(next.revalidateTag).not.toHaveBeenCalled();
  });

  it("falls back to revalidateTag with immediate expiry where Next.js refuses updateTag", async () => {
    const next = {
      ...fakeNextCache(),
      updateTag: vi.fn<(tag: string) => void>(() => {
        throw OUTSIDE;
      }),
    };
    const outcome = await new NextCacheRevalidator(() => next).flush([
      { tags: ["nextly:posts"] },
    ]);

    expect(next.revalidateTag).toHaveBeenCalledWith("nextly:posts", {
      expire: 0,
    });
    expect(outcome).toBeUndefined();
  });

  it("does not fall back on any other updateTag failure: it is retried, then handed off", async () => {
    const next = {
      ...fakeNextCache(),
      updateTag: vi.fn<(tag: string) => void>(() => {
        throw new Error("cache handler down");
      }),
    };
    const handoff = { handOff: vi.fn() };
    const outcome = await new NextCacheRevalidator(
      () => next,
      () => handoff
    ).flush([{ tags: ["nextly:posts"] }]);

    expect(next.updateTag).toHaveBeenCalledTimes(2);
    expect(next.revalidateTag).not.toHaveBeenCalled();
    expect(outcome).toEqual({ deferredTags: ["nextly:posts"] });
  });

  it("keeps the write when the hand-off itself throws or rejects", async () => {
    const next = fakeNextCache();
    next.revalidateTag.mockImplementation(() => {
      throw new Error("down");
    });
    const throwing = {
      handOff: () => {
        throw new Error("queue down");
      },
    };
    const rejecting = {
      handOff: () => Promise.reject(new Error("queue down")),
    };

    expect(
      await new NextCacheRevalidator(
        () => next,
        () => throwing
      ).flush([{ tags: ["a"] }])
    ).toEqual({ deferredTags: ["a"] });
    expect(
      await new NextCacheRevalidator(
        () => next,
        () => rejecting
      ).flush([{ tags: ["a"] }])
    ).toEqual({ deferredTags: ["a"] });
  });
});

/*
 * Next.js keeps at most 128 tags on a cached read. A write naming more expires
 * each collection's or Single's own tag instead, which every read of it carries.
 */
describe("the tags a write expires", () => {
  const ids = (n: number) =>
    Array.from({ length: n }, (_, i) => `nextly:posts:id:${i}`);

  it("keeps every tag up to the limit", async () => {
    expect(tagsToExpire([{ tags: ids(MAX_TAGS_PER_WRITE) }])).toHaveLength(
      MAX_TAGS_PER_WRITE
    );
  });

  it("past it, keeps every exact tag and adds each collection's and Single's own", async () => {
    const exact = [
      ...ids(MAX_TAGS_PER_WRITE),
      "nextly:pages:slug:about",
      "nextly:single:header:en",
      "navigation",
    ];
    const tags = tagsToExpire([{ tags: exact }]);
    // An entry cached under its own id tag alone is still expired.
    expect(tags).toEqual(expect.arrayContaining(exact));
    expect(tags).toEqual(
      expect.arrayContaining([
        "nextly:posts",
        "nextly:pages",
        "nextly:single:header",
      ])
    );
    expect(tags).toHaveLength(exact.length + 3);
  });

  it("counts a tag named by two intents once", async () => {
    expect(
      tagsToExpire([{ tags: ["nextly:posts"] }, { tags: ["nextly:posts"] }])
    ).toEqual(["nextly:posts"]);
  });

  it("expires every exact tag and the collection's through flush", async () => {
    const next = fakeNextCache();
    await new NextCacheRevalidator(() => next).flush([
      { tags: ids(MAX_TAGS_PER_WRITE + 1) },
    ]);
    const expired = next.revalidateTag.mock.calls.map(([tag]) => tag);
    expect(expired).toHaveLength(MAX_TAGS_PER_WRITE + 2);
    expect(expired).toContain("nextly:posts:id:128");
    expect(expired).toContain("nextly:posts");
  });
});

/*
 * A write whose expiry was handed off tells its caller so, through the same
 * channel a post-commit hook's notice takes: the change is saved, and may take
 * a moment to show. One notice per collection or Single, naming nothing else.
 */
describe("the notice a deferred expiry leaves on the response", () => {
  it("names each collection and Single whose reads wait, once", async () => {
    const next = fakeNextCache();
    next.revalidateTag.mockImplementation(tag => {
      if (tag !== "nextly:pages") throw new Error("down");
    });
    const { notices } = await withSideEffectWarnings(async () => {
      await new NextCacheRevalidator(
        () => next,
        () => ({ handOff: vi.fn() })
      ).flush([
        {
          tags: [
            "nextly:posts",
            "nextly:posts:id:1",
            "nextly:single:header",
            "nextly:pages",
          ],
        },
      ]);
    });

    expect(notices).toEqual([
      {
        severity: "notice",
        phase: "cache-expiry",
        collection: "posts",
        code: CACHE_EXPIRY_DEFERRED,
        message: DEFERRED_EXPIRY_NOTICE,
      },
      {
        severity: "notice",
        phase: "cache-expiry",
        collection: "single:header",
        code: CACHE_EXPIRY_DEFERRED,
        message: DEFERRED_EXPIRY_NOTICE,
      },
    ]);
  });

  it("leaves no notice when every tag expired", async () => {
    const next = fakeNextCache();
    const { notices } = await withSideEffectWarnings(async () => {
      await new NextCacheRevalidator(() => next).flush([
        { tags: ["nextly:posts"] },
      ]);
    });
    expect(notices).toEqual([]);
  });
});

/*
 * Where Next.js is installed but its cache cannot be loaded, every tag waits for
 * the out-of-request path rather than being skipped; an expiry an earlier write
 * handed to the in-process default goes out with the next flush; and a hand-off
 * that answers later is waited for, so the request does not end first.
 */
describe("NextCacheRevalidator, deferring rather than dropping", () => {
  afterEach(() => {
    setExpiryHandoff(null);
    vi.useRealTimers();
  });

  it("answers anyway when the hand-off does not answer in time", async () => {
    vi.useFakeTimers();
    const next = fakeNextCache();
    next.revalidateTag.mockImplementation(() => {
      throw new Error("down");
    });
    const hung = { handOff: () => new Promise<void>(() => {}) };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const flushed = new NextCacheRevalidator(
      () => next,
      () => hung
    ).flush([{ tags: ["a"] }]);
    await vi.advanceTimersByTimeAsync(HANDOFF_TIMEOUT_MS);

    expect(await flushed).toEqual({ deferredTags: ["a"] });
    expect(
      error.mock.calls.some(([line]) => String(line).includes("did not answer"))
    ).toBe(true);
    error.mockRestore();
  });

  it("defers every tag when next/cache is there but cannot be loaded", async () => {
    const handoff = { handOff: vi.fn() };
    const revalidator = new NextCacheRevalidator(
      () => {
        throw new Error("Cannot find module './incremental-cache'");
      },
      () => handoff
    );

    expect(
      await revalidator.flush([{ tags: ["nextly:posts", "nextly:posts:id:1"] }])
    ).toEqual({
      deferredTags: ["nextly:posts", "nextly:posts:id:1"],
    });
    expect(handoff.handOff).toHaveBeenCalledTimes(1);
  });

  it("does nothing where Next.js is not installed", async () => {
    const handoff = { handOff: vi.fn() };
    expect(
      await new NextCacheRevalidator(
        () => null,
        () => handoff
      ).flush([{ tags: ["nextly:posts"] }])
    ).toBeUndefined();
    expect(handoff.handOff).not.toHaveBeenCalled();
  });

  it("expires what an earlier write handed off, with the next flush", async () => {
    const failing = fakeNextCache();
    failing.revalidateTag.mockImplementation(() => {
      throw new Error("down");
    });
    await new NextCacheRevalidator(() => failing).flush([
      { tags: ["nextly:posts:id:1"] },
    ]);

    const next = fakeNextCache();
    expect(
      await new NextCacheRevalidator(() => next).flush([
        { tags: ["nextly:pages"] },
      ])
    ).toBeUndefined();
    expect(next.revalidateTag.mock.calls.map(([tag]) => tag).sort()).toEqual([
      "nextly:pages",
      "nextly:posts:id:1",
    ]);
    expect(takePendingExpiries()).toEqual([]);
  });

  it("waits for a hand-off that answers later before the flush returns", async () => {
    const next = fakeNextCache();
    next.revalidateTag.mockImplementation(() => {
      throw new Error("down");
    });
    let settled = false;
    const slow = {
      handOff: () =>
        new Promise<void>(resolve =>
          setTimeout(() => {
            settled = true;
            resolve();
          }, 20)
        ),
    };
    await new NextCacheRevalidator(
      () => next,
      () => slow
    ).flush([{ tags: ["a"] }]);
    expect(settled).toBe(true);
  });
});
