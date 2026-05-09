// Why: dnd-kit collision logic must distinguish three drop targets so the
// BuilderFieldList can show the correct indicator (vertical / horizontal /
// edge / red-rejected) and route the drop to the right reducer. The existing
// flat-list collision detector picks a target id; classifyDropTarget translates
// that into a UI intent based on the source row, target row, and width budget.
import { describe, expect, it } from "vitest";

import { classifyDropTarget } from "../dnd-collision";

describe("classifyDropTarget", () => {
  it("returns 'inside-row' when pointer is over a sibling field in the same row", () => {
    const result = classifyDropTarget({
      overId: "field-b",
      overType: "field",
      activeRowId: "row-1",
      overRowId: "row-1",
    });
    expect(result.kind).toBe("inside-row");
  });

  it("returns 'between-rows' when pointer is over the inter-row gap", () => {
    const result = classifyDropTarget({
      overId: "row-gap-1-2",
      overType: "row-gap",
    });
    expect(result.kind).toBe("between-rows");
  });

  it("returns 'edge' when pointer is at top of list or bottom of list", () => {
    expect(
      classifyDropTarget({ overId: "list-top", overType: "edge" }).kind
    ).toBe("edge");
    expect(
      classifyDropTarget({ overId: "list-bottom", overType: "edge" }).kind
    ).toBe("edge");
  });

  it("returns 'rejected' when total width would exceed 100", () => {
    const result = classifyDropTarget({
      overId: "field-b",
      overType: "field",
      activeRowId: "row-1",
      overRowId: "row-2",
      activeWidth: 75,
      rowSumIfDropped: 125,
    });
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.reason).toBe("doesnt-fit");
    }
  });

  it("inside-row is allowed when width budget is exactly 100", () => {
    const result = classifyDropTarget({
      overId: "field-b",
      overType: "field",
      activeRowId: "row-1",
      overRowId: "row-2",
      activeWidth: 50,
      rowSumIfDropped: 100,
    });
    expect(result.kind).toBe("inside-row");
  });
});
