/**
 * The component values a working draft holds, read off the draft for a
 * publish to write.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import {
  draftComponentValues,
  mergeComponentPatches,
} from "../draft-components";

function field(def: Record<string, unknown>): FieldConfig {
  return def as unknown as FieldConfig;
}

const fields = [
  field({ name: "title", type: "text" }),
  field({ name: "hero", type: "component", component: "hero" }),
  field({
    name: "cards",
    type: "component",
    component: "card",
    repeatable: true,
  }),
];

describe("draftComponentValues", () => {
  it("returns the component fields a draft holds, and nothing else", () => {
    expect(
      draftComponentValues(
        { title: "T", hero: { heading: "H" }, cards: [{ label: "A" }] },
        fields
      )
    ).toEqual({ hero: { heading: "H" }, cards: [{ label: "A" }] });
  });

  it("leaves out a component field the draft does not hold", () => {
    expect(draftComponentValues({ title: "T" }, fields)).toEqual({});
  });

  it("reads only the draft's own keys, never an inherited one", () => {
    // A component field may be named like an Object.prototype member; a draft
    // without it must not hand back the inherited function as its value.
    const named = [
      field({ name: "constructor", type: "component", component: "hero" }),
    ];
    expect(draftComponentValues({ title: "T" }, named)).toEqual({});
  });
});

describe("mergeComponentPatches", () => {
  it("merges a single component's sub-fields and replaces a list whole", () => {
    const schemas = new Map([
      [
        "hero",
        {
          fields: [
            field({ name: "heading", type: "text" }),
            field({ name: "subheading", type: "text" }),
          ],
        },
      ],
    ]) as unknown as Parameters<typeof mergeComponentPatches>[3];
    expect(
      mergeComponentPatches(
        {
          hero: { heading: "Old", subheading: "Keep" },
          cards: [{ label: "A" }],
        },
        { hero: { heading: "New" }, cards: [{ label: "B" }] },
        fields,
        schemas
      )
    ).toEqual({
      hero: { heading: "New", subheading: "Keep" },
      cards: [{ label: "B" }],
    });
  });
});
