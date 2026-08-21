import type { StyleTraceEntry } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { styleProvenance, type StyleProvenanceQuery } from "./style-provenance";

/** One declaration the compiler wrote, with the fields the trace records. */
function entry(over: Partial<StyleTraceEntry> = {}): StyleTraceEntry {
  return {
    origin: { kind: "node", id: "n1" },
    property: "margin-block-end",
    value: "24px",
    state: "base",
    breakpoint: "desktop",
    ...over,
  };
}

/** Asking about `n1`'s bottom margin at the desktop breakpoint. */
function query(
  trace: readonly StyleTraceEntry[],
  over: Partial<StyleProvenanceQuery> = {}
): StyleProvenanceQuery {
  return {
    trace,
    subject: { nodeId: "n1", classIds: ["c1"] },
    cssProperty: "margin-block-end",
    state: "base",
    breakpoint: "desktop",
    liveBreakpoints: ["desktop"],
    ...over,
  };
}

describe("a property nothing wrote", () => {
  it("is unset, which is a real answer rather than a failure", () => {
    expect(styleProvenance(query([]))).toEqual({ kind: "unset" });
  });

  it("is unset when the trace holds only OTHER properties", () => {
    // The separating property against a dot that lit up for any trace entry at
    // all: a node with a colour and no margin must show an empty margin dot.
    const trace = [entry({ property: "color", value: "red" })];
    expect(styleProvenance(query(trace)).kind).toBe("unset");
  });
});

describe("a value this node authored at the position being edited", () => {
  it("is authored, which is the control's own value", () => {
    const result = styleProvenance(query([entry()]));
    expect(result.kind).toBe("authored");
  });

  it("is INHERITED when the same node wrote it at another breakpoint", () => {
    // The case the three-state answer exists for. A desktop value showing while
    // the author edits mobile is not this control's own value, and a dot that
    // said otherwise would invite editing mobile through a control that then
    // silently changes desktop.
    const trace = [entry()];
    const result = styleProvenance(
      query(trace, {
        breakpoint: "mobile",
        liveBreakpoints: ["desktop", "mobile"],
      })
    );
    expect(result.kind).toBe("inherited");
  });

  it("does not reach a value written in another state", () => {
    // States are asked about separately: the trace records which state each
    // declaration came from, and a base value is not a hover value. So editing
    // hover with only a base entry recorded reports unset rather than showing
    // the base value as something hover inherited.
    const trace = [entry({ state: "base" })];
    const result = styleProvenance(query(trace, { state: "hover" }));
    expect(result.kind).toBe("unset");
  });

  it("is not authored when the winning entry belongs to a DIFFERENT node", () => {
    const trace = [entry({ origin: { kind: "node", id: "other" } })];
    expect(styleProvenance(query(trace)).kind).not.toBe("authored");
  });
});

describe("a value from another tier", () => {
  it("names the class it came from, with the id a panel opens it by", () => {
    const trace = [
      entry({ origin: { kind: "class", id: "c1", slug: "card" } }),
    ];
    const result = styleProvenance(query(trace));
    expect(result.kind).toBe("inherited");
    if (result.kind !== "inherited") return;
    expect(result.from).toEqual({ kind: "class", id: "c1", slug: "card" });
  });

  it("reports a block type's default as inherited", () => {
    const trace = [entry({ origin: { kind: "blockType", type: "heading" } })];
    expect(
      styleProvenance(
        query(trace, { subject: { nodeId: "n1", blockType: "heading" } })
      ).kind
    ).toBe("inherited");
  });

  it("prefers the node's own value over a class's, as the cascade does", () => {
    // Order in the trace is emission order, and the node tier is emitted last.
    const trace = [
      entry({ origin: { kind: "class", id: "c1", slug: "card" } }),
      entry(),
    ];
    expect(styleProvenance(query(trace)).kind).toBe("authored");
  });
});

describe("matching the property", () => {
  it("matches the CSS property the trace records, not the catalog key", () => {
    // `margin` is the catalog key and `margin-block-end` is what was written.
    // Asking with the catalog key finds nothing, which is why the query takes
    // the leaf's own `cssProperty`.
    expect(
      styleProvenance(query([entry()], { cssProperty: "margin" })).kind
    ).toBe("unset");
    expect(styleProvenance(query([entry()])).kind).toBe("authored");
  });
});
