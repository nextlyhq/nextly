/**
 * A cached Single read is keyed by every input that decides what it returns.
 *
 * The locale was already in the key for that reason. `trustedCollections` joined
 * it the moment a trust bound started deciding which RELATED rows come back: two
 * routes may mount the same Single in the same language with different bounds,
 * and a key that cannot tell them apart lets the more-trusted one warm the cache
 * and serve its populated restricted rows to the other — which never runs its
 * own bound at all.
 *
 * Only the PUBLIC factory reaches the cache. An enforced read and a granted
 * draft read are both per-visitor and marked dynamic, so neither is cached and
 * neither can leak this way.
 */
import { describe, expect, it, vi } from "vitest";

/** Options the route hands the cache, as the real `cachedFind` receives them. */
interface CacheOptions {
  keyParts: unknown[];
  tags?: string[];
}

const { cachedFind } = vi.hoisted(() => ({
  cachedFind: vi.fn(
    async (reader: () => Promise<unknown>, _options: { keyParts: unknown[] }) =>
      reader()
  ),
}));

vi.mock("../../cache/cached-find", () => ({ cachedFind }));

const { createPublicSingleRoute } = await import("../single-route");

const HOME = { title: "Home" };

/** The `keyParts` the route handed the cache for one configuration. */
async function keyFor(config: Record<string, unknown>): Promise<unknown[]> {
  cachedFind.mockClear();
  const reader = {
    findSingle: async () => HOME,
  } as unknown as Parameters<typeof createPublicSingleRoute>[0]["nextly"];

  const { generateMetadata } = createPublicSingleRoute({
    slug: "homepage",
    nextly: reader,
    render: () => "rendered",
    buildMetadata: () => ({ title: "Home" }),
    ...config,
  } as Parameters<typeof createPublicSingleRoute>[0]);

  await generateMetadata();

  expect(cachedFind, "the cache was never consulted").toHaveBeenCalled();
  const [, options] = cachedFind.mock.calls[0] as unknown as [
    unknown,
    CacheOptions,
  ];
  return options.keyParts;
}

describe("what a cached Single read is keyed by", () => {
  // The positive control: without it the comparisons below cannot tell a key
  // that omits the bound from a route that never reached the cache.
  it("keys by the single and its locale", async () => {
    const key = await keyFor({ locale: "en" });

    expect(key).toContain("homepage");
    expect(key).toContain("en");
  });

  it("separates two routes whose trust bounds differ", async () => {
    const narrow = await keyFor({ locale: "en", trustedCollections: [] });
    const wide = await keyFor({
      locale: "en",
      trustedCollections: ["posts"],
    });

    expect(narrow).not.toEqual(wide);
  });

  // Stated as its own case because "different keys" is satisfied by a key that
  // differs for the wrong reason — a counter, a timestamp, an object identity.
  // The bound has to be IN the key, not merely correlated with it.
  it("names the trusted collections in the key", async () => {
    const key = await keyFor({
      locale: "en",
      trustedCollections: ["posts", "authors"],
    });

    expect(key.join("|")).toContain("authors");
    expect(key.join("|")).toContain("posts");
  });

  // The negative control. Two routes stating the same trust in a different
  // order are the same policy, and warming two cache entries for one policy
  // would be a slow correctness-neutral regression nobody would notice.
  it("treats the same trust set in a different order as one policy", async () => {
    const first = await keyFor({
      locale: "en",
      trustedCollections: ["posts", "authors"],
    });
    const second = await keyFor({
      locale: "en",
      trustedCollections: ["authors", "posts"],
    });

    expect(first).toEqual(second);
  });
});
