/**
 * The content status widget's marks are drawn in each status's own colour, as
 * every status on the dashboard is: Published in the success status's solid,
 * held to 3:1 on the page in each mode, and Draft in the muted ink. Never a
 * tinted shade, and never the brand colour as given.
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
  it("draws each segment and its dot in its status's own colour", () => {
    const { container } = render(<ContentStatusWidget />);

    // The ring's segments, in the order they are drawn: each is a round-capped
    // arc, and the separators under them are stroked in the card colour.
    const segments = [
      ...container.querySelectorAll('circle[stroke-linecap="round"]'),
    ]
      .map(circle => circle.getAttribute("stroke"))
      .filter(stroke => stroke !== "var(--nx-card)");
    expect(segments).toEqual([
      "var(--nx-success-solid)",
      "var(--nx-muted-foreground)",
    ]);

    // 🔴 Read from the style attribute as written, so the check does not
    // depend on how the DOM normalises a `var()` value.
    expect(dotFor("Published").getAttribute("style")).toContain(
      "var(--nx-success-solid)"
    );
    expect(dotFor("Draft").getAttribute("style")).toContain(
      "var(--nx-muted-foreground)"
    );
    // A plain dot: no tinted halo around it.
    expect(dotFor("Published").className).not.toMatch(/\bring-/);
  });
});
