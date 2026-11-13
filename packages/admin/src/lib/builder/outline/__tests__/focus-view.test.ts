import { describe, expect, it } from "vitest";

import {
  nestedFixtureBlockCatalogs,
  nestedFixtureFieldGroups,
  nestedFixtureFields,
} from "@admin/components/features/schema-builder/__fixtures__/nested-fixture";

import {
  canFocus,
  focusFallback,
  focusHolding,
  focusView,
} from "../focus-view";
import {
  buildOutline,
  flattenOutline,
  visibleRows,
  type OutlineNode,
} from "../outline-model";

const typeLabel = (type: string) => type;

function outline(): OutlineNode[] {
  return buildOutline(nestedFixtureFields(), {
    entityReadOnly: false,
    fieldGroups: nestedFixtureFieldGroups(),
    blockCatalogs: nestedFixtureBlockCatalogs(),
  });
}

function node(nodes: OutlineNode[], id: string): OutlineNode {
  const found = flattenOutline(nodes).find(each => each.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
}

describe("focusView", () => {
  it("draws every row from level 1 when nothing is focused", () => {
    const nodes = outline();
    const view = focusView(nodes, null);
    expect(view.focused).toBeNull();
    expect(view.crumbs).toEqual([]);
    expect(view.nodes).toBe(nodes);
    expect(view.rootLevel).toBe(1);
  });

  it("draws only a container three deep, under crumbs from the top", () => {
    const nodes = outline();
    const view = focusView(nodes, "f-items-cta");
    expect(view.focused?.id).toBe("f-items-cta");
    expect(view.crumbs.map(crumb => crumb.path)).toEqual([
      "sections",
      "sections/items",
      "sections/items/cta",
    ]);
    expect(view.nodes.map(each => each.path)).toEqual([
      "sections/items/cta/label",
      "sections/items/cta/kind",
    ]);
    // Its own fields are the first level drawn.
    const rows = visibleRows(
      view.nodes,
      new Set(),
      "",
      typeLabel,
      view.rootLevel
    );
    expect(rows.map(row => row.level)).toEqual([1, 1]);
  });

  it("finds only inside the focused container", () => {
    const nodes = outline();
    const view = focusView(nodes, "f-items-cta");
    // "heading" is a field of Sections, outside the focus.
    expect(
      visibleRows(view.nodes, new Set(), "heading", typeLabel, view.rootLevel)
    ).toEqual([]);
    expect(
      visibleRows(view.nodes, new Set(), "kind", typeLabel, view.rootLevel).map(
        row => row.node.path
      )
    ).toEqual(["sections/items/cta/kind"]);
  });

  it("focuses a blocks field, its accepted blocks and their props beneath it", () => {
    const nodes = outline();
    const view = focusView(nodes, "f-body");
    expect(view.focused?.id).toBe("f-body");
    expect(view.nodes.length).toBeGreaterThan(0);
    expect(view.nodes.every(each => each.meta === "block")).toBe(true);
  });

  it("draws everything when the id names no container it may focus", () => {
    const nodes = outline();
    for (const id of ["f-gone", "f-summary-a", "f-seo"]) {
      const view = focusView(nodes, id);
      expect(view.focused).toBeNull();
      expect(view.nodes).toBe(nodes);
    }
  });
});

describe("canFocus", () => {
  it("allows a group, repeating rows and a blocks field, and nothing else", () => {
    const nodes = outline();
    expect(canFocus(node(nodes, "f-meta"))).toBe(true);
    expect(canFocus(node(nodes, "f-sections"))).toBe(true);
    expect(canFocus(node(nodes, "f-body"))).toBe(true);
    // A field group is changed in its own editor; a text field holds nothing.
    expect(canFocus(node(nodes, "f-seo"))).toBe(false);
    expect(canFocus(node(nodes, "f-summary-a"))).toBe(false);
  });
});

describe("focusFallback", () => {
  it("returns the deepest crumb still there when the focused container is gone", () => {
    const nodes = outline();
    expect(
      focusFallback(nodes, ["f-sections", "f-sections-items", "f-gone"])
    ).toBe("f-sections-items");
  });

  it("returns null when none of the crumbs is there", () => {
    expect(focusFallback(outline(), ["f-gone", "f-also-gone"])).toBeNull();
  });
});

describe("focusHolding", () => {
  it("is the nearest container above a field that may be focused", () => {
    expect(focusHolding(outline(), "f-cta-label")).toBe("f-items-cta");
    expect(focusHolding(outline(), "f-meta-title")).toBe("f-meta");
  });

  it("is null for a top-level field or one no longer there", () => {
    expect(focusHolding(outline(), "f-summary-a")).toBeNull();
    expect(focusHolding(outline(), "f-gone")).toBeNull();
  });
});
