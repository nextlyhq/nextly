// A field's name is judged where it is set, by the rules the save refuses a name by: in the
// settings panel as it is typed and as the label derives it, and in the picker as the label derives
// it. Each rule is asked of each place, on each surface whose names differ: a malformed spelling,
// a built-in column's name, a Draft/Published name while drafts are on, a column too long to keep
// whole, and a sibling's name, in the same spelling, in other letter case and as the same column,
// a field deleted but not yet saved among the siblings. The save's rule itself, and that it agrees
// with the server's save, is tested beside it in nextly.
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { BuilderFieldPicker } from "@admin/components/features/schema-builder/BuilderFieldPicker";
import { BuilderFieldSettings } from "@admin/components/features/schema-builder/BuilderFieldSettings";
import type { BuilderKind } from "@admin/components/features/schema-builder/builder-config";
import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { COLLECTION_BUILDER_CONFIG } from "@admin/pages/dashboard/collections/builder/builder-config";
import { FIELD_GROUP_BUILDER_CONFIG } from "@admin/pages/dashboard/field-group/builder/builder-config";
import { SINGLE_BUILDER_CONFIG } from "@admin/pages/dashboard/singles/builder/builder-config";

vi.mock("@admin/hooks/queries", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries")>()),
  useFieldGroups: () => ({ data: { items: [], meta: {} }, isLoading: false }),
}));

const CONFIGS = {
  collection: COLLECTION_BUILDER_CONFIG,
  single: SINGLE_BUILDER_CONFIG,
  "field-group": FIELD_GROUP_BUILDER_CONFIG,
} as const;

const text = (id: string, name: string, over: Partial<BuilderField> = {}) =>
  ({
    id,
    name,
    label: name,
    type: "text",
    validation: {},
    ...over,
  }) as BuilderField;

/** Saved siblings: a plugin's camelCase `metaTitle` and a `teaser` the person has since deleted. */
const META = text("f-meta", "metaTitle", { label: "Meta title" });
const TEASER = text("f-teaser", "teaser", { label: "Teaser" });
const SAVED: BuilderField[] = [META, TEASER];

/** The settings panel on a new field beside `META`, `TEASER` deleted but not yet saved. */
function Panel({
  kind = "collection",
  drafts = false,
  initial = text("f-new", "", { label: "" }),
  nestIn,
}: {
  kind?: BuilderKind;
  drafts?: boolean;
  initial?: BuilderField;
  nestIn?: string;
}) {
  const [field, setField] = useState(initial);
  const fields = nestIn
    ? [META, { ...text("f-box", nestIn), type: "group", fields: [field] }]
    : [META, field];
  return (
    <BuilderFieldSettings
      kind={kind}
      fields={fields as BuilderField[]}
      fieldId={field.id}
      savedFieldIds={new Set(SAVED.map(f => f.id))}
      readOnly={false}
      docked
      savedFields={SAVED}
      lifecycleEnabled={drafts}
      onFieldChange={setField}
      onFieldDelete={() => {}}
      onClose={() => {}}
    />
  );
}

const nameInput = () => screen.getByRole("textbox", { name: "Name" });
const labelInput = () => screen.getByRole("textbox", { name: "Label" });
const problem = () => screen.queryByRole("alert");

async function typeName(name: string) {
  const user = userEvent.setup();
  await user.clear(nameInput());
  await user.type(nameInput(), name);
}

describe("a name typed in the settings panel", () => {
  const cases: {
    rule: string;
    name: string;
    kind?: BuilderKind;
    drafts?: boolean;
    says: RegExp;
  }[] = [
    {
      rule: "a spelling the save refuses",
      name: "Body",
      says: /lowercase letters/,
    },
    {
      rule: "a column too long to keep whole",
      name: "a".repeat(64),
      says: /63 characters/,
    },
    {
      rule: "a built-in column, on a collection",
      name: "created_at",
      says: /built-in column/,
    },
    {
      rule: "a built-in column, on a Single",
      name: "updated_at",
      kind: "single",
      says: /built-in column/,
    },
    {
      rule: "a built-in column, in a field group",
      name: "id",
      kind: "field-group",
      says: /built-in column/,
    },
    {
      rule: "a collection's owner column",
      name: "created_by",
      says: /built-in column/,
    },
    {
      rule: "Draft/Published's name while drafts are on, on a collection",
      name: "status",
      drafts: true,
      says: /Draft\/Published/,
    },
    {
      rule: "Draft/Published's name while drafts are on, on a Single",
      name: "first_published_at",
      kind: "single",
      drafts: true,
      says: /Draft\/Published/,
    },
    {
      rule: "a sibling's name in other letter case",
      name: "metatitle",
      says: /metaTitle here already has the same name in other letter case/,
    },
    {
      rule: "a sibling's name as the same column",
      name: "meta_title",
      says: /metaTitle here already has a name that becomes the same column/,
    },
    {
      rule: "a name a pending delete still holds",
      name: "teaser",
      says: /teaser here already has the same name/,
    },
  ];
  for (const { rule, name, kind, drafts, says } of cases) {
    it(`says so beside the name for ${rule}`, async () => {
      render(<Panel kind={kind} drafts={drafts} />);
      await typeName(name);
      expect(problem()).toHaveTextContent(says);
      expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    });
  }

  // The same names, where the save takes them: the refusals above are the rules', not the names'.
  const takes: {
    name: string;
    kind?: BuilderKind;
    drafts?: boolean;
    nestIn?: string;
  }[] = [
    { name: "body" },
    { name: "order" },
    { name: "status" },
    { name: "status", kind: "field-group", drafts: true },
    { name: "created_by", kind: "single" },
    { name: "created_by", nestIn: "box" },
    { name: "a".repeat(64), nestIn: "box" },
  ];
  for (const { name, kind, drafts, nestIn } of takes) {
    it(`says nothing for ${name.length > 20 ? "a 64-character name" : name}${nestIn ? " inside a group" : ""} on ${kind ?? "collection"}${drafts ? " with drafts on" : ""}`, async () => {
      render(<Panel kind={kind} drafts={drafts} nestIn={nestIn} />);
      await typeName(name);
      expect(problem()).toBeNull();
      expect(nameInput()).toHaveAttribute("aria-invalid", "false");
    });
  }

  // A saved field's own name is the save's to keep, whatever the rule says of a new one.
  it("says nothing of the name a saved field already has", () => {
    render(<Panel initial={META} />);
    expect(nameInput()).toHaveValue("metaTitle");
    expect(problem()).toBeNull();
  });
});

describe("a name the settings panel derives from the label", () => {
  it("is judged as it follows the label", async () => {
    const user = userEvent.setup();
    render(<Panel />);
    await user.type(labelInput(), "Created at");
    expect(nameInput()).toHaveValue("created_at");
    expect(problem()).toHaveTextContent(/built-in column/);
    await user.clear(labelInput());
    await user.type(labelInput(), "Meta Title");
    expect(nameInput()).toHaveValue("meta_title");
    expect(problem()).toHaveTextContent(/same column/);
  });
});

/** The picker opened at the top level, beside `META`, with `TEASER` deleted but not yet saved. */
function renderPicker(kind: BuilderKind = "collection", drafts = false) {
  const onAdded = vi.fn();
  render(
    <BuilderFieldPicker
      config={CONFIGS[kind]}
      fields={[META]}
      position={{}}
      onCancel={() => {}}
      onFieldsChange={() => {}}
      onAdded={onAdded}
      savedFields={SAVED}
      lifecycleEnabled={drafts}
    />
  );
  return { onAdded };
}

async function labelInPicker(label: string) {
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("combobox", { name: "Search field types" }),
    "text"
  );
  await user.click(screen.getByRole("option", { name: /^Text/ }));
  await user.type(screen.getByRole("textbox", { name: "Label" }), label);
  return user;
}

const pickedName = () =>
  screen.getByText(/^Name:/).querySelector("code")?.textContent;

describe("a name the picker derives from the label", () => {
  // A name taken by a sibling, a pending delete, a built-in column or Draft/Published moves to the
  // next free suffix, so the derived name is always one the save takes.
  const suffixed: {
    label: string;
    kind?: BuilderKind;
    drafts?: boolean;
    name: string;
  }[] = [
    { label: "Meta title", name: "meta_title_2" },
    { label: "Teaser", name: "teaser_2" },
    { label: "Created at", name: "created_at_2" },
    { label: "Status", drafts: true, name: "status_2" },
    { label: "Status", kind: "single", drafts: true, name: "status_2" },
    { label: "Status", name: "status" },
  ];
  for (const { label, kind, drafts, name } of suffixed) {
    it(`gives "${label}" the name ${name} on ${kind ?? "collection"}${drafts ? " with drafts on" : ""}`, async () => {
      renderPicker(kind, drafts);
      await labelInPicker(label);
      expect(pickedName()).toBe(name);
      expect(problem()).toBeNull();
      expect(screen.getByRole("button", { name: "Add field" })).toBeEnabled();
    });
  }

  // A name refused for what it is, not for being taken, stays refused: the field cannot be added,
  // by button or by Enter.
  it("refuses a name too long to keep whole, and adds nothing by button or Enter", async () => {
    const { onAdded } = renderPicker();
    const user = await labelInPicker("a".repeat(64));
    expect(problem()).toHaveTextContent(/63 characters/);
    expect(screen.getByRole("button", { name: "Add field" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add field" }));
    await user.type(screen.getByRole("textbox", { name: "Label" }), "{Enter}");
    expect(onAdded).not.toHaveBeenCalled();
  });
});
