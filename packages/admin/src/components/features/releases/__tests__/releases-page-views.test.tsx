/**
 * The Releases page's three views of one set of releases.
 *
 * "Hide single documents" is turned on in the List's toolbar, and it holds
 * for the Calendar and the Board as well: the page keeps the switch, so it
 * outlives the List being swapped for another view and back. The views
 * stand in as small fakes here, each saying what it was handed; what each
 * view does with the filter is tested beside it.
 *
 * @module components/features/releases/__tests__/releases-page-views.test
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { ReleaseKind } from "@admin/types/releases";

vi.mock(
  "@admin/components/features/releases/ReleaseList",
  async importOriginal => ({
    // The real rule for which kind the switch shows; only the list is faked.
    releaseKindShown: (
      await importOriginal<
        typeof import("@admin/components/features/releases/ReleaseList")
      >()
    ).releaseKindShown,
    ReleaseBodyOutline: () => null,
    ReleaseList: ({
      hideSingles,
      onHideSinglesChange,
    }: {
      hideSingles: boolean;
      onHideSinglesChange: (next: boolean) => void;
    }) => (
      <label>
        <input
          type="checkbox"
          checked={hideSingles}
          onChange={event => onHideSinglesChange(event.target.checked)}
        />
        Hide single documents
      </label>
    ),
  })
);
vi.mock("@admin/components/features/releases/ReleaseBoard", () => ({
  ReleaseBoard: ({ kind }: { kind?: ReleaseKind }) => (
    <p>Board of {kind ?? "every"} kind</p>
  ),
}));
vi.mock("@admin/components/features/releases/ReleaseCalendar", () => ({
  ReleaseCalendar: ({ kind }: { kind?: ReleaseKind }) => (
    <p>Calendar of {kind ?? "every"} kind</p>
  ),
}));
vi.mock("@admin/components/features/releases/ReleaseAttentionStrip", () => ({
  ReleaseAttentionStrip: () => null,
  useAttentionStripKnown: () => true,
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => false }));

import ReleasesPage from "@admin/pages/dashboard/releases";

const view = (name: "List" | "Calendar" | "Board") =>
  userEvent.click(screen.getByRole("button", { name: new RegExp(name, "i") }));

describe("the Releases page's views", () => {
  it("carries 'Hide single documents' from the List to the Calendar and the Board, and back", async () => {
    render(<ReleasesPage />);

    await view("Board");
    expect(screen.getByText("Board of every kind")).toBeInTheDocument();

    await view("List");
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Hide single documents" })
    );
    await view("Calendar");
    expect(screen.getByText("Calendar of release kind")).toBeInTheDocument();
    await view("Board");
    expect(screen.getByText("Board of release kind")).toBeInTheDocument();

    // Back on the List, the switch is still on, so turning it off is where
    // it was turned on.
    await view("List");
    const toggle = screen.getByRole("checkbox", {
      name: "Hide single documents",
    });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await view("Board");
    expect(screen.getByText("Board of every kind")).toBeInTheDocument();
  });
});
