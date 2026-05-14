import { describe, expect, it, vi } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
import type { ComponentConfig } from "../../components/config/types";
import type { SingleConfig } from "../../singles/config/types";

import { collect, type Registries } from "./collect";
import type { ModuleContributor } from "./define-module";

function makeRegistries(args: {
  collections?: readonly CollectionConfig[];
  singles?: readonly SingleConfig[];
  components?: readonly ComponentConfig[];
}): Registries {
  return {
    collections: {
      getAllCollections: async () => args.collections ?? [],
    },
    singles: {
      getAllSingles: async () => args.singles ?? [],
    },
    components: {
      getAllComponents: async () => args.components ?? [],
    },
  };
}

const PostCollection: CollectionConfig = {
  slug: "posts",
  labels: { singular: "Post" },
  fields: [{ name: "title", type: "text" }],
};

const SiteSingle: SingleConfig = {
  slug: "site",
  labels: { singular: "Site Settings" },
  fields: [{ name: "name", type: "text" }],
};

const HeroComponent: ComponentConfig = {
  slug: "hero",
  fields: [{ name: "headline", type: "text" }],
};

const fakeModule: ModuleContributor = {
  name: "health",
  operations: [],
  schemas: {},
};

describe("collect", () => {
  it("returns empty arrays when nothing is registered", async () => {
    const result = await collect({
      registries: makeRegistries({}),
      modules: [],
    });
    expect(result).toEqual({
      collections: [],
      singles: [],
      components: [],
      modules: [],
    });
  });

  it("forwards collections / singles / components from the registries", async () => {
    const result = await collect({
      registries: makeRegistries({
        collections: [PostCollection],
        singles: [SiteSingle],
        components: [HeroComponent],
      }),
      modules: [],
    });
    expect(result.collections).toEqual([PostCollection]);
    expect(result.singles).toEqual([SiteSingle]);
    expect(result.components).toEqual([HeroComponent]);
  });

  it("passes modules through verbatim", async () => {
    const result = await collect({
      registries: makeRegistries({}),
      modules: [fakeModule],
    });
    expect(result.modules).toEqual([fakeModule]);
  });

  it("calls all three registry getters concurrently (Promise.all)", async () => {
    let collectionsCallStart = 0;
    let singlesCallStart = 0;
    let componentsCallStart = 0;
    const registries: Registries = {
      collections: {
        getAllCollections: async () => {
          collectionsCallStart = performance.now();
          return [];
        },
      },
      singles: {
        getAllSingles: async () => {
          singlesCallStart = performance.now();
          return [];
        },
      },
      components: {
        getAllComponents: async () => {
          componentsCallStart = performance.now();
          return [];
        },
      },
    };
    await collect({ registries, modules: [] });
    // All three should kick off within the same microtask tick.
    const spread = Math.max(
      Math.abs(collectionsCallStart - singlesCallStart),
      Math.abs(singlesCallStart - componentsCallStart)
    );
    expect(spread).toBeLessThan(2);
  });

  it("propagates errors from any registry getter", async () => {
    const boom = new Error("collections registry broken");
    const registries: Registries = {
      collections: {
        getAllCollections: vi.fn(async () => {
          throw boom;
        }),
      },
      singles: { getAllSingles: async () => [] },
      components: { getAllComponents: async () => [] },
    };
    await expect(collect({ registries, modules: [] })).rejects.toBe(boom);
  });

  it("treats the result as readonly (returned arrays are readonly typed)", async () => {
    const result = await collect({
      registries: makeRegistries({ collections: [PostCollection] }),
      modules: [],
    });
    // Type-level: assignability test
    const _check: readonly CollectionConfig[] = result.collections;
    expect(_check).toHaveLength(1);
  });
});
