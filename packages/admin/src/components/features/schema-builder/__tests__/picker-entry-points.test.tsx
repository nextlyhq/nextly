// Every place the field picker opens from, and the position each one asks for:
// the toolbar (the end of the list), between two rows (before the lower one),
// inside a container (between its rows, or at its end) and "/" on a field
// (right after it). None is offered where the new field would land in a
// read-only, locked or plugin-owned container, or in a blocks field, which
// holds no fields of its own here.
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { BuilderFieldList } from "../BuilderFieldList";
import { BuilderToolbar } from "../BuilderToolbar";
import type { BuilderConfig } from "../builder-config";
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
  render(
    <DndContext>
      <BuilderFieldList
        kind="collection"
        fields={fields}
        readOnly={readOnly}
        onAddAt={onAddAt}
        onEditField={vi.fn()}
        onDeleteField={vi.fn()}
        onDuplicateField={vi.fn()}
        onReorder={vi.fn()}
      />
    </DndContext>
  );
  return { onAddAt };
}

const card = (name: string) => screen.getByTestId(`field-row-${name}`);

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
    await userEvent.click(
      screen.getByRole("button", { name: "Add a field before Body" })
    );
    expect(onAddAt).toHaveBeenCalledWith({ beforeFieldId: "body" });
    // Only between rows: nothing above the first one.
    expect(
      screen.queryByRole("button", { name: "Add a field before Title" })
    ).toBeNull();
  });

  it("inside a container, between its rows, adds before the lower one", async () => {
    const { onAddAt } = renderList();
    await userEvent.click(
      screen.getByRole("button", { name: "Add a field before Summary" })
    );
    expect(onAddAt).toHaveBeenCalledWith({
      parentFieldId: "details",
      beforeFieldId: "summary",
    });
  });

  it("inside a container, its own add adds at its end", async () => {
    const { onAddAt } = renderList();
    await userEvent.click(
      screen.getByRole("button", { name: /add field inside details/i })
    );
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
    await userEvent.click(
      screen.getByRole("button", { name: "Add a field before Body" })
    );
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
      expect(
        screen.queryByRole("button", {
          name: new RegExp(`add field inside ${container}`, "i"),
        })
      ).toBeNull();
    }
    for (const child of ["Meta_description", "Label"]) {
      expect(
        screen.queryByRole("button", { name: `Add a field before ${child}` })
      ).toBeNull();
    }
    // "/" on a field inside a locked container offers nothing either.
    for (const child of ["meta_title", "url"]) {
      const row = card(child);
      row.focus();
      await userEvent.keyboard("/");
    }
    expect(onAddAt).not.toHaveBeenCalled();
    // The editable list around them keeps its entry points, so the absence
    // above is the containers' doing, not a list that offers nothing.
    expect(
      screen.getByRole("button", { name: "Add a field before Outro" })
    ).toBeInTheDocument();
  });

  it("no entry point anywhere in a read-only entity", async () => {
    const { onAddAt } = renderList(TREE, true);
    expect(screen.queryByRole("button", { name: /add a field/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /add field inside/i })
    ).toBeNull();
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

  it('anchors each "+" on the first field of the row below it', async () => {
    // A system field first, a hidden field, and a half-width pair: the rows a
    // person sees are not the array's items one for one.
    const fields: BuilderField[] = [
      f("title", { isSystem: true }),
      f("intro"),
      f("secret", { admin: { hidden: true } }),
      f("first", { admin: { width: "50%" } }),
      f("second", { admin: { width: "50%" } }),
      f("outro"),
    ];
    const { onAddAt } = renderList(fields);
    await userEvent.click(
      screen.getByRole("button", { name: "Add a field before First" })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Add a field before Outro" })
    );
    expect(onAddAt.mock.calls).toEqual([
      [{ beforeFieldId: "first" }],
      [{ beforeFieldId: "outro" }],
    ]);
    // A pair is one row: nothing between its two fields.
    expect(
      screen.queryByRole("button", { name: "Add a field before Second" })
    ).toBeNull();
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
    expect(
      screen.queryByRole("button", { name: /add field inside social/i })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add a field before Og_image" })
    ).toBeNull();
    card("og_title").focus();
    await userEvent.keyboard("/");
    expect(onAddAt).not.toHaveBeenCalled();
  });

  it("treats a field locked on its own inside an editable container as the top level does", async () => {
    const tree: BuilderField[] = [
      f("details", {
        type: "group",
        fields: [f("owned", { source: "plugin" }), f("mine")],
      }),
    ];
    const { onAddAt } = renderList(tree);
    // Inert: not a button, no actions, no "/".
    expect(card("owned")).not.toHaveAttribute("role", "button");
    expect(screen.queryByRole("button", { name: "Delete owned" })).toBeNull();
    card("owned").focus();
    await userEvent.keyboard("/");
    expect(onAddAt).not.toHaveBeenCalled();
    // Its editable neighbour keeps "/", in the container that holds both.
    card("mine").focus();
    await userEvent.keyboard("/");
    expect(onAddAt).toHaveBeenCalledWith({ parentFieldId: "details" });
  });

  it('leaves "/" with Ctrl or Cmd, or typed on a drag handle, alone', async () => {
    const { onAddAt } = renderList();
    card("title").focus();
    await userEvent.keyboard("{Control>}/{/Control}{Meta>}/{/Meta}");
    screen.getAllByRole("button", { name: "Reorder field" })[0].focus();
    await userEvent.keyboard("/");
    expect(onAddAt).not.toHaveBeenCalled();
    // The control: a plain "/" on the card itself does add.
    card("title").focus();
    await userEvent.keyboard("/");
    expect(onAddAt).toHaveBeenCalledWith({ beforeFieldId: "details" });
  });

  it("puts a field in the container that drew it when a copy shares its ids", async () => {
    // A duplicated group keeps its fields' ids.
    const details = TREE[1];
    const copy = {
      ...details,
      id: "details_copy",
      name: "details_copy",
      label: "Copy",
    };
    const { onAddAt } = renderList([...TREE, copy]);
    const subtitles = screen.getAllByTestId("field-row-subtitle");
    subtitles[1].focus();
    await userEvent.keyboard("/");
    expect(onAddAt).toHaveBeenCalledWith({
      parentFieldId: "details_copy",
      beforeFieldId: "summary",
    });
  });
});
