/**
 * Where focus goes once Refresh is pressed (dashboard-experience R-23): the fresh answers take the
 * "Updated N min ago · Refresh" line off the page, the button with it, and focus lands on the
 * header's heading rather than falling to the page's body. A reader who moved on before the
 * answers came keeps where they went.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Freshness } from "./Freshness";

const now = new Date(2026, 9, 28, 12, 0, 0);
const STALE = now.getTime() - 10 * 60 * 1000;
const FRESH = now.getTime() - 30 * 1000;

/** The line in a header beside the page's heading, as the dashboard draws it. */
function Header({
  oldestAnswerAt,
  onRefresh,
}: {
  oldestAnswerAt: number;
  onRefresh: () => void;
}) {
  return (
    <header>
      <h1 tabIndex={-1}>Acme</h1>
      <Freshness
        oldestAnswerAt={oldestAnswerAt}
        now={now}
        onRefresh={onRefresh}
      />
      <button type="button">Customize</button>
    </header>
  );
}

describe("Refresh and focus", () => {
  it("lands on the heading once the fresh answers take the line away", () => {
    const onRefresh = vi.fn();
    const view = render(
      <Header oldestAnswerAt={STALE} onRefresh={onRefresh} />
    );
    const refresh = screen.getByRole("button", { name: "Refresh" });
    refresh.focus();
    fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledOnce();

    view.rerender(<Header oldestAnswerAt={FRESH} onRefresh={onRefresh} />);
    expect(screen.queryByTestId("dashboard-freshness")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });

  it("leaves focus where the reader moved it before the answers came", () => {
    const view = render(<Header oldestAnswerAt={STALE} onRefresh={vi.fn()} />);
    const refresh = screen.getByRole("button", { name: "Refresh" });
    refresh.focus();
    fireEvent.click(refresh);
    const customize = screen.getByRole("button", { name: "Customize" });
    customize.focus();

    view.rerender(<Header oldestAnswerAt={FRESH} onRefresh={vi.fn()} />);
    expect(customize).toHaveFocus();
  });
});
