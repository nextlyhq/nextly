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
import { describe, expect, it } from "vitest";

import {
  cardSpanClass,
  GRID_CLASS,
} from "@admin/components/features/widgets/sizes";

// Core's own default dashboard, read where core keeps it, so the outline's
// default cannot drift from it unnoticed.
import { CORE_DEFAULT_LAYOUT } from "../../../../../../nextly/src/domains/widgets/core-widgets/ids";
import { DashboardCardsOutline } from "../outlines";

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
      CORE_DEFAULT_LAYOUT.map(card => cardSpanClass(card.w ?? 6))
    );
  });
});
