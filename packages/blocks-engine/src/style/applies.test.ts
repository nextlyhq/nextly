import { describe, expect, it } from "vitest";

import { applies, type AppliesContext } from "./applies";
import { STYLE_CATALOG, getStyleProperty } from "./catalog";
import { APPLIES_WHEN, type ObjectShape } from "./catalog-types";

/** A plain block box in block flow, inside a block-flow parent. */
const BLOCK: AppliesContext = {
  display: "block",
  flexWrap: "nowrap",
  position: "static",
  parentDisplay: "block",
  replaced: false,
};

/** The properties that apply in a context, in catalog order. */
function applying(context: AppliesContext): string[] {
  return STYLE_CATALOG.filter(entry => applies(entry.property, context)).map(
    entry => entry.property
  );
}

/** The properties that do NOT apply in a context, in catalog order. */
function notApplying(context: AppliesContext): string[] {
  return STYLE_CATALOG.filter(entry => !applies(entry.property, context)).map(
    entry => entry.property
  );
}

const FLEX_CONTAINER_ONLY = ["flexDirection", "flexWrap"];
const GRID_CONTAINER_ONLY = [
  "gridTemplateColumns",
  "gridTemplateRows",
  "gridAutoFlow",
  "justifyItems",
];
const EITHER_CONTAINER = [
  "justifyContent",
  "alignItems",
  "gap",
  "rowGap",
  "columnGap",
];
const FLEX_CHILD_ONLY = ["flexGrow", "flexShrink", "flexBasis"];
const EITHER_CHILD = ["alignSelf", "order"];
const GRID_CHILD_ONLY = ["justifySelf"];
const REPLACED_ONLY = ["objectFit", "objectPosition"];

describe("the catalog records when every property has an effect", () => {
  it("states an answer on every row, using only known conditions", () => {
    for (const entry of STYLE_CATALOG) {
      expect(entry.appliesWhen, `property "${entry.property}"`).toBeDefined();
      expect(entry.appliesWhen?.length, `property "${entry.property}"`).toBe(
        new Set(entry.appliesWhen).size
      );
      expect(
        entry.appliesWhen?.length,
        `property "${entry.property}"`
      ).toBeGreaterThan(0);
      for (const condition of entry.appliesWhen ?? []) {
        expect(APPLIES_WHEN, `property "${entry.property}"`).toContain(
          condition
        );
      }
    }
  });

  it("says `always` alone, never beside a narrower condition", () => {
    // `always` beside anything else makes the other condition meaningless,
    // which is a row that has not decided.
    for (const entry of STYLE_CATALOG) {
      const answer = entry.appliesWhen ?? [];
      if (answer.includes("always")) {
        expect(answer, `property "${entry.property}"`).toEqual(["always"]);
      }
    }
  });

  it("answers per field only for fields the property has", () => {
    for (const entry of STYLE_CATALOG) {
      if (entry.fieldAppliesWhen === undefined) continue;
      expect(entry.shape.kind, `property "${entry.property}"`).toBe("object");
      const fields = Object.keys((entry.shape as ObjectShape).fields);
      for (const [field, answer] of Object.entries(entry.fieldAppliesWhen)) {
        expect(fields, `property "${entry.property}"`).toContain(field);
        for (const condition of answer) {
          expect(APPLIES_WHEN).toContain(condition);
        }
      }
    }
  });

  it("covers a position's offsets and stacking order field by field", () => {
    expect(getStyleProperty("position")?.fieldAppliesWhen).toEqual({
      inset: ["positioned"],
      zIndex: ["positioned", "flex-or-grid-child"],
    });
  });
});

describe("applies, judged by what the block is", () => {
  it("lists only what a plain block box uses", () => {
    // The whole list, so a property wrongly marked `always` shows up here as
    // well as one wrongly narrowed.
    expect(notApplying(BLOCK)).toEqual([
      "flexDirection",
      "flexWrap",
      "justifyContent",
      "alignItems",
      "alignContent",
      "gap",
      "rowGap",
      "columnGap",
      "gridTemplateColumns",
      "gridTemplateRows",
      "gridAutoFlow",
      "justifyItems",
      "objectFit",
      "objectPosition",
      "flexGrow",
      "flexShrink",
      "flexBasis",
      "alignSelf",
      "justifySelf",
      "order",
    ]);
  });

  it("gives a Row (a flex container) its flex settings and no grid ones", () => {
    const row = applying({ ...BLOCK, display: "flex" });
    for (const property of [...FLEX_CONTAINER_ONLY, ...EITHER_CONTAINER]) {
      expect(row, property).toContain(property);
    }
    for (const property of GRID_CONTAINER_ONLY) {
      expect(row, property).not.toContain(property);
    }
    // A single flex line has nothing for align-content to distribute.
    expect(row).not.toContain("alignContent");
    expect(applying({ ...BLOCK, display: "flex", flexWrap: "wrap" })).toContain(
      "alignContent"
    );
  });

  it("gives a Grid its grid settings and no flex-only ones", () => {
    const grid = applying({ ...BLOCK, display: "grid" });
    for (const property of [
      ...GRID_CONTAINER_ONLY,
      ...EITHER_CONTAINER,
      "alignContent",
    ]) {
      expect(grid, property).toContain(property);
    }
    for (const property of FLEX_CONTAINER_ONLY) {
      expect(grid, property).not.toContain(property);
    }
  });

  it("reads the inline and two-keyword forms as the container they are", () => {
    expect(applies("flexDirection", { ...BLOCK, display: "inline-flex" })).toBe(
      true
    );
    expect(
      applies("gridTemplateColumns", { ...BLOCK, display: "inline grid" })
    ).toBe(true);
    expect(applies("gap", { ...BLOCK, display: " Flex " })).toBe(true);
    expect(applies("gap", { ...BLOCK, display: "flow-root" })).toBe(false);
  });

  it("gives a Stack's child (block flow) no child sizing", () => {
    const child = applying(BLOCK);
    for (const property of [
      ...FLEX_CHILD_ONLY,
      ...EITHER_CHILD,
      ...GRID_CHILD_ONLY,
    ]) {
      expect(child, property).not.toContain(property);
    }
  });

  it("gives a Row's child grow, shrink, basis, align self and order", () => {
    const child = applying({ ...BLOCK, parentDisplay: "flex" });
    for (const property of [...FLEX_CHILD_ONLY, ...EITHER_CHILD]) {
      expect(child, property).toContain(property);
    }
    expect(child).not.toContain("justifySelf");
  });

  it("gives a Grid's child justify self, align self and order", () => {
    const child = applying({ ...BLOCK, parentDisplay: "grid" });
    for (const property of [...GRID_CHILD_ONLY, ...EITHER_CHILD]) {
      expect(child, property).toContain(property);
    }
    for (const property of FLEX_CHILD_ONLY) {
      expect(child, property).not.toContain(property);
    }
  });

  it("gives an image its fit and focal point, and a box neither", () => {
    const image = applying({ ...BLOCK, replaced: true });
    for (const property of REPLACED_ONLY) {
      expect(image, property).toContain(property);
    }
    for (const property of REPLACED_ONLY) {
      expect(applying(BLOCK), property).not.toContain(property);
    }
  });

  it("judges a position's fields by the position in force", () => {
    expect(applies("position", BLOCK)).toBe(true);
    expect(applies("position", BLOCK, "type")).toBe(true);
    expect(applies("position", BLOCK, "inset")).toBe(false);
    expect(applies("position", BLOCK, "zIndex")).toBe(false);
    const relative = { ...BLOCK, position: "relative" };
    expect(applies("position", relative, "inset")).toBe(true);
    expect(applies("position", relative, "zIndex")).toBe(true);
    // A flex or grid item stacks by z-index without being positioned.
    expect(
      applies("position", { ...BLOCK, parentDisplay: "grid" }, "zIndex")
    ).toBe(true);
    expect(
      applies("position", { ...BLOCK, parentDisplay: "grid" }, "inset")
    ).toBe(false);
  });
});

describe("what cannot be read answers true", () => {
  it("applies every property when nothing about the block is known", () => {
    for (const entry of STYLE_CATALOG) {
      expect(applies(entry.property, {}), entry.property).toBe(true);
      for (const field of Object.keys(entry.fieldAppliesWhen ?? {})) {
        expect(applies(entry.property, {}, field), field).toBe(true);
      }
    }
  });

  it("treats each unreadable input on its own", () => {
    // The parent is unknown, so the child settings stay; the block's own
    // display is known, so the grid ones go.
    const unknownParent = { ...BLOCK, parentDisplay: undefined };
    expect(applies("flexGrow", unknownParent)).toBe(true);
    expect(applies("gridTemplateColumns", unknownParent)).toBe(false);
    expect(applies("objectFit", { ...BLOCK, replaced: undefined })).toBe(true);
    expect(
      applies("position", { ...BLOCK, position: undefined }, "inset")
    ).toBe(true);
    expect(
      applies("alignContent", {
        ...BLOCK,
        display: "flex",
        flexWrap: undefined,
      })
    ).toBe(true);
  });

  it("reads an escaped keyword as the browser does", () => {
    // Validation accepts `\66 lex` as `flex`, and the compiler writes it
    // as stored, so the page lays the block out as a flex row.
    expect(applies("flexGrow", { ...BLOCK, parentDisplay: "\\66 lex" })).toBe(
      true
    );
    expect(applies("flexDirection", { ...BLOCK, display: "FLE\\X" })).toBe(
      true
    );
    expect(
      applies("gridTemplateColumns", { ...BLOCK, display: "inline\\ grid" })
    ).toBe(false);
    expect(
      applies("flexGrow", { ...BLOCK, parentDisplay: "\\69 nherit" })
    ).toBe(true);
    expect(
      applies("position", { ...BLOCK, position: "St\\61tic" }, "inset")
    ).toBe(false);
  });

  it("reads a CSS-wide keyword as unreadable, not as block flow", () => {
    expect(applies("flexDirection", { ...BLOCK, display: "inherit" })).toBe(
      true
    );
    expect(applies("flexGrow", { ...BLOCK, parentDisplay: "revert" })).toBe(
      true
    );
    expect(applies("position", { ...BLOCK, position: "unset" }, "inset")).toBe(
      true
    );
  });

  it("answers true for a key the catalog does not define", () => {
    expect(applies("acmeNewProperty", BLOCK)).toBe(true);
  });
});
