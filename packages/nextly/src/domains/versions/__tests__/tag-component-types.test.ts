/**
 * The component values a write reads back feed two consumers: the version
 * snapshot, which needs to know which component they came from, and the outbox
 * event, whose payload is documented as read shape. Tagging is what separates
 * them, so not mutating the shared object is the whole point.
 */
import { describe, it, expect } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { NextlyError } from "../../../errors";
import {
  resolveComponentFieldMap,
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

describe("tagging a component inside another component", () => {
  // The inner component's values live in the outer component's deserialized
  // object, so the same walk reaches them — it just needs the inner schema,
  // which the capture site resolves and passes in.
  const outer = [
    { name: "hero", type: "component", component: "wrapper" },
  ] as FieldConfig[];

  const resolve = (slug: string) =>
    slug === "wrapper"
      ? ([
          { name: "heading", type: "text" },
          { name: "inner", type: "component", component: "leaf" },
        ] as FieldConfig[])
      : slug === "leaf"
        ? ([{ name: "deep", type: "text" }] as FieldConfig[])
        : undefined;

  it("tags the inner component as well as the outer", () => {
    const tagged = tagComponentTypes(
      { hero: { heading: "Hi", inner: { deep: "value" } } },
      outer,
      resolve
    ) as { hero: { _componentType: string; inner: Record<string, unknown> } };

    expect(tagged.hero._componentType).toBe("wrapper");
    expect(tagged.hero.inner).toEqual({
      deep: "value",
      _componentType: "leaf",
    });
  });

  it("tags only the outer one when no resolver is supplied", () => {
    // The previous behaviour, kept working: without the inner schema there is
    // nothing to say what the nested value is.
    const tagged = tagComponentTypes(
      { hero: { heading: "Hi", inner: { deep: "value" } } },
      outer
    ) as { hero: { _componentType: string; inner: Record<string, unknown> } };

    expect(tagged.hero._componentType).toBe("wrapper");
    expect(tagged.hero.inner).not.toHaveProperty("_componentType");
  });

  it("terminates on a component that reaches itself", () => {
    const selfRef = (slug: string) =>
      slug === "node"
        ? ([
            { name: "child", type: "component", component: "node" },
          ] as FieldConfig[])
        : undefined;

    const tagged = tagComponentTypes(
      { hero: { child: { child: {} } } },
      [{ name: "hero", type: "component", component: "node" }] as FieldConfig[],
      selfRef
    ) as { hero: Record<string, unknown> };

    expect(tagged.hero._componentType).toBe("node");
  });

  it("still leaves the value it was given untouched", () => {
    const components = { hero: { inner: { deep: "value" } } };

    tagComponentTypes(components, outer, resolve);

    expect(components.hero.inner).not.toHaveProperty("_componentType");
  });
});

describe("tagging finite data through a self-referential schema", () => {
  // `node` holds another `node`. The schema is cyclic; the stored data is a
  // finite chain, and every level of it belongs to `node`.
  const root = [
    { name: "root", type: "component", component: "node" },
  ] as FieldConfig[];
  const resolve = (slug: string) =>
    slug === "node"
      ? ([
          { name: "child", type: "component", component: "node" },
        ] as FieldConfig[])
      : undefined;

  it("tags every level, not just the first repeated one", () => {
    const tagged = tagComponentTypes(
      { root: { depth: 1, child: { depth: 2, child: { depth: 3 } } } },
      root,
      resolve
    ) as {
      root: {
        _componentType: string;
        child: { _componentType: string; child: { _componentType: string } };
      };
    };

    expect(tagged.root._componentType).toBe("node");
    expect(tagged.root.child._componentType).toBe("node");
    // The level a slug-keyed guard stopped at.
    expect(tagged.root.child.child._componentType).toBe("node");
  });

  it("terminates on a value that refers back to itself", () => {
    const cycle: Record<string, unknown> = { depth: 1 };
    cycle.child = cycle;

    const tagged = tagComponentTypes({ root: cycle }, root, resolve) as {
      root: { _componentType: string };
    };

    expect(tagged.root._componentType).toBe("node");
  });
});

describe("tagging inside dynamic-zone rows", () => {
  // A zone row already records its own type. What it does NOT record is the
  // type of a single component nested inside it.
  const zone = [
    { name: "blocks", type: "components", components: ["hero", "quote"] },
  ] as FieldConfig[];
  const resolve = (slug: string) =>
    slug === "hero"
      ? ([
          { name: "inner", type: "component", component: "leaf" },
        ] as FieldConfig[])
      : undefined;

  it("tags a component nested inside a row, using the row's own schema", () => {
    const tagged = tagComponentTypes(
      {
        blocks: [
          { _componentType: "hero", inner: { deep: "value" } },
          { _componentType: "quote", text: "hi" },
        ],
      },
      zone,
      resolve
    ) as { blocks: Array<Record<string, unknown>> };

    expect(tagged.blocks[0].inner).toEqual({
      deep: "value",
      _componentType: "leaf",
    });
    // The row's own marker is the editor's choice and is left as it was.
    expect(tagged.blocks[0]._componentType).toBe("hero");
    // A row whose schema resolves to nothing is untouched.
    expect(tagged.blocks[1]).toEqual({ _componentType: "quote", text: "hi" });
  });

  it("leaves a row naming a component the field does not allow", () => {
    const tagged = tagComponentTypes(
      { blocks: [{ _componentType: "smuggled", inner: { deep: "value" } }] },
      zone,
      resolve
    ) as { blocks: Array<Record<string, unknown>> };

    expect(tagged.blocks[0].inner).toEqual({ deep: "value" });
  });

  it("does not mutate the rows the outbox event carries", () => {
    const rows = [{ _componentType: "hero", inner: { deep: "value" } }];
    const source = { blocks: rows };

    tagComponentTypes(source, zone, resolve);

    expect(rows[0].inner).toEqual({ deep: "value" });
  });
});

describe("resolveComponentFieldMap", () => {
  it("resolves nested component schemas to a fixed point", async () => {
    const schemas: Record<string, FieldConfig[]> = {
      wrapper: [
        { name: "inner", type: "component", component: "leaf" },
      ] as FieldConfig[],
      leaf: [{ name: "deep", type: "text" }] as FieldConfig[],
    };

    const map = await resolveComponentFieldMap(
      [
        { name: "hero", type: "component", component: "wrapper" },
      ] as FieldConfig[],
      async slug => schemas[slug] ?? null
    );

    expect([...map.keys()].sort()).toEqual(["leaf", "wrapper"]);
  });

  it("terminates on a cycle", async () => {
    const map = await resolveComponentFieldMap(
      [{ name: "hero", type: "component", component: "node" }] as FieldConfig[],
      async () =>
        [
          { name: "child", type: "component", component: "node" },
        ] as FieldConfig[]
    );

    expect([...map.keys()]).toEqual(["node"]);
  });

  it("omits a component the registry does not know", async () => {
    // Absent is a real answer: the walk stops there and the save proceeds.
    const map = await resolveComponentFieldMap(
      [{ name: "hero", type: "component", component: "gone" }] as FieldConfig[],
      async () => null
    );

    expect(map.size).toBe(0);
  });

  it("propagates a failed lookup instead of treating it as absent", async () => {
    // A lookup that errors says nothing about whether the component exists.
    // Swallowing it would store a snapshot whose nested values carry no type,
    // which a later restore prunes against the wrong schema.
    await expect(
      resolveComponentFieldMap(
        [
          { name: "hero", type: "component", component: "gone" },
        ] as FieldConfig[],
        async () => {
          // What the registry lookup actually raises: it wraps driver errors
          // through `NextlyError.fromDatabaseError` rather than throwing raw.
          throw NextlyError.internal({
            logContext: { reason: "connection lost" },
          });
        }
      )
    ).rejects.toThrow(NextlyError);
  });
});
