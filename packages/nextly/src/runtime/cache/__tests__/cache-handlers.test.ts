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
});

describe("the handlers' bounded entries", () => {
  it("drops the least recently used once their size passes the bound", () => {
    const entries = new BoundedEntries<string>(10);
    entries.set("a", "a", 4);
    entries.set("b", "b", 4);
    entries.get("a");
    entries.set("c", "c", 4);
    expect(entries.get("b")).toBeUndefined();
    expect(entries.get("a")).toBe("a");
    expect(entries.get("c")).toBe("c");
    expect(entries.bytes).toBe(8);
    entries.set("huge", "x", 11);
    expect(entries.get("huge")).toBeUndefined();
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
