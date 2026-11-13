/**
 * The collection row cache: a row is read once and served, as a copy, while
 * the database's stored count of registry writes stays where it was when the
 * read began, however long that is, and read again once that count moves; a
 * clear or another database means a fresh read; and a read a clear or a moved
 * count overtakes is never served again. Where the count cannot be read (a
 * database handle that is not an adapter, a read that fails), a row is served
 * for its lifetime, as before the count was followed. One listing per registry
 * table is kept the same way, and serves every view derived from it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  markSchemaChanged,
  SCHEMA_VERSION_READ_INTERVAL_MS,
  storedSchemaSeq,
} from "../../../schema/stored-schema-seq";
import {
  cachedCollectionRow,
  cachedRegistryListing,
  cachedRegistryRow,
  clearRegistryRowCache,
  COLLECTION_ROW_LIFETIME_MS,
} from "../collection-row-cache";

/** A database's reader that counts its reads and answers `row`'s current value. */
function readerOf(row: { value: Record<string, unknown> }) {
  const read = vi.fn(async () => structuredClone(row.value));
  return read;
}

beforeEach(() => {
  // The lifetime is timed with `performance.now()`; only that clock is faked.
  vi.useFakeTimers({ toFake: ["performance"] });
  clearRegistryRowCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the collection row cache", () => {
  it("reads a slug once and serves it again within its lifetime", async () => {
    const database = {};
    const stored = { value: { slug: "posts", labels: { singular: "Post" } } };
    const read = readerOf(stored);

    await cachedCollectionRow(database, "posts", read);
    // Changed where this process cannot see: the cached row is still served.
    stored.value = { slug: "posts", labels: { singular: "Article" } };
    vi.advanceTimersByTime(COLLECTION_ROW_LIFETIME_MS - 1);

    await expect(cachedCollectionRow(database, "posts", read)).resolves.toEqual(
      { slug: "posts", labels: { singular: "Post" } }
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads again once the lifetime is up, and serves the change", async () => {
    const database = {};
    const stored = { value: { slug: "posts", labels: { singular: "Post" } } };
    const read = readerOf(stored);

    await cachedCollectionRow(database, "posts", read);
    stored.value = { slug: "posts", labels: { singular: "Article" } };
    vi.advanceTimersByTime(COLLECTION_ROW_LIFETIME_MS);

    await expect(cachedCollectionRow(database, "posts", read)).resolves.toEqual(
      { slug: "posts", labels: { singular: "Article" } }
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads again after a clear, whatever the time", async () => {
    const database = {};
    const stored = { value: { slug: "posts", fields: ["title"] } };
    const read = readerOf(stored);

    await cachedCollectionRow(database, "posts", read);
    stored.value = { slug: "posts", fields: ["title", "body"] };
    clearRegistryRowCache();

    await expect(cachedCollectionRow(database, "posts", read)).resolves.toEqual(
      { slug: "posts", fields: ["title", "body"] }
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("hands each caller its own copy, down to nested values", async () => {
    const database = {};
    const read = readerOf({
      value: { slug: "posts", fields: [{ name: "title" }] },
    });

    const first = await cachedCollectionRow(database, "posts", read);
    (first.fields as Array<{ name: string }>)[0]!.name = "changed";
    (first.fields as unknown[]).push({ name: "extra" });
    const second = await cachedCollectionRow(database, "posts", read);
    (second.fields as Array<{ name: string }>)[0]!.name = "changed again";

    await expect(cachedCollectionRow(database, "posts", read)).resolves.toEqual(
      { slug: "posts", fields: [{ name: "title" }] }
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  // A register committing a moment after a read that found nothing must be seen at once, however
  // its clear and its commit fall around that read.
  it("keeps no missing row: a slug the registry does not hold is read again", async () => {
    const database = {};
    const stored: { value: Record<string, unknown> | null } = { value: null };
    const read = vi.fn(async () => structuredClone(stored.value));

    await expect(
      cachedRegistryRow(database, "dynamic_singles", "promo", read)
    ).resolves.toBeNull();
    stored.value = { slug: "promo" };

    await expect(
      cachedRegistryRow(database, "dynamic_singles", "promo", read)
    ).resolves.toEqual({ slug: "promo" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps a table's rows apart from another table's of the same slug", async () => {
    const database = {};
    await cachedRegistryRow(database, "dynamic_singles", "promo", async () => ({
      kind: "single",
    }));

    await expect(
      cachedRegistryRow(database, "dynamic_components", "promo", async () => ({
        kind: "component",
      }))
    ).resolves.toEqual({ kind: "component" });
  });

  it("keeps each database's rows apart", async () => {
    const one = readerOf({ value: { slug: "posts", tableName: "dc_one" } });
    const two = readerOf({ value: { slug: "posts", tableName: "dc_two" } });

    await cachedCollectionRow({}, "posts", one);
    const other = {};
    await expect(cachedCollectionRow(other, "posts", two)).resolves.toEqual({
      slug: "posts",
      tableName: "dc_two",
    });
    expect(two).toHaveBeenCalledTimes(1);
  });

  it("answers a read a clear overtook, but never serves its row again", async () => {
    const database = {};
    const stored = { value: { slug: "posts", fields: ["title"] } };
    let release: (() => void) | undefined;
    const slow = vi.fn(async () => {
      const before = structuredClone(stored.value);
      await new Promise<void>(resolve => {
        release = resolve;
      });
      return before;
    });

    const pending = cachedCollectionRow(database, "posts", slow);
    // The read begins once the stored count has been asked for.
    await vi.waitFor(() => expect(release).toBeDefined());
    // The row changes, and the change clears, while the read is under way.
    stored.value = { slug: "posts", fields: ["title", "body"] };
    clearRegistryRowCache();
    release?.();
    await expect(pending).resolves.toEqual({
      slug: "posts",
      fields: ["title"],
    });

    const read = readerOf(stored);
    await expect(cachedCollectionRow(database, "posts", read)).resolves.toEqual(
      { slug: "posts", fields: ["title", "body"] }
    );
    expect(read).toHaveBeenCalledTimes(1);
  });
});

/**
 * A database handle whose stored schema version reads `seq` (or fails, where
 * `fails` says so) through the real reader, counting its reads: the one
 * statement it sends, `select … from … where … limit`.
 */
function versionedDatabase(start = 1) {
  const version = { seq: start, reads: 0, fails: false };
  const drizzle = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            version.reads += 1;
            if (version.fails) throw new Error("no such table: nextly_meta");
            return [
              { value: JSON.stringify({ migration: null, seq: version.seq }) },
            ];
          },
        }),
      }),
    }),
  };
  const database = {
    getDrizzle: () => drizzle,
    getCapabilities: () => ({ dialect: "sqlite" }),
  };
  return { database, version };
}

/**
 * {@link versionedDatabase}, its count read once already, as the served
 * schema version reads it on a server's first request: the cache follows a
 * count only once the process has read it.
 */
async function followedDatabase(start = 1, fails = false) {
  const made = versionedDatabase(start);
  made.version.fails = fails;
  await storedSchemaSeq(made.database, { fresh: true });
  return made;
}

describe("the registry row cache, following the stored count of registry writes", () => {
  it("serves a row long past its lifetime while the count stays, reading only the count", async () => {
    const { database, version } = await followedDatabase();
    const stored = { value: { slug: "posts", labels: { singular: "Post" } } };
    const read = readerOf(stored);

    await cachedCollectionRow(database, "posts", read);
    // Changed without moving the count: nothing says the registry changed.
    stored.value = { slug: "posts", labels: { singular: "Article" } };
    vi.advanceTimersByTime(COLLECTION_ROW_LIFETIME_MS * 10);

    await expect(cachedCollectionRow(database, "posts", read)).resolves.toEqual(
      { slug: "posts", labels: { singular: "Post" } }
    );
    expect(read).toHaveBeenCalledTimes(1);
    // The count was read again once its own read was older than the interval.
    expect(version.reads).toBe(2);
  });

  it("reads a row again once the count moves, seen when the count is next read and not before", async () => {
    const { database, version } = await followedDatabase();
    const stored = { value: { slug: "posts", labels: { singular: "Post" } } };
    const read = readerOf(stored);

    await cachedCollectionRow(database, "posts", read);
    // Another copy of the app changes the row and moves the count.
    stored.value = { slug: "posts", labels: { singular: "Article" } };
    version.seq += 1;

    vi.advanceTimersByTime(SCHEMA_VERSION_READ_INTERVAL_MS - 1);
    await expect(cachedCollectionRow(database, "posts", read)).resolves.toEqual(
      { slug: "posts", labels: { singular: "Post" } }
    );
    vi.advanceTimersByTime(1);
    await expect(cachedCollectionRow(database, "posts", read)).resolves.toEqual(
      { slug: "posts", labels: { singular: "Article" } }
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads the count again at once after a change marked in this process", async () => {
    const { database, version } = await followedDatabase();
    const stored = { value: { slug: "posts", labels: { singular: "Post" } } };
    const read = readerOf(stored);

    await cachedCollectionRow(database, "posts", read);
    stored.value = { slug: "posts", labels: { singular: "Article" } };
    version.seq += 1;
    markSchemaChanged();

    await expect(cachedCollectionRow(database, "posts", read)).resolves.toEqual(
      { slug: "posts", labels: { singular: "Article" } }
    );
    expect(version.reads).toBe(2);
  });

  it("reads no count this process has not read, and keeps the lifetime meanwhile", async () => {
    const { database, version } = versionedDatabase();
    const stored = { value: { slug: "posts", labels: { singular: "Post" } } };
    const read = readerOf(stored);

    await cachedCollectionRow(database, "posts", read);
    stored.value = { slug: "posts", labels: { singular: "Article" } };
    vi.advanceTimersByTime(COLLECTION_ROW_LIFETIME_MS);

    await expect(cachedCollectionRow(database, "posts", read)).resolves.toEqual(
      { slug: "posts", labels: { singular: "Article" } }
    );
    expect(version.reads).toBe(0);
  });

  it("keeps the lifetime where the count cannot be read", async () => {
    const { database, version } = await followedDatabase(1, true);
    const stored = { value: { slug: "posts", labels: { singular: "Post" } } };
    const read = readerOf(stored);

    await cachedCollectionRow(database, "posts", read);
    stored.value = { slug: "posts", labels: { singular: "Article" } };
    vi.advanceTimersByTime(COLLECTION_ROW_LIFETIME_MS);

    await expect(cachedCollectionRow(database, "posts", read)).resolves.toEqual(
      { slug: "posts", labels: { singular: "Article" } }
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps one listing per table, handed to each view, until the count moves", async () => {
    const { database, version } = await followedDatabase();
    const listing = {
      value: [
        { slug: "posts", labels: { singular: "Post" } },
        { slug: "pages", labels: { singular: "Page" } },
      ] as Record<string, unknown>[],
    };
    const read = vi.fn(async () => structuredClone(listing.value));
    const slugs = (rows: readonly Readonly<Record<string, unknown>>[]) =>
      rows.map(row => String(row.slug));

    await expect(
      cachedRegistryListing(database, "dynamic_collections", read, slugs)
    ).resolves.toEqual(["posts", "pages"]);
    listing.value = [{ slug: "posts", labels: { singular: "Post" } }];
    vi.advanceTimersByTime(COLLECTION_ROW_LIFETIME_MS * 10);
    // Another view of the same listing: no read.
    await expect(
      cachedRegistryListing(
        database,
        "dynamic_collections",
        read,
        rows => rows.length
      )
    ).resolves.toBe(2);
    expect(read).toHaveBeenCalledTimes(1);

    version.seq += 1;
    vi.advanceTimersByTime(SCHEMA_VERSION_READ_INTERVAL_MS);
    await expect(
      cachedRegistryListing(database, "dynamic_collections", read, slugs)
    ).resolves.toEqual(["posts"]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps a table's listing apart from its rows", async () => {
    const { database } = await followedDatabase();
    const row = vi.fn(async () => ({ slug: "posts" }));
    const listing = vi.fn(async () => [{ slug: "posts" }]);

    await cachedRegistryRow(database, "dynamic_collections", "posts", row);
    await expect(
      cachedRegistryListing(database, "dynamic_collections", listing, rows =>
        rows.map(r => r.slug)
      )
    ).resolves.toEqual(["posts"]);
    expect(listing).toHaveBeenCalledTimes(1);
  });
});
