import { describe, expect, it } from "vitest";

import {
  NO_STYLE_CONTROL_BEHAVIOUR,
  styleControlBehaviour,
  styleControlBehaviourKey,
  type StyleControlBehaviours,
} from "./style-control-behaviour";

describe("addressing behaviour by the catalog's own identity", () => {
  it("keys a plain property by its catalog key", () => {
    expect(styleControlBehaviourKey("opacity", [])).toBe("opacity");
  });

  it("keys a position inside a composite by property and path", () => {
    expect(styleControlBehaviourKey("margin", ["blockEnd"])).toBe(
      "margin.blockEnd"
    );
  });

  it("keeps two sides of one property distinct", () => {
    // The separating property against a key built from the property alone:
    // registering a spoken form for the bottom margin must not also speak for
    // the top one.
    expect(styleControlBehaviourKey("margin", ["blockEnd"])).not.toBe(
      styleControlBehaviourKey("margin", ["blockStart"])
    );
  });

  it("needs nothing added to the catalog to address a control", () => {
    // The whole point of the rule: the key is derived from what the catalog
    // already says, so `catalog.ts` stays data and gains no field for this.
    expect(
      styleControlBehaviourKey("inventedByThisTest", ["deep", "path"])
    ).toBe("inventedByThisTest.deep.path");
  });
});

describe("looking behaviour up", () => {
  it("ships with nothing registered", () => {
    expect(NO_STYLE_CONTROL_BEHAVIOUR.size).toBe(0);
    expect(
      styleControlBehaviour(NO_STYLE_CONTROL_BEHAVIOUR, "opacity", [])
    ).toBeUndefined();
  });

  it("returns what a host registered under the derived key", () => {
    // The positive control for the absence above: a lookup that answered
    // undefined unconditionally would satisfy that test forever.
    const behaviours: StyleControlBehaviours = new Map([
      [
        "margin.blockEnd",
        { ariaValueText: (value: unknown) => `${String(value)}, medium` },
      ],
    ]);
    const found = styleControlBehaviour(behaviours, "margin", ["blockEnd"]);
    expect(found?.ariaValueText?.("24px")).toBe("24px, medium");
  });

  it("does not answer for a control nothing was registered for", () => {
    const behaviours: StyleControlBehaviours = new Map([
      ["margin.blockEnd", {}],
    ]);
    expect(
      styleControlBehaviour(behaviours, "margin", ["blockStart"])
    ).toBeUndefined();
  });
});
