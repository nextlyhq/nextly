/**
 * What the component editor is told about the component it edits.
 *
 * The properties a plausible implementation gets wrong: reading the ids from
 * the wrong field or from the draft instead of the live row, a failed count
 * that takes the live ids down with it, and a malformed stored row that
 * throws where it should answer nothing.
 */
import { describe, expect, it } from "vitest";

import type { RetiredExposures } from "@nextlyhq/blocks-engine";

import {
  componentStoreShape,
  factsQuery,
  liveIdsOf,
  readComponentFacts,
  reconciledRetired,
} from "./component-facts-route";
import { reconcileRetired, type ComponentHistory } from "./retired-history";

const NO_RETIRED = { properties: [], slots: [] };

const row = {
  id: "hero",
  title: "Hero",
  content: {
    formatVersion: 1,
    kind: "component",
    nodes: [],
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "h",
        propPath: "text",
        type: "text",
      },
      { id: "cta", label: "CTA", nodeId: "b", propPath: "href", type: "link" },
    ],
    slots: { body: { label: "Body", nodeId: "box", slot: "children" } },
  },
};

describe("the live ids", () => {
  it("are every field and slot id the live definition holds", () => {
    expect(liveIdsOf(row, "content")).toEqual({
      properties: ["title", "cta"],
      slots: ["body"],
    });
  });

  it("are read from the store's own field", () => {
    expect(liveIdsOf(row, "definition")).toEqual({
      properties: [],
      slots: [],
    });
  });

  it("skip what a hand-written row holds in place of an id", () => {
    expect(
      liveIdsOf(
        { content: { exposed: [null, { id: 4 }, { id: "ok" }], slots: [] } },
        "content"
      )
    ).toEqual({ properties: ["ok"], slots: [] });
    expect(liveIdsOf(null, "content")).toEqual({ properties: [], slots: [] });
  });
});

describe("the answer", () => {
  it("carries the count, and says when it is a floor", async () => {
    const facts = await readComponentFacts("hero", {
      readLive: async () => row,
      countPlacements: async () => ({ documents: 3, complete: false }),
      field: "content",
      readRetired: async () => NO_RETIRED,
    });
    expect(facts).toEqual({
      live: { properties: ["title", "cta"], slots: ["body"] },
      retired: NO_RETIRED,
      reach: { count: 3, complete: false },
      pages: null,
    });
  });

  it("carries the pages a change reaches beside the direct count", async () => {
    const facts = await readComponentFacts("hero", {
      readLive: async () => row,
      countPlacements: async () => ({ documents: 1, complete: true }),
      countPages: async () => ({ documents: 4, complete: true }),
      field: "content",
      readRetired: async () => NO_RETIRED,
    });
    expect(facts.reach).toEqual({ count: 1, complete: true });
    expect(facts.pages).toEqual({ count: 4, complete: true });
  });

  it("keeps the rest of the answer when the page count fails", async () => {
    const facts = await readComponentFacts("hero", {
      readLive: async () => row,
      countPlacements: async () => ({ documents: 1, complete: true }),
      countPages: async () => {
        throw new Error("the Layouts are unavailable");
      },
      field: "content",
      readRetired: async () => NO_RETIRED,
    });
    expect(facts.pages).toBeNull();
    expect(facts.reach).toEqual({ count: 1, complete: true });
  });

  it("keeps the live ids when the count fails", async () => {
    const facts = await readComponentFacts("hero", {
      readLive: async () => row,
      countPlacements: async () => {
        throw new Error("the index is unavailable");
      },
      field: "content",
      readRetired: async () => NO_RETIRED,
    });
    expect(facts.live.properties).toEqual(["title", "cta"]);
    expect(facts.reach).toBeNull();
  });

  it("asks the live read for the component named", async () => {
    const asked: string[] = [];
    await readComponentFacts("hero", {
      readLive: async id => {
        asked.push(id);
        return null;
      },
      countPlacements: async () => ({ documents: 0, complete: true }),
      field: "content",
      readRetired: async () => NO_RETIRED,
    });
    expect(asked).toEqual(["hero"]);
  });
});

describe("a component the caller may not read", () => {
  it("is not counted, so its use is not revealed", async () => {
    let counted = 0;
    const facts = await readComponentFacts("secret", {
      readLive: async () => null,
      countPlacements: async () => {
        counted += 1;
        return { documents: 40, complete: true };
      },
      countPages: async () => {
        counted += 1;
        return { documents: 40, complete: true };
      },
      field: "content",
      readRetired: async () => NO_RETIRED,
    });
    expect(facts).toEqual({
      live: NO_RETIRED,
      retired: NO_RETIRED,
      reach: null,
      pages: null,
    });
    expect(counted).toBe(0);
  });
});

describe("the query", () => {
  const at = (query: string) => `http://admin.test/component-facts?${query}`;

  it("names the component, and the language when there is one", () => {
    expect(factsQuery(at("id=hero"))).toEqual({
      id: "hero",
      locale: undefined,
    });
    expect(factsQuery(at("id=hero&locale=de"))).toEqual({
      id: "hero",
      locale: "de",
    });
    expect(factsQuery(at("id=hero&locale="))).toEqual({
      id: "hero",
      locale: undefined,
    });
  });

  it("is refused without an id, or with one past its bound", () => {
    expect(() => factsQuery(at(""))).toThrow();
    expect(() => factsQuery(at("id=%20%20"))).toThrow();
    expect(() => factsQuery(at(`id=${"x".repeat(257)}`))).toThrow();
  });
});

describe("the retired ids", () => {
  it("travel beside the live ones, so a published removal's id stays reserved", async () => {
    const facts = await readComponentFacts("hero", {
      readLive: async () => row,
      countPlacements: async () => ({ documents: 1, complete: true }),
      field: "content",
      readRetired: async () => ({ properties: ["subtitle"], slots: ["aside"] }),
    });
    expect(facts.retired).toEqual({
      properties: ["subtitle"],
      slots: ["aside"],
    });
  });

  it("fail the answer when they cannot be read, so the editor waits", async () => {
    await expect(
      readComponentFacts("hero", {
        readLive: async () => row,
        countPlacements: async () => ({ documents: 1, complete: true }),
        field: "content",
        readRetired: async () => {
          throw new Error("the table is unavailable");
        },
      })
    ).rejects.toThrow("the table is unavailable");
  });
});

describe("a store that records no retirements", () => {
  it("answers null for them, so the editor adds no field", async () => {
    const facts = await readComponentFacts("hero", {
      readLive: async () => row,
      countPlacements: async () => ({ documents: 1, complete: true }),
      field: "content",
      readRetired: async () => null,
    });
    expect(facts.retired).toBeNull();
    expect(facts.live.properties).toEqual(["title", "cta"]);
  });
});

describe("whether the store is localized", () => {
  it("is read from the store's own configuration, as the request's user", async () => {
    const asked: Array<[string, unknown]> = [];
    const collections = {
      getCollection: async (name: string, context: unknown) => {
        asked.push([name, context]);
        return { slug: name, localized: name === "translated" };
      },
    };
    expect(
      (await componentStoreShape(collections, "translated", { id: "u1" }))
        .localized
    ).toBe(true);
    expect(
      (await componentStoreShape(collections, "components", null)).localized
    ).toBe(false);
    expect(asked[0]).toEqual(["translated", { user: { id: "u1" } }]);
  });
});

describe("the retired ids, reconciled with history", () => {
  /** Two published definitions: the first exposes `subtitle`, the newest not. */
  const history: ComponentHistory = {
    list: async (_ref, { cursor }) =>
      cursor === undefined
        ? [
            { versionNo: 2, status: "published" },
            { versionNo: 1, status: "published" },
          ]
        : [],
    get: async (_ref, versionNo) => ({
      snapshot: {
        content: {
          ...row.content,
          exposed:
            versionNo === 1
              ? [
                  ...row.content.exposed,
                  {
                    id: "subtitle",
                    label: "Subtitle",
                    nodeId: "h",
                    propPath: "text",
                    type: "text",
                  },
                ]
              : row.content.exposed,
        },
      },
    }),
  };

  it("answer an id whose record was lost, and record it", async () => {
    const recorded: RetiredExposures[] = [];
    const facts = await readComponentFacts("hero", {
      readLive: async () => row,
      countPlacements: async () => ({ documents: 1, complete: true }),
      field: "content",
      readRetired: reconciledRetired({
        shape: async () => ({ localized: false, lifecycle: true }),
        reconcile: (id, lifecycle) =>
          reconcileRetired(
            {
              history,
              componentCollection: "nx_pb_components",
              componentField: "content",
              lifecycle,
              store: {
                of: async () => new Map(),
                retire: async (_id, retired) => {
                  recorded.push(retired);
                },
              },
              logger: { warn: () => {}, error: () => {} },
            },
            id
          ),
      }),
    });

    expect(facts.retired).toEqual({ properties: ["subtitle"], slots: [] });
    expect(recorded).toEqual([{ properties: ["subtitle"], slots: [] }]);
  });

  it("pass the store's lifecycle on, and are null for a localized store", async () => {
    const asked: boolean[] = [];
    const reconcile = async (_id: string, lifecycle: boolean) => {
      asked.push(lifecycle);
      return { properties: [], slots: [] };
    };

    await reconciledRetired({
      shape: async () => ({ localized: false, lifecycle: false }),
      reconcile,
    })("hero");
    const localized = await reconciledRetired({
      shape: async () => ({ localized: true, lifecycle: true }),
      reconcile,
    })("hero");

    expect(asked).toEqual([false]);
    expect(localized).toBeNull();
  });
});

describe("the store's shape", () => {
  it("says whether it is localized and has the publishing lifecycle", async () => {
    const collections = {
      getCollection: async (name: string) =>
        name === "plain" ? { slug: name } : { slug: name, status: true },
    };
    expect(await componentStoreShape(collections, "plain", null)).toEqual({
      localized: false,
      lifecycle: false,
    });
    expect(await componentStoreShape(collections, "drafts", null)).toEqual({
      localized: false,
      lifecycle: true,
    });
  });
});
