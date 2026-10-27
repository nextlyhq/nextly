/**
 * Component read rules in history: which instances are judged, and which
 * top-level fields carry a rule when the rules cannot be evaluated.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import {
  clearFieldFunctions,
  registerFieldFunctions,
} from "../../../shared/lib/field-level-registry";
import {
  applyComponentReadAccess,
  fieldsCarryingReadRules,
  nestedWithheldPaths,
} from "../component-read-access";

afterEach(() => clearFieldFunctions());

const denied = { read: () => false };

function fields(...defs: Record<string, unknown>[]): FieldConfig[] {
  return defs as unknown as FieldConfig[];
}

const caller = {
  user: { id: "reader" },
  grants: () => Promise.resolve({ permissions: [], roles: [] }),
};

describe("applyComponentReadAccess", () => {
  it("judges a dynamic-zone block under either type key", async () => {
    registerFieldFunctions("fieldGroup", "card", [
      { name: "title", type: "text" },
      { name: "secret", type: "text", access: denied },
    ]);
    const entry = {
      blocks: [
        { _componentType: "card", title: "a", secret: "S-1" },
        // The spelling a migrated definition stores.
        { _fieldGroupType: "card", title: "b", secret: "S-2" },
      ],
    };

    await applyComponentReadAccess(
      entry,
      fields({ name: "blocks", type: "component", components: ["card"] }),
      new Map(),
      caller
    );

    expect(JSON.stringify(entry)).not.toMatch(/S-\d/);
    expect(JSON.stringify(entry)).toContain('"b"');
  });

  it("judges a live single component by its declared component, whatever type it claims", async () => {
    registerFieldFunctions("fieldGroup", "card", [
      { name: "title", type: "text" },
      { name: "secret", type: "text", access: denied },
    ]);
    // `plain` declares no rule: a value retagged as it must not escape `card`.
    registerFieldFunctions("fieldGroup", "plain", [
      { name: "title", type: "text" },
    ]);
    const entry = {
      hero: { _componentType: "plain", title: "a", secret: "S-1" },
    };

    await applyComponentReadAccess(
      entry,
      fields({ name: "hero", type: "component", component: "card" }),
      new Map(),
      { ...caller, declaredComponentDecides: true }
    );

    expect(entry.hero).not.toHaveProperty("secret");
    expect(entry.hero.title).toBe("a");
  });

  it("withholds a live dynamic-zone block whose type the zone does not allow", async () => {
    registerFieldFunctions("fieldGroup", "card", [
      { name: "title", type: "text" },
      { name: "secret", type: "text", access: denied },
    ]);
    // Readable only while the block holds no `secret`: judged after `card`
    // removed it, it would allow what the block as stored denies.
    registerFieldFunctions("fieldGroup", "quote", [
      { name: "secret", type: "text" },
      {
        name: "label",
        type: "text",
        access: {
          read: ({ data }: { data?: Record<string, unknown> }) =>
            !(data !== undefined && "secret" in data),
        },
      },
    ]);
    // `plain` declares no rule and the zone does not allow it.
    registerFieldFunctions("fieldGroup", "plain", [
      { name: "secret", type: "text" },
    ]);
    const entry = {
      blocks: [
        { title: "untagged", secret: "S-1", label: "L-1" },
        { _componentType: "ghost", secret: "S-2" },
        { _componentType: "plain", secret: "S-3" },
        // A type the zone allows is still judged by its own rules alone.
        { _componentType: "quote", secret: "kept" },
      ],
    };

    await applyComponentReadAccess(
      entry,
      fields({
        name: "blocks",
        type: "component",
        components: ["card", "quote"],
      }),
      new Map(),
      { ...caller, declaredComponentDecides: true }
    );

    expect(entry.blocks.slice(0, 3)).toEqual([{}, {}, {}]);
    expect(entry.blocks[3]).toEqual({
      _componentType: "quote",
      secret: "kept",
    });
  });

  it("judges the instances a container holds as JSON text, and keeps it text", async () => {
    // A hook may hand a group, a repeater or a field group back as JSON text,
    // the shape SQLite stores them in.
    registerFieldFunctions("fieldGroup", "card", [
      { name: "title", type: "text" },
      { name: "secret", type: "text", access: denied },
    ]);
    const entry: Record<string, unknown> = {
      meta: JSON.stringify({ hero: { title: "a", secret: "S-1" } }),
      rows: JSON.stringify([{ hero: { title: "b", secret: "S-2" } }]),
      hero: JSON.stringify({ title: "c", secret: "S-3" }),
    };
    const hero = { name: "hero", type: "component", component: "card" };

    await applyComponentReadAccess(
      entry,
      fields(
        { name: "meta", type: "group", fields: [hero] },
        { name: "rows", type: "repeater", fields: [hero] },
        hero
      ),
      new Map(),
      { ...caller, declaredComponentDecides: true }
    );

    expect(JSON.stringify(entry)).not.toMatch(/S-\d/);
    expect(typeof entry.meta).toBe("string");
    expect(JSON.parse(entry.meta as string)).toEqual({ hero: { title: "a" } });
    expect(JSON.parse(entry.hero as string)).toEqual({ title: "c" });
  });

  it("judges a version's single component by the type it was captured under", async () => {
    // The field now names `plain`; the snapshot was captured under `card`,
    // whose rule still withholds what the snapshot holds.
    registerFieldFunctions("fieldGroup", "card", [
      { name: "title", type: "text" },
      { name: "secret", type: "text", access: denied },
    ]);
    registerFieldFunctions("fieldGroup", "plain", [
      { name: "title", type: "text" },
    ]);
    const snapshot = {
      hero: { _componentType: "card", title: "a", secret: "S-1" },
    };

    await applyComponentReadAccess(
      snapshot,
      fields({ name: "hero", type: "component", component: "plain" }),
      new Map(),
      caller
    );

    expect(snapshot.hero).not.toHaveProperty("secret");
    expect(snapshot.hero.title).toBe("a");
  });
});

describe("malformed and serialized values", () => {
  const card = { name: "hero", type: "component", component: "card" };

  it("withholds a live field-group value that is not an instance", async () => {
    // A hook may replace a field-group value, or one instance of a list, with
    // a value that is not an instance at all, such as a denied field copied
    // out of it. No field group's rules can judge that, so it is withheld.
    registerFieldFunctions("fieldGroup", "card", [
      { name: "title", type: "text" },
      { name: "secret", type: "text", access: denied },
    ]);
    const entry: Record<string, unknown> = {
      hero: "S-1",
      list: [{ title: "a", secret: "S-2" }, "S-3"],
      text: JSON.stringify("S-4"),
    };

    await applyComponentReadAccess(
      entry,
      fields(
        card,
        { ...card, name: "list", repeatable: true },
        { ...card, name: "text" }
      ),
      new Map(),
      { ...caller, declaredComponentDecides: true }
    );

    expect(JSON.stringify(entry)).not.toMatch(/S-\d/);
    expect(entry.list).toEqual([{ title: "a" }]);
  });

  it("reports a withheld path inside a container held as JSON text", () => {
    const before = {
      meta: JSON.stringify({ hero: { title: "a", secret: "S-1" } }),
    };
    const after = { meta: JSON.stringify({ hero: { title: "a" } }) };

    const paths = nestedWithheldPaths(
      before,
      after,
      fields({ name: "meta", type: "group", fields: [card] }),
      new Map([["card", fields({ name: "title" }, { name: "secret" })]])
    );

    expect([...paths]).toEqual(["meta.hero.secret"]);
  });

  it("names a list row by its index, and a single group or instance by none", () => {
    // The second row lost the field, the first kept it; a value that is not
    // a row still holds its place, so the row after it is index 2, as the
    // stored list and the admin's form both count it. A list held as JSON
    // text is counted the same way.
    const rows = (secret: boolean) => [
      { title: "a", secret: "S-1" },
      secret ? { title: "b", secret: "S-2" } : { title: "b" },
      "not a row",
      secret ? { title: "c", secret: "S-3" } : { title: "c" },
    ];
    const before = {
      items: rows(true),
      text: JSON.stringify(rows(true)),
      banner: { title: "a", secret: "S-4" },
    };
    const after = {
      items: rows(false),
      text: JSON.stringify(rows(false)),
      banner: { title: "a" },
    };
    const inner = [{ name: "title" }, { name: "secret" }];

    const paths = nestedWithheldPaths(
      before,
      after,
      fields(
        { name: "items", type: "repeater", fields: inner },
        { name: "text", type: "repeater", fields: inner },
        { name: "banner", type: "group", fields: inner }
      ),
      new Map()
    );

    expect([...paths].sort()).toEqual([
      "banner.secret",
      "items.1.secret",
      "items.3.secret",
      "text.1.secret",
      "text.3.secret",
    ]);
  });
});

describe("fieldsCarryingReadRules", () => {
  it("finds a rule in a component nested in another component's group", () => {
    registerFieldFunctions("fieldGroup", "inner", [
      { name: "secret", type: "text", access: denied },
    ]);
    const components = new Map<string, FieldConfig[]>([
      [
        "outer",
        fields({
          name: "box",
          type: "group",
          fields: [{ name: "inside", type: "component", component: "inner" }],
        }),
      ],
      ["inner", fields({ name: "secret", type: "text" })],
    ]);

    expect(
      fieldsCarryingReadRules(
        "collection",
        fields(
          { name: "title", type: "text" },
          { name: "hero", type: "component", component: "outer" }
        ),
        components,
        "posts"
      )
    ).toEqual(["hero"]);
  });

  it("finds a rule in a component held by the entity's own group", () => {
    registerFieldFunctions("fieldGroup", "inner", [
      { name: "secret", type: "text", access: denied },
    ]);
    const components = new Map<string, FieldConfig[]>([
      ["inner", fields({ name: "secret", type: "text" })],
    ]);

    expect(
      fieldsCarryingReadRules(
        "collection",
        fields(
          { name: "title", type: "text" },
          {
            name: "meta",
            type: "group",
            fields: [{ name: "card", type: "component", component: "inner" }],
          }
        ),
        components,
        "posts"
      )
    ).toEqual(["meta"]);
  });
});

describe("a container that reaches itself", () => {
  // Raw config a plugin contributes is checked for field types only, so an
  // unnamed container whose fields include itself reaches the history walks.
  function cyclic(): FieldConfig[] {
    const layout: Record<string, unknown> = { type: "row", fields: [] };
    const banner: Record<string, unknown> = {
      name: "banner",
      type: "component",
      component: "card",
    };
    layout.fields = [banner, layout];
    const group: Record<string, unknown> = { name: "meta", type: "group" };
    group.fields = [group];
    return fields(layout, group);
  }

  it("is walked once per path, by every history walk", async () => {
    registerFieldFunctions("fieldGroup", "card", [
      { name: "secret", type: "text", access: denied },
    ]);
    const shape = cyclic();
    const components = new Map([
      ["card", fields({ name: "secret", type: "text" })],
    ]);
    const entry = { banner: { secret: "S" }, meta: {} };
    const before = structuredClone(entry);

    await applyComponentReadAccess(entry, shape, components, caller);
    expect(entry.banner).toEqual({});
    expect([...nestedWithheldPaths(before, entry, shape, components)]).toEqual([
      "banner.secret",
    ]);
    expect(
      fieldsCarryingReadRules("collection", shape, components, "posts")
    ).toEqual(["banner"]);
  });
});
