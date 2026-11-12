// Every place the field picker opens from, and the position each one asks for:
// the toolbar (the end of the list), between two rows (before the lower one),
// inside a container (between its rows, or at its end) and "/" on a field
// (right after it). None is offered where the new field would land in a
// read-only, locked or plugin-owned container, or in a blocks field, which
// holds no fields of its own here.
//
// The outline draws one field per row, so there is a "+" above every field but
// the first of its container, hidden fields included. The "+" places are for a
// pointer and stay out of the accessibility tree, so they are found here by
// their titles; a keyboard reaches the same places through "/" and the row's
// menu.
import { DndContext } from "@dnd-kit/core";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { buildOutline } from "@admin/lib/builder/outline/outline-model";

import { BuilderToolbar } from "../BuilderToolbar";
import { NO_PENDING_CHANGES } from "./no-pending-changes";
import type { BuilderConfig } from "../builder-config";
import { Outline, type OutlineCallbacks } from "../outline/Outline";
import type { BuilderField } from "../types";

const f = (id: string, over: Partial<BuilderField> = {}): BuilderField => ({
  id,
  name: id,
  label: id.charAt(0).toUpperCase() + id.slice(1),
  type: "text",
  validation: {},
  admin: { width: "100%" },
  ...over,
});

const TREE: BuilderField[] = [
  f("title"),
  f("details", {
    type: "group",
    fields: [f("subtitle"), f("summary")],
  }),
  f("body"),
];

function renderList(
  fields: BuilderField[] = TREE,
  readOnly = false
): { onAddAt: ReturnType<typeof vi.fn> } {
  const onAddAt = vi.fn();
  const callbacks: OutlineCallbacks = {
    select: vi.fn(),
    addAt: onAddAt,
    fields,
    // Nothing here moves: every move is refused, so the menu offers none.
    judgeMove: vi.fn(() => ({
      allowed: false as const,
      reason: "not-found" as const,
      message: "",
    })),
    moveDestinations: vi.fn(() => []),
    commitMove: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
    setHidden: vi.fn(),
    openFieldGroup: vi.fn(),
  };
  render(
    <DndContext>
      <Outline
        kind="collection"
        nodes={buildOutline(fields, {
          entityReadOnly: readOnly,
          fieldGroups: new Map(),
        })}
        systemFields={fields.filter(field => field.isSystem)}
        errors={new Map()}
        foldKey="test:picker-entry-points"
        selectedId={null}
        readOnly={readOnly}
        callbacks={callbacks}
        renderPreview={() => null}
      />
    </DndContext>
  );
  return { onAddAt };
}

const card = (name: string) => screen.getByTestId(`field-row-${name}`);
const before = (label: string) =>
  screen.queryByTitle(`Add a field before ${label}`);
const inside = (label: string) =>
  screen.queryByTitle(`Add a field inside ${label}`);

const config: BuilderConfig = {
  kind: "collection",
  basicsFields: [],
  advancedFields: [],
  toolbar: { previewSchemaChange: true },
  picker: {},
};

describe("picker entry points", () => {
  it("the toolbar opens the picker at the end of the list", async () => {
    const onAddField = vi.fn();
    render(
      <BuilderToolbar
        config={config}
        name="Posts"
        unsavedCount={0}
        pending={NO_PENDING_CHANGES}
        onAddField={onAddField}
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Add field" }));
    expect(onAddField).toHaveBeenCalledTimes(1);
  });

  it("between two rows adds before the lower one", async () => {
    const { onAddAt } = renderList();
    await userEvent.click(before("Body") as HTMLElement);
    expect(onAddAt).toHaveBeenCalledWith({ beforeFieldId: "body" });
    // Only between rows: nothing above the first one.
    expect(before("Title")).toBeNull();
  });

  it("inside a container, between its rows, adds before the lower one", async () => {
    const { onAddAt } = renderList();
    await userEvent.click(before("Summary") as HTMLElement);
    expect(onAddAt).toHaveBeenCalledWith({
      parentFieldId: "details",
      beforeFieldId: "summary",
    });
  });

  it("inside a container, its own add adds at its end", async () => {
    const { onAddAt } = renderList();
    await userEvent.click(inside("Details") as HTMLElement);
    expect(onAddAt).toHaveBeenCalledWith({ parentFieldId: "details" });
  });

  it('"/" on a field adds right after it', async () => {
    const { onAddAt } = renderList();
    card("title").focus();
    await userEvent.keyboard("/");
    // After Title is before the next field, the Details group.
    expect(onAddAt).toHaveBeenLastCalledWith({ beforeFieldId: "details" });

    card("body").focus();
    await userEvent.keyboard("/");
    // After the last field is the end of the list.
    expect(onAddAt).toHaveBeenLastCalledWith({});
  });

  it('"/" on a field inside a container adds right after it, in that container', async () => {
    const { onAddAt } = renderList();
    card("subtitle").focus();
    await userEvent.keyboard("/");
    expect(onAddAt).toHaveBeenLastCalledWith({
      parentFieldId: "details",
      beforeFieldId: "summary",
    });

    card("summary").focus();
    await userEvent.keyboard("/");
    expect(onAddAt).toHaveBeenLastCalledWith({ parentFieldId: "details" });
  });

  it("before and after one field ask for different places", async () => {
    // The "+" above Body puts the new field before it; "/" on Body after it.
    const { onAddAt } = renderList();
    await userEvent.click(before("Body") as HTMLElement);
    card("body").focus();
    await userEvent.keyboard("/");
    expect(onAddAt.mock.calls).toEqual([[{ beforeFieldId: "body" }], [{}]]);
  });

  it("no entry point inside a read-only container or a blocks field", async () => {
    const tree: BuilderField[] = [
      f("intro"),
      f("seo", {
        type: "group",
        source: "plugin",
        owner: "seo-plugin",
        fields: [f("meta_title"), f("meta_description")],
      }),
      f("links", {
        type: "repeater",
        locked: true,
        fields: [f("url"), f("label")],
      }),
      f("sections", { type: "blocks" }),
      f("outro"),
    ];
    const { onAddAt } = renderList(tree);

    for (const container of ["Seo", "Links", "Sections"]) {
      expect(inside(container)).toBeNull();
    }
    for (const child of ["Meta_description", "Label"]) {
      expect(before(child)).toBeNull();
    }
    // "/" on a field inside a locked container offers nothing either.
    for (const child of ["meta_title", "url"]) {
      card(child).focus();
      await userEvent.keyboard("/");
    }
    expect(onAddAt).not.toHaveBeenCalled();
    // The editable list around them keeps its entry points, so the absence
    // above is the containers' doing, not a list that offers nothing.
    expect(before("Outro")).toBeInTheDocument();
  });

  it("no entry point anywhere in a read-only entity", async () => {
    const { onAddAt } = renderList(TREE, true);
    expect(screen.queryByTitle(/add a field/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /add field/i })).toBeNull();
    card("title").focus();
    await userEvent.keyboard("/");
    expect(onAddAt).not.toHaveBeenCalled();
  });

  it("no toolbar add on a read-only entity", () => {
    render(
      <BuilderToolbar
        config={config}
        name="Posts"
        unsavedCount={0}
        pending={NO_PENDING_CHANGES}
        locked
        onAddField={vi.fn()}
        onOpenSettings={vi.fn()}
        onSave={vi.fn()}
      />
    );
    // Settings is still there, so the toolbar did render its actions.
    expect(
      screen.getByRole("button", { name: "View settings" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add field" })).toBeNull();
  });

  it('puts a "+" above every field but the first, a hidden one included', async () => {
    // A system field first and a hidden field: the system field is not one of
    // the outline's rows, and the hidden one is.
    const fields: BuilderField[] = [
      f("title", { isSystem: true }),
      f("intro"),
      f("secret", { admin: { hidden: true } }),
      f("outro"),
    ];
    const { onAddAt } = renderList(fields);
    expect(before("Intro")).toBeNull();
    await userEvent.click(before("Secret") as HTMLElement);
    await userEvent.click(before("Outro") as HTMLElement);
    expect(onAddAt.mock.calls).toEqual([
      [{ beforeFieldId: "secret" }],
      [{ beforeFieldId: "outro" }],
    ]);
  });

  it("keeps everything inside a locked container read-only, at every depth", async () => {
    const tree: BuilderField[] = [
      f("intro"),
      f("seo", {
        type: "group",
        source: "plugin",
        fields: [
          f("social", {
            type: "group",
            fields: [f("og_title"), f("og_image")],
          }),
        ],
      }),
    ];
    const { onAddAt } = renderList(tree);
    expect(inside("Social")).toBeNull();
    expect(before("Og_image")).toBeNull();
    card("og_title").focus();
    await userEvent.keyboard("/");
    expect(onAddAt).not.toHaveBeenCalled();
  });

  it("treats a field owned on its own inside an editable container as read-only", async () => {
    const tree: BuilderField[] = [
      f("details", {
        type: "group",
        fields: [f("owned", { source: "plugin" }), f("mine")],
      }),
    ];
    const { onAddAt } = renderList(tree);
    // Reachable and selectable, but read-only: no "/", and no "+" beside it.
    expect(card("owned")).toHaveAttribute("role", "treeitem");
    card("owned").focus();
    await userEvent.keyboard("/");
    expect(onAddAt).not.toHaveBeenCalled();
    // Its editable neighbour keeps "/", in the container that holds both.
    card("mine").focus();
    await userEvent.keyboard("/");
    expect(onAddAt).toHaveBeenCalledWith({ parentFieldId: "details" });
  });

  it('leaves "/" with Ctrl or Cmd alone', async () => {
    const { onAddAt } = renderList();
    card("title").focus();
    await userEvent.keyboard("{Control>}/{/Control}{Meta>}/{/Meta}");
    expect(onAddAt).not.toHaveBeenCalled();
    // The control: a plain "/" on the row itself does add.
    await userEvent.keyboard("/");
    expect(onAddAt).toHaveBeenCalledWith({ beforeFieldId: "details" });
  });
});
