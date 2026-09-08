/**
 * The form body under the takeover rule, asked once for both editors.
 *
 * The rule itself (`lib/builder/takeoverLayout`) has its own unit tests. What
 * is pinned here is the COMPOSITION on top of it — the order the three answers
 * are asked in, and the name→value pairing between the watch subscription and
 * the reducer. That sequence used to be typed out in the entry editor and again
 * in the Single editor, which is the shape a silent divergence takes: both call
 * sites keep looking correct while they stop agreeing.
 *
 * So the assertion that matters most here is the last one — that a single field
 * configuration reaches the same body through each editor's own field
 * plumbing. It is the only test that fails if the two ever answer differently.
 */
import { renderHook, act } from "@testing-library/react";
import type { FieldConfig } from "nextly/config";
import { useForm } from "react-hook-form";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { getCollectionFields } from "@admin/components/features/entries/EntryForm/useEntryForm";

import { useTakeoverLayout } from "../useTakeoverLayout";

/*
 * Reached through an arrow rather than passed directly, so the factory resolves
 * the spy when the mocked module is CALLED rather than when vitest hoists the
 * mock above these imports. Same shape as the editor-locale suite.
 */
const useBranding = vi.fn();
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
}));

/**
 * A plugin that registers a takeover-capable field type.
 *
 * Written out here rather than imported from a shipped plugin deliberately: no
 * plugin this repo ships declares `layout: "takeover"`, so a fixture built from
 * one would register nothing and every assertion below would pass against a
 * body that never collapsed.
 */
const PLUGINS = [
  {
    fieldTypes: [
      {
        type: "page-builder",
        component: "PageBuilderField",
        layout: "takeover",
      },
    ],
  },
];

/** No plugin declares the flag — the state the repo actually ships in. */
const NO_TAKEOVER_PLUGINS = [
  { fieldTypes: [{ type: "page-builder", component: "PageBuilderField" }] },
];

/**
 * One configuration both editors are asked about: system fields, an ordinary
 * field, a hidden control field, and a takeover field gated on `editorMode`.
 */
const FIELDS = [
  { name: "title", type: "text" },
  { name: "slug", type: "text" },
  { name: "editorMode", type: "select", admin: { hidden: true } },
  { name: "body", type: "richText" },
  {
    name: "layout",
    type: "page-builder",
    admin: {
      condition: {
        field: "editorMode",
        operator: "equals",
        value: "page-builder",
      },
    },
  },
] as unknown as FieldConfig[];

/**
 * The same shape with a VISIBLE controller.
 *
 * `FIELDS` models the page-builder case, where the mode field is `admin.hidden`
 * and switched from the toolbar — and a hidden field is stripped from the body
 * before the takeover rule ever runs, so the collapse leaves the takeover field
 * alone. A controller the author can see is the other half of the rule, and the
 * only case in which "plus its condition controller" is observable.
 */
const VISIBLE_CONTROLLER_FIELDS = FIELDS.map(f =>
  (f as { name?: string }).name === "editorMode"
    ? ({ name: "editorMode", type: "select" } as unknown as FieldConfig)
    : f
);

function useTakeoverHarness(
  fields: FieldConfig[],
  defaultValues: Record<string, unknown>
) {
  const form = useForm<Record<string, unknown>>({ defaultValues });
  return { form, layout: useTakeoverLayout(fields, form) };
}

function renderTakeover(
  fields: FieldConfig[],
  defaultValues: Record<string, unknown>
) {
  return renderHook(() => useTakeoverHarness(fields, defaultValues));
}

const namesOf = (fields: Array<{ name?: string }>) => fields.map(f => f.name);

beforeEach(() => {
  vi.clearAllMocks();
  useBranding.mockReturnValue({ plugins: PLUGINS });
});

describe("useTakeoverLayout", () => {
  /**
   * The collapse. `body` going missing is the assertion; without it a test
   * passes on a body that merely happens to contain the takeover field.
   *
   * The controller here is `admin.hidden`, as the page-builder mode field is,
   * and a hidden field never reaches the body — so the collapsed body is the
   * takeover field alone rather than the pair.
   */
  it("collapses the body to the takeover field alone when its controller is hidden", () => {
    const { result } = renderTakeover(FIELDS, { editorMode: "page-builder" });

    expect(namesOf(result.current.layout.mainFields)).toEqual(["layout"]);
  });

  /** A controller the author can see stays beside the field it governs. */
  it("keeps a visible controller beside the takeover field", () => {
    const { result } = renderTakeover(VISIBLE_CONTROLLER_FIELDS, {
      editorMode: "page-builder",
    });

    expect(namesOf(result.current.layout.mainFields)).toEqual([
      "editorMode",
      "layout",
    ]);
  });

  /** The condition fails, so the rule does not fire and the body is whole. */
  it("renders the full body when the takeover condition is not met", () => {
    const { result } = renderTakeover(FIELDS, { editorMode: "default" });

    // Title and slug are absent because they render as system components
    // upstream, not because a takeover hid them.
    expect(namesOf(result.current.layout.mainFields)).toEqual([
      "body",
      "layout",
    ]);
  });

  /**
   * The shipped reality: with no registered takeover type the rule is inert and
   * the body must be exactly what it would have been without the feature.
   */
  it("leaves the body alone when no plugin declares a takeover type", () => {
    useBranding.mockReturnValue({ plugins: NO_TAKEOVER_PLUGINS });

    const { result } = renderTakeover(FIELDS, { editorMode: "page-builder" });

    expect(namesOf(result.current.layout.mainFields)).toEqual([
      "body",
      "layout",
    ]);
    expect(result.current.layout.controllerNames).toEqual([]);
  });

  it("survives branding that has not arrived yet", () => {
    useBranding.mockReturnValue({ plugins: undefined });

    const { result } = renderTakeover(FIELDS, { editorMode: "page-builder" });

    expect(namesOf(result.current.layout.mainFields)).toEqual([
      "body",
      "layout",
    ]);
  });

  /**
   * The toolbar draws its mode switch from `controllerNames[0]`, so the names
   * must come back from the same computation that decided the layout rather
   * than from a second scan that could disagree with it.
   */
  it("reports the controller the toolbar switches on", () => {
    const { result } = renderTakeover(FIELDS, { editorMode: "default" });

    expect(result.current.layout.controllerNames).toEqual(["editorMode"]);
  });

  /**
   * The watch subscription is the reason this is a hook at all: switching modes
   * has to recompute the body without remounting the form. A composition that
   * read `getValues()` once would pass every test above and fail this one.
   */
  it("recomputes the body when the controller value changes", () => {
    const { result } = renderTakeover(FIELDS, { editorMode: "default" });

    expect(namesOf(result.current.layout.mainFields)).toEqual([
      "body",
      "layout",
    ]);

    act(() => result.current.form.setValue("editorMode", "page-builder"));

    expect(namesOf(result.current.layout.mainFields)).toEqual(["layout"]);
  });

  /**
   * THE equivalence assertion.
   *
   * The same configuration reaches the hook the way each editor supplies it —
   * the entry editor through `getCollectionFields`, the Single editor from
   * `schema.fields` directly — and both must produce the same body and the same
   * controllers, in both takeover states. This is what the two hand-written
   * copies of the composition could not guarantee.
   */
  describe("entries and singles agree", () => {
    it.each([
      ["takeover active", { editorMode: "page-builder" }],
      ["takeover inactive", { editorMode: "default" }],
    ])("produces one answer for both editors (%s)", (_label, values) => {
      // The entry editor's plumbing: fields read off the collection.
      const entryFields = getCollectionFields({
        name: "posts",
        fields: FIELDS,
      });
      // The Single editor's plumbing: fields read straight off the schema.
      const singleFields = { slug: "home", fields: FIELDS }.fields;

      const entry = renderTakeover(entryFields, values);
      const single = renderTakeover(singleFields, values);

      expect(namesOf(entry.result.current.layout.mainFields)).toEqual(
        namesOf(single.result.current.layout.mainFields)
      );
      expect(entry.result.current.layout.controllerNames).toEqual(
        single.result.current.layout.controllerNames
      );
      expect(entry.result.current.layout.takeoverTypes).toEqual(
        single.result.current.layout.takeoverTypes
      );
    });
  });
});
