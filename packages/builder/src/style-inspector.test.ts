/**
 * What the Style tab offers, asserted without a DOM.
 *
 * Every question here is derivation — which sections a block offers, in what
 * order, holding which properties, and which of them this node sets — and a
 * component test could not separate a correct answer from a plausible wrong one
 * because both render a column of inputs.
 *
 * @module style-inspector.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  registerBlocks,
  stylePropertiesForSupports,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import { afterEach, describe, expect, it } from "vitest";

import { INSPECTOR_SECTIONS } from "./inspector-sections";
import { inspectStyle } from "./style-inspector";

afterEach(() => {
  clearBlocks();
});

/** A block declaring exactly the supports a test needs. */
function register(
  supports: Record<string, boolean | Record<string, boolean>>
): void {
  registerBlocks(
    [
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        supports,
        render: () => null,
      },
    ] as never,
    { source: "style-inspector-test" }
  );
}

function documentOf(styles?: NodeStyles): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      { id: "a", type: "acme/box", version: 1, props: {}, styles },
    ] as BlockNode[],
  } as BlockDocument;
}

/** The properties one section offers, by catalog key. */
function propertiesOf(
  inspection: ReturnType<typeof inspectStyle>,
  group: string
): readonly string[] {
  const section = inspection?.sections.find(entry => entry.key === group);
  return (section?.properties ?? []).map(property => property.property);
}

describe("which sections a block offers", () => {
  it("offers a section per group the block supports, and no others", () => {
    register({ spacing: true, typography: true });

    const inspection = inspectStyle(documentOf(), "a");

    expect(inspection?.sections.map(section => section.key)).toEqual([
      "spacing",
      "typography",
    ]);
  });

  it("orders sections as the builder presents them, not as supports lists them", () => {
    // Declared in the opposite order to the builder's, so an implementation
    // walking `supports` would produce the reverse of this.
    register({ border: true, layout: true, spacing: true });

    const inspection = inspectStyle(documentOf(), "a");
    const order = INSPECTOR_SECTIONS.map(section => section.key).filter(key =>
      ["border", "layout", "spacing", "size"].includes(key)
    );

    expect(inspection?.sections.map(section => section.key)).toEqual(order);
    // Size as well: layout support brings box sizing, which the builder
    // places behind Size's More.
    expect(order).toEqual(["layout", "spacing", "size", "border"]);
  });

  it("offers no section for a group the block supports nothing in", () => {
    // A sub-flag that enables nothing outside its own property leaves the rest
    // of the group out — and a group left entirely out is not a heading.
    register({ border: { radius: true } });

    const inspection = inspectStyle(documentOf(), "a");

    expect(propertiesOf(inspection, "border")).toEqual(["borderRadius"]);
    expect(inspection?.sections).toHaveLength(1);
  });

  it("asks the engine which properties a supports declaration allows", () => {
    // The expectation is the ENGINE's answer rather than a list written here:
    // a list would agree with itself, and this is the one assertion that fails
    // if the panel ever grows its own reading of `supports`.
    register({ typography: true });

    const inspection = inspectStyle(documentOf(), "a");

    // Compared as sets: the engine decides WHICH properties, the placement
    // table decides their order.
    expect([...propertiesOf(inspection, "typography")].sort()).toEqual(
      stylePropertiesForSupports({ typography: true })
        .map(entry => entry.property)
        .sort()
    );
  });

  it("answers with no sections at all for a block that opts into nothing", () => {
    register({});

    const inspection = inspectStyle(documentOf(), "a");

    // An inspection, not null: the block IS selected and IS known, and the
    // panel says it offers no style properties. Null would make it look
    // unselected.
    expect(inspection).not.toBeNull();
    expect(inspection?.sections).toEqual([]);
  });
});

describe("what a property carries", () => {
  it("carries the controls the property's shape declares", () => {
    register({ spacing: true });

    const inspection = inspectStyle(documentOf(), "a");
    const padding = inspection?.sections[0]?.properties.find(
      property => property.property === "padding"
    );

    // Four logical sides, so four controls under one property rather than one
    // control for the whole box.
    expect(padding?.controls.map(control => control.path.join("."))).toEqual([
      "blockStart",
      "blockEnd",
      "inlineStart",
      "inlineEnd",
    ]);
  });

  it("labels a property as a human reads it", () => {
    register({ layout: true });

    const inspection = inspectStyle(documentOf(), "a");
    const labels = new Map(
      (inspection?.sections[0]?.properties ?? []).map(property => [
        property.property,
        property.label,
      ])
    );

    expect(labels.get("flexDirection")).toBe("Flex direction");
    expect(labels.get("gridTemplateColumns")).toBe("Grid template columns");
  });

  it("reports which properties this node sets, and which it does not", () => {
    register({ spacing: true });
    const styles = {
      base: { [BASE_BREAKPOINT]: { margin: { blockStart: "8px" } } },
    } as NodeStyles;

    const inspection = inspectStyle(documentOf(styles), "a");
    const set = new Map(
      (inspection?.sections[0]?.properties ?? []).map(property => [
        property.property,
        property.set,
      ])
    );

    expect(set.get("margin")).toBe(true);
    expect(set.get("padding")).toBe(false);
  });

  it("reports a value stored at ANOTHER breakpoint as unset here", () => {
    // "Set" is about this address, not about what the element shows: a value
    // inherited from a wider breakpoint is not one this panel would clear, so
    // calling it set would offer a reset with nothing to reset.
    register({ spacing: true });
    const styles = {
      base: { md: { margin: { blockStart: "8px" } } },
    } as NodeStyles;

    const inspection = inspectStyle(documentOf(styles), "a");
    const margin = inspection?.sections[0]?.properties.find(
      property => property.property === "margin"
    );

    expect(margin?.set).toBe(false);
    expect(
      inspectStyle(documentOf(styles), "a", {
        breakpoint: "md",
      })?.sections[0]?.properties.find(p => p.property === "margin")?.set
    ).toBe(true);
  });

  it("reads the state and breakpoint it was given, defaulting to base", () => {
    register({ spacing: true });
    const styles = {
      hover: { [BASE_BREAKPOINT]: { padding: "4px" } },
    } as NodeStyles;

    expect(inspectStyle(documentOf(styles), "a")?.state).toBe("base");
    expect(inspectStyle(documentOf(styles), "a")?.breakpoint).toBe(
      BASE_BREAKPOINT
    );

    const hover = inspectStyle(documentOf(styles), "a", { state: "hover" });
    expect(
      hover?.sections[0]?.properties.find(p => p.property === "padding")?.set
    ).toBe(true);
  });
});

describe("a property the block no longer supports", () => {
  it("still offers a stored property outside supports, marked as not offered", () => {
    // Measured: neither validation nor compilation consults `supports`, so a
    // value written before a block update removed the capability — or written
    // through the API, which never had one — is still valid and still emitted.
    // Hiding it would show an author styling they can see and cannot clear.
    register({ spacing: true });
    const styles = {
      base: { [BASE_BREAKPOINT]: { fontSize: "20px" } },
    } as NodeStyles;

    const inspection = inspectStyle(documentOf(styles), "a");
    const typography = inspection?.sections.find(
      section => section.key === "typography"
    );

    expect(typography?.properties.map(p => p.property)).toEqual(["fontSize"]);
    expect(typography?.properties[0]?.offered).toBe(false);
    expect(typography?.properties[0]?.set).toBe(true);
  });

  it("lists a retained property in the CATALOG's order, not discovery order", () => {
    // The allowed set is built in two passes — supported, then retained — and a
    // `Set` iterates in insertion order, so a group holding both listed the
    // supported one first however the catalog declares them. `border` is
    // declared before `borderRadius`, and only the second is supported here.
    register({ border: { radius: true } });
    const styles = {
      base: { [BASE_BREAKPOINT]: { border: "1px solid red" } },
    } as NodeStyles;

    const inspection = inspectStyle(documentOf(styles), "a");
    const border = inspection?.sections.find(
      section => section.key === "border"
    );

    expect(border?.properties.map(p => p.property)).toEqual([
      "border",
      "borderRadius",
    ]);
  });

  it("marks a property the block does support as offered", () => {
    register({ spacing: true });

    const inspection = inspectStyle(documentOf(), "a");

    expect(inspection?.sections[0]?.properties.every(p => p.offered)).toBe(
      true
    );
  });

  it("does not offer an unsupported property the node does not store", () => {
    // The reachability rule is about values that EXIST. Without that bound the
    // panel would list the whole catalog for every block.
    register({ spacing: true });

    const inspection = inspectStyle(documentOf(), "a");

    expect(inspection?.sections.map(section => section.key)).toEqual([
      "spacing",
    ]);
  });
});

describe("when there is nothing to style", () => {
  it("answers null with no selection", () => {
    register({ spacing: true });
    expect(inspectStyle(documentOf(), null)).toBeNull();
  });

  it("answers null for an id the document no longer holds", () => {
    register({ spacing: true });
    expect(inspectStyle(documentOf(), "gone")).toBeNull();
  });

  it("offers NO sections for an unregistered block that stores nothing", () => {
    // Deliberately NOT registered. `supports` lives on the definition, so an
    // unregistered block has no statement of what it may set, and offering the
    // whole catalog would invite an author to style a block nothing can draw.
    //
    // An inspection with no sections rather than null, for the same reason a
    // block that opts into nothing gets one: this block IS selected, and null
    // is what the panel reads as "nothing selected". The two empty states say
    // different things to an author and only one of them is true here.
    const inspection = inspectStyle(documentOf(), "a");

    expect(inspection).not.toBeNull();
    expect(inspection?.sections).toEqual([]);
  });
});

describe("a block the registry does not know but that STORES styles", () => {
  /*
   * The panel used to answer null here, and the value went on compiling.
   * `compile-page.ts` walks every node and hands `node.styles` to
   * `envelopeRules` without consulting the registry, so a node whose plugin was
   * disabled still emits its styles — and withholding the panel left an author
   * looking at styling with nothing able to remove it.
   */
  const STORED = {
    base: { [BASE_BREAKPOINT]: { padding: { blockStart: "12px" } } },
  } as NodeStyles;

  it("offers the stored property so it can be cleared", () => {
    const inspection = inspectStyle(documentOf(STORED), "a");

    expect(inspection).not.toBeNull();
    const properties = (inspection?.sections ?? []).flatMap(
      section => section.properties
    );
    expect(properties.map(property => property.property)).toEqual(["padding"]);
  });

  it("offers it as CLEAR-ONLY, because no definition declares it supported", () => {
    // The separating property. Reporting `offered: true` would draw editable
    // controls and let an author write NEW values through a block that no
    // longer exists, which is the opposite error from hiding the panel.
    const inspection = inspectStyle(documentOf(STORED), "a");
    const padding = (inspection?.sections ?? [])
      .flatMap(section => section.properties)
      .find(property => property.property === "padding");

    expect(padding?.offered).toBe(false);
    expect(padding?.set).toBe(true);
  });

  it("offers ONLY what is stored, never the rest of the catalog", () => {
    // With no `supports` to read, the retaining pass is the only thing filling
    // the panel — so a catalog of fifty properties must not arrive as fifty
    // controls on a block nothing can draw.
    const inspection = inspectStyle(documentOf(STORED), "a");
    const properties = (inspection?.sections ?? []).flatMap(
      section => section.properties
    );

    expect(properties).toHaveLength(1);
    expect(inspection?.sections).toHaveLength(1);
  });
});

describe("the builder's sections, over the engine's groups", () => {
  it("orders sections Layout to Effects, whatever the engine's group order", () => {
    // The engine lists spacing before layout and position after effects; the
    // builder's order is Layout, Spacing, Size, Position, ..., Effects.
    register({
      spacing: true,
      layout: true,
      position: true,
      effects: true,
      dimensions: true,
    });
    const inspection = inspectStyle(documentOf(), "a");
    expect(inspection?.sections.map(section => section.label)).toEqual([
      "Layout",
      "Spacing",
      "Size",
      "Position",
      "Effects",
    ]);
  });

  it("puts colour inside Typography and shadow inside Effects", () => {
    register({ typography: true, color: true, shadow: true });
    const inspection = inspectStyle(documentOf(), "a");
    expect(inspection?.sections.map(section => section.key)).toEqual([
      "typography",
      "effects",
    ]);
    expect(propertiesOf(inspection, "typography")).toContain("color");
    expect(propertiesOf(inspection, "effects")).toEqual(["boxShadow"]);
  });

  it("lists a section's properties in the table's order, not the catalog's", () => {
    // The catalog declares boxSizing first among layout's properties; the
    // table moves it behind Size's More.
    register({ layout: true, dimensions: true });
    const inspection = inspectStyle(documentOf(), "a");
    expect(propertiesOf(inspection, "layout")[0]).toBe("display");
    expect(propertiesOf(inspection, "layout")).not.toContain("boxSizing");
    expect(propertiesOf(inspection, "size").at(-1)).toBe("boxSizing");
  });

  it("shows the common properties and keeps the rest for More", () => {
    register({ typography: true });
    const inspection = inspectStyle(documentOf(), "a");
    const typography = inspection?.sections.find(
      section => section.key === "typography"
    );
    const common = (typography?.properties ?? [])
      .filter(p => p.common)
      .map(p => p.property);
    expect(common).toEqual([
      "fontFamily",
      "fontWeight",
      "fontSize",
      "lineHeight",
      "textAlign",
    ]);
  });

  it("shows the flex controls once the block is a flex container", () => {
    register({ layout: true });
    const commonOf = (styles?: NodeStyles) =>
      (inspectStyle(documentOf(styles), "a")?.sections[0]?.properties ?? [])
        .filter(p => p.common)
        .map(p => p.property);
    expect(commonOf()).toEqual(["display"]);
    expect(
      commonOf({
        base: { [BASE_BREAKPOINT]: { display: "flex" } },
      } as NodeStyles)
    ).toEqual([
      "display",
      "flexDirection",
      "justifyContent",
      "alignItems",
      "gap",
      "flexWrap",
    ]);
  });

  it("shows the media fit controls on a replaced element only", () => {
    register({ dimensions: true });
    const fitIsCommon = (media: boolean) =>
      inspectStyle(documentOf(), "a", { media })?.sections[0]?.properties.find(
        p => p.property === "objectFit"
      )?.common;
    expect(fitIsCommon(false)).toBe(false);
    expect(fitIsCommon(true)).toBe(true);
  });
});

describe("which display the tiers read", () => {
  const breakpoints = {
    viewport: [
      { id: BASE_BREAKPOINT, label: "Desktop" },
      { id: "tablet", label: "Tablet", maxWidth: 1024 },
      { id: "mobile", label: "Mobile", maxWidth: 640 },
    ],
    container: [],
  } as never;
  const flexShown = (
    styles: NodeStyles,
    state: "base" | "hover",
    breakpoint: string
  ) =>
    inspectStyle(documentOf(styles), "a", {
      state,
      breakpoint: breakpoint as never,
      breakpoints,
    })?.sections[0]?.properties.find(p => p.property === "flexDirection")
      ?.common;

  it("reads the same state at a wider tier before the base state", () => {
    register({ layout: true });
    // Hover at mobile: hover set at tablet (wider) applies; the base state
    // at mobile says block, which a hover rule outranks.
    const styles = {
      hover: { tablet: { display: "flex" } },
      base: { mobile: { display: "block" } },
    } as unknown as NodeStyles;
    expect(flexShown(styles, "hover", "mobile")).toBe(true);
  });

  it("reads an intermediate tier before the unconditional one", () => {
    register({ layout: true });
    const styles = {
      base: {
        [BASE_BREAKPOINT]: { display: "block" },
        tablet: { display: "flex" },
      },
    } as unknown as NodeStyles;
    expect(flexShown(styles, "base", "mobile")).toBe(true);
    // The control: at the unconditional tier itself, block applies.
    expect(flexShown(styles, "base", BASE_BREAKPOINT)).toBe(false);
  });

  it("reads the container axis's unbounded tier at a bounded container tier", () => {
    register({ layout: true });
    // Every container context applies the axis's unbounded one too, as the
    // compiler emits it, so flex set there holds at the narrow card tier.
    const containers = {
      viewport: [{ id: BASE_BREAKPOINT, label: "Desktop" }],
      container: [
        { id: "card", label: "Card" },
        { id: "card-narrow", label: "Narrow card", maxWidth: 400 },
      ],
    } as never;
    const styles = {
      base: { card: { display: "flex" } },
    } as unknown as NodeStyles;
    const shown = (breakpoint: string) =>
      inspectStyle(documentOf(styles), "a", {
        breakpoint: breakpoint as never,
        breakpoints: containers,
      })?.sections[0]?.properties.find(p => p.property === "flexDirection")
        ?.common;
    expect(shown("card-narrow")).toBe(true);
    // The control: the viewport's unconditional tier is not on that axis.
    expect(shown(BASE_BREAKPOINT)).toBe(false);
  });

  it("lets the container axis's unbounded tier win over the unconditional one", () => {
    register({ layout: true });
    // Both carry no upper bound; the stylesheet emits the container rule
    // later, so it is the one that applies at a bounded container tier.
    const containers = {
      viewport: [{ id: BASE_BREAKPOINT, label: "Desktop" }],
      container: [
        { id: "card", label: "Card" },
        { id: "card-narrow", label: "Narrow card", maxWidth: 400 },
      ],
    } as never;
    const styles = {
      base: {
        [BASE_BREAKPOINT]: { display: "block" },
        card: { display: "flex" },
      },
    } as unknown as NodeStyles;
    const shown = (breakpoint: string) =>
      inspectStyle(documentOf(styles), "a", {
        breakpoint: breakpoint as never,
        breakpoints: containers,
      })?.sections[0]?.properties.find(p => p.property === "flexDirection")
        ?.common;
    expect(shown("card-narrow")).toBe(true);
    // The control: at the unconditional tier, block applies.
    expect(shown(BASE_BREAKPOINT)).toBe(false);
  });

  it("reads the compiled cascade, so a class's display counts", () => {
    register({ layout: true });
    // The node stores no display; a class it applies makes it a flex row.
    const trace = [
      {
        origin: { kind: "class", id: "c1", slug: "row" },
        property: "display",
        value: "flex",
        state: "base",
        breakpoint: BASE_BREAKPOINT,
      },
    ] as never;
    const shown = (classIds: readonly string[]) =>
      inspectStyle(documentOf(), "a", {
        cascade: { trace, subject: { nodeId: "a", classIds } },
      })?.sections[0]?.properties.find(p => p.property === "flexDirection")
        ?.common;
    expect(shown(["c1"])).toBe(true);
    // The control: a node that does not apply the class is not flex.
    expect(shown([])).toBe(false);
    // And without a cascade only what the node stores is read.
    expect(
      inspectStyle(documentOf(), "a")?.sections[0]?.properties.find(
        p => p.property === "flexDirection"
      )?.common
    ).toBe(false);
  });

  it("reads a block default at a wider tier through the cascade", () => {
    register({ layout: true });
    const trace = [
      {
        origin: { kind: "blockType", type: "acme/box" },
        property: "display",
        value: "flex",
        state: "base",
        breakpoint: "tablet",
        atRule: "@media (max-width: 1024px)",
      },
    ] as never;
    const shown = (breakpoint: string) =>
      inspectStyle(documentOf(), "a", {
        breakpoint: breakpoint as never,
        breakpoints,
        cascade: {
          trace,
          subject: { nodeId: "a", blockType: "acme/box" },
        },
      })?.sections[0]?.properties.find(p => p.property === "flexDirection")
        ?.common;
    expect(shown("mobile")).toBe(true);
    // The control: the tablet rule does not apply at the unconditional tier.
    expect(shown(BASE_BREAKPOINT)).toBe(false);
  });
});
