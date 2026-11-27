/**
 * The Releases page's three views of one set: List, Calendar and Board, chosen
 * by the switch in its header. From the Board, a full column's "+N more"
 * turns the page to the List, on that column's tab.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

const { setSearchParams } = vi.hoisted(() => ({ setSearchParams: vi.fn() }));

vi.mock("@admin/components/features/releases/ReleaseList", () => ({
  ReleaseList: () => <p>the list</p>,
  ReleaseBodyOutline: () => null,
}));
vi.mock("@admin/components/features/releases/ReleaseCalendar", () => ({
  ReleaseCalendar: () => <p>the calendar</p>,
}));
vi.mock("@admin/components/features/releases/ReleaseBoard", () => ({
  ReleaseBoard: ({ onShowTab }: { onShowTab: (tab: string) => void }) => (
    <button type="button" onClick={() => onShowTab("done")}>
      +4 more
    </button>
  ),
}));
vi.mock("@admin/components/features/releases/ReleaseAttentionStrip", () => ({
  ReleaseAttentionStrip: () => null,
  useAttentionStripKnown: () => true,
}));
vi.mock("@admin/components/features/releases/CreateReleaseDialog", () => ({
  CreateReleaseDialog: () => null,
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => false }));
vi.mock("@admin/lib/navigation", async importOriginal => ({
  ...(await importOriginal<object>()),
  setSearchParams,
}));

import ReleasesPage from "./index";

beforeEach(() => vi.clearAllMocks());

describe("the Releases page's trail", () => {
  it("says where the page is, as every other page does", () => {
    render(<ReleasesPage />);

    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(trail).toHaveTextContent("Dashboard");
    expect(trail).toHaveTextContent("Releases");
  });
});

describe("the Releases page's views", () => {
  it("offers List, Calendar and Board, in that order", () => {
    render(<ReleasesPage />);

    const group = screen.getByRole("group", { name: "View releases as" });
    expect(
      [...group.querySelectorAll("button")].map(b => b.textContent)
    ).toEqual(["list", "calendar", "board"]);
    expect(screen.getByText("the list")).toBeInTheDocument();
  });

  it("shows the Board when it is chosen, and says it is the one chosen", async () => {
    render(<ReleasesPage />);

    await userEvent.click(screen.getByRole("button", { name: "board" }));

    expect(screen.getByRole("button", { name: "board" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "+4 more" })).toBeInTheDocument();
    expect(screen.queryByText("the list")).toBeNull();
  });

  it("turns to the List, on the column's tab, from a column's +N more", async () => {
    render(<ReleasesPage />);
    await userEvent.click(screen.getByRole("button", { name: "board" }));

    await userEvent.click(screen.getByRole("button", { name: "+4 more" }));

    expect(setSearchParams).toHaveBeenCalledWith(
      expect.objectContaining({ tab: "done" })
    );
    expect(screen.getByText("the list")).toBeInTheDocument();
  });
});
