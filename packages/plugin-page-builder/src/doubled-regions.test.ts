import {
  COLLECTION_LIST_TYPE,
  COMPONENT_INSTANCE_TYPE,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { doubledRegions, doubledRegionsKey } from "./doubled-regions";

function node(
  id: string,
  type: string,
  props: Record<string, unknown> = {},
  children?: BlockNode[]
): BlockNode {
  return {
    id,
    type,
    version: 1,
    props,
    ...(children === undefined ? {} : { slots: { children } }),
  };
}

const section = (id: string, as: string, children?: BlockNode[]) =>
  node(id, "core/section", { as }, children);
const placed = (id: string, componentId: string) =>
  node(id, COMPONENT_INSTANCE_TYPE, { componentId });

const areas: Record<string, "header" | "footer"> = {
  "c-head": "header",
  "c-foot": "footer",
};
const areaOf = (id: string) => areas[id];
const both = new Set(["header", "footer"] as const);

describe("doubledRegions", () => {
  it("finds a Section whose HTML tag is header while the set shows a header", () => {
    const found = doubledRegions(
      [section("s1", "header"), section("s2", "section")],
      { shown: both, componentArea: areaOf }
    );
    expect(found).toEqual([{ area: "header", nodeIds: ["s1"] }]);
  });

  it("finds a header block at any depth, in a Box or another Section", () => {
    const found = doubledRegions(
      [
        node("box", "core/box", { as: "div" }, [
          section("outer", "section", [section("deep", "header")]),
        ]),
      ],
      { shown: both, componentArea: areaOf }
    );
    expect(found).toEqual([{ area: "header", nodeIds: ["deep"] }]);
  });

  it("finds a placed component marked to be used as the header", () => {
    const found = doubledRegions([placed("p1", "c-head")], {
      shown: both,
      componentArea: areaOf,
    });
    expect(found).toEqual([{ area: "header", nodeIds: ["p1"] }]);
  });

  it("finds footers the same way, header first", () => {
    const found = doubledRegions(
      [
        section("f1", "footer"),
        placed("p2", "c-foot"),
        section("h1", "header"),
      ],
      { shown: both, componentArea: areaOf }
    );
    expect(found).toEqual([
      { area: "header", nodeIds: ["h1"] },
      { area: "footer", nodeIds: ["f1", "p2"] },
    ]);
  });

  it("leaves out an area the page's set does not show", () => {
    const found = doubledRegions(
      [section("h1", "header"), section("f1", "footer")],
      { shown: new Set(["footer"] as const), componentArea: areaOf }
    );
    expect(found).toEqual([{ area: "footer", nodeIds: ["f1"] }]);
  });

  it("finds nothing when the set shows neither area", () => {
    const found = doubledRegions([section("h1", "header")], {
      shown: new Set(),
      componentArea: areaOf,
    });
    expect(found).toEqual([]);
  });

  it("does not look inside a Collection list, whose items repeat per entry", () => {
    const found = doubledRegions(
      [node("list", COLLECTION_LIST_TYPE, {}, [section("item", "header")])],
      { shown: both, componentArea: areaOf }
    );
    expect(found).toEqual([]);
  });

  it("ignores a placed component with no area and an unknown component", () => {
    const found = doubledRegions(
      [placed("p1", "c-plain"), placed("p2", "c-missing")],
      {
        shown: both,
        componentArea: id => (id === "c-plain" ? undefined : areaOf(id)),
      }
    );
    expect(found).toEqual([]);
  });

  it("does not look inside a placed component's own slots", () => {
    const instance = {
      ...placed("p1", "c-plain"),
      slots: { children: [section("inner", "header")] },
    };
    const found = doubledRegions([instance], {
      shown: both,
      componentArea: areaOf,
    });
    expect(found).toEqual([]);
  });

  it("skips entries that are not nodes, as stored data may hold", () => {
    const found = doubledRegions(
      [null, 7, section("h1", "header")] as unknown as BlockNode[],
      { shown: both, componentArea: areaOf }
    );
    expect(found).toEqual([{ area: "header", nodeIds: ["h1"] }]);
  });
});

describe("doubledRegionsKey", () => {
  const header = (nodeIds: string[]) => ({ area: "header" as const, nodeIds });

  it("is the same for the same page, set, area and blocks in any order", () => {
    expect(doubledRegionsKey("page-1", "set-1", header(["a", "b"]))).toBe(
      doubledRegionsKey("page-1", "set-1", header(["b", "a"]))
    );
  });

  it("changes when the page, the set, the area or the blocks change", () => {
    const base = doubledRegionsKey("page-1", "set-1", header(["a"]));
    expect(doubledRegionsKey("page-2", "set-1", header(["a"]))).not.toBe(base);
    expect(doubledRegionsKey("page-1", "set-2", header(["a"]))).not.toBe(base);
    expect(
      doubledRegionsKey("page-1", "set-1", { area: "footer", nodeIds: ["a"] })
    ).not.toBe(base);
    expect(doubledRegionsKey("page-1", "set-1", header(["a", "c"]))).not.toBe(
      base
    );
  });
});
