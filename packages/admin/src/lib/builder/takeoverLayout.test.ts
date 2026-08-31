import { describe, expect, it } from "vitest";

import {
  computeMainFields,
  computeFieldsBeside,
  conditionFieldNames,
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

describe("fields nested inside a group", () => {
  /** A group whose single child renders only in the classic editor. */
  const grouped = [
    { name: "title", type: "text" },
    { name: "slug", type: "text" },
    { name: "body", type: "blocks" },
    {
      name: "seo",
      type: "group",
      fields: [
        {
          name: "legacy",
          type: "text",
          admin: { condition: { field: "mode", equals: "classic" } },
        },
      ],
    },
  ];

  it("watches the child's condition at its QUALIFIED path, not its bare name", () => {
    /*
     * `FieldRenderer` resolves a nested condition against the field's own base,
     * so this child watches `seo.mode`. Collecting the bare `mode` would
     * subscribe to a top-level field that does not exist, and every lookup
     * against it would read `undefined` — which this rule treats as "not
     * watched" and therefore visible, hiding nothing and fixing nothing.
     */
    expect(conditionFieldNames(grouped)).toEqual(["seo.mode"]);
  });

  it("hides a group whose every child is conditioned away", () => {
    // The reported case: the group's OWN condition passes — it has none — so
    // counting it left the panel offered with a `Fields` heading over a group
    // that draws its label and nothing else.
    const out = computeFieldsBeside(grouped, "body", { "seo.mode": "builder" });
    expect(out.content.map(f => f.name)).toEqual([]);
  });

  it("keeps that group once any child can render", () => {
    // The control. A rule that dropped every group, or every field carrying
    // children, would satisfy the case above without being right.
    const out = computeFieldsBeside(grouped, "body", { "seo.mode": "classic" });
    expect(out.content.map(f => f.name)).toEqual(["seo"]);
  });

  it("leaves a group alone when nothing has told it about the value", () => {
    // An unwatched name reads as `undefined`, and hiding content on the
    // strength of a value nobody supplied would withhold a panel that has
    // something in it — the failure in the direction that loses work.
    const out = computeFieldsBeside(grouped, "body", {});
    expect(out.content.map(f => f.name)).toEqual(["seo"]);
  });

  it("does NOT walk into a repeater, whose fields are a row template", () => {
    /*
     * A repeater's children describe what each ROW holds; their conditions are
     * evaluated per row against that row's values, and the repeater renders its
     * add control whether or not it has any rows. Treating an all-conditional
     * row template as an empty repeater would hide a control that works.
     */
    const withRepeater = [
      { name: "body", type: "blocks" },
      {
        name: "faqs",
        type: "repeater",
        fields: [
          {
            name: "answer",
            type: "text",
            admin: { condition: { field: "kind", equals: "long" } },
          },
        ],
      },
    ];
    expect(conditionFieldNames(withRepeater)).toEqual([]);
    const out = computeFieldsBeside(withRepeater, "body", {});
    expect(out.content.map(f => f.name)).toEqual(["faqs"]);
  });
});

describe("a group holding a hidden controller", () => {
  /*
   * The realistic shape, and the one the first version of this rule counted as
   * content. A group carries the field its own controls are conditioned on, and
   * that field is `admin.hidden` because a toolbar drives it rather than the
   * form. `FieldWrapper` returns null for a hidden field, so it draws nothing —
   * but it is not conditioned away, so a visibility rule that only asks about
   * conditions finds it "visible" and keeps the whole group alive.
   */
  const withHiddenController = [
    { name: "body", type: "blocks" },
    {
      name: "seo",
      type: "group",
      fields: [
        { name: "mode", type: "select", admin: { hidden: true } },
        {
          name: "legacyMeta",
          type: "text",
          admin: { condition: { field: "mode", equals: "classic" } },
        },
      ],
    },
  ];

  it("hides the group when its only DRAWN child is conditioned away", () => {
    const out = computeFieldsBeside(withHiddenController, "body", {
      "seo.mode": "builder",
    });
    expect(out.content.map(f => f.name)).toEqual([]);
  });

  it("keeps it when that child can render", () => {
    // The control: the hidden controller is unchanged between the two, so a
    // rule that simply dropped every group would pass the case above and fail
    // here.
    const out = computeFieldsBeside(withHiddenController, "body", {
      "seo.mode": "classic",
    });
    expect(out.content.map(f => f.name)).toEqual(["seo"]);
  });

  it("still WATCHES the hidden controller, which is what decides the rest", () => {
    /*
     * The two questions are different and it matters that they stay so. A
     * hidden field draws nothing, so it cannot keep a group alive — but it is
     * exactly the field whose value the other children read, so it must still
     * be subscribed to. Filtering hidden fields out of the name walk would
     * leave the condition above evaluated against a value nobody watched.
     */
    expect(conditionFieldNames(withHiddenController)).toEqual(["seo.mode"]);
  });
});
