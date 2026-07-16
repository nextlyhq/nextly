import { describe, expect, it } from "vitest";

import {
  FIELD_TYPE_CATALOG,
  FORM_FIELD_TYPE_CATALOG,
  USER_FIELD_TYPE_CATALOG,
  getFieldTypeCatalogEntry,
  narrowFieldTypeCatalog,
} from "./catalog";
import { ALL_FIELD_TYPES } from "./types";

describe("FIELD_TYPE_CATALOG", () => {
  it("describes every canonical field type exactly once", () => {
    const catalogKeys = FIELD_TYPE_CATALOG.map(entry => entry.type);
    // Same set, no duplicates: a type missing here is invisible to every
    // picker, and a duplicate would render twice.
    expect(new Set(catalogKeys).size).toBe(catalogKeys.length);
    expect([...catalogKeys].sort()).toEqual([...ALL_FIELD_TYPES].sort());
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
