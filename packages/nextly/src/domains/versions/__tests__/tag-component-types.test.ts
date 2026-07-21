/**
 * The component values a write reads back feed two consumers: the version
 * snapshot, which needs to know which component they came from, and the outbox
 * event, whose payload is documented as read shape. Tagging is what separates
 * them, so not mutating the shared object is the whole point.
 */
import { describe, it, expect } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { tagComponentTypes } from "../tag-component-types";

const singleComponent = [
  { name: "hero", type: "component", component: "banner" },
] as FieldConfig[];

describe("tagComponentTypes", () => {
  it("records the component a single-component field named", () => {
    const tagged = tagComponentTypes(
      { hero: { heading: "Hi" } },
      singleComponent
    );

    expect(tagged.hero).toEqual({ heading: "Hi", _componentType: "banner" });
  });

  it("leaves the value it was given untouched", () => {
    // The outbox event carries the original. Mutating it would put a key in
    // every webhook that no ordinary read produces.
    const components = { hero: { heading: "Hi" } };

    const tagged = tagComponentTypes(components, singleComponent);

    expect(components.hero).not.toHaveProperty("_componentType");
    expect(tagged).not.toBe(components);
    expect(tagged.hero).not.toBe(components.hero);
  });

  it("tags every instance of a repeatable single component", () => {
    const repeatable = [
      { name: "cards", type: "component", component: "card", repeatable: true },
    ] as FieldConfig[];

    const tagged = tagComponentTypes(
      { cards: [{ text: "a" }, { text: "b" }] },
      repeatable
    );

    expect(tagged.cards).toEqual([
      { text: "a", _componentType: "card" },
      { text: "b", _componentType: "card" },
    ]);
  });

  it("leaves a dynamic zone alone", () => {
    // Those rows already store a type, chosen per row by the editor rather than
    // implied by the schema — there is nothing to infer and nothing to add.
    const zone = [
      { name: "blocks", type: "component", components: ["a", "b"] },
    ] as FieldConfig[];
    const value = { blocks: [{ _componentType: "a", x: 1 }] };

    expect(tagComponentTypes(value, zone)).toEqual(value);
  });

  it("ignores a field with no captured value", () => {
    const tagged = tagComponentTypes({}, singleComponent);

    expect(tagged).toEqual({});
  });

  it("passes through when the schema names no single component", () => {
    const tagged = tagComponentTypes({ title: "x" }, [
      { name: "title", type: "text" },
    ] as FieldConfig[]);

    expect(tagged).toEqual({ title: "x" });
  });

  it("leaves a null value as null rather than making an object of it", () => {
    // A cleared component field is how the save path is told to delete rows.
    const tagged = tagComponentTypes({ hero: null }, singleComponent);

    expect(tagged.hero).toBeNull();
  });
});
