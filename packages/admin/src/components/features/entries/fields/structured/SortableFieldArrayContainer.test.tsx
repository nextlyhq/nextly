/**
 * The generic sortable container names a row the way the row's own handle is
 * named.
 *
 * It sorts rows it knows nothing about — a repeater's, a component field's —
 * so the caller says what a row is called, per row. A multi-component field
 * whose rows are a Hero and a CTA must announce "Hero 1", not the parent
 * field's label for every row.
 *
 * @module components/features/entries/fields/structured/SortableFieldArrayContainer.test
 */

import { useSortable } from "@dnd-kit/sortable";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { layOutStacked, recordDragRegion } from "@admin/__tests__/helpers/drag";

import {
  SortableFieldArrayContainer,
  useSortableSensors,
} from "./field-array-helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

type Row = { id: string; type: string };

/** The least a row needs: a sortable node and a handle carrying the listeners. */
function TestRow({ row, name }: { row: Row; name: string }) {
  const { attributes, listeners, setNodeRef } = useSortable({ id: row.id });
  return (
    <div ref={setNodeRef} data-testid={`row-${row.id}`}>
      <button
        type="button"
        aria-label={`Drag to reorder ${name}`}
        {...attributes}
        {...listeners}
      />
    </div>
  );
}

function Harness({
  describeItem,
}: {
  describeItem?: (row: Row, index: number) => string;
}) {
  const rows: Row[] = [
    { id: "r1", type: "Hero" },
    { id: "r2", type: "CTA" },
  ];
  const sensors = useSortableSensors();
  return (
    <SortableFieldArrayContainer
      items={rows}
      sensors={sensors}
      handleDragEnd={() => {}}
      isSortable
      describeItem={describeItem}
    >
      {rows.map((row, index) => (
        <TestRow key={row.id} row={row} name={`${row.type} ${index + 1}`} />
      ))}
    </SortableFieldArrayContainer>
  );
}

describe("the sortable container", () => {
  it("names a row with what its caller says, per row", async () => {
    render(
      <Harness describeItem={(row, index) => `${row.type} ${index + 1}`} />
    );
    layOutStacked([screen.getByTestId("row-r1"), screen.getByTestId("row-r2")]);
    const heard = recordDragRegion();
    const handle = screen.getByRole("button", {
      name: "Drag to reorder CTA 2",
    });
    handle.focus();
    fireEvent.keyDown(handle, { code: "Space", key: " " });

    await waitFor(() =>
      expect(heard).toContain("Picked up CTA 2, position 2 of 2.")
    );
  });

  it("falls back to a numbered item when the caller says nothing", async () => {
    render(<Harness />);
    layOutStacked([screen.getByTestId("row-r1"), screen.getByTestId("row-r2")]);
    const heard = recordDragRegion();
    const handle = screen.getByRole("button", {
      name: "Drag to reorder Hero 1",
    });
    handle.focus();
    fireEvent.keyDown(handle, { code: "Space", key: " " });

    await waitFor(() =>
      expect(heard).toContain("Picked up Item 1, position 1 of 2.")
    );
  });
});
