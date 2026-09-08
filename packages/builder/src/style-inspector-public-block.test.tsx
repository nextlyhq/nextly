/**
 * A block declared the way a THIRD PARTY declares one gets a full inspector.
 *
 * The other inspector suites build their fixtures as object literals passed to
 * `registerBlocks` through `as never`. That is convenient and it removes the
 * property this file exists for: the cast is exactly what takes the public
 * contract out of the path, so those suites prove the inspector derives from a
 * supports declaration and cannot prove a plugin author can produce one.
 *
 * So the fixture below goes through `defineBlock`, which is what the plugin SDK
 * re-exports to third parties, and is registered WITHOUT A CAST. If the public
 * definition shape and the registry ever disagree, this file stops compiling —
 * which is the failure a plugin author would hit, arriving here instead of in
 * their project.
 *
 * "Zero custom editor code" is the other half, and it is asserted by omission
 * with a control: the definition declares no `editor` and no inspector
 * components, and the assertions below show the sections and controls appear
 * anyway. The control is the LAST test, which registers a block supporting
 * nothing and requires an empty inspector — without it, an `inspectStyle` that
 * returned every group for every block would satisfy everything above.
 *
 * @module style-inspector-public-block.test
 */
import {
  BASE_BREAKPOINT,
  clearBlocks,
  defineBlock,
  registerBlocks,
  STYLE_GROUP_DEFS,
  stylePropertiesForSupports,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { afterEach, describe, expect, it } from "vitest";

import { inspectStyle, type StyleInspection } from "./style-inspector";

interface CalloutProps {
  /** The callout's body text. */
  text?: string;
}

/**
 * A third-party block: declared through the public API, carrying no editor
 * code of any kind.
 *
 * `supports` names three groups and no properties within them, which is the
 * ordinary way an author opts in — the properties each group offers are the
 * catalog's answer, not this definition's.
 */
const acmeCallout = defineBlock<CalloutProps>({
  name: "acme/callout",
  version: 1,
  description: "A callout an author can style but not configure.",
  props: {
    text: { type: "string", label: "Text" },
  },
  defaultProps: { text: "" },
  example: { props: { text: "Heads up" } },
  supports: {
    spacing: true,
    typography: true,
    color: true,
  },
  render: () => null,
});

/** A block that opts into nothing, so "everything is offered" cannot pass. */
const acmeInert = defineBlock<CalloutProps>({
  name: "acme/inert",
  version: 1,
  description: "A block with no style opt-in at all.",
  props: {
    text: { type: "string", label: "Text" },
  },
  defaultProps: { text: "" },
  example: { props: { text: "Nothing to style" } },
  supports: {},
  render: () => null,
});

afterEach(() => {
  clearBlocks();
});

/** A document holding one node of the given block type. */
function documentOf(type: string): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "a", type, version: 1, props: {} }] as BlockNode[],
  } as BlockDocument;
}

/**
 * The inspection for one node, refusing rather than returning null.
 *
 * `inspectStyle` answers `null` when the selection names no node, and a test
 * reading `?.sections` on that would report an empty inspector — the same shape
 * as a block that opts into nothing, which is this file's control. Failing here
 * keeps the two apart.
 */
function inspect(type: string): StyleInspection {
  registerBlocks([type === "acme/inert" ? acmeInert : acmeCallout], {
    source: "public-block-test",
  });
  const inspection = inspectStyle(documentOf(type), "a", {
    breakpoint: BASE_BREAKPOINT,
  });
  if (inspection === null) {
    throw new Error(`inspectStyle found no node for ${type}`);
  }
  return inspection;
}

describe("a block declared through the public API", () => {
  it("registers without a cast, which is the contract a plugin author compiles against", () => {
    // The assertion is that this line type-checks and does not throw. A
    // definition the registry refuses at runtime, or a shape `registerBlocks`
    // will not accept at compile time, both fail here — and both are what a
    // third party would hit first.
    expect(() =>
      registerBlocks([acmeCallout], { source: "public-block-test" })
    ).not.toThrow();
  });

  it("gets a section for every group it supports, with no editor code of its own", () => {
    const groups = inspect("acme/callout").sections.map(s => s.group);

    // Exactly the three it opted into. `toEqual` on a sorted list rather than
    // three `toContain`s, so a section it did NOT opt into fails here instead
    // of passing unnoticed.
    expect([...groups].sort()).toEqual(["color", "spacing", "typography"]);
  });

  it("orders those sections as the catalog presents them, not as supports lists them", () => {
    const groups = inspect("acme/callout").sections.map(s => s.group);

    const catalogOrder = STYLE_GROUP_DEFS.map(g => g.key).filter(k =>
      groups.includes(k)
    );
    // The definition lists spacing, typography, color; the catalog's own order
    // is what an author sees. A block author cannot reorder another block's
    // inspector by the order they happened to type their supports.
    expect(groups).toEqual(catalogOrder);
  });

  it("offers every property the engine says those supports allow, not merely some", () => {
    const sections = inspect("acme/callout").sections;

    // The expectation is the ENGINE's answer rather than a list written here.
    // Two reasons, and the second is why a count would not do: a list written
    // here would agree with itself and stop tracking the catalog, and an
    // inspector that kept only the FIRST property of each group satisfies
    // "every section is non-empty" while presenting a partial inspector — the
    // exact failure the phrase "complete inspector" is about.
    for (const section of sections) {
      const offered = section.properties.map(property => property.property);
      const allowed = stylePropertiesForSupports({
        [section.group]: true,
      }).map(entry => entry.property);

      // Membership rather than length: a section that dropped one property and
      // gained another matches any total compared against.
      expect(offered).toEqual(allowed);
    }
  });

  it("gives every offered property at least one control to edit it with", () => {
    // Separate from the property set above, because they fail differently: a
    // property present with no control is a labelled row an author cannot
    // touch, which reads as a bug in the control rather than in the inspector.
    const sections = inspect("acme/callout").sections;

    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      for (const property of section.properties) {
        expect(property.controls.length).toBeGreaterThan(0);
      }
    }
  });

  it("offers nothing for a block that opts into nothing", () => {
    // The control for all three assertions above. An `inspectStyle` that
    // ignored `supports` and returned the whole catalog would pass every test
    // in this file except this one.
    expect(inspect("acme/inert").sections).toEqual([]);
  });
});
