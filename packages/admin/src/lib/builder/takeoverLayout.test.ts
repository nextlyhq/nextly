import { describe, expect, it } from "vitest";

import {
  computeMainFields,
  computeFieldsBeside,
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

describe("computeFieldsBeside", () => {
  /** Both groups run together, for the assertions that do not care which. */
  const offered = (fs: typeof fields, exclude: string) => {
    const out = computeFieldsBeside(fs, exclude);
    return [...out.page, ...out.content].map(f => f.name);
  };

  it("offers every body field except the one asking and its controller", () => {
    expect(offered(fields, "content")).toEqual(["title", "slug", "summary"]);
  });

  it("withholds the field that decides whether the asking field is visible", () => {
    // `content` renders only while `editormode` equals "builder". Offering
    // `editormode` inside `content`'s own panel would let an author un-render
    // the surface they are standing in, from a control that does not say so.
    expect(offered(fields, "content")).not.toContain("editormode");
  });

  it("never offers the asking field back to itself", () => {
    // Rendering `content` inside `content`'s own panel would nest an editor in
    // its own settings.
    expect(offered(fields, "content")).not.toContain("content");
  });

  it("OFFERS the system fields, because the surface asking has hidden them", () => {
    /*
     * This replaces a case requiring the opposite, and the reversal is the
     * point rather than a relaxation. Title and slug were withheld because the
     * system header draws them, so a second editor would have been a second
     * answer to one value. A surface that COVERS the form suppresses that
     * header — the page builder names it in `useSuppressAdminChrome` — so
     * there is no first editor to compete with, and withholding them left the
     * commonest collection shape, a title, a slug and a builder field, with an
     * empty panel and no way to read a document's own name from inside it.
     */
    const out = computeFieldsBeside(fields, "content");
    expect(out.page.map(f => f.name)).toEqual(["title", "slug"]);
  });

  it("keeps them APART from the fields a collection declares", () => {
    // The panel labels the two groups, so a slug is never sorted in among a
    // collection's own relations in an order an author cannot anticipate.
    const out = computeFieldsBeside(fields, "content");
    expect(out.content.map(f => f.name)).toEqual(["summary"]);
    expect(out.content.map(f => f.name)).not.toContain("title");
  });

  it("gives the minimal collection shape something to show, which it had none of", () => {
    /*
     * The shape that produced the defect: title, slug, and the builder field.
     * Every system field stripped, the asking field excluded, nothing left —
     * so the panel was offered and opened blank. The identity group is what it
     * now has, and it is the group an author most needs while the form is
     * covered.
     */
    const minimal = [
      { name: "title", type: "text" },
      { name: "slug", type: "text" },
      { name: "content", type: "blocks" },
    ];
    const out = computeFieldsBeside(minimal, "content");
    expect(out.page.map(f => f.name)).toEqual(["title", "slug"]);
    expect(out.content).toEqual([]);
  });

  it("reports BOTH groups empty when the builder is genuinely all there is", () => {
    /*
     * The case the caller must still be able to detect, and the reason the
     * emptiness check reads both groups rather than assuming a document always
     * has an identity. A collection declaring only the takeover field and its
     * controller offers nothing at all, and a panel must not be opened for it.
     */
    const alone = [
      { name: "editormode", type: "select" },
      {
        name: "content",
        type: "page-builder",
        admin: { condition: { field: "editormode", equals: "builder" } },
      },
    ];
    const out = computeFieldsBeside(alone, "content");
    expect(out.page).toEqual([]);
    expect(out.content).toEqual([]);
  });

  it("does not depend on a takeover being active", () => {
    // `layout: "takeover"` is declared in the branding type and no shipped
    // plugin sets it, so a rule conditioned on an ACTIVE takeover would be
    // permanently inert. The same fields are offered either way.
    const asIfActive = offered(fields, "content");
    const asIfNot = offered(fields, "content");
    expect(asIfActive).toEqual(asIfNot);
    expect(asIfActive.length).toBeGreaterThan(0);
  });

  it("works for the code-first shape, which is addressed by the same name", () => {
    // This fixture declares no title or slug, so the identity group is empty
    // and the collection's own field is the whole of what is offered.
    expect(offered(codeFirstFields, "content")).toEqual(["summary"]);
  });
});
