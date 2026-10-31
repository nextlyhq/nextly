/**
 * Opening a card's settings before the panel's code has arrived still opens a
 * panel that holds focus and says it is loading.
 *
 * The menu and popover that open the sheet close themselves without handing
 * focus back, so with nothing drawn while the code loads, focus fell to the
 * page and the action looked lost. The sheet's module is held back here, so the
 * test sees the dashboard as it stands on a slow connection.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    default: ({ widget }: { widget: { title: string } }) => (
      <div role="dialog" aria-label={`${widget.title} settings form`} />
    ),
  };
});

const { LazyWidgetSettingsSheet } = await import("../LazyWidgetSettingsSheet");

/** What a card's cell hands its panel, for a card titled Notes. */
function cellProps(): CellSettingsProps {
  const widget: DashboardWidget = {
    id: "core/notes",
    title: "Notes",
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
    focusFirstField: false,
    size,
    returnFocusTo: () => null,
    isEditing: false,
    isWriting: false,
  };
}

describe("the card settings sheet while its code loads", () => {
  // First, while the panel's code is still held back.
  it("hands focus back to the control it was opened from when closed before its code arrives", async () => {
    function Opened() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button">Card menu for Notes</button>
          <LazyWidgetSettingsSheet
            {...cellProps()}
            open={open}
            onOpenChange={setOpen}
            returnFocusTo={() =>
              screen.getByRole("button", { name: "Card menu for Notes" })
            }
          />
        </>
      );
    }
    render(<Opened />);
    const panel = await screen.findByRole("dialog", { name: "Notes settings" });
    await waitFor(() =>
      expect(panel).toContainElement(document.activeElement as HTMLElement)
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Notes settings" })
      ).toBeNull()
    );
    expect(
      screen.getByRole("button", { name: "Card menu for Notes" })
    ).toHaveFocus();
  });

  it("opens a panel named for the card, takes focus into it, says it is loading, then gives way to the sheet", async () => {
    render(<LazyWidgetSettingsSheet {...cellProps()} />);

    const panel = await screen.findByRole("dialog", { name: "Notes settings" });
    expect(within(panel).getByRole("status")).toHaveTextContent(
      "Loading settings…"
    );
    await waitFor(() =>
      expect(panel).toContainElement(document.activeElement as HTMLElement)
    );
    expect(document.activeElement).not.toBe(document.body);

    chunk.release();
    expect(
      await screen.findByRole("dialog", { name: "Notes settings form" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading settings…")).toBeNull();
  });
});
