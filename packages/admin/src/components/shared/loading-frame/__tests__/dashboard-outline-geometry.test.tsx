/**
 * The dashboard's outline is drawn on the dashboard's own grid: the same grid
 * classes and, for each card, the same span classes the real cards take at its
 * width, so at every dashboard width the outline's cards stand where the real
 * ones land. Asserted on the classes, which ARE the geometry here: jsdom lays
 * nothing out, and the span classes are the one place a card's drawn width is
 * decided (`features/widgets/sizes`).
 *
 * The separating property is the span per card. An outline with breakpoints of
 * its own draws a default Count card (three columns) one to a row on a phone
 * where the real grid draws two, and that difference is a class.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  cardSpanClass,
  GRID_CLASS,
} from "@admin/components/features/widgets/sizes";

import { DashboardCardsOutline } from "../outlines";

/**
 * A default dashboard unlike core's own, in place of the one core publishes:
 * the outline drawn with no arrangement must follow whichever default core
 * declares, so a stand-in that differs from it shows whether it is read.
 */
const STAND_IN_DEFAULT = vi.hoisted(
  () =>
    [
      { widget: "core/count", w: 3 },
      { widget: "core/content-table", w: 8 },
      { widget: "core/note", w: 4 },
    ] as const
);
vi.mock("nextly/core-widget-data", () => ({
  CORE_DEFAULT_LAYOUT: STAND_IN_DEFAULT,
}));

const cards = () => screen.getAllByTestId("dashboard-card-outline");

describe("the dashboard's outline", () => {
  it("draws the cards it is given on the dashboard's grid, each at its real span", () => {
    render(<DashboardCardsOutline widths={[3, 3, 3, 3, 8, 4]} />);
    expect(screen.getByTestId("dashboard-cards-outline").className).toBe(
      GRID_CLASS
    );
    expect(cards().map(card => card.getAttribute("data-span"))).toEqual(
      [3, 3, 3, 3, 8, 4].map(w => cardSpanClass(w))
    );
    for (const card of cards()) {
      expect(card.className).toContain(card.getAttribute("data-span"));
    }
  });

  it("draws core's default dashboard when the arrangement is not known", () => {
    render(<DashboardCardsOutline />);
    expect(cards().map(card => card.getAttribute("data-span"))).toEqual(
      STAND_IN_DEFAULT.map(card => cardSpanClass(card.w))
    );
  });
});
