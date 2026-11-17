// A saved field's name is its identity: its column and its API key. It changes only through
// Rename…, which the save answers as a rename and so keeps the field's values, and only for a
// field with a column of its own. A field inside a named group or a repeater is a key in that
// container's value, and a field using a field group keeps its values in that group's table, so
// neither offers Rename…, and each says why. An unsaved field's name stays editable.
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { fieldsNamedByHooks } from "@admin/lib/builder/rename-field";
import type { StoredHookConfig } from "@admin/types/collection";

import { BuilderFieldSettings } from "../BuilderFieldSettings";
import type { BuilderField } from "../types";

vi.mock("@admin/hooks/queries", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries")>()),
  useFieldGroups: () => ({ data: { items: [], meta: {} }, isLoading: false }),
}));

const text = (id: string, name: string, over: Partial<BuilderField> = {}) =>
  ({
    id,
    name,
    label: name,
    type: "text",
    validation: {},
    ...over,
  }) as BuilderField;

const SUMMARY = text("f-summary", "summary", { label: "Summary" });
const BODY = text("f-body", "body", { label: "Body" });

function panel(
  fields: BuilderField[],
  fieldId: string,
  saved: string[] = ["f-summary", "f-body"],
  startRenaming = false,
  storedHooks: StoredHookConfig[] = []
) {
  const onFieldChange = vi.fn();
  render(
    <BuilderFieldSettings
      kind="collection"
      fields={fields}
      fieldId={fieldId}
      savedFieldIds={new Set(saved)}
      readOnly={false}
      docked
      savedFields={fields.filter(field => saved.includes(field.id))}
      lifecycleEnabled={false}
      rename={{
        asked: startRenaming,
        namedByHooks: fieldsNamedByHooks(storedHooks),
      }}
      onFieldChange={onFieldChange}
      onFieldDelete={() => {}}
      onClose={() => {}}
    />
  );
  return { onFieldChange };
}

const nameInput = () => screen.getByRole("textbox", { name: "Name" });
const renameButton = () => screen.queryByRole("button", { name: "Rename…" });

describe("a saved field's name", () => {
  it("is fixed in the panel, with Rename… beside it", () => {
    panel([SUMMARY, BODY], "f-summary");
    expect(nameInput()).toBeDisabled();
    expect(screen.getByText(/changes through Rename…/)).toBeInTheDocument();
    expect(renameButton()).toBeInTheDocument();
  });

  it("is renamed through Rename…, and the new name is judged as it is typed", async () => {
    const user = userEvent.setup();
    const { onFieldChange } = panel([SUMMARY, BODY], "f-summary");

    await user.click(renameButton() as HTMLElement);
    const dialog = screen.getByRole("dialog", { name: /Rename Summary/ });
    const input = within(dialog).getByRole("textbox", { name: "New name" });
    const confirm = within(dialog).getByRole("button", { name: "Rename" });

    await user.clear(input);
    await user.type(input, "created_at");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /built-in column/
    );
    expect(confirm).toBeDisabled();

    await user.clear(input);
    await user.type(input, "body");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /body here already has the same name/
    );
    expect(confirm).toBeDisabled();

    await user.clear(input);
    await user.type(input, "abstract");
    expect(within(dialog).queryByRole("alert")).toBeNull();
    await user.click(confirm);

    expect(onFieldChange).toHaveBeenCalledTimes(1);
    expect(onFieldChange.mock.lastCall?.[0]).toMatchObject({
      id: "f-summary",
      name: "abstract",
    });
  });

  // The row menu's Rename… opens the settings with the rename already asked for.
  it("opens with its rename asked for, from the row's menu", () => {
    panel([SUMMARY, BODY], "f-summary", undefined, true);
    expect(
      screen.getByRole("dialog", { name: /Rename Summary/ })
    ).toBeInTheDocument();
  });

  it("is not offered Rename… inside a named group, and says why", () => {
    const inner = text("f-inner", "street", { label: "Street" });
    panel(
      [
        SUMMARY,
        { ...text("f-address", "address"), type: "group", fields: [inner] },
      ],
      "f-inner",
      ["f-summary", "f-address", "f-inner"]
    );
    expect(nameInput()).toBeDisabled();
    expect(renameButton()).toBeNull();
    expect(screen.getByText(/inside address/)).toBeInTheDocument();
  });

  it("is not offered Rename… for a field using a field group, and says why", () => {
    panel(
      [SUMMARY, text("f-seo", "seo", { type: "component", component: "seo" })],
      "f-seo",
      ["f-summary", "f-seo"]
    );
    expect(nameInput()).toBeDisabled();
    expect(renameButton()).toBeNull();
    expect(screen.getByText(/field group's own table/)).toBeInTheDocument();
  });
});

// A stored hook reads the field it names by that name (an auto-slug's source, say), so renaming it
// would leave the hook reading a key no entry has, and the hook would stop working unseen.
describe("a field a stored hook names", () => {
  it("is not offered Rename…, and says which hook names it", () => {
    panel([SUMMARY, BODY], "f-summary", undefined, false, [
      {
        hookId: "auto-slug",
        hookType: "beforeCreate",
        enabled: true,
        config: { sourceField: "summary", targetField: "slug" },
        order: 0,
      },
    ]);
    expect(nameInput()).toBeDisabled();
    expect(renameButton()).toBeNull();
    expect(screen.getByText(/hook names this field/)).toBeInTheDocument();
  });

  it("leaves a field no hook names renamable", () => {
    panel([SUMMARY, BODY], "f-body", undefined, false, [
      {
        hookId: "auto-slug",
        hookType: "beforeCreate",
        enabled: true,
        config: { sourceField: "summary", targetField: "slug" },
        order: 0,
      },
    ]);
    expect(renameButton()).not.toBeNull();
  });
});

describe("an unsaved field's name", () => {
  it("stays editable, with no Rename…", () => {
    panel([SUMMARY, text("f-new", "teaser")], "f-new", ["f-summary"]);
    expect(nameInput()).toBeEnabled();
    expect(renameButton()).toBeNull();
  });
});
