/**
 * The header's summary line as assistive technology hears it (dashboard-experience R-23): a
 * polite live region, read whole, so a count that changes under the reader is said as the new
 * line, without moving them; and what the line ends with ("Resume setup") outside that region,
 * so its own status is never nested in it.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DashboardSummary } from "@admin/types/dashboard/summary";

import { ResumeSetupLink } from "./ResumeSetupLink";
import { SummaryLine } from "./SummaryLine";

const now = new Date(2026, 9, 28, 12, 0, 0);
const needing = (count: number): DashboardSummary => ({
  parts: [{ kind: "attention", count }],
  failed: 0,
});

describe("the summary line's live region", () => {
  // Exact text after each change, so a line that kept the last one's words beside the new ones fails.
  it("is polite and read whole, and holds the new line once the count changes", () => {
    const view = render(
      <SummaryLine summary={needing(2)} cards={{}} now={now} />
    );
    const line = screen.getByTestId("dashboard-summary-said");
    expect(line).toHaveAttribute("aria-live", "polite");
    expect(line).toHaveAttribute("aria-atomic", "true");
    expect(line.textContent).toBe("2 things need you");

    view.rerender(<SummaryLine summary={needing(1)} cards={{}} now={now} />);
    // The same region, so the change is announced rather than a new region appearing silent.
    expect(screen.getByTestId("dashboard-summary-said")).toBe(line);
    expect(line.textContent).toBe("1 thing needs you");

    view.rerender(
      <SummaryLine summary={{ parts: [], failed: 0 }} cards={{}} now={now} />
    );
    expect(screen.getByTestId("dashboard-summary-said")).toBe(line);
    expect(line.textContent).toBe("You're all caught up");
  });
});

describe("Resume setup at the line's end", () => {
  it("says its failure from a status of its own, outside the summary's live region", () => {
    render(
      <SummaryLine
        summary={needing(2)}
        cards={{}}
        now={now}
        trailing={
          <ResumeSetupLink
            resume={{
              resumable: true,
              resume: () => undefined,
              isResuming: false,
              failed: true,
            }}
          />
        }
      />
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("could not resume, try again");
    // No live region around it: nested in the summary's atomic one, the failure would be read out
    // with every part of the line, or not at all, as the screen reader resolves the two.
    expect(
      status.parentElement?.closest(
        "[aria-live], [role='status'], [role='log'], [role='alert']"
      )
    ).toBeNull();
    // The summary's own words stay a polite region read whole, and the control stays on the line.
    const said = screen.getByTestId("dashboard-summary-said");
    expect(said).toHaveAttribute("aria-live", "polite");
    expect(said.textContent).toBe("2 things need you");
    expect(screen.getByTestId("dashboard-summary")).toContainElement(
      screen.getByRole("button", { name: "Resume setup" })
    );
  });
});
