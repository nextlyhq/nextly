/**
 * The dashboard's crash screen keeps the page's one level-one heading.
 *
 * When anything inside the dashboard throws, the error boundary replaces the
 * whole page, welcome heading included, with its fallback. That fallback is
 * then the page, so it carries the main heading itself: a person jumping by
 * heading lands on what went wrong rather than on nothing.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@admin/components/features/dashboard/WelcomeHeader", () => ({
  WelcomeHeader: () => <h1>Welcome, Ada</h1>,
}));
vi.mock("@admin/components/features/widgets/WidgetGrid", () => ({
  WidgetGrid: () => {
    throw new Error("a widget crashed");
  },
}));

import DashboardPage from "./index";

describe("the dashboard's crash screen", () => {
  beforeEach(() => {
    // React and the boundary both report the thrown error; it is the point of
    // the test, not noise worth printing.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is the one level-one heading, naming what went wrong", () => {
    render(<DashboardPage />);

    // The fallback replaced the page: the welcome heading is gone with it.
    expect(
      screen.queryByRole("heading", { name: "Welcome, Ada" })
    ).not.toBeInTheDocument();

    const mains = screen.getAllByRole("heading", { level: 1 });
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAccessibleName("The dashboard couldn't load");
    // And it is the crash screen's own title, not a second heading beside it.
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });
});
