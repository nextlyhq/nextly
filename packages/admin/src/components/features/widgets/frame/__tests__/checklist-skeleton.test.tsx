/**
 * The setup card loading as the checklist it is: the checklist's own bar and
 * step lines, four unless told otherwise, rather than a list's rows, which
 * are taller than four steps and shrank the card when its steps arrived.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CardSkeleton } from "../states";

describe("a checklist card's loading state", () => {
  it("draws the checklist's own step lines, four by default", () => {
    const { container } = render(<CardSkeleton shape="checklist" />);
    const steps = container.querySelectorAll("ol > li");
    expect(steps).toHaveLength(4);
    // Each a checklist step, drawn by the checklist's own line.
    for (const step of steps) {
      expect(step.getAttribute("data-status")).toBe("open");
    }
    // No list rows stand in for the steps.
    expect(container.querySelector('[data-shape="checklist"]')).not.toBeNull();
  });

  it("draws as many steps as it is told", () => {
    const { container } = render(<CardSkeleton shape="checklist" rows={5} />);
    expect(container.querySelectorAll("ol > li")).toHaveLength(5);
  });

  it("is hidden from assistive technology but says it is loading", () => {
    const { getByText, container } = render(<CardSkeleton shape="checklist" />);
    expect(getByText("Loading")).toBeTruthy();
    expect(
      container.querySelector("ol")?.closest('[aria-hidden="true"]')
    ).not.toBeNull();
  });
});
