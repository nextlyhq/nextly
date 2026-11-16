/**
 * A cached read that misses reads the site's languages afresh before it runs. Another instance may
 * have changed them and flushed the cache a moment ago, while this one still trusts the list it
 * read within its interval; rendering on that list would cache the former default language until
 * the next content write. A hit runs nothing, and a failed language read never blocks the read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { registry } = vi.hoisted(() => ({
  registry: {
    refresh: vi.fn<(options?: { force?: boolean }) => Promise<void>>(),
  },
}));

vi.mock("../../../di/container", () => ({
  container: {
    has: (name: string) => name === "languageRegistry",
    get: () => registry,
  },
}));

import { applyCache, type UnstableCache } from "../cached-find";

/** A cache that never holds the entry, so every call runs the reader. */
const missing: UnstableCache = cb => () => cb();
/** A cache that always holds `value`, so the reader never runs. */
const holding =
  (value: unknown): UnstableCache =>
  <T>() =>
  () =>
    Promise.resolve(value as T);

const options = { tags: ["nextly:posts"], keyParts: ["posts"] };

describe("a cached read and the site's languages", () => {
  beforeEach(() => {
    registry.refresh.mockReset();
    registry.refresh.mockResolvedValue(undefined);
  });

  it("reads the languages afresh, then runs the reader, on a miss", async () => {
    const order: string[] = [];
    registry.refresh.mockImplementation(() => {
      order.push("languages");
      return Promise.resolve();
    });

    const value = await applyCache(
      missing,
      () => {
        order.push("reader");
        return Promise.resolve("fresh");
      },
      options
    );

    expect(value).toBe("fresh");
    expect(registry.refresh).toHaveBeenCalledWith({ force: true });
    expect(order).toEqual(["languages", "reader"]);
  });

  it("reads nothing on a hit", async () => {
    const reader = vi.fn(() => Promise.resolve("fresh"));

    expect(await applyCache(holding("cached"), reader, options)).toBe("cached");
    expect(registry.refresh).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
  });

  it("still runs the reader when the languages cannot be read", async () => {
    registry.refresh.mockRejectedValue(new Error("database unreachable"));

    expect(
      await applyCache(missing, () => Promise.resolve("fresh"), options)
    ).toBe("fresh");
  });
});
