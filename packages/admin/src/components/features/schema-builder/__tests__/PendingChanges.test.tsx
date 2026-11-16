/**
 * The Builder's pending changes on screen: their number, always shown; Undo
 * and Redo by button and by the platform's keys outside a text input, each
 * saying what it did; and Discard all, which asks first, naming how many
 * changes go. Driven through the real field builder and entity state, as a
 * builder page uses them.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "@admin/__tests__/utils";
import { useBuilderEntityState } from "@admin/hooks/useBuilderEntityState";
import { useBuilderFieldActions } from "@admin/hooks/useBuilderFieldActions";
import { useFieldBuilder } from "@admin/hooks/useFieldBuilder";
import { copyWithNewIds } from "@admin/lib/builder/copy-field";
import { judgeMove } from "@admin/lib/builder/move-rule";
import type { FieldDefinition } from "@admin/types/collection";

import { BuilderPageLayout } from "../BuilderPageLayout";
import type { BuilderConfig } from "../builder-config";
import type { BuilderSettingsValues } from "../BuilderSettingsModal";
import { PendingChangesControls } from "../PendingChangesControls";
import type { BuilderField } from "../types";

// The layout's exits are watched, not followed, and it reads no field groups.
vi.mock("@admin/lib/navigation", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/lib/navigation")>()),
  navigateTo: vi.fn(),
}));
vi.mock("@admin/services/fieldGroupApi", () => ({
  fieldGroupApi: {
    fetchComponents: vi.fn(() =>
      Promise.resolve({ items: [], meta: { hasNext: false } })
    ),
  },
}));

type Entity = { slug: string; name: string; fields: FieldDefinition[] };

const definition = (
  name: string,
  extra: Partial<FieldDefinition> = {}
): FieldDefinition => ({
  name,
  label: name[0]?.toUpperCase() + name.slice(1),
  type: "text",
  required: false,
  unique: false,
  index: false,
  ...extra,
});

// "title" and "slug" are the builder's own system rows, so the fixture uses
// other names.
const entity: Entity = {
  slug: "posts",
  name: "Post",
  fields: [
    definition("headline"),
    definition("summary"),
    definition("address", {
      type: "group",
      fields: [definition("street"), definition("city"), definition("zip")],
    }),
  ],
};

const settingsOf = (loaded: Entity): BuilderSettingsValues => ({
  singularName: loaded.name,
  slug: loaded.slug,
  icon: "Database",
});

/** What a test reaches into: the builder the controls are driven through. */
let builder: ReturnType<typeof useFieldBuilder>;
/** The overlays the layout asked for, in order: the picker among them. */
let activeChanges: unknown[] = [];
let setSettings: (next: BuilderSettingsValues) => void;

function Harness({
  locked = false,
  held = false,
}: {
  locked?: boolean;
  held?: boolean;
}) {
  const fieldBuilder = useFieldBuilder({
    resolver: async values => ({ values, errors: {} }),
    defaultValues: {},
  });
  const state = useBuilderEntityState({
    entity,
    builder: fieldBuilder,
    toFields: loaded => loaded.fields,
    toSettings: settingsOf,
    onLoad: () => {},
    identity: loaded => loaded.slug,
  });
  builder = fieldBuilder;
  setSettings = state.setSettings;
  return (
    <>
      <PendingChangesControls
        pending={state.pending}
        count={state.unsavedCount}
        locked={locked}
        held={held}
      />
      <label>
        Notes
        <input defaultValue="" />
      </label>
    </>
  );
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>{children}</ShortcutProvider>
    </QueryClientProvider>
  );
}

function setup(locked = false, held = false) {
  render(<Harness locked={locked} held={held} />, { wrapper: Providers });
  return userEvent.setup();
}

/** The field named `name`, nested ones included, as the builder holds it now. */
function field(name: string): BuilderField {
  const all = builder.fields.flatMap(f => [f, ...(f.fields ?? [])]);
  const found = all.find(f => f.name === name);
  if (!found) throw new Error(`no field named ${name}`);
  return found;
}

const names = () => builder.fields.filter(f => !f.isSystem).map(f => f.name);

const countText = () => screen.getByTestId("pending-changes-count").textContent;
const announced = () => screen.getByRole("status").textContent;

describe("pending changes controls", () => {
  it("the count: shown at all times, singular and plural", () => {
    setup();
    expect(countText()).toBe("No unsaved changes");
    act(() => builder.handleFieldUpdate({ ...field("headline"), label: "A" }));
    expect(countText()).toBe("1 unsaved change");
    act(() => setSettings({ ...settingsOf(entity), singularName: "Article" }));
    expect(countText()).toBe("2 unsaved changes");
  });

  it("undo, redo and discard are unavailable with nothing to act on", () => {
    setup();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Discard all changes" })
    ).toBeDisabled();
  });

  // One case per kind of change: each edit, undone and redone by button,
  // says what it did, and puts the fields back and forward.
  const kinds: Array<{
    kind: string;
    edit: () => void;
    says: string;
    check: (undone: boolean) => void;
  }> = [
    {
      kind: "an add",
      edit: () => builder.handleFieldAdd("text"),
      says: "added a new field",
      check: undone => expect(names()).toHaveLength(undone ? 3 : 4),
    },
    {
      kind: "a move",
      // Past two fields in one step. Swapping two neighbours leaves the same
      // fields whichever of them moved, and changes are read from the fields
      // alone, so that would not say which one did.
      edit: () => builder.setFields(prev => headlineToEnd(prev)),
      says: "moved Headline",
      check: undone =>
        expect(names()).toEqual(
          undone
            ? ["headline", "summary", "address"]
            : ["summary", "address", "headline"]
        ),
    },
    {
      kind: "a setting",
      edit: () =>
        builder.handleFieldUpdate({ ...field("summary"), label: "Excerpt" }),
      says: "changed Excerpt",
      check: undone =>
        expect(field("summary").label).toBe(undone ? "Summary" : "Excerpt"),
    },
    {
      kind: "a type change",
      edit: () =>
        builder.handleFieldUpdate({ ...field("summary"), type: "textarea" }),
      says: "changed the type of Summary",
      check: undone =>
        expect(field("summary").type).toBe(undone ? "text" : "textarea"),
    },
    {
      kind: "a rename",
      edit: () =>
        builder.handleFieldUpdate({ ...field("summary"), name: "excerpt" }),
      says: "renamed summary to excerpt",
      check: undone =>
        expect(names()).toContain(undone ? "summary" : "excerpt"),
    },
    {
      kind: "a duplicate",
      edit: () =>
        builder.setFields(prev => {
          const copy = copyWithNewIds({
            ...field("address"),
            name: "address_copy",
            label: "Address copy",
          });
          return [...prev, copy];
        }),
      says: "added Address copy and 3 fields inside",
      check: undone => expect(names().includes("address_copy")).toBe(!undone),
    },
    {
      kind: "a delete",
      edit: () => builder.handleFieldDelete(field("address").id),
      says: "deleted Address and 3 fields inside",
      check: undone => expect(names().includes("address")).toBe(undone),
    },
  ];

  for (const { kind, edit, says, check } of kinds) {
    it(`undoes and redoes ${kind} by button, saying what it did`, async () => {
      const user = setup();
      act(edit);
      check(false);
      await user.click(screen.getByRole("button", { name: "Undo" }));
      check(true);
      expect(announced()).toBe(`Undid: ${says}`);
      await user.click(screen.getByRole("button", { name: "Redo" }));
      check(false);
      expect(announced()).toBe(`Redid: ${says}`);
    });
  }

  it("undoes and redoes by the platform's keys outside a text input", async () => {
    const user = setup();
    act(() =>
      builder.handleFieldUpdate({ ...field("summary"), label: "Excerpt" })
    );
    await user.keyboard("{Control>}z{/Control}");
    expect(field("summary").label).toBe("Summary");
    expect(announced()).toBe("Undid: changed Excerpt");
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(field("summary").label).toBe("Excerpt");
    await user.keyboard("{Control>}z{/Control}");
    await user.keyboard("{Control>}y{/Control}");
    expect(field("summary").label).toBe("Excerpt");
  });

  it("keys inside a text input edit the text", async () => {
    const user = setup();
    act(() =>
      builder.handleFieldUpdate({ ...field("summary"), label: "Excerpt" })
    );
    await user.click(screen.getByLabelText("Notes"));
    await user.keyboard("{Control>}z{/Control}");
    expect(field("summary").label).toBe("Excerpt");
    expect(countText()).toBe("1 unsaved change");
  });

  it("discard asks with the count, and keeps everything when refused", async () => {
    const user = setup();
    act(() => builder.handleFieldUpdate({ ...field("headline"), label: "A" }));
    act(() => builder.handleFieldAdd("text"));
    act(() => setSettings({ ...settingsOf(entity), singularName: "Article" }));
    await user.click(
      screen.getByRole("button", { name: "Discard all changes" })
    );
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: "Discard 3 changes?" })
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Keep editing" })
    );
    expect(countText()).toBe("3 unsaved changes");

    await user.click(
      screen.getByRole("button", { name: "Discard all changes" })
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Discard 3 changes",
      })
    );
    expect(countText()).toBe("No unsaved changes");
    expect(field("headline").label).toBe("Headline");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("says each undo even when it reads as the one before", async () => {
    const user = setup();
    act(() => builder.handleFieldAdd("text"));
    act(() => builder.handleFieldAdd("text"));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    const first = announced();
    expect(first?.trim()).toBe("Undid: added a new field");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    // The same words, but a change to the live region, so it is read again.
    expect(announced()).not.toBe(first);
    expect(announced()?.trim()).toBe("Undid: added a new field");
  });

  it("the keys do nothing while a dialog is open over the builder", async () => {
    const user = setup();
    act(() =>
      builder.handleFieldUpdate({ ...field("summary"), label: "Excerpt" })
    );
    // A confirmation waiting on the person, as a schema change's preview is.
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    const confirm = document.createElement("button");
    dialog.append(confirm);
    document.body.append(dialog);
    try {
      confirm.focus();
      await user.keyboard("{Control>}z{/Control}");
      expect(field("summary").label).toBe("Excerpt");
    } finally {
      dialog.remove();
    }
    await user.keyboard("{Control>}z{/Control}");
    expect(field("summary").label).toBe("Summary");
  });

  // An unsaved entity's address move, still being checked, records its
  // settings when it ends: an undo or a redo made meanwhile would be written
  // over by it, so both wait.
  it("undo and redo wait, by button and by key, while the page holds them", async () => {
    const user = setup(false, true);
    act(() =>
      builder.handleFieldUpdate({ ...field("summary"), label: "Excerpt" })
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    await user.keyboard("{Control>}z{/Control}");
    expect(field("summary").label).toBe("Excerpt");
  });

  // A discard during the move would let the entity go before the move renames
  // it, and the move would then report its address as taken: it waits too.
  it("discard all waits while the page holds it, and is offered once the hold ends", () => {
    const { rerender } = render(<Harness held />, { wrapper: Providers });
    act(() =>
      builder.handleFieldUpdate({ ...field("summary"), label: "Excerpt" })
    );
    expect(
      screen.getByRole("button", { name: "Discard all changes" })
    ).toBeDisabled();

    rerender(<Harness />);
    expect(
      screen.getByRole("button", { name: "Discard all changes" })
    ).toBeEnabled();
  });

  it("a read-only entity offers none of them", () => {
    setup(true);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Discard all changes" })
    ).toBeNull();
  });
});

const layoutConfig: BuilderConfig = {
  kind: "collection",
  basicsFields: ["singularName", "slug"],
  advancedFields: [],
  toolbar: { previewSchemaChange: true },
  picker: {},
};

/** What a page's save checks first: the fields it would send, or null when refused. */
let saveCheck: () => FieldDefinition[] | null;

/** The whole builder page frame, on the real hooks. */
function LayoutHarness() {
  const fieldBuilder = useFieldBuilder({
    resolver: async values => ({ values, errors: {} }),
    defaultValues: {},
  });
  saveCheck = useBuilderFieldActions(fieldBuilder).getValidatedFields;
  const state = useBuilderEntityState({
    entity,
    builder: fieldBuilder,
    toFields: loaded => loaded.fields,
    toSettings: settingsOf,
    onLoad: () => {},
    identity: loaded => loaded.slug,
  });
  builder = fieldBuilder;
  if (!state.settings) return null;
  return (
    <BuilderPageLayout
      config={layoutConfig}
      builder={fieldBuilder}
      entitySlug="posts"
      name="Post"
      locked={false}
      unsavedCount={state.unsavedCount}
      pending={state.pending}
      savedFieldIds={state.savedFieldIds}
      onSave={() => {}}
      settings={state.settings}
      onSettingsChange={state.setSettings}
      active={{ kind: "none" }}
      onActiveChange={next => {
        activeChanges.push(next);
      }}
      onDuplicateField={() => {}}
      isSaving={false}
      savingLabel="Saving"
    />
  );
}

const row = (name: string) => screen.getByTestId(`field-row-${name}`);

/** The fields with Headline moved past both fields after it, to the end. */
function headlineToEnd(prev: BuilderField[]): BuilderField[] {
  const verdict = judgeMove(
    prev,
    field("headline").id,
    {},
    { entityReadOnly: false, surface: "collection" }
  );
  return verdict.allowed ? verdict.fields : prev;
}

describe("pending changes in the outline", () => {
  it("the count and the row marks", () => {
    render(<LayoutHarness />, { wrapper: Providers });
    act(() => builder.setFields(prev => headlineToEnd(prev)));
    act(() =>
      builder.handleFieldUpdate({ ...field("summary"), label: "Excerpt" })
    );
    act(() => builder.handleFieldDelete(field("city").id));
    expect(countText()).toBe("3 unsaved changes");
    expect(within(row("headline")).getByText("Moved")).toBeInTheDocument();
    expect(within(row("summary")).getByText("Changed")).toBeInTheDocument();
    // Deleted, and still shown where it was saved until the save.
    expect(within(row("city")).getByText("Deleted")).toBeInTheDocument();
    for (const unchanged of ["street", "zip", "address"]) {
      for (const mark of ["New", "Changed", "Moved", "Deleted"]) {
        expect(within(row(unchanged)).queryByText(mark)).toBeNull();
      }
    }
    act(() => builder.handleFieldAdd("text"));
    expect(screen.getByTestId("field-row-")).toHaveTextContent("New");
  });

  it("deleting a container with three fields inside", async () => {
    const user = userEvent.setup();
    render(<LayoutHarness />, { wrapper: Providers });
    row("address").focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    // A pending delete, one change, naming the fields that go with it.
    expect(countText()).toBe("1 unsaved change");
    expect(row("address")).toHaveTextContent("Deleted · 3 fields inside");
    for (const inside of ["street", "city", "zip"]) {
      expect(within(row(inside)).getByText("Deleted")).toBeInTheDocument();
    }
    expect(
      screen.getByText(
        "Deleted Address and 3 fields inside. Undo brings them back."
      )
    ).toBeInTheDocument();

    // A deleted row offers nothing to do to it until it is back.
    row("address").focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(countText()).toBe("No unsaved changes");
    expect(within(row("address")).queryByText(/Deleted/)).toBeNull();
  });

  it("nothing moves into or out of a deleted row's place", async () => {
    const user = userEvent.setup();
    render(<LayoutHarness />, { wrapper: Providers });
    act(() => builder.handleFieldDelete(field("summary").id));
    // Headline sits just above the deleted Summary.
    row("headline").focus();
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(names()).toEqual(["headline", "address"]);
    row("summary").focus();
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(names()).toEqual(["headline", "address"]);
  });

  it("a deleted row adds nothing by key", async () => {
    const user = userEvent.setup();
    activeChanges = [];
    render(<LayoutHarness />, { wrapper: Providers });
    // On a live row, "/" opens the picker to add after it.
    row("headline").focus();
    await user.keyboard("/");
    expect(activeChanges).toHaveLength(1);
    act(() => builder.handleFieldDelete(field("summary").id));
    activeChanges = [];
    row("summary").focus();
    await user.keyboard("/");
    expect(activeChanges).toEqual([]);
  });

  it("a deleted row offers no place to add, inside it or before it", () => {
    render(<LayoutHarness />, { wrapper: Providers });
    // By the id each place carries: "add-inside-<label>", "add-before-<label>".
    const place = (id: string) => screen.queryByTestId(id);
    // Offered while the group is there.
    expect(place("add-inside-Address")).not.toBeNull();
    expect(place("add-before-City")).not.toBeNull();
    act(() => builder.handleFieldDelete(field("address").id));
    expect(place("add-inside-Address")).toBeNull();
    expect(place("add-before-Address")).toBeNull();
    expect(place("add-before-City")).toBeNull();
  });
});

describe("a broken condition", () => {
  /** Show `name` only while `source` equals `value`, as the panel sets it. */
  const gate = (name: string, source: string, value = "x") =>
    act(() =>
      builder.handleFieldUpdate({
        ...field(name),
        admin: {
          ...field(name).admin,
          condition: { field: source, operator: "equals", value },
        },
      })
    );
  /** Move `name` out of the Address group, to the end of the top level. */
  const moveToTop = (name: string) =>
    act(() =>
      builder.setFields(prev => [
        ...prev.map(each =>
          each.fields
            ? { ...each, fields: each.fields.filter(f => f.name !== name) }
            : each
        ),
        field(name),
      ])
    );
  const marked = (name: string) =>
    within(row(name)).queryByText("Has an error") !== null;

  it("a condition broken by a move blocks saving until repaired", () => {
    render(<LayoutHarness />, { wrapper: Providers });
    // Street, in Address, is shown by City beside it.
    gate("street", "city");
    expect(saveCheck()).not.toBeNull();
    moveToTop("city");
    expect(marked("street")).toBe(true);
    expect(saveCheck()).toBeNull();
    // Kept, not dropped: the condition still names City until repointed.
    expect(field("street").admin?.condition?.field).toBe("city");
    gate("street", "zip");
    expect(marked("street")).toBe(false);
    expect(saveCheck()).not.toBeNull();
  });

  it("a condition broken by a move blocks saving until removed", () => {
    render(<LayoutHarness />, { wrapper: Providers });
    gate("street", "city");
    moveToTop("city");
    expect(saveCheck()).toBeNull();
    act(() =>
      builder.handleFieldUpdate({
        ...field("street"),
        admin: { ...field("street").admin, condition: undefined },
      })
    );
    expect(marked("street")).toBe(false);
    expect(saveCheck()).not.toBeNull();
  });

  it("a condition reading a built-in field is neither marked nor refused", () => {
    render(<LayoutHarness />, { wrapper: Providers });
    // Title is the builder's own row, which the user's fields leave out.
    expect(builder.fields.some(f => f.isSystem && f.name === "title")).toBe(
      true
    );
    gate("headline", "title");
    expect(marked("headline")).toBe(false);
    expect(saveCheck()).not.toBeNull();
  });

  it("a delete marks it broken; Undo clears it, and Redo marks it again", () => {
    render(<LayoutHarness />, { wrapper: Providers });
    gate("street", "city");
    act(() => builder.handleFieldDelete(field("city").id));
    expect(marked("street")).toBe(true);
    act(() => {
      builder.undo();
    });
    expect(marked("street")).toBe(false);
    expect(saveCheck()).not.toBeNull();
    act(() => {
      builder.redo();
    });
    expect(marked("street")).toBe(true);
    expect(saveCheck()).toBeNull();
  });

  it("a removed option marks it broken, and Undo clears it", () => {
    render(<LayoutHarness />, { wrapper: Providers });
    act(() =>
      builder.handleFieldUpdate({
        ...field("zip"),
        type: "select",
        options: [
          { label: "North", value: "north" },
          { label: "South", value: "south" },
        ],
      })
    );
    gate("street", "zip", "south");
    expect(marked("street")).toBe(false);
    act(() =>
      builder.handleFieldUpdate({
        ...field("zip"),
        options: [{ label: "North", value: "north" }],
      })
    );
    expect(marked("street")).toBe(true);
    expect(saveCheck()).toBeNull();
    act(() => {
      builder.undo();
    });
    expect(marked("street")).toBe(false);
    expect(saveCheck()).not.toBeNull();
  });
});
