// Why: lock the SortableRow contract:
//   - Drag handle exposes the canonical dnd-kit signal
//     (aria-roledescription="sortable") and pointer events fire.
//   - Click on handle does not trigger the row's onEdit (click-vs-drag UX).
//   - Each field card renders a type icon + Edit/Duplicate/Delete icon
//     buttons with stopPropagation so clicking them doesn't open the
//     editor (PR D).
//   - Width badge has a `title=` tooltip explaining how to change it.
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
        onDuplicateField={vi.fn()}
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
        onDuplicateField={vi.fn()}
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
        onDuplicateField={vi.fn()}
      />,
      ["row-0"]
    );
    const handle = screen.getByLabelText("Reorder field");
    handle.click();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("renders an Edit, Duplicate, and Delete icon button (PR D)", () => {
    renderInDnd(
      <SortableRow
        rowId="row-0"
        fields={[baseField()]}
        onEditField={vi.fn()}
        onDeleteField={vi.fn()}
        onDuplicateField={vi.fn()}
      />,
      ["row-0"]
    );
    expect(screen.getByLabelText("Edit title")).toBeInTheDocument();
    expect(screen.getByLabelText("Duplicate title")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete title")).toBeInTheDocument();
  });

  it("renders a width tooltip via the title attribute (PR D)", () => {
    renderInDnd(
      <SortableRow
        rowId="row-0"
        fields={[baseField({ admin: { width: "50%" } })]}
        onEditField={vi.fn()}
        onDeleteField={vi.fn()}
        onDuplicateField={vi.fn()}
      />,
      ["row-0"]
    );
    const badge = screen.getByText(/^50%$/);
    expect(badge.getAttribute("title")).toMatch(
      /Width: 50%\. Configure in the field's Display tab\./
    );
  });

  it("clicking the duplicate icon does not propagate to the row's onEdit", () => {
    const onEdit = vi.fn();
    const onDuplicate = vi.fn();
    renderInDnd(
      <SortableRow
        rowId="row-0"
        fields={[baseField()]}
        onEditField={onEdit}
        onDeleteField={vi.fn()}
        onDuplicateField={onDuplicate}
      />,
      ["row-0"]
    );
    screen.getByLabelText("Duplicate title").click();
    expect(onDuplicate).toHaveBeenCalledWith("f1");
    expect(onEdit).not.toHaveBeenCalled();
  });
});
