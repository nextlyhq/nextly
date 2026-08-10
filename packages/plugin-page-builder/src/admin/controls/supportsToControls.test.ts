import { describe, expect, it } from "vitest";

import { defaultBlockRegistry } from "../../core/registry";
import { normalizeSupports } from "../../core/supports";
import { OBJECT_FIT_VALUES, OVERFLOW_VALUES } from "../../core/types";
import "../../render/blocks";

import { supportsToControls } from "./supportsToControls";

describe("supportsToControls", () => {
  it("groups typography + border controls from supports", () => {
    const groups = supportsToControls({
      typography: { fontSize: true, fontWeight: true },
      border: { radius: true },
    });
    const typo = groups.find(g => g.group === "Typography")!;
    expect(typo.controls.map(c => c.styleKey)).toEqual([
      "fontSize",
      "fontWeight",
    ]);
    const border = groups.find(g => g.group === "Border & Shadow")!;
    expect(border.controls.some(c => c.styleKey === "borderRadius")).toBe(true);
  });

  it("returns no groups for empty supports", () => {
    expect(supportsToControls({})).toEqual([]);
  });

  it("typography selects carry option lists (weight/case/decoration/appearance)", () => {
    const g = supportsToControls({ typography: true }).find(
      x => x.group === "Typography"
    )!;
    const weight = g.controls.find(c => c.styleKey === "fontWeight")!;
    expect(weight.control).toBe("select");
    expect(weight.options && weight.options.length).toBeGreaterThan(0);
    expect(
      g.controls.find(c => c.styleKey === "textTransform")!.options!.length
    ).toBeGreaterThan(0);
  });

  it("exposes gradient, width-alignment, shadow presets and link colors", () => {
    const groups = supportsToControls({
      background: { gradient: true },
      dimensions: { width: true },
      shadow: true,
      color: { link: true },
    });
    const flat = groups.flatMap(g => g.controls);
    expect(flat.some(c => c.control === "gradient")).toBe(true);
    expect(flat.some(c => c.styleKey === "widthAlign")).toBe(true);
    const shadow = flat.find(c => c.styleKey === "boxShadow")!;
    expect(shadow.control).toBe("select");
    expect(shadow.options!.some(o => o.label === "Deep")).toBe(true);
    expect(flat.some(c => c.styleKey === "linkColor")).toBe(true);
    expect(flat.some(c => c.styleKey === "linkColorHover")).toBe(true);
  });

  it("offers a reusable placement the typed style controls it can actually apply", () => {
    // A placement's classes are applied to the element its target renders, so these controls reach
    // a real element. Without them the Style tab reports that the block has no style options and
    // the capability is only reachable by editing the document by hand.
    const groups = supportsToControls(
      defaultBlockRegistry.get("core/ref")?.supports
    );
    const flat = groups.flatMap(g => g.controls);

    expect(flat.some(c => c.styleKey === "color")).toBe(true);
    expect(flat.some(c => c.styleKey === "backgroundColor")).toBe(true);
    expect(flat.some(c => c.styleKey === "margin")).toBe(true);
    expect(flat.some(c => c.styleKey === "maxWidth")).toBe(true);
  });

  it("does not offer a reusable placement a motion control it cannot honour", () => {
    // An entrance of "none" compiles to no declaration, and the placement shares an element with
    // its target — so choosing "none" on the placement could not switch off an animation the
    // target defines. The control would be present and inert.
    //
    // Asserted through `normalizeSupports`, which is what the inspector reads: `motion` defaults
    // ON there, so an absent key and an explicit `false` are the same value on the definition and
    // opposite values in the panel.
    const supports = defaultBlockRegistry.get("core/ref")?.supports;
    expect(normalizeSupports(supports).motion).toBe(false);
    // Positive control: this reads a real block whose motion IS on, so the assertion above is not
    // just a normalizer that returns false for everything.
    expect(
      normalizeSupports(defaultBlockRegistry.get("core/container")?.supports)
        .motion
    ).toBe(true);
  });

  it("does not offer a reusable placement a width-alignment control it cannot honour", () => {
    // Same reason motion is off: `widthAlign: "none"` compiles to no declaration, so choosing None
    // on a placement could not undo a target's Wide or Full — they share one element. The width,
    // max-width and margin controls reach the same result and do emit declarations.
    const forRef = supportsToControls(
      defaultBlockRegistry.get("core/ref")?.supports
    )
      .flatMap(g => g.controls)
      .map(c => c.styleKey);
    // Positive control: the placement DOES get the rest of the Layout & size group, so this is
    // about one control being withheld rather than the whole group being absent.
    expect(forRef).toContain("maxWidth");
    expect(forRef).not.toContain("widthAlign");

    // And every OTHER block still gets it without saying anything: the control was made
    // opt-OUT, not opt-in, because a block defined outside this repository cannot be migrated
    // and would otherwise lose it silently. `core/container` does not mention `widthAlign`.
    const forContainer = supportsToControls(
      defaultBlockRegistry.get("core/container")?.supports
    )
      .flatMap(g => g.controls)
      .map(c => c.styleKey);
    expect(forContainer).toContain("widthAlign");
    // Stated directly on a definition this repository does not own the shape of: a third-party
    // block declaring only `width` keeps the control it had before the flag existed.
    const thirdParty = supportsToControls({ dimensions: { width: true } })
      .flatMap(g => g.controls)
      .map(c => c.styleKey);
    expect(thirdParty).toContain("widthAlign");
  });

  it("gives every select the options it needs to be usable", () => {
    // A select with no options renders an empty menu: the capability is advertised in the panel
    // and cannot be set. Checked across the whole catalogue rather than one block, because the
    // gap is in the mapping and any block enabling that support inherits it.
    const empty = defaultBlockRegistry.all().flatMap(def =>
      supportsToControls(def.supports)
        .flatMap(g => g.controls)
        .filter(c => c.control === "select" && !c.options?.length)
        .map(c => `${def.type}.${c.styleKey}`)
    );

    expect(empty).toEqual([]);
  });

  it("offers exactly the values the typed style contract holds", () => {
    // A control offering a value the exported types reject lets the editor write a document a
    // block author or a consumer cannot represent without a cast. Both sides are now built from
    // one list, so this asserts they still are — a hand-written list reintroduced here is what it
    // catches, not a value-by-value comparison, which the shared source already makes impossible.
    //
    // It cannot be a type-level assertion HERE: this package's `check-types` runs `tsc` against a
    // config that excludes `**/*.test.ts*`, and unlike `nextly` and `blocks-react` it has no
    // second pass over a config that includes them — so a type error written in this file is
    // reported by nothing.
    const optionsFor = (key: string) =>
      supportsToControls({ dimensions: { overflow: true, objectFit: true } })
        .flatMap(g => g.controls)
        .find(c => c.styleKey === key)
        ?.options?.map(o => o.value);

    expect(optionsFor("overflow")).toEqual([...OVERFLOW_VALUES]);
    expect(optionsFor("objectFit")).toEqual([...OBJECT_FIT_VALUES]);
  });
});
