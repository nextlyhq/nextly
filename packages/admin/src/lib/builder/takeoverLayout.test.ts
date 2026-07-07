import { describe, expect, it } from "vitest";

import {
  computeMainFields,
  takeoverControllerNames,
  takeoverTypesFromBranding,
} from "./takeoverLayout";

const CANVAS_COMPONENT = "@nextlyhq/plugin-page-builder/admin#PageBuilderField";
const takeoverTypes = [{ type: "page-builder", component: CANVAS_COMPONENT }];

// UI-created shape: the canvas field uses the first-class `page-builder` type.
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

// Code-first shape: `json` field whose admin.component is the plugin editor.
const codeFirstFields = [
  { name: "editormode", type: "select" },
  {
    name: "content",
    type: "json",
    admin: {
      component: CANVAS_COMPONENT,
      condition: { field: "editormode", equals: "builder" },
    },
  },
  { name: "summary", type: "textarea" },
];

describe("computeMainFields", () => {
  it("strips title/slug and returns the full body when no takeover is active", () => {
    const out = computeMainFields(fields, {
      takeoverTypes,
      values: { editormode: "default" },
    });
    expect(out.map(f => f.name)).toEqual(["editormode", "content", "summary"]);
  });

  it("collapses to the takeover field + its controller when active (type match)", () => {
    const out = computeMainFields(fields, {
      takeoverTypes,
      values: { editormode: "builder" },
    });
    expect(out.map(f => f.name)).toEqual(["editormode", "content"]);
  });

  it("collapses via admin.component match (code-first json canvas field)", () => {
    const out = computeMainFields(codeFirstFields, {
      takeoverTypes,
      values: { editormode: "builder" },
    });
    expect(out.map(f => f.name)).toEqual(["editormode", "content"]);
  });

  it("never renders admin.hidden fields (plumbing kept out of the body)", () => {
    const withHidden = [
      { name: "headline", type: "text" },
      { name: "editormode", type: "select", admin: { hidden: true } },
      {
        name: "content",
        type: "page-builder",
        admin: { condition: { field: "editormode", equals: "builder" } },
      },
    ];
    // Default: hidden editormode excluded; headline + content remain.
    const def = computeMainFields(withHidden, {
      takeoverTypes,
      values: { editormode: "default" },
    });
    expect(def.map(f => f.name)).toEqual(["headline", "content"]);
    // Builder: takeover active → only the canvas (hidden controller excluded).
    const builder = computeMainFields(withHidden, {
      takeoverTypes,
      values: { editormode: "builder" },
    });
    expect(builder.map(f => f.name)).toEqual(["content"]);
  });

  it("returns the full body when no takeover type is registered", () => {
    const out = computeMainFields(fields, {
      takeoverTypes: [],
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
  it("collects field types flagged layout: takeover with their component", () => {
    const out = takeoverTypesFromBranding([
      {
        fieldTypes: [
          {
            type: "page-builder",
            component: CANVAS_COMPONENT,
            layout: "takeover",
          },
          { type: "rating", component: "x#R" },
        ],
      },
      { fieldTypes: [{ type: "map", component: "x#M", layout: "takeover" }] },
    ]);
    expect(out.map(t => t.type).sort()).toEqual(["map", "page-builder"]);
    expect(out.find(t => t.type === "page-builder")?.component).toBe(
      CANVAS_COMPONENT
    );
  });

  it("handles missing plugins/fieldTypes", () => {
    expect(takeoverTypesFromBranding(undefined)).toEqual([]);
    expect(takeoverTypesFromBranding([{}])).toEqual([]);
  });
});

describe("takeoverControllerNames", () => {
  it("returns the controller field names of takeover fields", () => {
    expect(takeoverControllerNames(fields, takeoverTypes)).toEqual([
      "editormode",
    ]);
  });

  it("returns empty when no takeover field is present", () => {
    expect(takeoverControllerNames(fields, [])).toEqual([]);
  });
});
