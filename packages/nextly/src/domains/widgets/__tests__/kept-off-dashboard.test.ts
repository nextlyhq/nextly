/**
 * What the dashboard keeps off is recorded from the same refresh that publishes the sources, and
 * only once that refresh has published them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The registry is reached through the DI container, as in `collection-sources.test.ts`.
vi.mock("../../../di/container", () => ({ container: { get: vi.fn() } }));

// The real source registration, with a switch that makes the next one refuse, as it does for a
// registry row it cannot turn into a source.
const { refuseNext } = vi.hoisted(() => ({ refuseNext: { value: false } }));
vi.mock("../built-in-sources", async importOriginal => {
  const actual = await importOriginal<typeof import("../built-in-sources")>();
  return {
    ...actual,
    registerBuiltInSources: (
      ...args: Parameters<typeof actual.registerBuiltInSources>
    ) => {
      if (refuseNext.value) {
        refuseNext.value = false;
        throw new Error("a registry row could not become a source");
      }
      return actual.registerBuiltInSources(...args);
    },
  };
});

import { container } from "../../../di/container";
import { setNextlyLogger } from "../../../observability/logger";
import { refreshCollectionSources } from "../collection-sources";
import {
  isKeptOffDashboard,
  recordKeptOffDashboard,
} from "../kept-off-dashboard";
import { clearSources, listSources } from "../sources";

function registryHolds(rows: Array<{ slug: string; admin?: unknown }>): void {
  vi.mocked(container.get).mockImplementation((name: string) => {
    if (name === "collectionRegistryService") {
      return {
        getAllCollections: async () =>
          rows.map(row => ({
            ...row,
            fields: [{ name: "title", type: "text" }],
          })),
      };
    }
    throw new Error(`unexpected container.get("${name}") in this test`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearSources();
  recordKeptOffDashboard("collection", []);
  setNextlyLogger({
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
  });
});

afterEach(() => {
  refuseNext.value = false;
  recordKeptOffDashboard("collection", []);
});

describe("the kept-off record and the sources describe one refresh", () => {
  it("keeps the previous record when a refresh fails to publish its sources", async () => {
    // A refresh that publishes: "secret" is hidden and gets no source.
    registryHolds([
      { slug: "posts" },
      { slug: "secret", admin: { hidden: true } },
    ]);
    await refreshCollectionSources();
    expect(isKeptOffDashboard("collection", "secret")).toBe(true);
    expect(listSources().map(source => source.id)).toEqual([
      "collection:posts",
    ]);

    // The next registry read hides "posts" instead, and its sources are refused: the previous
    // sources stand, so the record must stand too -- or "posts" would still have a source while
    // every other surface left it out.
    registryHolds([
      { slug: "posts", admin: { hidden: true } },
      { slug: "secret" },
    ]);
    refuseNext.value = true;
    await refreshCollectionSources().catch(() => undefined);

    expect(listSources().map(source => source.id)).toEqual([
      "collection:posts",
    ]);
    expect(isKeptOffDashboard("collection", "posts")).toBe(false);
    expect(isKeptOffDashboard("collection", "secret")).toBe(true);
  });
});
