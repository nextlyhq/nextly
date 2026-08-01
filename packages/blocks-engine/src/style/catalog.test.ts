import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { getSupport } from "../registry";
import {
  STYLE_CATALOG,
  getStyleProperty,
  styleFlagsInGroup,
  stylePropertiesInGroup,
} from "./catalog";
import {
  STYLE_GROUPS,
  STYLE_GROUP_DEFS,
  TOKEN_KINDS,
  shapeLeaves,
} from "./catalog-types";
import {
  stylePropertiesForSupports,
  styleSupportDefinitions,
  supportsAllowStyleProperty,
} from "./supports-map";
import { tokenKindsForProperty } from "./validate-style-value";

const DOC_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "STYLE-CATALOG.md"
);

describe("the catalog is internally consistent", () => {
  it("has no duplicate property names", () => {
    const names = STYLE_CATALOG.map(entry => entry.property);
    expect(new Set(names).size).toBe(names.length);
  });

  it("puts every property in a known group", () => {
    for (const entry of STYLE_CATALOG) {
      expect(STYLE_GROUPS, `property "${entry.property}"`).toContain(
        entry.group
      );
    }
  });

  it("gives every property a non-empty summary for the reference docs", () => {
    for (const entry of STYLE_CATALOG) {
      expect(entry.summary.trim(), `property "${entry.property}"`).not.toBe("");
    }
  });

  it("names a CSS property at every leaf", () => {
    for (const entry of STYLE_CATALOG) {
      for (const leaf of shapeLeaves(entry.shape)) {
        expect(
          leaf.cssProperty.trim(),
          `property "${entry.property}"`
        ).not.toBe("");
      }
    }
  });

  it("references only known token kinds", () => {
    for (const entry of STYLE_CATALOG) {
      for (const leaf of shapeLeaves(entry.shape)) {
        for (const kind of leaf.tokenKinds) {
          expect(TOKEN_KINDS, `property "${entry.property}"`).toContain(kind);
        }
      }
    }
  });

  it("gives every keyword leaf a non-empty closed value set", () => {
    for (const entry of STYLE_CATALOG) {
      for (const leaf of shapeLeaves(entry.shape)) {
        if (leaf.kind !== "keyword") continue;
        expect(
          leaf.values.length,
          `property "${entry.property}"`
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe("storage keys and emission are logical, not physical", () => {
  // The whole point of logical-first storage is that one document renders
  // correctly in both writing directions. A physical edge anywhere in the
  // emitted CSS would silently reintroduce the per-locale fork it exists to
  // avoid, so the catalog is held to it mechanically rather than by review.
  it("emits no physical edge properties", () => {
    for (const entry of STYLE_CATALOG) {
      for (const leaf of shapeLeaves(entry.shape)) {
        expect(
          leaf.cssProperty,
          `property "${entry.property}" emits a physical edge`
        ).not.toMatch(/-(left|right|top|bottom)\b/);
      }
    }
  });

  it("offers no physical direction keyword", () => {
    for (const entry of STYLE_CATALOG) {
      for (const leaf of shapeLeaves(entry.shape)) {
        if (leaf.kind !== "keyword") continue;
        expect(leaf.values, `property "${entry.property}"`).not.toContain(
          "left"
        );
        expect(leaf.values, `property "${entry.property}"`).not.toContain(
          "right"
        );
      }
    }
  });

  it("spells box sides in writing-mode terms", () => {
    const margin = getStyleProperty("margin");
    expect(margin?.shape.kind).toBe("logicalSides");
    expect(shapeLeaves(margin!.shape).map(leaf => leaf.cssProperty)).toEqual([
      "margin-block-start",
      "margin-block-end",
      "margin-inline-start",
      "margin-inline-end",
    ]);
  });

  it("keeps sizing physical, which is direction-neutral", () => {
    expect(shapeLeaves(getStyleProperty("width")!.shape)[0]?.cssProperty).toBe(
      "width"
    );
  });
});

describe("token-kind compatibility", () => {
  it.each([
    ["padding", ["dimension"]],
    ["backgroundColor", ["color"]],
    ["color", ["color"]],
    ["fontFamily", ["fontFamily"]],
    ["fontWeight", ["fontWeight", "number"]],
    ["lineHeight", ["number", "dimension"]],
    ["boxShadow", ["shadow"]],
    ["opacity", ["number"]],
    ["transition", ["custom", "duration"]],
    ["display", []],
    ["textAlign", []],
    ["containerType", []],
  ])("%s accepts %j", (property, kinds) => {
    expect([...tokenKindsForProperty(property)].sort()).toEqual(
      [...kinds].sort()
    );
  });

  it("reports no kinds for a property that does not exist", () => {
    expect(tokenKindsForProperty("notAProperty")).toEqual([]);
  });
});

describe("supports map onto catalog groups", () => {
  it("derives one support per group, plus the flags its properties declare", () => {
    const definitions = styleSupportDefinitions();
    expect(definitions.map(support => support.key)).toEqual(
      STYLE_GROUP_DEFS.map(group => group.key)
    );
    for (const support of definitions) {
      const flags = styleFlagsInGroup(
        support.key as (typeof STYLE_GROUP_DEFS)[number]["key"]
      );
      expect(support.flags ?? [], `support "${support.key}"`).toEqual([
        ...flags,
      ]);
    }
  });

  it("registers the derived supports as built-ins, alongside customCss", () => {
    for (const group of STYLE_GROUP_DEFS) {
      const support = getSupport(group.key);
      expect(support, `support "${group.key}"`).toBeDefined();
      expect(support?.label).toBe(group.label);
      expect(support?.flags ?? []).toEqual([...styleFlagsInGroup(group.key)]);
    }
    expect(getSupport("customCss")).toBeDefined();
  });

  it("enables a whole group when a block declares it as true", () => {
    const allowed = stylePropertiesForSupports({ border: true }).map(
      entry => entry.property
    );
    expect(allowed).toEqual(
      stylePropertiesInGroup("border").map(entry => entry.property)
    );
  });

  it("enables only the flagged properties when a block names sub-flags", () => {
    expect(
      stylePropertiesForSupports({ border: { radius: true } }).map(
        entry => entry.property
      )
    ).toEqual(["borderRadius"]);
    expect(
      stylePropertiesForSupports({ color: { link: true } }).map(
        entry => entry.property
      )
    ).toEqual(["linkColor", "linkColorHover"]);
  });

  it("leaves unflagged properties reachable only through the whole group", () => {
    // boxShadow declares no flag, so an object form cannot name it.
    expect(
      supportsAllowStyleProperty({ shadow: { boxShadow: true } }, "boxShadow")
    ).toBe(false);
    expect(supportsAllowStyleProperty({ shadow: true }, "boxShadow")).toBe(
      true
    );
  });

  it("enables nothing for an undeclared or disabled group", () => {
    expect(stylePropertiesForSupports(undefined)).toEqual([]);
    expect(stylePropertiesForSupports({ spacing: false })).toEqual([]);
  });
});

describe("the reference doc and the catalog agree", () => {
  // Documented separately from the code, the two drift; the doc's property rows
  // are therefore checked against the catalog in both directions.
  const doc = readFileSync(DOC_PATH, "utf8");
  const documented = new Set(
    [...doc.matchAll(/^\|\s*`([a-zA-Z]+)`\s*\|/gm)].map(match => match[1])
  );

  it("documents every catalog property", () => {
    for (const entry of STYLE_CATALOG) {
      expect(documented, `property "${entry.property}"`).toContain(
        entry.property
      );
    }
  });

  it("documents nothing the catalog does not define", () => {
    for (const property of documented) {
      expect(
        getStyleProperty(property as string),
        `documented property "${property}"`
      ).toBeDefined();
    }
  });
});
