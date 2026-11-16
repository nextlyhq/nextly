/**
 * Which fields a condition may read, as the Builder's settings panel offers
 * them: every field the entry form can evaluate for the field, which is each
 * named field on its level, through containers without a name of their own;
 * each shown by its label, its type's plain name and its name in the database
 * and API, so two fields of one label and type are told apart; and the one
 * chosen kept on the condition.
 */
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { nestedFixtureFields } from "@admin/components/features/schema-builder/__fixtures__/nested-fixture";
import { BuilderFieldSettings } from "@admin/components/features/schema-builder/BuilderFieldSettings";
import type { BuilderField } from "@admin/components/features/schema-builder/types";

// Radix opens its menus by pointer capture and scrolls the chosen item into
// view, neither of which jsdom has.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

/** The Builder's panel over `initial`, holding each change as the draft does. */
function Panel({
  initial,
  fieldId,
  onUpdate,
}: {
  initial: BuilderField[];
  fieldId: string;
  onUpdate: (next: BuilderField) => void;
}) {
  const [fields, setFields] = useState(initial);
  const replace = (list: BuilderField[], next: BuilderField): BuilderField[] =>
    list.map(each =>
      each.id === next.id
        ? next
        : each.fields
          ? { ...each, fields: replace(each.fields, next) }
          : each
    );
  return (
    <BuilderFieldSettings
      kind="collection"
      fields={fields}
      fieldId={fieldId}
      savedFieldIds={new Set()}
      readOnly={false}
      docked={false}
      onFieldChange={next => {
        onUpdate(next);
        setFields(all => replace(all, next));
      }}
      onFieldDelete={() => {}}
      onClose={() => {}}
    />
  );
}

/** Open the Conditions tab, add a condition, and open its source list. */
async function openSources(): Promise<string[]> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: "Conditions" }));
  await user.click(screen.getByRole("button", { name: /Add condition/ }));
  await user.click(screen.getByRole("combobox", { name: "Condition field" }));
  return screen.getAllByRole("option").map(option => option.textContent ?? "");
}

const field = (
  name: string,
  extra: Partial<BuilderField> = {}
): BuilderField => ({
  id: `f-${name || extra.label}`,
  name,
  label: name ? name[0].toUpperCase() + name.slice(1) : "",
  type: "text",
  ...extra,
});

describe("a condition's source list", () => {
  it("two sibling fields of one label and type, each with its name, the chosen one kept", async () => {
    const onUpdate = vi.fn();
    render(
      <Panel
        initial={nestedFixtureFields()}
        fieldId="f-internal-note"
        onUpdate={onUpdate}
      />
    );
    const offered = await openSources();
    // Both labelled Summary, both long text: told apart by name.
    const summaries = offered.filter(text => text.startsWith("Summary"));
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toContain("name in the database and API: summary_a");
    expect(summaries[1]).toContain("name in the database and API: summary_b");
    for (const text of summaries) expect(text).toContain("Long text");

    await userEvent.click(screen.getByRole("option", { name: /summary_b/ }));
    const last = onUpdate.mock.calls.at(-1)?.[0] as BuilderField;
    expect(last.admin?.condition?.field).toBe("summary_b");
  });

  it("offers the fields on its level through a container without a name, and no other level's", async () => {
    // Inside "details", a nameless group holds Teaser: the entry form reads a
    // condition of Teaser's beside it in details, so Headline is a source,
    // and the top level's Title is not.
    const fields = [
      field("title"),
      field("details", {
        type: "group",
        fields: [
          field("headline"),
          field("", {
            label: "Layout",
            type: "group",
            fields: [field("teaser"), field("caption")],
          }),
        ],
      }),
    ];
    render(<Panel initial={fields} fieldId="f-teaser" onUpdate={vi.fn()} />);
    const offered = await openSources();
    expect(offered.map(text => text.split(" ")[0])).toEqual([
      "Headline",
      "Caption",
    ]);
    // Its path where it is nested, as every list in the Builder says it.
    expect(offered[0]).toContain(
      "name in the database and API: details.headline"
    );
  });

  it("offers the fields inside a nameless container to one beside it", async () => {
    const fields = [
      field("title"),
      field("", {
        label: "Layout",
        type: "group",
        fields: [field("teaser")],
      }),
      field("body"),
    ];
    render(<Panel initial={fields} fieldId="f-body" onUpdate={vi.fn()} />);
    const offered = await openSources();
    expect(offered.map(text => text.split(" ")[0])).toEqual([
      "Title",
      "Teaser",
    ]);
  });
});
