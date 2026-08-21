import {
  getStyleProperty,
  shapeLeaves,
  STYLE_CATALOG,
  type StyleLeaf,
  type StyleProperty,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  styleControlsFor,
  SUPPORTED_LEAF_KINDS,
  type StyleControl,
  type StyleControlKind,
} from "./style-controls";

/**
 * A VALID leaf of one kind.
 *
 * Built per kind rather than by spreading one shape and casting, because the
 * kinds do not carry the same fields: a keyword leaf without `values` is not a
 * catalog entry the engine could ever produce, and a helper that emitted one
 * would hand later tests a fixture that throws the moment anything reads it.
 */
function leaf(kind: StyleLeaf["kind"], cssProperty: string): StyleLeaf {
  const base = { cssProperty, tokenKinds: [] } as const;
  if (kind === "keyword") return { ...base, kind, values: ["normal"] };
  return { ...base, kind };
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
  it("maps every leaf kind to the control it is supposed to draw", () => {
    // Stated here rather than read off the implementation, which is what gives
    // the assertion content: deriving the expectation from the same mapping the
    // code uses would agree with any mapping at all, including one that drew a
    // dimension with the unitless number field.
    const expected = {
      keyword: "select",
      dimension: "length",
      number: "number",
      color: "color",
      cssValue: "css",
      url: "url",
    } satisfies Record<StyleLeaf["kind"], StyleControlKind>;

    // The derived set must still cover every kind, or the sweep below runs on
    // fewer kinds than the catalog can hold and passes by not looking.
    expect([...SUPPORTED_LEAF_KINDS].sort()).toEqual(
      Object.keys(expected).sort()
    );
    for (const kind of SUPPORTED_LEAF_KINDS) {
      const { controls } = styleControlsFor(property("p", leaf(kind, "p")));
      expect(controls).toHaveLength(1);
      expect(controls[0].supported).toBe(true);
      expect(controls[0].kind).toBe(expected[kind]);
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
    expect(set.variants).toEqual([{ path: [], active: 0, count: 2 }]);
  });

  it("shows the composite variant when a record is stored", () => {
    const set = styleControlsFor(radius, { startStart: "4px" });
    expect(paths(set.controls)).toEqual([
      ["startStart"],
      ["startEnd"],
      ["endStart"],
      ["endEnd"],
    ]);
    expect(set.variants[0].active).toBe(1);
  });

  it("treats a token reference as a scalar, not as a composite", () => {
    // `{ $token }` is one value spelled as an object. Judging by `typeof` alone
    // would show a token-valued radius in the four-corner control with the
    // token in none of them.
    const set = styleControlsFor(radius, { $token: "Radius.Card" });
    expect(paths(set.controls)).toEqual([[]]);
    expect(set.variants[0].active).toBe(0);
  });

  it("records how many variants exist, so an editor can offer the other one", () => {
    expect(styleControlsFor(radius).variants[0].count).toBe(2);
  });

  it("reports no variants for a property that is not a union", () => {
    expect(
      styleControlsFor(property("p", leaf("color", "p"))).variants
    ).toEqual([]);
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

describe("the unions the catalog actually ships", () => {
  /** The control kinds a real catalog property resolves to for a stored value. */
  function kindsFor(
    name: string,
    value: Parameters<typeof styleControlsFor>[1]
  ) {
    const entry = getStyleProperty(name);
    expect(entry).toBeDefined();
    return styleControlsFor(entry as StyleProperty, value).controls.map(
      control => control.kind
    );
  }

  // Three of the catalog's four unions have arms that are BOTH scalars, so a
  // composite-versus-scalar test picks arm 0 for every value they can hold.
  // These are the properties, and the values, that distinguish the arms.

  it("draws a numeric fontWeight with the number control, not the keyword select", () => {
    expect(kindsFor("fontWeight", 600)).toEqual(["number"]);
  });

  it("draws a keyword fontWeight with the select", () => {
    expect(kindsFor("fontWeight", "bold")).toEqual(["select"]);
  });

  it("draws a unitless lineHeight with the number control", () => {
    expect(kindsFor("lineHeight", 1.5)).toEqual(["number"]);
  });

  it("draws a measured lineHeight with the length control", () => {
    expect(kindsFor("lineHeight", "1.5rem")).toEqual(["length"]);
  });

  it("draws a listed fontStyle with the select", () => {
    expect(kindsFor("fontStyle", "italic")).toEqual(["select"]);
  });

  it("reaches fontStyle's free-form arm for a value the keywords do not list", () => {
    expect(kindsFor("fontStyle", "oblique 40deg")).toEqual(["css"]);
  });

  it("sends a token to the arm that admits tokens", () => {
    // `fontWeight`'s keyword arm declares no token kinds and its number arm
    // declares two, so a token weight belongs to the number arm.
    expect(kindsFor("fontWeight", { $token: "type.weight.bold" })).toEqual([
      "number",
    ]);
  });

  it("still separates borderRadius's scalar and composite arms", () => {
    expect(kindsFor("borderRadius", "4px")).toEqual(["length"]);
    expect(kindsFor("borderRadius", { startStart: "4px" })).toHaveLength(4);
  });
});

describe("a union nested below the property root", () => {
  // `position.zIndex` is a number OR the `auto` keyword. Reporting choices only
  // at the root would leave a renderer no way to offer `auto`.

  function positionSet(value?: Parameters<typeof styleControlsFor>[1]) {
    const entry = getStyleProperty("position");
    expect(entry).toBeDefined();
    return styleControlsFor(entry as StyleProperty, value);
  }

  it("records the choice at the path it sits on", () => {
    const set = positionSet();
    const zIndex = set.variants.find(v => v.path.join(".") === "zIndex");
    expect(zIndex).toBeDefined();
    expect(zIndex?.count).toBe(2);
  });

  it("selects the arm the stored value is written in", () => {
    const numeric = positionSet({ zIndex: 3 });
    const keyword = positionSet({ zIndex: "auto" });
    const kindAt = (set: ReturnType<typeof positionSet>) =>
      set.controls.find(c => c.path.join(".") === "zIndex")?.kind;
    expect(kindAt(numeric)).toBe("number");
    expect(kindAt(keyword)).toBe("select");
  });
});

describe("choosing between union arms that both accept tokens", () => {
  // `lineHeight` takes a number token on one arm and a dimension token on the
  // other, and a stored reference carries only its name.

  function lineHeightKind(
    token: string,
    tokens?: { kindOf: (n: string) => never }
  ) {
    const entry = getStyleProperty("lineHeight");
    return styleControlsFor(
      entry as StyleProperty,
      { $token: token },
      tokens === undefined ? undefined : { tokens }
    ).controls[0].kind;
  }

  it("uses the site's token table when it has one", () => {
    const table = {
      kindOf: (name: string) => (name === "space.gap" ? "dimension" : "number"),
    } as never;
    expect(lineHeightKind("space.gap", table)).toBe("length");
    expect(lineHeightKind("type.ratio", table)).toBe("number");
  });

  it("falls back to the catalog's arm order without a table", () => {
    // Stated rather than left implicit: the name alone cannot separate the arms,
    // and arm order is the engine's own fallback for a name it cannot resolve.
    expect(lineHeightKind("space.gap")).toBe("number");
  });

  it("skips an arm that accepts no tokens at all", () => {
    // `fontWeight`'s keyword arm declares no token kinds, so a token belongs to
    // the number arm whatever the table says.
    const entry = getStyleProperty("fontWeight");
    const set = styleControlsFor(entry as StyleProperty, {
      $token: "type.weight",
    });
    expect(set.controls[0].kind).toBe("number");
  });
});

describe("the fixtures this file builds are ones the engine could produce", () => {
  it("gives every synthetic leaf the fields its kind requires", () => {
    // A fixture that is not a real catalog entry lets a test agree with a
    // belief the engine does not share, which is how a broken comparison
    // passes. `shapeLeaves` is the engine's own reader, so anything it can
    // walk is a shape the engine accepts.
    for (const kind of SUPPORTED_LEAF_KINDS) {
      const built = leaf(kind, "p");
      expect(shapeLeaves(built)).toEqual([built]);
      if (built.kind === "keyword") {
        expect(Array.isArray(built.values)).toBe(true);
      }
    }
  });

  it("resolves a keyword arm by its OWN values, which needs a real keyword leaf", () => {
    // The case the old helper would have thrown on: a union whose keyword arm
    // is consulted for a stored string.
    const union = property("p", {
      kind: "union",
      of: [leaf("keyword", "p"), leaf("cssValue", "p")],
    });
    expect(styleControlsFor(union, "normal").controls[0].kind).toBe("select");
    expect(styleControlsFor(union, "anything-else").controls[0].kind).toBe(
      "css"
    );
  });
});

describe("keywords as the engine compares them", () => {
  // CSS keywords are ASCII case-insensitive and parsing discards surrounding
  // whitespace, so the validator accepts "Italic" and " italic " exactly as it
  // accepts "italic". An exact match sends those to the free-form arm, which
  // draws a text box where a select belongs.

  function fontStyleKind(value: string) {
    const entry = getStyleProperty("fontStyle");
    return styleControlsFor(entry as StyleProperty, value).controls[0].kind;
  }

  it("matches a keyword whatever case it was stored in", () => {
    expect(fontStyleKind("italic")).toBe("select");
    expect(fontStyleKind("Italic")).toBe("select");
    expect(fontStyleKind("ITALIC")).toBe("select");
  });

  it("matches a keyword carrying surrounding whitespace", () => {
    expect(fontStyleKind(" italic ")).toBe("select");
  });

  it("still sends a value the vocabulary does not hold to the free-form arm", () => {
    // The other half of the pair: normalizing must not make every string a
    // keyword, or the select would be drawn for values it cannot represent.
    expect(fontStyleKind("oblique 40deg")).toBe("css");
    expect(fontStyleKind("italicish")).toBe("css");
  });
});
