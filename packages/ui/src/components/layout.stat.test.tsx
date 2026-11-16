// @vitest-environment jsdom
/**
 * `Stat`'s tone dot and its compact size, beside the default every existing
 * caller draws: a change that added the new options and altered the old look
 * would still be wrong.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Stat } from "./layout";

afterEach(cleanup);

describe("Stat", () => {
  it("draws its value large, with no dot, by default", () => {
    const { container } = render(<Stat label="Pages" value="12" />);
    expect(screen.getByText("12").className).toContain("text-2xl");
    expect(container.querySelector("[data-stat-tone]")).toBeNull();
  });

  it("draws a compact value at the size of a card's figure", () => {
    render(<Stat label="Pages" value="12 public pages" size="compact" />);
    const value = screen.getByText("12 public pages");
    expect(value.className).toContain("text-xl");
    expect(value.className).not.toContain("text-2xl");
  });

  it("marks the value with a dot in its tone's solid colour", () => {
    const { container, rerender } = render(
      <Stat label="Search health" value="Should improve" tone="warning" />
    );
    const dot = container.querySelector("[data-stat-tone]");
    expect(dot?.getAttribute("data-stat-tone")).toBe("warning");
    expect(dot?.className).toContain("bg-warning-solid");
    // A picture only: the value's own words carry the meaning.
    expect(dot?.getAttribute("aria-hidden")).toBe("true");

    rerender(<Stat label="Search health" value="Good" tone="success" />);
    expect(container.querySelector("[data-stat-tone]")?.className).toContain(
      "bg-success-solid"
    );

    rerender(<Stat label="Search health" value="Poor" tone="destructive" />);
    expect(container.querySelector("[data-stat-tone]")?.className).toContain(
      "bg-danger-solid"
    );
  });
});
