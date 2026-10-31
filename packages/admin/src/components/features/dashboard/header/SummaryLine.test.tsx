/**
 * The header's summary line as assistive technology hears it (dashboard-experience R-23): a
 * polite live region, read whole, so a count that changes under the reader is said as the new
 * line, without moving them.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DashboardSummary } from "@admin/types/dashboard/summary";

import { SummaryLine } from "./SummaryLine";

const now = new Date(2026, 9, 28, 12, 0, 0);
const needing = (count: number): DashboardSummary => ({
  parts: [{ kind: "attention", count }],
  failed: 0,
});

describe("the summary line's live region", () => {
  it("is polite and read whole, and holds the new line once the count changes", () => {
    const view = render(
      <SummaryLine summary={needing(2)} cards={{}} now={now} />
    );
    const line = screen.getByTestId("dashboard-summary");
    expect(line).toHaveAttribute("aria-live", "polite");
    expect(line).toHaveAttribute("aria-atomic", "true");
    expect(line).toHaveTextContent("2 things need you");

    view.rerender(<SummaryLine summary={needing(1)} cards={{}} now={now} />);
    // The same region, so the change is announced rather than a new region appearing silent.
    expect(screen.getByTestId("dashboard-summary")).toBe(line);
    expect(line).toHaveTextContent("1 thing needs you");

    view.rerender(
      <SummaryLine summary={{ parts: [], failed: 0 }} cards={{}} now={now} />
    );
    expect(screen.getByTestId("dashboard-summary")).toBe(line);
    expect(line).toHaveTextContent("You're all caught up");
  });
});
