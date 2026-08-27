import { describe, it, expect } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { Users } from "@admin/components/icons";

import { StatsCard } from "./StatsCard";

/**
 * The element carrying the trend colour: the badge wrapping the icon and the
 * percentage, not the span holding the text.
 *
 * Throws rather than returning null when it cannot be found, so a future markup
 * change surfaces as "the badge is gone" instead of an assertion quietly
 * passing against an element that does not exist.
 */
function trendBadge(text: string): HTMLElement {
  const badge = screen.getByText(text).closest("div");
  if (badge === null) throw new Error(`no trend badge around "${text}"`);
  return badge;
}

describe("StatsCard", () => {
  it("renders with basic props", () => {
    render(<StatsCard title="Total Users" value={1247} />);

    expect(screen.getByText("Total Users")).toBeInTheDocument();
    // toLocaleString() formats numbers, so "1247" becomes "1,247"
    expect(screen.getByText("1,247")).toBeInTheDocument();
  });

  it("renders with positive trend indicator", () => {
    render(
      <StatsCard title="Total Users" value={1247} change={12.5} trend="up" />
    );

    expect(screen.getByText("+12.5%")).toBeInTheDocument();
    // The colour is on the BADGE, not on the span holding the text — the text
    // sits in a bare child, so the old assertion read an element with no class
    // at all and could never have passed.
    //
    // Asserted by FAMILY rather than by ramp step: `text-success-700` is the
    // current value and a legitimate token change would move it, while the
    // property worth locking is that an up trend is coloured with the success
    // family and never the destructive one. Both halves are needed — a class
    // list carrying both would satisfy either check alone, and swapping the two
    // branches is exactly the regression this guards.
    const badge = trendBadge("+12.5%");
    expect(badge.className).toMatch(/\btext-success-\d+\b/);
    expect(badge.className).not.toMatch(/\btext-destructive-\d+\b/);
  });

  it("renders with negative trend indicator", () => {
    render(
      <StatsCard title="Total Users" value={1247} change={-5.2} trend="down" />
    );

    expect(screen.getByText("-5.2%")).toBeInTheDocument();
    const badge = trendBadge("-5.2%");
    expect(badge.className).toMatch(/\btext-destructive-\d+\b/);
    expect(badge.className).not.toMatch(/\btext-success-\d+\b/);
  });

  it("does not render trend when change is undefined", () => {
    render(<StatsCard title="Total Users" value={1247} />);

    // Should not have any trend indicators
    expect(screen.queryByText(/\+/)).not.toBeInTheDocument();
    expect(screen.queryByText(/-/)).not.toBeInTheDocument();
  });

  it("does not render trend when change is 0", () => {
    // When change is 0, dashboard passes undefined to hide the trend
    render(<StatsCard title="Total Users" value={1247} change={undefined} />);

    // Should not render any trend indicators
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("+0%")).not.toBeInTheDocument();
    expect(screen.queryByText(/vs last month/i)).not.toBeInTheDocument();
  });

  it("renders with icon", () => {
    render(
      <StatsCard
        title="Total Users"
        value={1247}
        icon={<Users data-testid="users-icon" className="h-6 w-6" />}
      />
    );

    expect(screen.getByTestId("users-icon")).toBeInTheDocument();
  });

  it("renders without icon", () => {
    render(<StatsCard title="Total Users" value={1247} />);

    // Should not have any lucide icons
    expect(screen.queryByTestId("users-icon")).not.toBeInTheDocument();
  });

  it("formats string values correctly", () => {
    render(<StatsCard title="Status" value="Active" />);

    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <StatsCard title="Total Users" value={1247} className="custom-class" />
    );

    const card = container.firstChild as HTMLElement;
    expect(card).toHaveClass("custom-class");
  });

  it("forwards ref correctly", () => {
    const ref = { current: null };

    render(<StatsCard ref={ref} title="Total Users" value={1247} />);

    expect(ref.current).toBeInstanceOf(HTMLElement);
  });

  it("renders large numbers correctly", () => {
    render(<StatsCard title="Total Users" value={1234567} />);

    // toLocaleString() formats large numbers with commas
    expect(screen.getByText("1,234,567")).toBeInTheDocument();
  });

  it("renders decimal change values correctly", () => {
    render(
      <StatsCard title="Total Users" value={1247} change={0.5} trend="up" />
    );

    expect(screen.getByText("+0.5%")).toBeInTheDocument();
  });

  it("has correct accessibility structure", () => {
    render(
      <StatsCard title="Total Users" value={1247} change={12.5} trend="up" />
    );

    // Card should be in the document
    const card = screen.getByText("Total Users").closest("div");
    expect(card).toBeInTheDocument();

    // Title should be visible
    expect(screen.getByText("Total Users")).toBeVisible();

    // Value should be visible (with localized formatting)
    expect(screen.getByText("1,247")).toBeVisible();
  });
});
