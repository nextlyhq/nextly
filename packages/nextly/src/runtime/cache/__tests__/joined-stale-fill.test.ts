/**
 * A page rendered after a write must not be kept if it drew a `use cache`
 * value filled before that write.
 *
 * Next.js shares one in-flight `use cache` fill between concurrent requests:
 * a request rendering a page after a write can join a fill another request
 * began before it, and draw the old value. The fill is refused when it is
 * stored (it began before the expiry), but the page that joined it began
 * after the expiry, so by its own start it looked fresh and was kept, old,
 * for its whole lifetime.
 *
 * Driven step by step with a fake clock and a fill held open, so the race
 * happens every time rather than sometimes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import IncrementalHandler from "../incremental-cache-handler";
import type { TagExpiries, TagExpiryLedger } from "../tag-expiry-ledger";
import { expireTags, publishTagExpiryLedger } from "../tag-expiry-view";
import useCacheHandler from "../use-cache-handler";

const T0 = Date.UTC(2026, 10, 16, 12, 0, 0);

function memoryLedger(): TagExpiryLedger {
  const rows = new Map<string, number>();
  return {
    record: async tags => {
      for (const tag of tags) rows.set(tag, Date.now());
      return new Map(tags.map(tag => [tag, rows.get(tag) ?? 0] as const));
    },
    expiriesOf: async (tags): Promise<TagExpiries> => {
      const expired = new Map(
        tags.flatMap(tag => {
          const at = rows.get(tag);
          return at === undefined ? [] : [[tag, at] as const];
        })
      );
      return { now: expired.size > 0 ? Date.now() : undefined, expired };
    },
    prune: async () => 0,
  };
}

/** A `use cache` entry as Next.js hands it to `set`, begun at `begunAt`. */
function fill(text: string, tags: string[], begunAt: number) {
  return {
    value: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    tags,
    stale: 0,
    timestamp: begunAt,
    expire: 3600,
    revalidate: 900,
  };
}

const page = (text: string) => ({ kind: "APP_PAGE", html: text });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  // A fresh view and stores per case: their state is shared on purpose.
  for (const key of [
    "__nextly_tag_expiry_view",
    "__nextly_cache_entries",
    "__nextly_cache_reads",
    "__nextly_cache_reads_overflowed_at",
  ]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  publishTagExpiryLedger(memoryLedger());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a page that joined a fill begun before a write", () => {
  // A placed component's per-id tag, and the site style's Single tag: the two
  // writes the cached page was seen keeping old.
  it.each([
    ["a component's publish", "nextly:components:id:c1"],
    ["a site style save", "nextly:singles:site-style"],
  ])("is not kept after %s", async (_write, tag) => {
    // 1. A request's render begins the inner `use cache` fill (held open).
    const fillBegan = Date.now();
    let finish: (entry: ReturnType<typeof fill>) => void = () => {};
    const held = new Promise<ReturnType<typeof fill>>(resolve => {
      finish = resolve;
    });
    const storing = useCacheHandler.set("inner", held);
    vi.advanceTimersByTime(10);

    // 2. The write expires the tag in this process.
    await expireTags([tag]);
    vi.advanceTimersByTime(10);

    // 3. A later request misses the page and starts rendering it; it joins
    //    the held fill (Next.js shares it) instead of reading afresh.
    const pages = new IncrementalHandler();
    expect(await pages.get("/cached-page")).toBeNull();
    vi.advanceTimersByTime(10);

    // 4. The fill finishes with the value read before the write.
    finish(fill("old", [tag], fillBegan));
    await storing;
    vi.advanceTimersByTime(10);

    // 5. The page, drawn from that old value, is stored.
    await pages.set("/cached-page", page("old"), { tags: [tag] });
    vi.advanceTimersByTime(10);

    // The next visitor must not be served it: it is rendered again, afresh.
    expect(await new IncrementalHandler().get("/cached-page")).toBeNull();
    // The old fill itself is not served either.
    expect(await useCacheHandler.get("inner", [])).toBeUndefined();
  });

  it("keeps a page whose fills all began after the write", async () => {
    const tag = "nextly:components:id:c1";
    await expireTags([tag]);
    vi.advanceTimersByTime(10);

    const pages = new IncrementalHandler();
    expect(await pages.get("/cached-page")).toBeNull();
    const fillBegan = Date.now();
    vi.advanceTimersByTime(10);
    await useCacheHandler.set(
      "inner",
      Promise.resolve(fill("new", [tag], fillBegan))
    );
    vi.advanceTimersByTime(10);
    await pages.set("/cached-page", page("new"), { tags: [tag] });
    vi.advanceTimersByTime(10);

    // A fresh fill re-expires nothing, so the page stands.
    expect(await new IncrementalHandler().get("/cached-page")).not.toBeNull();
  });
  it("settles under load: each stale fill re-expires once, and a burst afterwards keeps the new page", async () => {
    const tag = "nextly:components:id:c1";
    // Three fills in flight across requests, each begun before the publish.
    const finishers: Array<() => Promise<void>> = [];
    for (const key of ["a", "b", "c"]) {
      const began = Date.now();
      let finish: (entry: ReturnType<typeof fill>) => void = () => {};
      const storing = useCacheHandler.set(
        key,
        new Promise<ReturnType<typeof fill>>(resolve => {
          finish = resolve;
        })
      );
      finishers.push(async () => {
        finish(fill("old", [tag], began));
        await storing;
      });
      vi.advanceTimersByTime(5);
    }
    await expireTags([tag]);
    vi.advanceTimersByTime(5);

    // Requests keep arriving while the stale fills finish one by one: each
    // page render that began before a stale fill finished is refused.
    for (const finishOne of finishers) {
      const pages = new IncrementalHandler();
      expect(await pages.get("/cached-page")).toBeNull();
      vi.advanceTimersByTime(5);
      await finishOne();
      vi.advanceTimersByTime(5);
      await pages.set("/cached-page", page("old"), { tags: [tag] });
      vi.advanceTimersByTime(5);
      expect(await new IncrementalHandler().get("/cached-page")).toBeNull();
    }

    // Once every stale fill has finished, one render with fresh fills is
    // kept, and a burst of visitors is served it: no loop of misses.
    const pages = new IncrementalHandler();
    expect(await pages.get("/cached-page")).toBeNull();
    const began = Date.now();
    vi.advanceTimersByTime(5);
    await useCacheHandler.set("a", Promise.resolve(fill("new", [tag], began)));
    await pages.set("/cached-page", page("new"), { tags: [tag] });
    for (let visit = 0; visit < 20; visit += 1) {
      vi.advanceTimersByTime(5);
      expect(await new IncrementalHandler().get("/cached-page")).not.toBeNull();
    }
    expect(await useCacheHandler.get("a", [])).toBeDefined();
  });
});

describe("a page render overtaken by a later read of the same page", () => {
  it.each([
    ["a component's publish", "nextly:components:id:c1"],
    ["a site style save", "nextly:singles:site-style"],
  ])(
    "is dated from its own read, so %s while it runs refuses it",
    async (_write, tag) => {
      // 1. A request misses the page and starts rendering it, drawing the value
      //    from before the write.
      expect(await new IncrementalHandler().get("/cached-page")).toBeNull();
      vi.advanceTimersByTime(10);
      // 2. The write expires the tag while that render runs.
      await expireTags([tag]);
      vi.advanceTimersByTime(10);
      // 3. Another request misses the same page meanwhile (Next.js serves it the
      //    render already under way).
      expect(await new IncrementalHandler().get("/cached-page")).toBeNull();
      vi.advanceTimersByTime(10);
      // 4. The first render, drawn before the write, is stored.
      await new IncrementalHandler().set("/cached-page", page("old"), {
        tags: [tag],
      });
      vi.advanceTimersByTime(10);

      // It began before the write, so the next visitor gets a new render.
      expect(await new IncrementalHandler().get("/cached-page")).toBeNull();
    }
  );

  it("is not dated from an earlier read that was served from the cache", async () => {
    const tag = "nextly:components:id:c1";
    // The page is stored, and a visitor is served it: that read started no
    // render.
    await new IncrementalHandler().set("/cached-page", page("old"), {
      tags: [tag],
    });
    vi.advanceTimersByTime(10);
    expect(await new IncrementalHandler().get("/cached-page")).not.toBeNull();
    vi.advanceTimersByTime(10);
    // The write expires it; the next visitor misses and renders it afresh.
    await expireTags([tag]);
    vi.advanceTimersByTime(10);
    expect(await new IncrementalHandler().get("/cached-page")).toBeNull();
    vi.advanceTimersByTime(10);
    await new IncrementalHandler().set("/cached-page", page("new"), {
      tags: [tag],
    });
    vi.advanceTimersByTime(10);

    // That render began after the write, so it is kept: rendered once.
    expect(await new IncrementalHandler().get("/cached-page")).not.toBeNull();
  });
});
