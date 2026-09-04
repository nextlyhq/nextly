import { describe, expect, it } from "vitest";

import { STORAGE_FORMAT } from "../../schemas/storage-format";

import {
  BINDABLE_KINDS,
  BLOCK_FIELD_TYPES,
  BLOCK_FIELD_TYPE_CATALOG,
  FIELD_TYPE_BINDING_KIND,
  FIELD_TYPE_CATALOG,
  FORM_FIELD_TYPE_CATALOG,
  USER_FIELD_TYPE_CATALOG,
  bindingKindOf,
  canBindFieldToProp,
  getFieldTypeCatalogEntry,
  isBindablePropType,
  isBlockFieldType,
  narrowFieldTypeCatalog,
} from "./catalog";
import { ALL_FIELD_TYPES } from "./types";

describe("FIELD_TYPE_CATALOG", () => {
  it("describes every canonical field type exactly once", () => {
    const catalogKeys = FIELD_TYPE_CATALOG.map(entry => entry.type);
    // Same set, no duplicates: a type missing here is invisible to every
    // picker, and a duplicate would render twice. fieldGroup is absent by
    // design — it is the migrated spelling of component, not a second field
    // kind, so the picker keeps one entry and new fields keep writing the
    // storage spelling.
    expect(new Set(catalogKeys).size).toBe(catalogKeys.length);
    expect([...catalogKeys].sort()).toEqual(
      ALL_FIELD_TYPES.filter(type => type !== "fieldGroup").sort()
    );
  });

  it("gives every entry a non-empty label, hint, and icon name", () => {
    for (const entry of FIELD_TYPE_CATALOG) {
      expect(entry.label.length, entry.type).toBeGreaterThan(0);
      expect(entry.hint.length, entry.type).toBeGreaterThan(0);
      expect(entry.icon.length, entry.type).toBeGreaterThan(0);
    }
  });

  it("orders categories Basic → Advanced → Media → Relational → Structured", () => {
    const order = ["Basic", "Advanced", "Media", "Relational", "Structured"];
    const seen = FIELD_TYPE_CATALOG.map(entry => order.indexOf(entry.category));
    // Category indexes never decrease as the catalog is read top to bottom,
    // so the picker's sticky headers appear in the documented order.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
  });

  it("looks up an entry by key", () => {
    expect(getFieldTypeCatalogEntry("select")?.label).toBe("Select");
    expect(getFieldTypeCatalogEntry("text")?.category).toBe("Basic");
  });

  it("narrows to a surface's subset in catalog order", () => {
    const subset = narrowFieldTypeCatalog(["date", "text", "select"]);
    expect(subset.map(entry => entry.type)).toEqual(["text", "date", "select"]);
  });
});

describe("FORM_FIELD_TYPE_CATALOG", () => {
  it("describes the form surface's thirteen types exactly once", () => {
    const types = FORM_FIELD_TYPE_CATALOG.map(entry => entry.type);
    expect(new Set(types).size).toBe(types.length);
    expect([...types].sort()).toEqual(
      [
        "text",
        "textarea",
        "number",
        "email",
        "url",
        "phone",
        "select",
        "radio",
        "checkbox",
        "date",
        "time",
        "file",
        "hidden",
      ].sort()
    );
  });

  it("slots url and phone beside email, and time beside date", () => {
    const types = FORM_FIELD_TYPE_CATALOG.map(entry => entry.type);
    const email = types.indexOf("email");
    expect(types[email + 1]).toBe("url");
    expect(types[email + 2]).toBe("phone");
    const date = types.indexOf("date");
    expect(types[date + 1]).toBe("time");
  });

  it("keeps categories in display order (Basic before Advanced before Media)", () => {
    const order = ["Basic", "Advanced", "Media", "Relational", "Structured"];
    const indices = FORM_FIELD_TYPE_CATALOG.map(entry =>
      order.indexOf(entry.category)
    );
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
    }
  });

  it("gives every form-surface type an icon distinct from canonical entries", () => {
    const canonicalIcons = new Set(FIELD_TYPE_CATALOG.map(e => e.icon));
    for (const surfaceOnly of ["url", "phone", "time", "file", "hidden"]) {
      const entry = FORM_FIELD_TYPE_CATALOG.find(e => e.type === surfaceOnly);
      expect(entry && canonicalIcons.has(entry.icon)).toBe(false);
    }
  });

  it("keeps the surface-only types out of the canonical catalog", () => {
    for (const surfaceOnly of ["time", "file", "hidden"]) {
      expect(
        FIELD_TYPE_CATALOG.find(entry => entry.type === surfaceOnly)
      ).toBeUndefined();
    }
  });

  it("shares the url and phone descriptions with the user surface", () => {
    for (const shared of ["url", "phone"] as const) {
      const formEntry = FORM_FIELD_TYPE_CATALOG.find(e => e.type === shared);
      const userEntry = USER_FIELD_TYPE_CATALOG.find(e => e.type === shared);
      expect(formEntry).toEqual(userEntry);
    }
  });

  it("gives every entry a non-empty label, hint, and icon name", () => {
    for (const entry of FORM_FIELD_TYPE_CATALOG) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.hint.length).toBeGreaterThan(0);
      expect(entry.icon.length).toBeGreaterThan(0);
    }
  });
});

describe("BLOCK_FIELD_TYPE_CATALOG", () => {
  it("is the canonical catalog minus password and component", () => {
    const types = BLOCK_FIELD_TYPE_CATALOG.map(entry => entry.type);
    expect(new Set(types).size).toBe(types.length);
    // fieldGroup is excluded beside component: it is the same field kind's
    // migrated spelling, and a block prop can no more be a field group than
    // it can be a component.
    expect([...types].sort()).toEqual(
      ALL_FIELD_TYPES.filter(
        type =>
          type !== "password" && type !== "component" && type !== "fieldGroup"
      ).sort()
    );
  });

  it("adds no surface-only types, so every entry maps to a field config", () => {
    const canonical = new Set(FIELD_TYPE_CATALOG.map(entry => entry.type));
    for (const entry of BLOCK_FIELD_TYPE_CATALOG) {
      expect(canonical.has(entry.type), entry.type).toBe(true);
    }
  });

  it("lists the same types the type list does, in catalog order", () => {
    expect(BLOCK_FIELD_TYPE_CATALOG.map(entry => entry.type)).toEqual(
      FIELD_TYPE_CATALOG.map(entry => entry.type).filter(type =>
        (BLOCK_FIELD_TYPES as readonly string[]).includes(type)
      )
    );
  });

  it("recognizes block prop types and rejects everything else", () => {
    expect(isBlockFieldType("richText")).toBe(true);
    expect(isBlockFieldType("password")).toBe(false);
    expect(isBlockFieldType("component")).toBe(false);
    expect(isBlockFieldType("fieldGroup")).toBe(false);
    expect(isBlockFieldType("url")).toBe(false);
    expect(isBlockFieldType("nope")).toBe(false);
  });
});

describe("binding kinds", () => {
  it("assigns a source kind to every canonical field type", () => {
    for (const type of ALL_FIELD_TYPES) {
      expect(FIELD_TYPE_BINDING_KIND).toHaveProperty(type);
    }
  });

  it("declares accepted kinds for every block prop type", () => {
    for (const type of BLOCK_FIELD_TYPES) {
      expect(BINDABLE_KINDS[type]).toBeDefined();
    }
  });

  it("never accepts a kind no field type can produce", () => {
    const producible = new Set(
      Object.values(FIELD_TYPE_BINDING_KIND).filter(kind => kind !== null)
    );
    for (const accepted of Object.values(BINDABLE_KINDS)) {
      for (const kind of accepted) {
        expect(producible.has(kind), kind).toBe(true);
      }
    }
  });

  it("makes bindability a property of the prop type", () => {
    expect(isBindablePropType({ type: "text" })).toBe(true);
    expect(isBindablePropType({ type: "upload" })).toBe(true);
    // Structured props are composed, not bound.
    expect(isBindablePropType({ type: "repeater" })).toBe(false);
    expect(isBindablePropType({ type: "group" })).toBe(false);
    // Not a block prop type at all.
    expect(isBindablePropType({ type: "password" })).toBe(false);
  });

  it("pairs compatible source fields with props", () => {
    expect(canBindFieldToProp({ type: "text" }, { type: "text" })).toBe(true);
    expect(canBindFieldToProp({ type: "email" }, { type: "text" })).toBe(true);
    expect(canBindFieldToProp({ type: "number" }, { type: "text" })).toBe(true);
    expect(canBindFieldToProp({ type: "select" }, { type: "radio" })).toBe(
      true
    );
    expect(canBindFieldToProp({ type: "upload" }, { type: "upload" })).toBe(
      true
    );
    expect(
      canBindFieldToProp({ type: "relationship" }, { type: "relationship" })
    ).toBe(true);
  });

  it("refuses pairs the renderer would have to coerce", () => {
    // Rich text is structured editor content; a plain string is not it.
    expect(canBindFieldToProp({ type: "text" }, { type: "richText" })).toBe(
      false
    );
    expect(canBindFieldToProp({ type: "richText" }, { type: "text" })).toBe(
      false
    );
    expect(canBindFieldToProp({ type: "number" }, { type: "checkbox" })).toBe(
      false
    );
    // A to-many repeater is iterated by a loop, never flattened into a prop.
    expect(canBindFieldToProp({ type: "repeater" }, { type: "text" })).toBe(
      false
    );
    // Secrets never leave the server.
    expect(canBindFieldToProp({ type: "password" }, { type: "text" })).toBe(
      false
    );
  });

  it("requires the two ends to agree on cardinality", () => {
    const many = { type: "select", hasMany: true };
    const single = { type: "select" };
    expect(canBindFieldToProp(many, single)).toBe(false);
    expect(canBindFieldToProp(single, many)).toBe(false);
    expect(canBindFieldToProp(many, many)).toBe(true);
    expect(canBindFieldToProp(single, single)).toBe(true);
    // A multi-upload produces an array of references.
    expect(
      canBindFieldToProp(
        { type: "upload", hasMany: true },
        { type: "upload", hasMany: true }
      )
    ).toBe(true);
    expect(
      canBindFieldToProp({ type: "upload", hasMany: true }, { type: "upload" })
    ).toBe(false);
  });

  it("resolves a plugin type through its storage primitive", () => {
    // A plugin type is not in the built-in union, so its primitive decides
    // what it produces and what it accepts.
    expect(bindingKindOf({ type: "rating", storage: "number" })).toBe("number");
    expect(
      canBindFieldToProp(
        { type: "number" },
        { type: "rating", storage: "number" }
      )
    ).toBe(true);
    expect(
      canBindFieldToProp(
        { type: "rating", storage: "number" },
        { type: "text" }
      )
    ).toBe(true);
    expect(
      canBindFieldToProp(
        { type: "rating", storage: "number" },
        { type: "checkbox" }
      )
    ).toBe(false);
  });

  it("requires reference endpoints to agree on their collections", () => {
    // Binding does not rewrite a reference, so a users document cannot fill a
    // prop that relates to posts even though both ends are of kind reference.
    expect(
      canBindFieldToProp(
        { type: "relationship", relationTo: "users" },
        { type: "relationship", relationTo: "posts" }
      )
    ).toBe(false);
    // Same collection, different storage shape: a single target stores a bare
    // id while a list of targets stores a { relationTo, value } pair, and
    // binding does not rewrite the value it moves.
    expect(
      canBindFieldToProp(
        { type: "relationship", relationTo: "posts" },
        { type: "relationship", relationTo: ["posts", "pages"] }
      )
    ).toBe(false);
    expect(
      canBindFieldToProp(
        { type: "relationship", relationTo: ["posts"] },
        { type: "relationship", relationTo: ["posts", "pages"] }
      )
    ).toBe(true);
    expect(
      canBindFieldToProp(
        { type: "relationship", relationTo: ["posts"] },
        { type: "relationship", relationTo: "posts" }
      )
    ).toBe(false);
    // A source that can yield pages cannot fill a posts-only prop.
    expect(
      canBindFieldToProp(
        { type: "relationship", relationTo: ["posts", "pages"] },
        { type: "relationship", relationTo: "posts" }
      )
    ).toBe(false);
    expect(
      canBindFieldToProp(
        { type: "upload", relationTo: "media" },
        { type: "upload", relationTo: "media" }
      )
    ).toBe(true);
  });

  it("skips the target check when an endpoint declares no collections", () => {
    // Omitting targets says nothing about collection identity, so it must not
    // be read as a claim to accept any.
    expect(
      canBindFieldToProp(
        { type: "relationship" },
        { type: "relationship", relationTo: "posts" }
      )
    ).toBe(true);
    expect(
      canBindFieldToProp(
        { type: "relationship", relationTo: "posts" },
        { type: "relationship" }
      )
    ).toBe(true);
  });

  it("rejects unknown types on either side", () => {
    expect(bindingKindOf({ type: "nope" })).toBeNull();
    expect(canBindFieldToProp({ type: "nope" }, { type: "text" })).toBe(false);
    expect(canBindFieldToProp({ type: "text" }, { type: "nope" })).toBe(false);
    expect(canBindFieldToProp({ type: "text" }, { type: "password" })).toBe(
      false
    );
    // A prototype member is not a field type.
    expect(canBindFieldToProp({ type: "toString" }, { type: "text" })).toBe(
      false
    );
  });
});

// The field group's field type has two spellings that must not be confused: what the picker SHOWS
// and what gets written to disk. The label was renamed with the rest of the vocabulary; the stored
// value deliberately was not, because changing it rewrites `fields` JSON in three registry tables.
//
// This pins them apart. A sweep that renames the label and takes the value with it would pass every
// other test in the suite while silently making existing content unreadable.
describe("field group entry: display name vs stored value", () => {
  const entry = FIELD_TYPE_CATALOG.find(f => f.label === "Field Group");

  it("presents itself as a field group", () => {
    expect(entry).toBeDefined();
    expect(entry?.hint).toBe("Embed a reusable field group");
  });

  it("still stores the value the on-disk format defines, not the label", () => {
    expect(entry?.type).toBe(STORAGE_FORMAT.fieldType);
    expect(STORAGE_FORMAT.fieldType).toBe("component");
  });

  // No catalog entry may present itself with the pre-rename vocabulary.
  it("leaves no catalog entry labelled or hinted 'component'", () => {
    const stale = FIELD_TYPE_CATALOG.filter(
      f => /component/i.test(f.label) || /component/i.test(f.hint ?? "")
    );
    expect(stale.map(f => f.label)).toEqual([]);
  });
});
