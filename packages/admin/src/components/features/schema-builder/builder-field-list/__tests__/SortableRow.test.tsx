// Why: regression test for Bug 3 -- SortableRow was rendering the drag
// handle but not spreading useSortable's {attributes, listeners} on it,
// so pointer events never fired. Lock that the handle exposes the
// canonical dnd-kit signal (aria-roledescription="sortable") and that
// clicking the handle does not trigger the row's onEdit (would be a
// regression of the click-vs-drag UX).
import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderField } from "../../types";
import { SortableRow } from "../SortableRow";

const baseField = (overrides: Partial<BuilderField> = {}): BuilderField => ({
  id: "f1",
  name: "title",
  label: "Title",
  type: "text",
  validation: {},
  ...overrides,
});

const renderInDnd = (ui: React.ReactNode, items: string[]) =>
  render(
    <DndContext>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {ui}
      </SortableContext>
    </DndContext>
  );

describe("SortableRow", () => {
  it("exposes the drag handle with sortable role description (not readOnly)", () => {
    renderInDnd(
      <SortableRow
        rowId="row-0"
        fields={[baseField()]}
        onEditField={vi.fn()}
        onDeleteField={vi.fn()}
      />,
      ["row-0"]
    );
    const handle = screen.getByLabelText("Reorder field");
    expect(handle.getAttribute("aria-roledescription")).toBe("sortable");
    expect(handle.getAttribute("tabindex")).not.toBe("-1");
  });

  it("does not render the drag handle in readOnly mode", () => {
    renderInDnd(
      <SortableRow
        rowId="row-0"
        fields={[baseField()]}
        readOnly
        onEditField={vi.fn()}
        onDeleteField={vi.fn()}
      />,
      ["row-0"]
    );
    expect(screen.queryByLabelText("Reorder field")).toBeNull();
  });

  it("does not propagate drag handle clicks to the row's onEdit", () => {
    const onEdit = vi.fn();
    renderInDnd(
      <SortableRow
        rowId="row-0"
        fields={[baseField()]}
        onEditField={onEdit}
        onDeleteField={vi.fn()}
      />,
      ["row-0"]
    );
    const handle = screen.getByLabelText("Reorder field");
    handle.click();
    expect(onEdit).not.toHaveBeenCalled();
  });
});
