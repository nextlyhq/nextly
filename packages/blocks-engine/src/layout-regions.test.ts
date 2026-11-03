import { describe, expect, it } from "vitest";

import { COMPONENT_INSTANCE_TYPE } from "./document";
import { layoutRelationId, regionDocument, regionsOf } from "./layout-regions";

describe("regionsOf", () => {
  it("reads the areas in drawing order, header first, whatever order they are stored in", () => {
    expect(
      regionsOf({
        areas: [
          { area: "footer", component: "f" },
          { area: "header", component: { id: "h", title: "Header" } },
        ],
      })
    ).toEqual([
      { area: "header", componentId: "h" },
      { area: "footer", componentId: "f" },
    ]);
  });

  it("skips a row with no component, an unknown area and a malformed value", () => {
    expect(regionsOf({ areas: [{ area: "header" }] })).toEqual([]);
    expect(regionsOf({ areas: [{ area: "sidebar", component: "s" }] })).toEqual(
      []
    );
    expect(regionsOf({ areas: "header" })).toEqual([]);
    expect(regionsOf(undefined)).toEqual([]);
  });

  it("takes the first row for an area", () => {
    expect(
      regionsOf({
        areas: [
          { area: "header", component: "first" },
          { area: "header", component: "second" },
        ],
      })
    ).toEqual([{ area: "header", componentId: "first" }]);
  });
});

describe("regionDocument", () => {
  it("holds one component instance per region, under an id fixed by its area", () => {
    const document = regionDocument([
      { area: "header", componentId: "h" },
      { area: "footer", componentId: "f" },
    ]);
    expect(document.nodes).toEqual([
      {
        id: "nextly-region-header",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId: "h" },
      },
      {
        id: "nextly-region-footer",
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId: "f" },
      },
    ]);
  });
});

describe("layoutRelationId", () => {
  it("reads an id, a populated row, and nothing", () => {
    expect(layoutRelationId("a")).toBe("a");
    expect(layoutRelationId({ id: "b" })).toBe("b");
    expect(layoutRelationId("  ")).toBeNull();
    expect(layoutRelationId(null)).toBeNull();
  });
});
