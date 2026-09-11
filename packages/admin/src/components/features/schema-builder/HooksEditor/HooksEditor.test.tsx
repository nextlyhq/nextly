/**
 * A hook can be picked up from the keyboard, and the reader is told which.
 *
 * The card's drag handle was an icon with no accessible name, and a drag
 * announced the hook's instance id. Both are asserted through the real
 * `DndContext`: the handle by its name, the pick-up by what the live region
 * says.
 *
 * @module components/features/schema-builder/HooksEditor/HooksEditor.test
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { layOutStacked, recordDragRegion } from "@admin/__tests__/helpers/drag";

import { HooksEditor } from "./HooksEditor";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the hooks editor", () => {
  it("names each handle after its hook and says what it picked up", async () => {
    render(
      <HooksEditor
        hooks={[
          { id: "h1", hookId: "auto-slug", config: {}, enabled: true },
          { id: "h2", hookId: "audit-fields", config: {}, enabled: true },
        ]}
        onHooksChange={() => {}}
        fieldNames={["title"]}
        isExpanded
      />
    );
    const handle = screen.getByRole("button", {
      name: "Reorder Set Audit Fields",
    });
    // Each card is the sortable node; lay the cards out as a column.
    const cards = screen
      .getAllByRole("button", { name: /^Reorder / })
      .map(
        h => h.closest("[class*='rounded']") ?? (h.parentElement as Element)
      );
    layOutStacked(cards, { height: 80 });
    const heard = recordDragRegion();

    handle.focus();
    fireEvent.keyDown(handle, { code: "Space", key: " " });

    await waitFor(() =>
      expect(heard).toContain("Picked up Set Audit Fields, position 2 of 2.")
    );
    expect(heard.join(" ")).not.toContain("draggable item");
  });
});
