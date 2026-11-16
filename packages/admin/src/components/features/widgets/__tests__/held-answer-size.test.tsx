/**
 * A list card whose reader asked for more entries keeps its old answer on screen while the larger
 * one loads, and draws that answer by the "Number of entries" it was fetched with.
 *
 * A card's `load` reads one row more than the card draws, the sign that more exist. Drawn by the
 * card's new, larger number, that one more would read as one more row until the new answer
 * arrived; drawn by the number it was fetched with, it stays the sign it is.
 */
import { render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  AnswerSizeContext,
  CardTierContext,
  useRowsDrawn,
} from "../frame/tier";
import { Widget } from "../kit";

/** `useRowsDrawn(items)` in a card whose answer was fetched with `fetched`, if any. */
function drawnWith(items: unknown, fetched?: { items: unknown }) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    fetched === undefined ? (
      <>{children}</>
    ) : (
      <AnswerSizeContext.Provider value={fetched}>
        {children}
      </AnswerSizeContext.Provider>
    );
  return renderHook(() => useRowsDrawn(items), { wrapper }).result.current;
}

describe("useRowsDrawn", () => {
  it("draws the card's Number of entries where its answer's is not known", () => {
    expect(drawnWith(10)).toBe(10);
    expect(drawnWith(20)).toBe(20);
    expect(drawnWith(undefined)).toBe(5);
  });

  it("draws the fewer of the card's number and its answer's", () => {
    // 🔴 Drawn by the card's new ten, an answer fetched for five, and one more, draws its sixth
    // row as an entry.
    expect(drawnWith(10, { items: 5 })).toBe(5);
    // Asked for fewer than the answer holds: the card's own number, the answer's rows past it
    // left out.
    expect(drawnWith(5, { items: 10 })).toBe(5);
  });

  it("reads the answer's number by the rule the card's own is read by", () => {
    // A missing number was fetched as five, and one above twenty as twenty.
    expect(drawnWith(10, { items: undefined })).toBe(5);
    expect(drawnWith(20, { items: 25 })).toBe(20);
  });
});

describe("a list held from a smaller Number of entries", () => {
  it("draws the rows its answer was asked for, never its one row more", () => {
    // Fetched for five, and the one more that says more exist; the reader has since asked for ten.
    const rows = Array.from({ length: 6 }, (_, index) => ({
      title: `Entry ${index + 1}`,
    }));
    render(
      <CardTierContext.Provider value="medium">
        <AnswerSizeContext.Provider value={{ items: 5 }}>
          <Widget.List rows={rows} title={row => row.title} limit={10} />
        </AnswerSizeContext.Provider>
      </CardTierContext.Provider>
    );
    expect(screen.getAllByTestId("entity-row")).toHaveLength(5);
    expect(screen.queryByText("Entry 6")).toBeNull();
  });
});
