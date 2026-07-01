// Why: a plugin-contributed field inside an otherwise-editable UI collection
// must be (a) not editable/deletable, (b) visibly read-only (lock indicator),
// and (c) labelled with a "Plugin · <owner>" badge — the user's own fields stay
// fully editable. Locks the Builder's per-field plugin-source affordance.
import { DndContext } from "@dnd-kit/core";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { BuilderFieldList } from "./BuilderFieldList";
import type { BuilderField } from "./types";

const field = (overrides: Partial<BuilderField>): BuilderField => ({
  id: overrides.name ?? "f",
  name: "x",
  label: overrides.label ?? "Field",
  type: "text",
  validation: {},
  // Full-width so each field packs onto its own row (deterministic rows).
  admin: { width: "100%" },
  ...overrides,
});

function renderList(fields: BuilderField[]) {
  return render(
    <DndContext>
      <BuilderFieldList
        fields={fields}
        onAddAt={vi.fn()}
        onEditField={vi.fn()}
        onDeleteField={vi.fn()}
        onDuplicateField={vi.fn()}
        onReorder={vi.fn()}
        onAddInsideParent={vi.fn()}
        readOnly={false}
      />
    </DndContext>
  );
}

describe("BuilderFieldList — plugin-sourced field lock/label", () => {
  it("locks + labels + marks read-only a plugin field inside an editable collection", () => {
    renderList([
      field({ id: "f1", name: "body", label: "Body", source: "ui" }),
      field({
        id: "f2",
        name: "meta_title",
        label: "Meta Title",
        source: "plugin",
        owner: "@acme/plugin-example",
        locked: true,
      }),
    ]);

    // User field: editable, no plugin badge.
    const userRow = screen.getByTestId("field-row-body");
    expect(within(userRow).queryByLabelText(/delete/i)).toBeInTheDocument();
    expect(within(userRow).queryByText(/plugin/i)).not.toBeInTheDocument();

    // Plugin field: locked + labelled + read-only.
    const pluginRow = screen.getByTestId("field-row-meta_title");
    expect(
      within(pluginRow).queryByLabelText(/delete/i)
    ).not.toBeInTheDocument();
    expect(within(pluginRow).queryByLabelText(/edit/i)).not.toBeInTheDocument();
    expect(within(pluginRow).getByText(/plugin/i)).toBeInTheDocument();
    expect(within(pluginRow).getByText(/plugin-example/i)).toBeInTheDocument();
    expect(
      within(pluginRow).getByTestId("field-readonly-indicator")
    ).toBeInTheDocument();
  });
});
