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
import { publishDeclaredEntities } from "../../dynamic-collections/services/removed-from-code-writes";
import { refreshCollectionSources } from "../collection-sources";
import {
  isKeptOffDashboard,
  keptOffDashboard,
  recordKeptOffDashboard,
} from "../kept-off-dashboard";
import { clearSources, listSources } from "../sources";

function registryHolds(
  rows: Array<{ slug: string; source?: string; admin?: unknown }>
): void {
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
  publishDeclaredEntities(undefined);
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

describe("an entity removed from code", () => {
  /** The running configuration: it declares "posts" alone. */
  const declaresPosts = () =>
    publishDeclaredEntities({ collections: [{ slug: "posts" }], singles: [] });

  it("is kept off: no source, and recorded for every surface that lists from the registry", async () => {
    declaresPosts();
    // "retired" is the app's code's and the configuration no longer declares it: its registry
    // row stayed behind, and its table may be gone. A Builder collection and a plugin's are never
    // in the configuration, so their absence from it leaves them on the dashboard.
    registryHolds([
      { slug: "posts", source: "code" },
      { slug: "retired", source: "code" },
      { slug: "drawn", source: "ui" },
      { slug: "plugged", source: "plugin:acme" },
    ]);
    await refreshCollectionSources();

    expect(
      listSources()
        .map(source => source.id)
        .sort()
    ).toEqual(["collection:drawn", "collection:plugged", "collection:posts"]);
    expect(isKeptOffDashboard("collection", "retired")).toBe(true);
    expect(isKeptOffDashboard("collection", "posts")).toBe(false);
    expect(isKeptOffDashboard("collection", "drawn")).toBe(false);
  });

  it("is kept while no configuration is published, since nothing is known to be removed", async () => {
    registryHolds([
      { slug: "posts", source: "code" },
      { slug: "retired", source: "code" },
    ]);
    await refreshCollectionSources();

    expect(
      listSources()
        .map(source => source.id)
        .sort()
    ).toEqual(["collection:posts", "collection:retired"]);
    expect(isKeptOffDashboard("collection", "retired")).toBe(false);
  });

  it("is judged against the configuration's entities of its own kind", () => {
    // A Single declared under the slug does not keep a collection removed from code.
    publishDeclaredEntities({
      collections: [],
      singles: [{ slug: "retired" }],
    });
    const row = { slug: "retired", source: "code" };

    expect(keptOffDashboard("collection", row)).toBe(true);
    expect(keptOffDashboard("single", row)).toBe(false);
  });
});
