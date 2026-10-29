/**
 * The content status widget's Published marks are drawn in the brand's chart
 * slot, which the admin holds to 3:1 on the card, and not in `--nx-primary`,
 * which is the brand colour as given and may be too pale or too dark to see on
 * the card in one of the modes.
 *
 * @module components/features/dashboard/ContentStatusWidget.test
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { useDashboardStats } from "@admin/hooks/queries/useDashboardStats";

vi.mock("@admin/hooks/queries/useDashboardStats", () => ({
  useDashboardStats: () =>
    ({
      data: { status: { published: 3, draft: 1 } },
      isLoading: false,
      error: null,
    }) as unknown as ReturnType<typeof useDashboardStats>,
}));

const { ContentStatusWidget } = await import("./ContentStatusWidget");

/** The legend's dot beside a status label: the element before the label. */
function dotFor(label: string): Element {
  const dot = screen.getByText(label).previousElementSibling;
  if (dot === null) throw new Error(`no dot beside "${label}"`);
  return dot;
}

describe("the content status widget", () => {
  it("draws the Published segment and its dot in the brand's chart slot", () => {
    const { container } = render(<ContentStatusWidget />);

    // The ring's segments, in the order they are drawn: each is a round-capped
    // arc, and the separators under them are stroked in the card colour.
    const segments = [
      ...container.querySelectorAll('circle[stroke-linecap="round"]'),
    ]
      .map(circle => circle.getAttribute("stroke"))
      .filter(stroke => stroke !== "var(--nx-card)");
    expect(segments).toEqual(["var(--nx-chart-1)", "var(--nx-chart-4)"]);

    // 🔴 Read from the style attribute as written, so the check does not
    // depend on how the DOM normalises a `var()` value.
    expect(dotFor("Published").getAttribute("style")).toContain(
      "var(--nx-chart-1)"
    );
    expect(dotFor("Draft").getAttribute("style")).toContain(
      "var(--nx-chart-4)"
    );
  });
});
