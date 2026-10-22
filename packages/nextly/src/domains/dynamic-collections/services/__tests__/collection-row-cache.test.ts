/**
 * The collection row cache: a row is read once and served, as a copy, for its
 * lifetime; a clear, the end of the lifetime, or another database means a
 * fresh read; and a read a clear overtakes is never served again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cachedCollectionRow,
  clearCollectionRowCache,
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
  clearCollectionRowCache();
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
    clearCollectionRowCache();

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
    // The row changes, and the change clears, while the read is under way.
    stored.value = { slug: "posts", fields: ["title", "body"] };
    clearCollectionRowCache();
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
