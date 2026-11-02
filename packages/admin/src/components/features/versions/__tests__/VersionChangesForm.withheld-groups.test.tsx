/**
 * An unnamed group that holds a field held back, on a past version's changes.
 *
 * Drawn through the editor's own renderer, not a stand-in, so the group's
 * heading, its rules and its fields' conditions are judged as the editor
 * judges them. The group is drawn whole, held-back note in place, except for
 * the changed fields it lays out: those are drawn once, as their marked
 * change, where the changes view draws a change the form does not lay out.
 */
import { render, screen } from "@testing-library/react";
import type { FieldConfig } from "nextly/config";
import { describe, expect, it, vi } from "vitest";

import type { FieldDiff, VersionDiff } from "@admin/services/versionApi";

import { VersionChangesForm } from "../VersionChangesForm";
import { versionChangesOf } from "../version-changes";
import { WithheldFieldsProvider } from "../withheld-fields-context";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));

const HIDDEN = "Hidden: you don't have access to this field.";

const text = (name: string, extra: Record<string, unknown> = {}) =>
  ({
    name,
    type: "text",
    label: name[0]!.toUpperCase() + name.slice(1),
    ...extra,
  }) as FieldConfig;

const changed = (name: string): FieldDiff => ({
  kind: "text",
  name,
  label: name[0]!.toUpperCase() + name.slice(1),
  type: "text",
  status: "changed",
  segments: [
    { op: -1, text: "before" },
    { op: 1, text: "after" },
  ],
});

const hiddenNode: FieldDiff = {
  kind: "hidden",
  reason: "no-access",
  name: "secret",
  label: "Secret",
  type: "text",
  status: "unchanged",
};

/** The changes view of a version whose comparison found `diffFields`. */
function renderChanges(
  fields: FieldConfig[],
  values: Record<string, unknown>,
  diffFields: FieldDiff[],
  withheld: string[] = ["secret"],
  showUnchanged = false
) {
  const diff: VersionDiff = {
    from: 1,
    to: 2,
    locale: null,
    hasChanges: true,
    incomplete: true,
    fields: diffFields,
  };
  const changes = versionChangesOf(diff);
  return render(
    <WithheldFieldsProvider paths={withheld}>
      <VersionChangesForm
        fields={fields}
        values={values}
        changes={changes}
        order={[...changes.byField.keys()]}
        current={null}
        showUnchanged={showUnchanged}
        onToggleUnchanged={() => {}}
      />
    </WithheldFieldsProvider>
  );
}

const changeCards = () =>
  screen
    .queryAllByRole("region")
    .map(region => region.getAttribute("aria-label"))
    .filter(label => label?.endsWith(", changed"));

describe("an unnamed group holding a field held back, on a version's changes", () => {
  it("draws a changed field it lays out once, as its marked change", () => {
    const group = {
      type: "group",
      label: "Private",
      fields: [text("secret"), text("note")],
    } as FieldConfig;

    renderChanges([text("title"), group], { title: "t", note: "after" }, [
      changed("note"),
      hiddenNode,
    ]);

    // The held-back field says so, in its group.
    expect(screen.getByText(HIDDEN)).toBeInTheDocument();
    // The change is drawn once, marked, and never again as a plain value.
    expect(changeCards()).toEqual(["Note, changed"]);
    expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull();
  });

  it("draws a changed field once in an unnamed group with nothing held back, the fold open", () => {
    // The same rule outside a held-back group: unfolded, the group is drawn
    // without the change it lays out, which is drawn once, as its card.
    const group = {
      type: "group",
      label: "Private",
      fields: [text("note"), text("extra")],
    } as FieldConfig;

    renderChanges(
      [text("title"), group],
      { title: "t", note: "after", extra: "x" },
      [changed("note")],
      [],
      true
    );

    expect(changeCards()).toEqual(["Note, changed"]);
    expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull();
    // The rest of the group is drawn as it is, on request.
    expect(screen.getByRole("textbox", { name: "Extra" })).toBeInTheDocument();
  });

  it("draws no heading for an unnamed group the change left empty", () => {
    const group = {
      type: "group",
      label: "Private",
      fields: [
        text("secret"),
        { type: "group", label: "Notes", fields: [text("note")] },
      ],
    } as FieldConfig;

    renderChanges([group], { note: "after" }, [changed("note"), hiddenNode]);

    expect(screen.getByText(HIDDEN)).toBeInTheDocument();
    expect(changeCards()).toEqual(["Note, changed"]);
    expect(screen.queryByText("Notes")).toBeNull();
  });

  it("keeps the rules of what it still draws: a condition reading the field it left out, and its own", () => {
    // `extra` shows only while `note` reads "show". The group leaves `note`
    // out, as a marked change, but a condition reads the document's values,
    // not the fields drawn, so `extra` follows the version's note.
    const group = (condition?: Record<string, unknown>) =>
      ({
        type: "group",
        label: "Private",
        fields: [
          text("secret"),
          text("note"),
          text("extra", {
            admin: {
              condition: { field: "note", operator: "equals", value: "show" },
            },
          }),
        ],
        ...(condition ? { admin: { condition } } : {}),
      }) as FieldConfig;
    const diffFields = [changed("note"), hiddenNode];

    const shown = renderChanges(
      [group()],
      { note: "show", extra: "x" },
      diffFields
    );
    expect(screen.getByRole("textbox", { name: "Extra" })).toBeInTheDocument();
    shown.unmount();

    const hidden = renderChanges(
      [group()],
      { note: "hide", extra: "x" },
      diffFields
    );
    expect(screen.queryByRole("textbox", { name: "Extra" })).toBeNull();
    hidden.unmount();

    // The group's own condition, on a field beside it, still decides whether
    // it is drawn at all: the editor draws it while the mode is on, and not
    // while it is off.
    const gated = [
      text("mode"),
      group({ field: "mode", operator: "equals", value: "on" }),
    ];
    const on = renderChanges(gated, { mode: "on", note: "show" }, diffFields);
    expect(screen.getByText(HIDDEN)).toBeInTheDocument();
    on.unmount();
    renderChanges(gated, { mode: "off", note: "show" }, diffFields);
    expect(screen.queryByText(HIDDEN)).toBeNull();
  });

  it("reads a form holding a group that lays itself out, directly or through another, without walking forever", () => {
    // Raw config can hold a cycle. The walk that finds what each field lays
    // out stops at a group already open on its own path, so the changes view
    // still reads such a form: here the held-back field is drawn, and the
    // looping groups, which hold nothing held back, stay folded. (Drawing a
    // looping group is the editor's renderer's to guard; nothing here does.)
    const direct: { type: string; label: string; fields: unknown[] } = {
      type: "group",
      label: "Loop",
      fields: [],
    };
    direct.fields = [text("note"), direct];
    const outer: { type: string; label: string; fields: unknown[] } = {
      type: "group",
      label: "Outer",
      fields: [],
    };
    const inner = { type: "group", label: "Inner", fields: [outer] };
    outer.fields = [text("extra"), inner];

    renderChanges(
      [
        text("secret"),
        direct as unknown as FieldConfig,
        outer as unknown as FieldConfig,
      ],
      {},
      [hiddenNode]
    );

    expect(screen.getByText(HIDDEN)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show 2 unchanged fields" })
    ).toBeInTheDocument();
  });
});
