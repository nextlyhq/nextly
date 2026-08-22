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
  STYLE_GROUP_DEFS,
  stylePropertiesForSupports,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import { afterEach, describe, expect, it } from "vitest";

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
  const section = inspection?.sections.find(entry => entry.group === group);
  return (section?.properties ?? []).map(property => property.property);
}

describe("which sections a block offers", () => {
  it("offers a section per group the block supports, and no others", () => {
    register({ spacing: true, typography: true });

    const inspection = inspectStyle(documentOf(), "a");

    expect(inspection?.sections.map(section => section.group)).toEqual([
      "spacing",
      "typography",
    ]);
  });

  it("orders sections as the catalog presents them, not as supports lists them", () => {
    // Declared in the opposite order to the catalog's, so an implementation
    // walking `supports` would produce the reverse of this.
    register({ border: true, layout: true, spacing: true });

    const inspection = inspectStyle(documentOf(), "a");
    const order = STYLE_GROUP_DEFS.map(group => group.key).filter(key =>
      ["border", "layout", "spacing"].includes(key)
    );

    expect(inspection?.sections.map(section => section.group)).toEqual(order);
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

    expect(propertiesOf(inspection, "typography")).toEqual(
      stylePropertiesForSupports({ typography: true }).map(
        entry => entry.property
      )
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
      section => section.group === "typography"
    );

    expect(typography?.properties.map(p => p.property)).toEqual(["fontSize"]);
    expect(typography?.properties[0]?.offered).toBe(false);
    expect(typography?.properties[0]?.set).toBe(true);
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

    expect(inspection?.sections.map(section => section.group)).toEqual([
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

  it("answers null for a block the registry does not know", () => {
    // Deliberately NOT registered. `supports` lives on the definition, so an
    // unregistered block has no statement of what it may set — and offering the
    // whole catalog would let an author write styles the compiler then drops.
    expect(inspectStyle(documentOf(), "a")).toBeNull();
  });
});
