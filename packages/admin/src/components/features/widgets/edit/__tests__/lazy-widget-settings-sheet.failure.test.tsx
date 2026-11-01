/**
 * When the settings panel's code cannot be fetched, the failure stays inside
 * the panel, with Try again, and a retry that succeeds opens the form: the
 * dashboard is never thrown into its error boundary for the session.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { gridBounds } from "../../__tests__/grid-bounds";
import type { CellSettingsProps } from "../CellSettings";

const fetches = vi.hoisted(() => ({ count: 0 }));

vi.mock("../CellSettings", () => {
  fetches.count += 1;
  if (fetches.count === 1) throw new Error("chunk missing after a deploy");
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

describe("the card settings sheet when its code cannot be fetched", () => {
  it("says so in the panel with Try again, and a retry opens the form", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<LazyWidgetSettingsSheet {...cellProps()} />);

    const panel = await screen.findByRole("dialog", { name: "Notes settings" });
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Settings could not be loaded"
    );
    await user.click(within(panel).getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("dialog", { name: "Notes settings form" })
    ).toBeInTheDocument();
    expect(fetches.count).toBe(2);
    consoleError.mockRestore();
  });
});
