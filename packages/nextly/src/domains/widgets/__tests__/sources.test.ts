import { beforeEach, describe, expect, it } from "vitest";

import {
  clearSources,
  getSource,
  listSources,
  registerSource,
  replaceSourcesOfKind,
  type WidgetOp,
  type WidgetSource,
  type WidgetSourceField,
} from "../sources";

const VALID_SOURCE: WidgetSource = {
  id: "collection:posts",
  label: "Posts",
  kind: "collection",
  supports: ["count", "list"],
  fields: [
    { name: "title", type: "string" },
    { name: "status", type: "string" },
  ],
};

beforeEach(() => {
  clearSources();
});

describe("registerSource / getSource", () => {
  it("registers a well-formed source and makes it retrievable", () => {
    registerSource(VALID_SOURCE);
    expect(getSource("collection:posts")).toEqual(VALID_SOURCE);
  });

  it("returns undefined for a source that was never registered", () => {
    expect(getSource("collection:nope")).toBeUndefined();
  });

  it("refuses a duplicate id", () => {
    registerSource(VALID_SOURCE);
    expect(() => registerSource(VALID_SOURCE)).toThrow(
      /Widget source "collection:posts" is already registered/
    );
  });
});

describe("listSources / clearSources", () => {
  it("lists every registered source", () => {
    registerSource(VALID_SOURCE);
    registerSource({ ...VALID_SOURCE, id: "collection:pages", label: "Pages" });
    expect(
      listSources()
        .map(s => s.id)
        .sort()
    ).toEqual(["collection:pages", "collection:posts"]);
  });

  it("returns an empty list when nothing is registered", () => {
    expect(listSources()).toEqual([]);
  });

  it("empties the store", () => {
    registerSource(VALID_SOURCE);
    clearSources();
    expect(listSources()).toEqual([]);
    expect(getSource("collection:posts")).toBeUndefined();
  });
});

describe("registerSource validation (M8)", () => {
  it("refuses an empty id", () => {
    expect(() => registerSource({ ...VALID_SOURCE, id: "" })).toThrow(
      /id is required and must be a non-empty string/
    );
  });

  it("refuses a missing label", () => {
    expect(() => registerSource({ ...VALID_SOURCE, label: "" })).toThrow(
      /label is required/
    );
  });

  it("refuses an unknown kind", () => {
    expect(() =>
      registerSource({
        ...VALID_SOURCE,
        kind: "spreadsheet" as unknown as WidgetSource["kind"],
      })
    ).toThrow(/kind must be one of/);
  });

  it("refuses empty supports", () => {
    expect(() => registerSource({ ...VALID_SOURCE, supports: [] })).toThrow(
      /supports must be a non-empty array of ops/
    );
  });

  it("refuses an unknown op in supports", () => {
    expect(() =>
      registerSource({
        ...VALID_SOURCE,
        supports: [
          "count",
          "explode" as unknown as WidgetSource["supports"][number],
        ],
      })
    ).toThrow(/supports names an unknown op "explode"/);
  });

  it("refuses empty fields", () => {
    expect(() => registerSource({ ...VALID_SOURCE, fields: [] })).toThrow(
      /fields must be a non-empty array/
    );
  });

  it("refuses a field with no name", () => {
    expect(() =>
      registerSource({
        ...VALID_SOURCE,
        fields: [{ name: "", type: "string" }],
      })
    ).toThrow(/every field requires a non-empty name/);
  });

  it("refuses a field with an unknown type", () => {
    expect(() =>
      registerSource({
        ...VALID_SOURCE,
        fields: [
          {
            name: "title",
            type: "money" as unknown as WidgetSource["fields"][number]["type"],
          },
        ],
      })
    ).toThrow(/field "title" has an unknown type "money"/);
  });

  it("refuses duplicate field names", () => {
    expect(() =>
      registerSource({
        ...VALID_SOURCE,
        fields: [
          { name: "title", type: "string" },
          { name: "title", type: "string" },
        ],
      })
    ).toThrow(/field "title" is declared more than once/);
  });
});

describe("a source id's namespace and its kind are one fact", () => {
  // The two were validated independently, so `{ id: "collection:posts", kind:
  // "plugin" }` passed. `replaceSourcesOfKind("collection", ...)` then
  // preserved it BY KIND, and publishing the real `collection:posts` collided
  // -- `refreshCollectionSources` threw before any batch slot ran, so every
  // dashboard query request failed on one squatting plugin.
  it("refuses a plugin-kind source in the collection namespace", () => {
    expect(() =>
      registerSource({
        ...VALID_SOURCE,
        id: "collection:posts",
        kind: "plugin",
      })
    ).toThrow(/namespace "collection:" is reserved for kind "collection"/);
  });

  it("refuses a plugin-kind source in the single namespace", () => {
    expect(() =>
      registerSource({ ...VALID_SOURCE, id: "single:homepage", kind: "plugin" })
    ).toThrow(/namespace "single:" is reserved for kind "single"/);
  });

  it("refuses a plugin-kind source in the system namespace", () => {
    expect(() =>
      registerSource({ ...VALID_SOURCE, id: "system:users", kind: "plugin" })
    ).toThrow(/namespace "system:" is reserved for kind "system"/);
  });

  it("refuses a collection-kind source OUTSIDE the collection namespace", () => {
    // Both directions. A `collection` kind under `plugin:` is the same
    // disagreement pointing the other way, and it is the one that survives a
    // collection rebuild by claiming a kind that rebuild deletes.
    expect(() =>
      registerSource({
        ...VALID_SOURCE,
        id: "plugin:acme/revenue",
        kind: "collection",
      })
    ).toThrow(/kind "collection" requires the "collection:" namespace/);
  });

  it("accepts a plugin source in its own namespace", () => {
    registerSource({
      ...VALID_SOURCE,
      id: "plugin:acme/revenue",
      kind: "plugin",
    });
    expect(getSource("plugin:acme/revenue")?.kind).toBe("plugin");
  });

  it("accepts an unprefixed plugin source", () => {
    // No reserved namespace, so nothing is being claimed and `plugin` is the
    // only kind that can be meant.
    registerSource({ ...VALID_SOURCE, id: "revenue", kind: "plugin" });
    expect(getSource("revenue")?.kind).toBe("plugin");
  });

  it("lets a collection refresh publish the namespace it owns", () => {
    // The half that makes the refusal worth having: with the squatter refused
    // at registration, the real source publishes.
    expect(() =>
      registerSource({
        ...VALID_SOURCE,
        id: "collection:posts",
        kind: "plugin",
      })
    ).toThrow();
    expect(() =>
      replaceSourcesOfKind("collection", [VALID_SOURCE])
    ).not.toThrow();
    expect(getSource("collection:posts")?.label).toBe("Posts");
  });
});

describe("a registered source is a detached snapshot", () => {
  // Registration is the only place `validateWidgetSource` runs, so a plugin
  // that kept the object it passed could edit `fields`, `supports`, `kind` or
  // `id` afterwards -- and `validateWidgetQuery` would then check a query
  // against an allowlist nothing ever validated. The widget REGISTRY already
  // stores a detached, frozen copy for exactly this; sources now match it.
  it("ignores a field appended to the caller's array after registration", () => {
    const declared: WidgetSource = {
      id: "collection:posts",
      label: "Posts",
      kind: "collection",
      supports: ["count"],
      fields: [{ name: "title", type: "string" }],
    };
    registerSource(declared);

    (declared.fields as WidgetSourceField[]).push({
      name: "salary",
      type: "number",
    });

    expect(getSource("collection:posts")?.fields.map(f => f.name)).toEqual([
      "title",
    ]);
  });

  it("ignores an op added to the caller's supports after registration", () => {
    const declared: WidgetSource = {
      ...VALID_SOURCE,
      supports: ["count"],
    };
    registerSource(declared);
    (declared.supports as WidgetOp[]).push("list");
    expect(getSource("collection:posts")?.supports).toEqual(["count"]);
  });

  it("ignores a kind or id rewritten on the caller's object", () => {
    const declared = { ...VALID_SOURCE };
    registerSource(declared);
    declared.kind = "plugin";
    declared.id = "collection:elsewhere";
    const stored = getSource("collection:posts");
    expect(stored?.kind).toBe("collection");
    expect(stored?.id).toBe("collection:posts");
  });

  it("hands back a value a reader cannot mutate", () => {
    // Detached alone is not enough: a copy returned unfrozen is edited through
    // the getter, which puts the caller back where they started.
    registerSource(VALID_SOURCE);
    const stored = getSource("collection:posts") as WidgetSource;
    expect(() => {
      (stored.fields as WidgetSourceField[]).push({
        name: "salary",
        type: "number",
      });
    }).toThrow();
    expect(getSource("collection:posts")?.fields).toHaveLength(2);
  });

  it("detaches what listSources hands back too", () => {
    registerSource(VALID_SOURCE);
    const [listed] = listSources();
    expect(Object.isFrozen(listed)).toBe(true);
  });
});
