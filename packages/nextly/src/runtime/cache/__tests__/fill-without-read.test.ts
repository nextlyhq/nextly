/**
 * A page Next.js stores with no read of its key before it must not pass for
 * fresh when a write landed while it was rendered.
 *
 * Next.js serves a path no build listed from its route's fallback shell, and
 * then renders the path's own page in the background and stores it, without
 * asking the handler for that key first. With no read to date it, the fill
 * used to be dated when it was stored, after a write made while it rendered,
 * so the page drawn before the write was kept and served until its tags
 * expired again: a page published after the build showed its previous
 * version on the next visit.
 *
 * Driven step by step with a fake clock, so the race happens every time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import IncrementalHandler from "../incremental-cache-handler";
import type { TagExpiries, TagExpiryLedger } from "../tag-expiry-ledger";
import { expireTags, publishTagExpiryLedger } from "../tag-expiry-view";

const T0 = Date.UTC(2026, 10, 17, 12, 0, 0);
const TAG = "nextly:pages:id:p1";

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

const page = (text: string) => ({ kind: "APP_PAGE", html: text });

/** What Next.js hands `set` with a page: its tags and its cache control. */
const asNextStoresIt = (tags: string[]) => ({
  tags,
  cacheControl: { revalidate: 900, expire: 3600 },
});

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

describe("a page stored with no read before it", () => {
  it("is not kept when a write landed while it was rendered", async () => {
    // 1. The background render of the path's own page begins: no read of
    //    its key comes first.
    vi.advanceTimersByTime(1_000);

    // 2. A write to the page expires its tag while the render runs.
    await expireTags([TAG]);
    vi.advanceTimersByTime(1_000);

    // 3. The render, drawn from what it read before the write, is stored.
    await new IncrementalHandler().set(
      "/published-later",
      page("old"),
      asNextStoresIt([TAG])
    );
    vi.advanceTimersByTime(10);

    // The next visitor must not be served it: the page is rendered again.
    expect(
      await new IncrementalHandler().get("/published-later", {
        tags: [TAG],
      })
    ).toBeNull();
  });

  it("is kept once no write to its tags is recent enough to have run across it", async () => {
    // A write longer ago than any render runs cannot have landed during this
    // one, so the page stands and visitors are served it.
    await expireTags([TAG]);
    vi.advanceTimersByTime(61_000);

    await new IncrementalHandler().set(
      "/published-later",
      page("new"),
      asNextStoresIt([TAG])
    );
    vi.advanceTimersByTime(10);

    expect(
      await new IncrementalHandler().get("/published-later", {
        tags: [TAG],
      })
    ).not.toBeNull();
  });

  it("is still dated by its read where one came first", async () => {
    // The ordinary miss: the read dates the fill, so a write before the read
    // does not expire what the render stores after it.
    await expireTags([TAG]);
    vi.advanceTimersByTime(1_000);
    const pages = new IncrementalHandler();
    expect(await pages.get("/published-later", { tags: [TAG] })).toBeNull();
    vi.advanceTimersByTime(1_000);
    await pages.set("/published-later", page("new"), asNextStoresIt([TAG]));
    vi.advanceTimersByTime(10);

    expect(
      await new IncrementalHandler().get("/published-later", {
        tags: [TAG],
      })
    ).not.toBeNull();
  });
});
