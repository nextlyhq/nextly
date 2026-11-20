/**
 * The "Waiting for my review" view (R-11, D10): every part whose next step the reader may take and
 * that waits for them, across collections and Singles, each row naming its document (a link to it),
 * where it lives, its stage, whom it waits for and when it was submitted. With nothing waiting it
 * says so; with more waiting than one read counts, the count is a floor.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { WaitingForMyReview } from "../WaitingForMyReview";

const { waiting } = vi.hoisted(() => ({
  waiting: vi.fn(),
}));
vi.mock("@admin/hooks/queries/useWaitingForMe", () => ({
  useWaitingForMe: (args: { page: number; limit: number }) => waiting(args),
}));

const rows = [
  {
    key: "collection:posts:e1:-",
    title: "Pricing FAQ",
    href: "/admin/collections/posts/e1",
    where: "Posts",
    stage: "Legal check",
    waitingFor: "Editors",
    submitted: "2026-11-02T10:00:00.000Z",
  },
  {
    key: "single:home:s1:=en",
    title: "Home",
    href: "/admin/singles/home",
    where: "Home (English)",
    stage: "In review",
    waitingFor: "You",
    submitted: "2026-11-03T10:00:00.000Z",
  },
];

describe("WaitingForMyReview", () => {
  it("lists each waiting part with a link to its document, where it lives, its stage and whom it waits for", () => {
    waiting.mockReturnValue({
      rows,
      total: 2,
      totalCapped: false,
      isLoading: false,
    });
    render(<WaitingForMyReview />);

    expect(
      screen.getByRole("heading", { name: "Waiting for my review" })
    ).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Waiting for my review" });
    const pricing = within(table).getByRole("row", { name: /Pricing FAQ/ });
    expect(
      within(pricing).getByRole("link", { name: "Pricing FAQ" })
    ).toHaveAttribute("href", "/admin/collections/posts/e1");
    expect(within(pricing).getByText("Posts")).toBeInTheDocument();
    expect(within(pricing).getByText("Legal check")).toBeInTheDocument();
    expect(within(pricing).getByText("Editors")).toBeInTheDocument();
    const home = within(table).getByRole("row", { name: /Home/ });
    expect(within(home).getByText("Home (English)")).toBeInTheDocument();
    expect(screen.getByText("2 waiting")).toBeInTheDocument();
  });

  it("says when nothing waits for the reader", () => {
    waiting.mockReturnValue({
      rows: [],
      total: 0,
      totalCapped: false,
      isLoading: false,
    });
    render(<WaitingForMyReview />);

    expect(
      screen.getByText("Nothing waits for your review.")
    ).toBeInTheDocument();
  });

  it("shows a count that is a floor as one", () => {
    waiting.mockReturnValue({
      rows,
      total: 1000,
      totalCapped: true,
      isLoading: false,
    });
    render(<WaitingForMyReview />);

    expect(screen.getByText("1000+ waiting")).toBeInTheDocument();
  });

  it("says a list it could not read failed, never that nothing waits", () => {
    waiting.mockReturnValue({
      rows: [],
      total: 0,
      totalCapped: false,
      hasNext: false,
      hasPrev: false,
      isLoading: false,
      error: new Error("The server is unavailable."),
    });
    render(<WaitingForMyReview />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The server is unavailable."
    );
    expect(
      screen.queryByText("Nothing waits for your review.")
    ).not.toBeInTheDocument();
  });

  it("reaches every page of the waiting work", async () => {
    waiting.mockImplementation(({ page }: { page: number }) => ({
      rows: page === 1 ? [rows[0]] : [rows[1]],
      total: 2,
      totalCapped: false,
      hasNext: page === 1,
      hasPrev: page > 1,
      isLoading: false,
      error: null,
    }));
    const user = userEvent.setup();
    render(<WaitingForMyReview />);

    expect(
      screen.getByRole("link", { name: "Pricing FAQ" })
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(waiting).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 })
    );
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
