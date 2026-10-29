/**
 * A card's body height from its `h`: what the frame leaves of the card's rows for the body, the
 * height a list's rows that fit are counted against (foundations R-9).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WidgetCard } from "../../WidgetCard";
import {
  cardBodyHeightPx,
  FRAME_BODY_GAP,
  FRAME_FOOTER_GAP,
  FRAME_HEADER,
  FRAME_PADDING,
} from "../measures";

describe("cardBodyHeightPx", () => {
  it("is the card's rows less the frame around the body, at every h a card may take", () => {
    // Rows of 72 px with 16 px between them, less a 1 px border and 16 px of padding top and
    // bottom, the 40 px header, the 12 px gap under it and the footer's 12 px gap and 16 px line:
    // 114 px of frame. Written out rather than recomputed, so a change to any measure shows here.
    expect(
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(h => [h, cardBodyHeightPx(h)])
    ).toEqual([
      [2, 46],
      [3, 134],
      [4, 222],
      [5, 310],
      [6, 398],
      [7, 486],
      [8, 574],
      [9, 662],
      [10, 750],
      [11, 838],
      [12, 926],
    ]);
  });

  it("grows by one row's height and one gap for each row the card is taller", () => {
    // The gap down the grid is 16 px at every width; only the gap across widens from 1,280 px.
    // So the body height has no width to depend on, and follows `h` alone.
    for (let h = 2; h < 12; h++) {
      expect(cardBodyHeightPx(h + 1) - cardBodyHeightPx(h)).toBe(88);
    }
  });
});

describe("the frame's measures", () => {
  it("are the classes the frame draws with", () => {
    // The must-differ half of the body height: the numbers above are only true while the frame
    // draws these classes. Each is read off the drawn card, not off the constants.
    render(
      <WidgetCard
        title="Published posts"
        link={{ label: "View all", href: "/admin/collections/posts" }}
      >
        <p>body</p>
      </WidgetCard>
    );
    const card = screen.getByRole("region", { name: "Published posts" });
    expect(card).toHaveClass(FRAME_PADDING.className);
    expect(card.firstElementChild).toHaveClass(FRAME_HEADER.className);
    expect(screen.getByTestId("widget-card-body")).toHaveClass(
      FRAME_BODY_GAP.className
    );
    expect(screen.getByTestId("widget-card-footer")).toHaveClass(
      FRAME_FOOTER_GAP.className
    );
  });
});
