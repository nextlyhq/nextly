import { describe, expect, it } from "vitest";

import {
  computeMainFields,
  takeoverControllerNames,
  takeoverTypesFromBranding,
} from "./takeoverLayout";

const takeoverTypes = new Set(["page-builder"]);

const fields = [
  { name: "title", type: "text" },
  { name: "slug", type: "text" },
  { name: "editormode", type: "select" },
  {
    name: "content",
    type: "page-builder",
    admin: { condition: { field: "editormode", equals: "builder" } },
  },
  { name: "summary", type: "textarea" },
];

describe("computeMainFields", () => {
  it("strips title/slug and returns the full body when no takeover is active", () => {
    const out = computeMainFields(fields, {
      takeoverTypes,
      values: { editormode: "default" },
    });
    // content stays in the body — it self-hides via its own FieldRenderer condition.
    expect(out.map(f => f.name)).toEqual(["editormode", "content", "summary"]);
  });

  it("collapses to the takeover field + its controller when active", () => {
    const out = computeMainFields(fields, {
      takeoverTypes,
      values: { editormode: "builder" },
    });
    expect(out.map(f => f.name)).toEqual(["editormode", "content"]);
  });

  it("returns the full body when no takeover type is registered", () => {
    const out = computeMainFields(fields, {
      takeoverTypes: new Set(),
      values: { editormode: "builder" },
    });
    expect(out.map(f => f.name)).toEqual(["editormode", "content", "summary"]);
  });

  it("treats a takeover field with no condition as always active", () => {
    const f = [
      { name: "title", type: "text" },
      { name: "canvas", type: "page-builder" },
      { name: "summary", type: "textarea" },
    ];
    const out = computeMainFields(f, { takeoverTypes, values: {} });
    expect(out.map(x => x.name)).toEqual(["canvas"]);
  });
});

describe("takeoverTypesFromBranding", () => {
  it("collects only field types flagged layout: takeover", () => {
    const set = takeoverTypesFromBranding([
      {
        fieldTypes: [
          { type: "page-builder", layout: "takeover" },
          { type: "rating" },
        ],
      },
      { fieldTypes: [{ type: "map", layout: "takeover" }] },
    ]);
    expect([...set].sort()).toEqual(["map", "page-builder"]);
  });

  it("handles missing plugins/fieldTypes", () => {
    expect(takeoverTypesFromBranding(undefined).size).toBe(0);
    expect(takeoverTypesFromBranding([{}]).size).toBe(0);
  });
});

describe("takeoverControllerNames", () => {
  it("returns the controller field names of takeover fields", () => {
    expect(takeoverControllerNames(fields, takeoverTypes)).toEqual([
      "editormode",
    ]);
  });

  it("returns empty when no takeover field is present", () => {
    expect(takeoverControllerNames(fields, new Set())).toEqual([]);
  });
});
