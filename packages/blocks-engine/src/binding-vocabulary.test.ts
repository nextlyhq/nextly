/**
 * The binding vocabulary: the one table of what each field type produces and
 * what each prop type accepts, the picker's question asked of it, and the
 * renderer's question derived from the picker's.
 */
import { describe, expect, it } from "vitest";

import {
  bindablePropKind,
  fieldFitsProp,
  type BindingFieldShape,
} from "./binding-rules";
import {
  bindingKindOf,
  canBindFieldToProp,
  FIELD_TYPE_BINDING_KIND,
} from "./binding-vocabulary";

const field = (shape: Partial<BindingFieldShape> & { type: string }) => ({
  name: "f",
  ...shape,
});

describe("which fields a picker offers for a prop", () => {
  it("offers a number or a date for a text prop, since a format makes text of it", () => {
    expect(canBindFieldToProp({ type: "number" }, { type: "text" })).toBe(true);
    expect(canBindFieldToProp({ type: "date" }, { type: "text" })).toBe(true);
    expect(canBindFieldToProp({ type: "richText" }, { type: "text" })).toBe(
      false
    );
  });

  it("offers an image only a media field or a URL field, and a link only a URL field", () => {
    expect(canBindFieldToProp({ type: "upload" }, { type: "media" })).toBe(
      true
    );
    expect(canBindFieldToProp({ type: "url" }, { type: "media" })).toBe(true);
    expect(canBindFieldToProp({ type: "text" }, { type: "media" })).toBe(false);
    expect(canBindFieldToProp({ type: "url" }, { type: "url" })).toBe(true);
    expect(canBindFieldToProp({ type: "text" }, { type: "url" })).toBe(false);
  });

  it("offers an icon field wherever text fits, since its id is a string", () => {
    expect(bindingKindOf({ type: "icon" })).toBe("text");
    expect(canBindFieldToProp({ type: "icon" }, { type: "text" })).toBe(true);
    expect(canBindFieldToProp({ type: "icon" }, { type: "media" })).toBe(false);
    // An icon prop takes an icon field, a text field or a select of ids, and
    // nothing that is not a string.
    expect(canBindFieldToProp({ type: "icon" }, { type: "icon" })).toBe(true);
    expect(canBindFieldToProp({ type: "select" }, { type: "icon" })).toBe(true);
    expect(canBindFieldToProp({ type: "text" }, { type: "icon" })).toBe(true);
    expect(canBindFieldToProp({ type: "number" }, { type: "icon" })).toBe(
      false
    );
    expect(canBindFieldToProp({ type: "upload" }, { type: "icon" })).toBe(
      false
    );
    // Its own value and its fallback are judged as text: an id is a string.
    expect(bindablePropKind({ type: "icon" })).toBe("text");
  });

  it("offers an email prop text only", () => {
    expect(canBindFieldToProp({ type: "text" }, { type: "email" })).toBe(true);
    expect(canBindFieldToProp({ type: "select" }, { type: "email" })).toBe(
      false
    );
  });

  it("requires the cardinality to agree", () => {
    expect(
      canBindFieldToProp({ type: "text", hasMany: true }, { type: "text" })
    ).toBe(false);
    expect(
      canBindFieldToProp(
        { type: "chips", hasMany: true },
        { type: "chips", hasMany: true }
      )
    ).toBe(true);
  });

  it("requires reference targets, and how they are stored, to agree", () => {
    const prop = { type: "relationship", relationTo: ["authors", "editors"] };
    expect(
      canBindFieldToProp(
        { type: "relationship", relationTo: ["authors"] },
        prop
      )
    ).toBe(true);
    // Same collection, stored as a bare id rather than a pair.
    expect(
      canBindFieldToProp({ type: "relationship", relationTo: "authors" }, prop)
    ).toBe(false);
    expect(
      canBindFieldToProp({ type: "relationship", relationTo: ["posts"] }, prop)
    ).toBe(false);
  });

  it("judges a plugin's field type by the primitive it stores as", () => {
    expect(bindingKindOf({ type: "plugin/rating" })).toBeNull();
    expect(bindingKindOf({ type: "plugin/rating", storage: "number" })).toBe(
      "number"
    );
    expect(
      canBindFieldToProp(
        { type: "plugin/when", storage: "timestamp" },
        { type: "date" }
      )
    ).toBe(true);
  });

  it("never offers a password, a group or a repeater", () => {
    for (const type of ["password", "group", "repeater"] as const) {
      expect(FIELD_TYPE_BINDING_KIND[type]).toBeNull();
    }
  });
});

describe("whether a value fills its prop as it is", () => {
  it("is derived from the picker: what it does not offer never fits", () => {
    expect(fieldFitsProp(field({ type: "richText" }), { type: "text" })).toBe(
      false
    );
    expect(
      fieldFitsProp(field({ type: "text", hasMany: true }), { type: "text" })
    ).toBe(false);
  });

  it("needs a format for a number or a date reaching text, but not for a choice", () => {
    expect(fieldFitsProp(field({ type: "number" }), { type: "text" })).toBe(
      false
    );
    expect(fieldFitsProp(field({ type: "date" }), { type: "text" })).toBe(
      false
    );
    expect(fieldFitsProp(field({ type: "select" }), { type: "text" })).toBe(
      true
    );
  });

  it("fills a choice prop only from a choice field whose values it allows", () => {
    const prop = { type: "select", options: ["a", "b"] };
    expect(fieldFitsProp(field({ type: "select", options: ["a"] }), prop)).toBe(
      true
    );
    expect(
      fieldFitsProp(field({ type: "select", options: ["a", "z"] }), prop)
    ).toBe(false);
    expect(fieldFitsProp(field({ type: "text" }), prop)).toBe(false);
  });
});
