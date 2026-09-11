/**
 * The fields table can be reordered from the keyboard, and says what it is
 * doing about the FIELD rather than its key.
 *
 * Driven through the real `DndContext`, with the rows laid out the way a
 * table lays them out — see `__tests__/helpers/drag` for why jsdom needs
 * telling. From there a Space, an arrow and a Space reorder the list the way
 * a keyboard user's would, and the live region says what theirs would say.
 *
 * @module components/features/content/SortableFieldsTable.test
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  dragRegion,
  layOutStacked,
  recordDragRegion,
} from "@admin/__tests__/helpers/drag";
import type { FieldConfig } from "@admin/types/ui/collection";

import { SortableFieldsTable } from "./SortableFieldsTable";

const FIELDS: FieldConfig[] = [
  { name: "title", label: "Title", type: "text" },
  { name: "slug", label: "Slug", type: "text" },
  { name: "body", label: "Body", type: "richtext" },
];

afterEach(() => {
  vi.restoreAllMocks();
});

function draw() {
  const onReorder = vi.fn();
  const view = render(
    <SortableFieldsTable
      fields={FIELDS}
      onReorder={onReorder}
      onEdit={vi.fn()}
      onDeleteRequest={vi.fn()}
    />
  );
  layOutStacked(Array.from(document.querySelectorAll("tbody tr")));
  return { ...view, onReorder };
}

describe("the fields table", () => {
  it("names each handle after its field, so a keyboard user knows which row they hold", () => {
    // 🔴 Every handle used to be "Drag handle". Tabbing through was N identical
    // buttons with nothing to say which field was which.
    draw();
    expect(
      screen.getByRole("button", { name: "Drag to reorder Title" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Drag to reorder Body" })
    ).toBeInTheDocument();
  });

  it("picks a field up from the keyboard and says so by label and position", async () => {
    // 🔴 Two things, and one press proves both. The drag begins only if a
    // KeyboardSensor is attached -- a pointer-only table ignores the key -- and
    // the sentence names "Slug", not the sortable key, because the table
    // supplied its own announcements in place of dnd-kit's "Picked up
    // draggable item slug."
    draw();
    const heard = recordDragRegion();
    const handle = screen.getByRole("button", { name: "Drag to reorder Slug" });
    handle.focus();
    fireEvent.keyDown(handle, { code: "Space", key: " " });

    await waitFor(() =>
      expect(heard).toContain("Picked up Slug, position 2 of 3.")
    );
    // Nothing it said, before or after, was dnd-kit's default.
    expect(heard.join(" ")).not.toContain("draggable item");
  });

  it("reorders the fields from the keyboard: Space, arrow, Space", async () => {
    // 🔴 The whole of WCAG 2.1.1 for this table, end to end. Every step is
    // spoken: the pick-up, the row it is over once the arrow moves it, and
    // the landing -- and the drop reaches `onReorder` with the moved list.
    const { onReorder } = draw();
    const heard = recordDragRegion();
    const handle = screen.getByRole("button", { name: "Drag to reorder Slug" });
    handle.focus();
    fireEvent.keyDown(handle, { code: "Space", key: " " });
    await waitFor(() =>
      expect(heard).toContain("Picked up Slug, position 2 of 3.")
    );

    fireEvent.keyDown(handle, { code: "ArrowDown", key: "ArrowDown" });
    await waitFor(() =>
      expect(heard).toContain("Slug is over Body, position 3 of 3.")
    );

    fireEvent.keyDown(handle, { code: "Space", key: " " });
    await waitFor(() =>
      expect(heard).toContain("Slug moved to position 3 of 3.")
    );
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(
      onReorder.mock.calls[0][0].map((f: { name: string }) => f.name)
    ).toEqual(["title", "body", "slug"]);
  });

  it("says where a cancelled drag returned to", async () => {
    draw();
    const heard = recordDragRegion();
    const handle = screen.getByRole("button", { name: "Drag to reorder Slug" });
    handle.focus();
    fireEvent.keyDown(handle, { code: "Space", key: " " });
    await waitFor(() => expect(heard.length).toBeGreaterThan(0));

    fireEvent.keyDown(handle, { code: "Escape", key: "Escape" });

    await waitFor(() =>
      expect(dragRegion().textContent).toContain(
        "Dragging cancelled. Slug returned to position 2 of 3."
      )
    );
  });
});
