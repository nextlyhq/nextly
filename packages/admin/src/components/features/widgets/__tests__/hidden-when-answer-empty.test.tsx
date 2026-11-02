/**
 * A card that hides while empty leaves the dashboard by one of two rules, and the dashboard
 * holds each card to its own: a widget the layout read answers ahead keeps the verdict that read
 * gave, held for the visit; a widget it cannot answer (one whose data a query asks rather than a
 * `load`), named in the layout's `hiddenWhenAnswerEmpty`, leaves while its own answer is empty, as
 * drawn.
 * The grid takes a card out by the mark checked here (`data-hidden-empty`, `ArrangedCell`).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { HiddenWhileEmptyContext } from "../hidden-while-empty";
import { WidgetRenderer } from "../WidgetRenderer";

import { gridBounds } from "./grid-bounds";

/** A list widget that hides while empty, of the id `id`. */
const quietList = (id: string): DashboardWidget => ({
  id,
  title: "Quiet list",
  archetype: "list",
  size: gridBounds(4),
  hidesWhenEmpty: true,
});

const EMPTY: WidgetSlot = { ok: true, result: { op: "list", items: [] } };
const ONE_ROW: WidgetSlot = {
  ok: true,
  result: { op: "list", items: [{ id: "p1", title: "First post" }] },
};

/**
 * The card of `definition` answered `slot`, on a dashboard holding `held`: the cards the layout
 * read found empty, and the widgets that leave by their own answer.
 */
function cardOf(
  definition: DashboardWidget,
  slot: WidgetSlot,
  held: { hidden?: string[]; ownAnswer?: string[] }
): HTMLElement {
  render(
    <HiddenWhileEmptyContext.Provider
      value={{
        hidden: new Set(held.hidden ?? []),
        revealed: new Set(),
        hiddenWhenAnswerEmpty: new Set(held.ownAnswer ?? []),
      }}
    >
      <WidgetRenderer
        definition={definition}
        slot={slot}
        placement={{ id: "card-1", settings: {} }}
      />
    </HiddenWhileEmptyContext.Provider>
  );
  return screen.getByRole("region", { name: "Quiet list" });
}

describe("a card that hides while empty", () => {
  it("of a widget the layout read cannot answer, leaves the dashboard while its own answer is empty", () => {
    const legacy = quietList("acme/legacy-quiet");
    expect(
      cardOf(legacy, EMPTY, { ownAnswer: ["acme/legacy-quiet"] })
    ).toHaveAttribute("data-hidden-empty");
  });

  it("of a widget the layout read cannot answer, stays while its own answer has rows", () => {
    const legacy = quietList("acme/legacy-quiet");
    expect(
      cardOf(legacy, ONE_ROW, { ownAnswer: ["acme/legacy-quiet"] })
    ).not.toHaveAttribute("data-hidden-empty");
  });

  it("of a widget the layout read answers, keeps that read's verdict whatever its own answer says", () => {
    const declared = quietList("acme/declared-quiet");
    // Found with something waiting when the layout was read: its answer emptying since never
    // takes it off the page under the reader.
    expect(cardOf(declared, EMPTY, {})).not.toHaveAttribute(
      "data-hidden-empty"
    );
  });

  it("of a widget the layout read answers, stays off the dashboard when that read found it empty", () => {
    const declared = quietList("acme/declared-quiet");
    expect(cardOf(declared, ONE_ROW, { hidden: ["card-1"] })).toHaveAttribute(
      "data-hidden-empty"
    );
  });
});
