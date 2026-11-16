// @vitest-environment jsdom
/**
 * The late-queue banner: drawn only while queued email is overdue, naming
 * how many, how late, and the jobs trigger to set up.
 *
 * @module components/features/email-hub/activity/__tests__/OverdueBanner.test
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { JOBS_TRIGGER_DOCS, OverdueBanner } from "../OverdueBanner";

describe("the late-queue banner", () => {
  it("draws nothing while no queued email is overdue", () => {
    const { container } = render(
      <OverdueBanner
        overdue={{ overdue: 0, capped: false, warningAfterMinutes: 15 }}
      />
    );
    expect(container.textContent).toBe("");
  });

  it("draws nothing before the answer arrives", () => {
    const { container } = render(<OverdueBanner overdue={undefined} />);
    expect(container.textContent).toBe("");
  });

  it("names how many are late, by how long, and the trigger to set up", () => {
    render(
      <OverdueBanner
        overdue={{ overdue: 3, capped: false, warningAfterMinutes: 15 }}
      />
    );
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain(
      "3 queued emails have waited more than 15 minutes"
    );
    expect(banner.textContent).toContain("POST /admin/api/jobs/run");
    expect(
      screen
        .getByRole("link", { name: "How to set it up" })
        .getAttribute("href")
    ).toBe(JOBS_TRIGGER_DOCS);
  });

  it("says one in the singular, and a capped count as a floor", () => {
    const { rerender } = render(
      <OverdueBanner
        overdue={{ overdue: 1, capped: false, warningAfterMinutes: 15 }}
      />
    );
    expect(screen.getByRole("status").textContent).toContain(
      "1 queued email has waited"
    );
    rerender(
      <OverdueBanner
        overdue={{ overdue: 100, capped: true, warningAfterMinutes: 15 }}
      />
    );
    expect(screen.getByRole("status").textContent).toContain(
      "100+ queued emails have waited"
    );
  });
});
