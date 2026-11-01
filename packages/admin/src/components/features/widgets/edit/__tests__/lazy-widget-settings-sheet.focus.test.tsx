/**
 * The panel's code arriving while its stand-in is open: the loaded panel takes the stand-in's
 * place, and where it was opened for a field (a card's empty state asking for what it misses),
 * that field keeps the focus the panel gives it. The stand-in going is no close: focus is not sent
 * back to the control the panel was opened from, which would take it off the field.
 *
 * The panel here is a stand-in of its own: a non-modal sheet that focuses its field as it opens,
 * as the real one does for `focusFirstField`. Its module is held back until the test lets it in.
 */
import { Sheet, SheetContent, SheetTitle } from "@nextlyhq/ui";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { gridBounds } from "../../__tests__/grid-bounds";
import type { CellSettingsProps } from "../CellSettings";

const chunk = vi.hoisted(() => {
  let release: () => void = () => undefined;
  const arrived = new Promise<void>(resolve => {
    release = resolve;
  });
  return { arrived, release: () => release() };
});

vi.mock("../CellSettings", async () => {
  await chunk.arrived;
  return {
    default: ({
      widget,
      open,
      onOpenChange,
    }: {
      widget: { title: string };
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }) => (
      <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
        <SheetContent
          side="right"
          // Not modal, as the real panel is not: a click or focus beside it leaves it open.
          onInteractOutside={event => event.preventDefault()}
          onOpenAutoFocus={event => {
            event.preventDefault();
            document.getElementById("note-field")?.focus();
          }}
        >
          <SheetTitle>{widget.title} settings</SheetTitle>
          <textarea id="note-field" aria-label="Note" />
        </SheetContent>
      </Sheet>
    ),
  };
});

const { LazyWidgetSettingsSheet } = await import("../LazyWidgetSettingsSheet");

/** What a card's cell hands its panel, for a card titled Note, opened for its first field. */
function cellProps(): CellSettingsProps {
  const widget: DashboardWidget = {
    id: "core/note",
    title: "Note",
    archetype: "list",
    size: gridBounds(4),
    query: { source: "collection:posts", op: "list", limit: 5 },
  };
  const size = { w: 4, h: 3 };
  return {
    row: { placementId: "p1", widget, size },
    widget,
    data: { slot: undefined, updatedAt: null, isFetching: false },
    done: { done: vi.fn(), blocked: undefined },
    open: true,
    onOpenChange: vi.fn(),
    focusFirstField: true,
    size,
    returnFocusTo: () => null,
    isEditing: false,
    isWriting: false,
  };
}

describe("the panel's code arriving while its stand-in is open", () => {
  it("leaves focus on the field the panel opened for, not on the control it was opened from", async () => {
    function Opened() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button">Card menu for Note</button>
          <LazyWidgetSettingsSheet
            {...cellProps()}
            open={open}
            onOpenChange={setOpen}
            returnFocusTo={() =>
              screen.getByRole("button", { name: "Card menu for Note" })
            }
          />
        </>
      );
    }
    render(<Opened />);
    // The stand-in, while the code is held back, with focus in it.
    const standIn = await screen.findByRole("dialog", {
      name: /Note settings/,
    });
    await waitFor(() =>
      expect(standIn).toContainElement(document.activeElement as HTMLElement)
    );

    await act(async () => {
      chunk.release();
      await chunk.arrived;
    });
    const field = await screen.findByRole("textbox", { name: "Note" });
    await waitFor(() => expect(field).toHaveFocus());
    // Still there once the stand-in's leaving has played out, which happens a turn later.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(field).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Card menu for Note" })
    ).not.toHaveFocus();
  });
});
