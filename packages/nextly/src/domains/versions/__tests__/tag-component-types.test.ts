/**
 * The component values a write reads back feed two consumers: the version
 * snapshot, which needs to know which component they came from, and the outbox
 * event, whose payload is documented as read shape. Tagging is what separates
 * them, so not mutating the shared object is the whole point.
 */
import { describe, it, expect } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import {
  tagComponentTypes,
  tagNestedComponentTypes,
} from "../tag-component-types";

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

describe("tagComponentTypes — inherited keys", () => {
  it("does not tag a field name that only matches an inherited property", () => {
    // `in` matches the prototype chain, so a field called `constructor` would
    // be treated as captured and tagged when nothing was read back for it.
    const fields = [
      { name: "constructor", type: "component", component: "banner" },
    ] as FieldConfig[];

    const tagged = tagComponentTypes({}, fields);

    expect(Object.prototype.hasOwnProperty.call(tagged, "constructor")).toBe(
      false
    );
  });

  it("still tags a field genuinely named that way when it was captured", () => {
    const fields = [
      { name: "constructor", type: "component", component: "banner" },
    ] as FieldConfig[];

    const tagged = tagComponentTypes({ constructor: { x: 1 } }, fields);

    expect(tagged.constructor).toEqual({ x: 1, _componentType: "banner" });
  });
});

describe("tagNestedComponentTypes", () => {
  const insideGroup = [
    {
      name: "meta",
      type: "group",
      fields: [{ name: "hero", type: "component", component: "banner" }],
    },
  ] as FieldConfig[];

  it("reaches a component declared inside a group", () => {
    // A group is one column, so the component value rides in the container's
    // JSON on the parent row rather than appearing as its own key.
    const row = { meta: { hero: { heading: "Hi" } } };

    const tagged = tagNestedComponentTypes(row, insideGroup) as {
      meta: { hero: Record<string, unknown> };
    };

    expect(tagged.meta.hero).toEqual({
      heading: "Hi",
      _componentType: "banner",
    });
  });

  it("leaves the row it was given untouched", () => {
    const row = { meta: { hero: { heading: "Hi" } } };

    tagNestedComponentTypes(row, insideGroup);

    expect(row.meta.hero).not.toHaveProperty("_componentType");
  });

  it("reaches through a repeater's rows", () => {
    const insideRepeater = [
      {
        name: "rows",
        type: "repeater",
        fields: [{ name: "hero", type: "component", component: "banner" }],
      },
    ] as FieldConfig[];

    const tagged = tagNestedComponentTypes(
      { rows: [{ hero: { a: 1 } }, { hero: { a: 2 } }] },
      insideRepeater
    ) as { rows: { hero: Record<string, unknown> }[] };

    expect(tagged.rows.map(r => r.hero._componentType)).toEqual([
      "banner",
      "banner",
    ]);
  });

  it("leaves scalars and absent keys alone", () => {
    const row = { title: "x" };

    expect(tagNestedComponentTypes(row, insideGroup)).toEqual({ title: "x" });
  });
});

describe("tagging through presentational groups", () => {
  // A group with no name lays fields out; its children are stored at the level
  // the group sits in, not under it. Skipping it without descending leaves a
  // component inside a layout group untagged, and that grouping is common.
  const layout = [
    {
      name: "",
      type: "group",
      fields: [{ name: "hero", type: "component", component: "banner" }],
    },
  ] as FieldConfig[];

  it("tags a component inside an unnamed group at the top level", () => {
    const tagged = tagComponentTypes({ hero: { heading: "Hi" } }, layout);

    expect(tagged.hero).toEqual({ heading: "Hi", _componentType: "banner" });
  });

  it("descends through nested unnamed groups", () => {
    const nestedLayout = [
      {
        name: "",
        type: "group",
        fields: [
          {
            name: "",
            type: "group",
            fields: [{ name: "hero", type: "component", component: "banner" }],
          },
        ],
      },
    ] as FieldConfig[];

    const tagged = tagComponentTypes({ hero: { heading: "Hi" } }, nestedLayout);

    expect(tagged.hero).toEqual({ heading: "Hi", _componentType: "banner" });
  });

  it("reaches one inside a named container through a layout group", () => {
    const mixed = [
      {
        name: "",
        type: "group",
        fields: [
          {
            name: "meta",
            type: "group",
            fields: [{ name: "hero", type: "component", component: "banner" }],
          },
        ],
      },
    ] as FieldConfig[];

    const tagged = tagNestedComponentTypes(
      { meta: { hero: { heading: "Hi" } } },
      mixed
    ) as { meta: { hero: Record<string, unknown> } };

    expect(tagged.meta.hero._componentType).toBe("banner");
  });
});
