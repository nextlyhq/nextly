/**
 * Where a step or a drop asks to put a field, over the nested fixture: the
 * place the move rule is then asked about. A drop's sideways offset sets the
 * level; a field group's field stands for the field using the group; a
 * pending delete is never a place.
 */
import { describe, expect, it } from "vitest";

import {
  nestedFixtureBlockCatalogs,
  nestedFixtureFieldGroups,
  nestedFixtureFields,
} from "@admin/components/features/schema-builder/__fixtures__/nested-fixture";

import {
  dropTarget,
  fieldGroupFieldHolding,
  stepTarget,
  type OutlineRows,
} from "../move-targets";
import {
  buildOutline,
  flattenOutline,
  type OutlineNode,
} from "../outline-model";

function rows(mark?: (node: OutlineNode) => OutlineNode): OutlineRows {
  const built = buildOutline(nestedFixtureFields(), {
    entityReadOnly: false,
    fieldGroups: nestedFixtureFieldGroups(),
  });
  const marked = mark
    ? built.map(function each(node): OutlineNode {
        return mark({ ...node, children: node.children.map(each) });
      })
    : built;
  return {
    nodes: marked,
    byId: new Map(flattenOutline(marked).map(node => [node.id, node])),
  };
}

/** The id of the row at a path. */
function at(outline: OutlineRows, path: string): string {
  const node = [...outline.byId.values()].find(each => each.path === path);
  if (!node) throw new Error(`no row at ${path}`);
  return node.id;
}

describe("a step", () => {
  const outline = rows();

  it("goes past the field beside it, and out of its container at either end", () => {
    expect(stepTarget(outline, "f-summary-b", "up")).toEqual({
      beforeFieldId: "f-summary-a",
    });
    expect(stepTarget(outline, "f-summary-a", "down")).toEqual({
      beforeFieldId: "f-internal-note",
    });
    expect(stepTarget(outline, "f-meta-title", "up")).toEqual({
      beforeFieldId: "f-meta",
    });
    expect(stepTarget(outline, "f-meta-rating", "down")).toEqual({
      beforeFieldId: "f-sections",
    });
  });

  it("goes out to just after its container, or into the one above it", () => {
    expect(stepTarget(outline, "f-cta-label", "out")).toEqual({
      parentFieldId: "f-sections-items",
    });
    expect(stepTarget(outline, "f-sections", "in")).toEqual({
      parentFieldId: "f-meta",
    });
    // Above Summary is Title, which holds no fields.
    expect(stepTarget(outline, "f-summary-a", "in")).toBeNull();
    expect(stepTarget(outline, "f-title", "out")).toBeNull();
    expect(stepTarget(outline, "f-title", "up")).toBeNull();
  });

  it("goes nowhere past a pending delete", () => {
    const deleted = rows(node =>
      node.id === "f-summary-a"
        ? { ...node, pending: { marks: ["deleted"] } }
        : node
    );
    expect(stepTarget(deleted, "f-summary-b", "up")).toBeNull();
    expect(stepTarget(deleted, "f-title", "down")).toBeNull();
  });
});

describe("a drop", () => {
  const outline = rows();

  it("lands before a row dragged up to it and after one dragged down to it", () => {
    expect(dropTarget(outline, "f-summary-b", "f-title", 0)).toEqual({
      beforeFieldId: "f-title",
    });
    expect(dropTarget(outline, "f-title", "f-summary-b", 0)).toEqual({
      beforeFieldId: "f-internal-note",
    });
  });

  it("lands in the over row's own container, at any depth", () => {
    expect(dropTarget(outline, "f-title", "f-cta-kind", 0)).toEqual({
      parentFieldId: "f-items-cta",
    });
    expect(dropTarget(outline, "f-cta-kind", "f-meta-title", 0)).toEqual({
      parentFieldId: "f-meta",
      beforeFieldId: "f-meta-title",
    });
  });

  it("goes into a container a level to the right, and out a level to the left", () => {
    expect(dropTarget(outline, "f-title", "f-meta", 1)).toEqual({
      parentFieldId: "f-meta",
    });
    // Sideways off a row that holds nothing stays beside it.
    expect(dropTarget(outline, "f-summary-b", "f-title", 1)).toEqual({
      beforeFieldId: "f-title",
    });
    expect(dropTarget(outline, "f-title", "f-cta-label", -1)).toEqual({
      parentFieldId: "f-sections-items",
    });
    // Left on itself takes it out; right on itself, into the container above.
    expect(dropTarget(outline, "f-meta-title", "f-meta-title", -1)).toEqual({
      beforeFieldId: "f-sections",
    });
    expect(dropTarget(outline, "f-sections", "f-sections", 1)).toEqual({
      parentFieldId: "f-meta",
    });
    expect(dropTarget(outline, "f-title", "f-title", 0)).toBeNull();
  });

  it("names the field using a field group for a drop among its fields", () => {
    // Its rows are not the entity's own, so no anchor is taken from them.
    expect(
      dropTarget(outline, "f-title", at(outline, "seo/meta_title"), 0)
    ).toEqual({ parentFieldId: "f-seo" });
    expect(
      dropTarget(outline, "f-body", at(outline, "seo/meta_title"), 0)
    ).toEqual({ parentFieldId: "f-seo" });
  });

  it("is no place on a pending delete", () => {
    const deleted = rows(node =>
      node.id === "f-summary-a"
        ? { ...node, pending: { marks: ["deleted"] } }
        : node
    );
    expect(dropTarget(deleted, "f-title", "f-summary-a", 0)).toBeNull();
  });
});

describe("fieldGroupFieldHolding", () => {
  const byId = () =>
    new Map(
      flattenOutline(
        buildOutline(nestedFixtureFields(), {
          entityReadOnly: false,
          fieldGroups: nestedFixtureFieldGroups(),
          blockCatalogs: nestedFixtureBlockCatalogs(),
        })
      ).map(node => [node.id, node])
    );

  it("names the field using the group for a field group's own row", () => {
    const rows = byId();
    const groupRow = [...rows.values()].find(
      node => node.readOnly?.kind === "field-group"
    );
    expect(fieldGroupFieldHolding(rows, groupRow!.id)?.id).toBe("f-seo");
  });

  it("names nothing for a registered block's row, which no field group holds", () => {
    const rows = byId();
    const blockRow = [...rows.values()].find(node => node.meta === "block");
    expect(blockRow).toBeDefined();
    expect(fieldGroupFieldHolding(rows, blockRow!.id)).toBeUndefined();
  });
});
