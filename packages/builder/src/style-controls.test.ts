import {
  getStyleProperty,
  STYLE_CATALOG,
  type StyleLeaf,
  type StyleProperty,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  styleControlsFor,
  SUPPORTED_LEAF_KINDS,
  type StyleControl,
} from "./style-controls";

/** A leaf of one kind, with the fields every leaf carries. */
function leaf(kind: StyleLeaf["kind"], cssProperty: string): StyleLeaf {
  return { kind, cssProperty, tokenKinds: [] } as StyleLeaf;
}

/** A catalog row, spelled the way `catalog.ts` spells one. */
function property(name: string, shape: StyleProperty["shape"]): StyleProperty {
  return { property: name, group: "spacing", shape, summary: name };
}

/** The paths a control set addresses, in order. */
function paths(controls: readonly StyleControl[]): string[][] {
  return controls.map(control => [...control.path]);
}

describe("deriving controls from a leaf", () => {
  it("maps every leaf kind the catalog can hold to a control", () => {
    // The mapping is a mapped type, so an unmapped kind cannot compile. What
    // this adds is that each kind resolves to a control at RUNTIME — a mapped
    // type is satisfied by a key whose value is `undefined`.
    for (const kind of SUPPORTED_LEAF_KINDS) {
      const { controls } = styleControlsFor(property("p", leaf(kind, "p")));
      expect(controls).toHaveLength(1);
      expect(controls[0].supported).toBe(true);
      expect(controls[0].kind).toBeTypeOf("string");
    }
  });

  it("carries the catalog's own leaf through, so a control reads units and bounds from it", () => {
    const bounded: StyleLeaf = {
      kind: "number",
      cssProperty: "opacity",
      tokenKinds: [],
      min: 0,
      max: 1,
    };
    const { controls } = styleControlsFor(property("opacity", bounded));
    expect(controls[0].leaf).toBe(bounded);
  });

  it("reports a leaf kind this build has no control for as a KNOWN gap", () => {
    // A document written by a newer engine can carry a kind absent from this
    // build's mapping. The descriptor must still appear — omitting it presents
    // an incomplete property as a complete one — and must say it is not
    // editable here rather than reaching a renderer as `undefined`.
    const future = { kind: "gradient", cssProperty: "x", tokenKinds: [] };
    const { controls } = styleControlsFor(
      property("x", future as unknown as StyleLeaf)
    );
    expect(controls).toHaveLength(1);
    expect(controls[0].supported).toBe(false);
    expect(controls[0].kind).toBeUndefined();
  });
});

describe("deriving controls from a composite", () => {
  it("gives a logical-sides property one control per side, addressed by name", () => {
    const margin = getStyleProperty("margin");
    expect(margin).toBeDefined();
    const { controls } = styleControlsFor(margin as StyleProperty);
    expect(paths(controls)).toEqual([
      ["blockStart"],
      ["blockEnd"],
      ["inlineStart"],
      ["inlineEnd"],
    ]);
  });

  it("recurses through nested objects, carrying the full path", () => {
    const nested = property("outline", {
      kind: "object",
      fields: {
        width: leaf("dimension", "outline-width"),
        inner: {
          kind: "object",
          fields: { color: leaf("color", "outline-color") },
        },
      },
    });
    expect(paths(styleControlsFor(nested).controls)).toEqual([
      ["width"],
      ["inner", "color"],
    ]);
  });
});

describe("a union, which stores one value in more than one form", () => {
  const radius = property("radius", {
    kind: "union",
    of: [
      leaf("dimension", "border-radius"),
      {
        kind: "logicalCorners",
        corners: {
          startStart: leaf("dimension", "border-start-start-radius"),
          startEnd: leaf("dimension", "border-start-end-radius"),
          endStart: leaf("dimension", "border-end-start-radius"),
          endEnd: leaf("dimension", "border-end-end-radius"),
        },
      },
    ],
  });

  it("shows the FIRST variant when nothing is stored, which is the form the engine tries first", () => {
    const set = styleControlsFor(radius);
    expect(paths(set.controls)).toEqual([[]]);
    expect(set.variants).toEqual({ active: 0, count: 2 });
  });

  it("shows the composite variant when a record is stored", () => {
    const set = styleControlsFor(radius, { startStart: "4px" });
    expect(paths(set.controls)).toEqual([
      ["startStart"],
      ["startEnd"],
      ["endStart"],
      ["endEnd"],
    ]);
    expect(set.variants?.active).toBe(1);
  });

  it("treats a token reference as a scalar, not as a composite", () => {
    // `{ $token }` is one value spelled as an object. Judging by `typeof` alone
    // would show a token-valued radius in the four-corner control with the
    // token in none of them.
    const set = styleControlsFor(radius, { $token: "Radius.Card" });
    expect(paths(set.controls)).toEqual([[]]);
    expect(set.variants?.active).toBe(0);
  });

  it("records how many variants exist, so an editor can offer the other one", () => {
    expect(styleControlsFor(radius).variants?.count).toBe(2);
  });

  it("reports no variants for a property that is not a union", () => {
    expect(
      styleControlsFor(property("p", leaf("color", "p"))).variants
    ).toBeUndefined();
  });
});

describe("D-05.1 — the catalog drives the controls", () => {
  it("gives a property this module has never heard of a full set of controls", () => {
    // The point of the rule, stated as a test: a property invented here — no
    // entry in any list in `style-controls.ts`, no name it could match on —
    // resolves to controls purely from its declared shape.
    const invented = property("inventedByThisTest", {
      kind: "logicalSides",
      sides: {
        blockStart: leaf("dimension", "invented-block-start"),
        blockEnd: leaf("dimension", "invented-block-end"),
        inlineStart: leaf("number", "invented-inline-start"),
        inlineEnd: leaf("color", "invented-inline-end"),
      },
    });
    const { controls } = styleControlsFor(invented);
    expect(paths(controls)).toEqual([
      ["blockStart"],
      ["blockEnd"],
      ["inlineStart"],
      ["inlineEnd"],
    ]);
    // Each side resolves through its OWN leaf, so a shape mixing kinds is not
    // collapsed onto whatever the first side happened to be.
    expect(controls.map(c => c.kind)).toEqual([
      "length",
      "length",
      "number",
      "color",
    ]);
  });

  it("draws a control for every property the real catalog ships", () => {
    // An empty offender list is only evidence once the search is shown to
    // work: this asserts the walk reaches the shipped catalog at all, so the
    // sweep below cannot pass by finding nothing.
    expect(STYLE_CATALOG.length).toBeGreaterThan(0);
    const unsupported: string[] = [];
    for (const entry of STYLE_CATALOG) {
      const { controls } = styleControlsFor(entry);
      expect(controls.length).toBeGreaterThan(0);
      for (const control of controls) {
        if (!control.supported) unsupported.push(`${entry.property}`);
      }
    }
    expect(unsupported).toEqual([]);
  });
});
