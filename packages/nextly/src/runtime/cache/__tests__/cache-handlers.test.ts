/**
 * nextly's cache handlers against a stand-in for the tag expiry ledger whose
 * clock may differ from this process's: an expiry recorded elsewhere reaches
 * an entry once its tags' answers are older than their TTL, whatever order
 * the expiries were written in; a write made here expires at once; reads in
 * one TTL share one ledger read; a ledger that fails is warned about once;
 * an entry older than the ledger keeps an expiry is refused; and `use cache`
 * streams are replayed.
 */
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setNextlyLogger } from "../../../observability/logger";
import { BoundedEntries } from "../bounded-entries";
import IncrementalHandler from "../incremental-cache-handler";
import type { TagExpiries, TagExpiryLedger } from "../tag-expiry-ledger";
import { LEDGER_RETENTION_MS } from "../tag-expiry-ledger";
import { publishTagExpiryLedger, TAG_LOOKUP_TTL_MS } from "../tag-expiry-view";
import useCacheHandler from "../use-cache-handler";

const T0 = Date.UTC(2026, 9, 30, 12, 0, 0);

/** A ledger kept in memory, on a clock `skewMs` ahead of this process's. */
function memoryLedger(skewMs = 0) {
  const rows = new Map<string, number>();
  const now = () => Date.now() + skewMs;
  const expiriesOf = vi.fn(
    async (tags: readonly string[]): Promise<TagExpiries> => {
      const expired = new Map(
        tags.flatMap(tag => {
          const at = rows.get(tag);
          return at === undefined ? [] : [[tag, at] as const];
        })
      );
      return { now: expired.size > 0 ? now() : undefined, expired };
    }
  );
  const ledger: TagExpiryLedger = {
    record: async tags => {
      for (const tag of tags) rows.set(tag, now());
      return true;
    },
    expiriesOf,
    prune: async () => 0,
  };
  /** An expiry recorded by another instance, or a writer outside any request. */
  const recordElsewhere = (tag: string, atLedgerTime = now()) =>
    rows.set(tag, atLedgerTime);
  return { ledger, expiriesOf, recordElsewhere };
}

const page = (n: number) => ({ kind: "FETCH", data: { n } });

const viewState = () =>
  (
    globalThis as {
      __nextly_tag_expiry_view?: { lookups: Map<string, unknown> };
    }
  ).__nextly_tag_expiry_view;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  // A fresh view per case: its state is shared by every module copy on purpose.
  delete (globalThis as { __nextly_tag_expiry_view?: unknown })
    .__nextly_tag_expiry_view;
  delete (globalThis as { __nextly_cache_entries?: unknown })
    .__nextly_cache_entries;
  delete (globalThis as { __nextly_cache_reads?: unknown })
    .__nextly_cache_reads;
});
afterEach(() => {
  vi.useRealTimers();
  setNextlyLogger(undefined);
});

describe("the incremental cache handler", () => {
  it("serves an entry until an expiry recorded elsewhere reaches it, within the lookup's lifetime", async () => {
    const { ledger, recordElsewhere } = memoryLedger();
    publishTagExpiryLedger(ledger);
    const handler = new IncrementalHandler();
    await handler.set("k", page(1), { tags: ["posts"] });
    expect(await handler.get("k")).not.toBeNull();

    vi.advanceTimersByTime(1000);
    recordElsewhere("posts");
    // Asked again only once the tag's answer is older than its lifetime.
    expect(await handler.get("k")).not.toBeNull();
    vi.advanceTimersByTime(TAG_LOOKUP_TTL_MS);
    expect(await handler.get("k")).toBeNull();
  });

  it("expires an entry for an expiry written after a later one was read, as a late commit is", async () => {
    const { ledger, recordElsewhere } = memoryLedger();
    publishTagExpiryLedger(ledger);
    const handler = new IncrementalHandler();
    await handler.set("k", page(1), { tags: ["posts"] });
    vi.advanceTimersByTime(1000);
    expect(await handler.get("k")).not.toBeNull();

    // Committed only now, carrying a time from before the last read: a read
    // of rows newer than the last look would pass over it.
    vi.advanceTimersByTime(TAG_LOOKUP_TTL_MS);
    recordElsewhere("posts", T0 + 500);
    expect(await handler.get("k")).toBeNull();
  });

  it("asks the ledger about the tags the entry carries, and no others", async () => {
    const { ledger, expiriesOf } = memoryLedger();
    publishTagExpiryLedger(ledger);
    const handler = new IncrementalHandler();
    await handler.set("k", page(1), { tags: ["posts"] });
    await handler.get("k", { softTags: ["_N_T_/blog"] });
    expect(expiriesOf).toHaveBeenCalledTimes(1);
    expect([...expiriesOf.mock.calls[0][0]].sort()).toEqual([
      "_N_T_/blog",
      "posts",
    ]);
  });

  it("expires its own write at once, without waiting for a read of the ledger", async () => {
    const { ledger, expiriesOf } = memoryLedger();
    publishTagExpiryLedger(ledger);
    const handler = new IncrementalHandler();
    await handler.set("k", page(1), { tags: ["posts"] });
    await handler.get("k");
    const reads = expiriesOf.mock.calls.length;

    vi.advanceTimersByTime(1);
    await handler.revalidateTag(["posts"]);
    expect(await handler.get("k")).toBeNull();
    expect(expiriesOf.mock.calls.length).toBe(reads);
  });

  it("reads the ledger once for every read of one tag in the lookup's lifetime", async () => {
    const { ledger, expiriesOf } = memoryLedger();
    publishTagExpiryLedger(ledger);
    const handler = new IncrementalHandler();
    for (let i = 0; i < 10; i += 1) {
      await handler.set(`k${i}`, page(i), { tags: ["posts"] });
    }
    // Concurrent reads share the one read under way.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => handler.get(`k${i}`))
    );
    await handler.get("k0");
    expect(expiriesOf).toHaveBeenCalledTimes(1);
  });

  it("judges an entry on the ledger's clock, however far this process's clock is from it", async () => {
    // The ledger's clock runs a minute ahead of this process's.
    const { ledger, recordElsewhere } = memoryLedger(60_000);
    publishTagExpiryLedger(ledger);
    const handler = new IncrementalHandler();
    await handler.set("k", page(1), { tags: ["posts"] });

    // Thirty seconds BEFORE the entry was stored, on the ledger's clock; on
    // this process's clock that reads as thirty seconds after it.
    recordElsewhere("posts", T0 + 60_000 - 30_000);
    expect(await handler.get("k")).not.toBeNull();

    recordElsewhere("posts", Date.now() + 60_000);
    vi.advanceTimersByTime(TAG_LOOKUP_TTL_MS);
    expect(await handler.get("k")).toBeNull();
  });

  it("refuses an entry older than the ledger keeps an expiry", async () => {
    publishTagExpiryLedger(memoryLedger().ledger);
    const handler = new IncrementalHandler();
    await handler.set("k", page(1), { tags: ["posts"] });
    vi.advanceTimersByTime(LEDGER_RETENTION_MS + 1);
    expect(await handler.get("k")).toBeNull();
  });

  it("reads a stored page's tags from its cache-tags header", async () => {
    const { ledger, recordElsewhere } = memoryLedger();
    publishTagExpiryLedger(ledger);
    const handler = new IncrementalHandler();
    await handler.set("/blog", {
      kind: "APP_PAGE",
      headers: { "x-next-cache-tags": "_N_T_/blog,posts" },
    });
    vi.advanceTimersByTime(1);
    recordElsewhere("posts");
    expect(await handler.get("/blog")).toBeNull();
  });

  it("keeps an entry across the handlers Next.js makes, one per request", async () => {
    publishTagExpiryLedger(memoryLedger().ledger);
    await new IncrementalHandler().set("k", page(1), { tags: ["posts"] });
    expect(await new IncrementalHandler().get("k")).not.toBeNull();
  });

  it("counts a prerender's segment buffers toward the bound, and evicts past it", async () => {
    publishTagExpiryLedger(memoryLedger().ledger);
    // A page's segments are a Map of Buffers, which JSON writes as `{}`.
    const prerender = () => ({
      kind: "APP_PAGE",
      segmentData: new Map([["/page", Buffer.alloc(10 * 1024 * 1024)]]),
    });
    for (let i = 0; i < 6; i += 1) {
      await new IncrementalHandler().set(`p${i}`, prerender());
    }
    expect(await new IncrementalHandler().get("p0")).toBeNull();
    expect(await new IncrementalHandler().get("p5")).not.toBeNull();
  });

  it("expires an entry for its own write when the database's offset is learned after it", async () => {
    // The database's clock runs a minute ahead; the ledger cannot take the
    // write, so only this process's own record of it expires the entry.
    const ahead = 60_000;
    publishTagExpiryLedger({
      record: async () => {
        throw new Error("read-only replica");
      },
      expiriesOf: async tags => ({
        now: Date.now() + ahead,
        expired: new Map(
          tags.includes("other") ? [["other", T0 + ahead - 100_000]] : []
        ),
      }),
      prune: async () => 0,
    });
    const handler = new IncrementalHandler();
    await handler.set("k", page(1), { tags: ["posts", "other"] });
    vi.advanceTimersByTime(1000);
    // Before any read: the offset is not known yet.
    await handler.revalidateTag("posts");
    expect(await handler.get("k")).toBeNull();
  });

  it("hands back the lifetime a route was stored with", async () => {
    publishTagExpiryLedger(memoryLedger().ledger);
    const cacheControl = { revalidate: 60, expire: 300 };
    await new IncrementalHandler().set("/r", page(1), {
      tags: ["posts"],
      cacheControl,
    });
    expect((await new IncrementalHandler().get("/r"))?.cacheControl).toEqual(
      cacheControl
    );
  });

  it("caches a not-found answer rather than forgetting the key", async () => {
    publishTagExpiryLedger(memoryLedger().ledger);
    await new IncrementalHandler().set("/missing", null, { tags: ["posts"] });
    const hit = await new IncrementalHandler().get("/missing");
    expect(hit).not.toBeNull();
    expect(hit?.value).toBeNull();
  });

  it("keeps a fresh entry written while an expired one was being judged", async () => {
    const { ledger, recordElsewhere } = memoryLedger();
    let answer!: () => void;
    const gate = new Promise<void>(resolve => {
      answer = resolve;
    });
    const expiriesOf = ledger.expiriesOf;
    publishTagExpiryLedger({
      ...ledger,
      expiriesOf: async tags => {
        await gate;
        return expiriesOf(tags);
      },
    });
    const handler = new IncrementalHandler();
    await handler.set("k", page(1), { tags: ["posts"] });
    vi.advanceTimersByTime(1);
    recordElsewhere("posts");
    vi.advanceTimersByTime(1);
    // The stale entry is judged while a regenerated one replaces it.
    const judging = handler.get("k");
    await handler.set("k", page(2), { tags: ["posts"] });
    answer();
    expect(await judging).toBeNull();
    expect((await handler.get("k"))?.value).toEqual(page(2));
  });

  it("refuses a fill that began before an expiry recorded while it ran", async () => {
    const { ledger, recordElsewhere } = memoryLedger();
    publishTagExpiryLedger(ledger);
    // The miss that starts the fill.
    expect(await new IncrementalHandler().get("k")).toBeNull();
    vi.advanceTimersByTime(10);
    // Another instance writes while the fill is still rendering old content.
    recordElsewhere("posts");
    vi.advanceTimersByTime(10);
    await new IncrementalHandler().set("k", page(1), { tags: ["posts"] });
    expect(await new IncrementalHandler().get("k")).toBeNull();
  });

  it("keeps an expiry it knew through a refresh that fails", async () => {
    const { ledger, recordElsewhere } = memoryLedger();
    let failing = false;
    publishTagExpiryLedger({
      ...ledger,
      expiriesOf: async tags => {
        if (failing) throw new Error("connection refused");
        return ledger.expiriesOf(tags);
      },
    });
    const handler = new IncrementalHandler();
    await handler.set("old", page(1), { tags: ["posts"] });
    vi.advanceTimersByTime(1);
    recordElsewhere("posts");
    vi.advanceTimersByTime(1);
    await handler.set("new", page(2), { tags: ["posts"] });
    // Learned here: posts expired after "old" was stored.
    expect(await handler.get("new")).not.toBeNull();

    failing = true;
    vi.advanceTimersByTime(TAG_LOOKUP_TTL_MS + 1);
    expect(await handler.get("old")).toBeNull();
  });

  it("serves a regeneration made in the same millisecond as its own expiry", async () => {
    publishTagExpiryLedger(memoryLedger().ledger);
    const handler = new IncrementalHandler();
    await handler.set("k", page(1), { tags: ["posts"] });
    vi.advanceTimersByTime(1);
    // The clock does not move between these.
    await handler.revalidateTag("posts");
    expect(await handler.get("k")).toBeNull();
    await handler.set("k", page(2), { tags: ["posts"] });
    expect((await handler.get("k"))?.value).toEqual(page(2));
  });

  it("remembers a bounded number of reads, however many distinct keys a burst reads", async () => {
    publishTagExpiryLedger(memoryLedger().ledger);
    const handler = new IncrementalHandler();
    // All inside the fill window: none is old enough to drop by age.
    for (let i = 0; i < 10_500; i += 1) await handler.get(`miss-${i}`);
    const remembered = (
      globalThis as { __nextly_cache_reads?: Map<string, number> }
    ).__nextly_cache_reads;
    expect(remembered?.size).toBeLessThanOrEqual(10_000);
    // None inside the window is dropped: the reads that overflowed are the
    // ones not remembered, and their fills are judged from the window's start.
    expect(remembered?.has("miss-0")).toBe(true);
    expect(remembered?.has("miss-10499")).toBe(false);
  });

  it("refuses a fill whose read went unremembered while the reads were full, when an expiry crossed it", async () => {
    const { ledger, recordElsewhere } = memoryLedger();
    publishTagExpiryLedger(ledger);
    const handler = new IncrementalHandler();
    // Fills the remembered reads with ones still inside the window.
    for (let i = 0; i < 10_000; i += 1) await handler.get(`busy-${i}`);
    // This miss finds no room, so when its fill began is not kept.
    expect(await handler.get("k")).toBeNull();
    vi.advanceTimersByTime(10);
    recordElsewhere("posts");
    vi.advanceTimersByTime(10);
    await handler.set("k", page(1), { tags: ["posts"] });
    expect(await handler.get("k")).toBeNull();
  });

  it("expires its own writes with no ledger published, as one instance needs", async () => {
    publishTagExpiryLedger(null);
    const handler = new IncrementalHandler();
    await handler.set("k", page(1), { tags: ["posts"] });
    vi.advanceTimersByTime(1);
    await handler.revalidateTag("posts");
    expect(await handler.get("k")).toBeNull();
  });

  it("serves from what it knows when the ledger fails, warning once and not asking again within the lifetime", async () => {
    const warn = vi.fn();
    const ignore = () => undefined;
    setNextlyLogger({ warn, error: ignore, info: ignore, debug: ignore });
    const expiriesOf = vi.fn(async () => {
      throw new Error("connection refused");
    });
    publishTagExpiryLedger({
      record: async () => true,
      expiriesOf,
      prune: async () => 0,
    });
    const handler = new IncrementalHandler();
    await handler.set("k", page(1), { tags: ["posts"] });
    expect(await handler.get("k")).not.toBeNull();
    expect(await handler.get("k")).not.toBeNull();
    expect(expiriesOf).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TAG_LOOKUP_TTL_MS);
    expect(await handler.get("k")).not.toBeNull();
    expect(expiriesOf).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({
      kind: "cache-tag-ledger-unreachable",
    });
  });
});

describe("the expiries kept in memory", () => {
  it("forget an own expiry once it is older than the ledger keeps one", async () => {
    publishTagExpiryLedger(null);
    await useCacheHandler.updateTags(["posts"]);
    expect(await useCacheHandler.getExpiration(["posts"])).toBeGreaterThan(0);

    vi.advanceTimersByTime(LEDGER_RETENTION_MS + TAG_LOOKUP_TTL_MS);
    expect(await useCacheHandler.getExpiration(["posts"])).toBe(0);
  });

  it("drop the ledger's answers once they are past their lifetime", async () => {
    publishTagExpiryLedger(memoryLedger().ledger);
    await useCacheHandler.getExpiration(
      Array.from({ length: 100 }, (_, i) => `tag-${i}`)
    );
    expect(viewState()?.lookups.size).toBe(100);

    vi.advanceTimersByTime(TAG_LOOKUP_TTL_MS);
    await useCacheHandler.getExpiration(["posts"]);
    expect(viewState()?.lookups.size).toBe(1);
  });
});

describe("the use cache handler", () => {
  const entry = (text: string, tags: string[]) => ({
    value: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    tags,
    stale: 0,
    timestamp: Date.now(),
    expire: 3600,
    revalidate: 900,
  });
  const read = async (stream: ReadableStream<Uint8Array> | undefined) =>
    stream === undefined ? undefined : new Response(stream).text();

  it("replays a stored value to every reader, and drops it once a tag expires elsewhere", async () => {
    const { ledger, recordElsewhere } = memoryLedger();
    publishTagExpiryLedger(ledger);
    await useCacheHandler.set("k", Promise.resolve(entry("hello", ["posts"])));

    expect(await read((await useCacheHandler.get("k", []))?.value)).toBe(
      "hello"
    );
    expect(await read((await useCacheHandler.get("k", []))?.value)).toBe(
      "hello"
    );

    vi.advanceTimersByTime(1);
    recordElsewhere("posts");
    vi.advanceTimersByTime(TAG_LOOKUP_TTL_MS);
    expect(await useCacheHandler.get("k", [])).toBeUndefined();
    // Reported on this process's clock, for Next.js to compare its own times with.
    expect(await useCacheHandler.getExpiration(["posts"])).toBeGreaterThan(T0);
  });

  it("does not store a dynamic result outside development, keeping the entry there", async () => {
    publishTagExpiryLedger(memoryLedger().ledger);
    vi.stubEnv("NODE_ENV", "production");
    await useCacheHandler.set("k", Promise.resolve(entry("kept", ["posts"])));
    await useCacheHandler.set(
      "k",
      Promise.resolve({ ...entry("dynamic", ["posts"]), expire: 0 })
    );
    expect(await read((await useCacheHandler.get("k", []))?.value)).toBe(
      "kept"
    );
    vi.unstubAllEnvs();
  });

  it("answers a get made while the same key is being written with the new value", async () => {
    publishTagExpiryLedger(memoryLedger().ledger);
    let finish!: (value: ReturnType<typeof entry>) => void;
    const pending = new Promise<ReturnType<typeof entry>>(resolve => {
      finish = resolve;
    });
    const writing = useCacheHandler.set("k", pending);
    const reading = useCacheHandler.get("k", []);
    finish(entry("fresh", ["posts"]));
    await writing;
    expect(await read((await reading)?.value)).toBe("fresh");
  });
});

describe("the handlers' bounded entries", () => {
  it("drops the least recently used once their size passes the bound", () => {
    // No per-entry overhead here: a value counts its bytes and its key.
    const entries = new BoundedEntries<string>(10, 0);
    entries.set("a", "a", 4);
    entries.set("b", "b", 4);
    entries.get("a");
    entries.set("c", "c", 4);
    expect(entries.get("b")).toBeUndefined();
    expect(entries.get("a")).toBe("a");
    expect(entries.get("c")).toBe("c");
    // Two entries of four bytes, each with its one-character key.
    expect(entries.bytes).toBe(10);
    entries.set("huge", "x", 11);
    expect(entries.get("huge")).toBeUndefined();
  });

  it("removes a key only while it still holds the value it was asked about", () => {
    const entries = new BoundedEntries<{ n: number }>();
    const judged = { n: 1 };
    entries.set("k", judged, 1);
    const fresh = { n: 2 };
    entries.set("k", fresh, 1);
    entries.deleteIf("k", judged);
    expect(entries.get("k")).toBe(fresh);
    entries.deleteIf("k", fresh);
    expect(entries.get("k")).toBeUndefined();
  });

  it("counts an empty value too, so a flood of them still reaches the bound", () => {
    const entries = new BoundedEntries<string>(10_000);
    for (let i = 0; i < 1_000; i += 1) entries.set(`k${i}`, "", 0);
    expect(entries.get("k0")).toBeUndefined();
    expect(entries.get("k999")).toBe("");
    expect(entries.bytes).toBeLessThanOrEqual(10_000);
  });
});

describe("the handlers' subpaths", () => {
  // A `next.config.ts` in an app without `"type": "module"` runs as CommonJS,
  // where the install line's `require.resolve` matches only `require` or
  // `default`; an `import`-only entry refuses it. Next.js then loads the path
  // it is given with `import()`, so both name the same ES module.
  const exportsOf = JSON.parse(
    readFileSync(new URL("../../../../package.json", import.meta.url), "utf8")
  ).exports as Record<string, Record<string, string>>;

  it.each(["./cache-handler", "./cache-handlers"])(
    "%s resolves for a CommonJS next.config, to the module an import gets",
    subpath => {
      expect(exportsOf[subpath]?.default).toBeDefined();
      expect(exportsOf[subpath]?.default).toBe(exportsOf[subpath]?.import);
    }
  );
});
