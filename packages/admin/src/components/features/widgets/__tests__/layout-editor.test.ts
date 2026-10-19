/**
 * The arrangement rules, at the edges a rendered grid makes hard to reach.
 *
 * The dashboard is one ordered list, and every rule here addresses a card by
 * its placement ID. The list a reader edits holds more than they can see --
 * removed cards, and cards whose widget this admin cannot draw -- so a rule
 * written against a position in what is DRAWN would act on the wrong card.
 */
import { describe, expect, it } from "vitest";

import type { WidgetPlacement } from "@admin/types/dashboard/widgets";

import {
  withinSubmissionLimit,
  addPlacement,
  drawnPosition,
  hasChanges,
  moveAvailability,
  moveEarlier,
  moveLater,
  movePlacementTo,
  moveToEnd,
  moveToStart,
  newPlacementId,
  removePlacement,
  restorePlacement,
  setPlacementConfig,
  setPlacementWidth,
} from "../layout-editor";

import { MAX_PLACEMENTS, layoutSizeProblem } from "nextly/config";

function placements(...ids: string[]): WidgetPlacement[] {
  return ids.map(id => ({
    id,
    widgetId: `core/${id}`,
    width: "full",
    removed: false,
  }));
}

const ids = (list: readonly WidgetPlacement[]) => list.map(p => p.id);

/** `a b c d`, with `x` removed between b and c: drawn as a, b, c, d. */
function withRemoved(): WidgetPlacement[] {
  const list = placements("a", "b", "x", "c", "d");
  return list.map(p => (p.id === "x" ? { ...p, removed: true } : p));
}

describe("moving a card one step", () => {
  it("moves it earlier past the card drawn before it", () => {
    expect(ids(moveEarlier(placements("a", "b", "c"), "c"))).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("moves it later past the card drawn after it", () => {
    expect(ids(moveLater(placements("a", "b", "c"), "a"))).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("steps over a removed card rather than swapping with it", () => {
    // 🔴 The separating case. A step by array index swaps `c` with the removed
    // `x`, which nobody can see: the reader pressed Move earlier and the
    // dashboard did not change.
    expect(ids(moveEarlier(withRemoved(), "c"))).toEqual([
      "a",
      "c",
      "b",
      "x",
      "d",
    ]);
    expect(ids(moveLater(withRemoved(), "b"))).toEqual([
      "a",
      "x",
      "c",
      "b",
      "d",
    ]);
  });

  it("steps over a card this admin cannot draw, given what is drawn", () => {
    const list = placements("a", "u", "b");
    const drawn = (p: WidgetPlacement) => p.id !== "u";
    expect(ids(moveEarlier(list, "b", drawn))).toEqual(["b", "a", "u"]);
  });

  it("returns a new array rather than mutating", () => {
    const original = placements("a", "b");
    const moved = moveLater(original, "a");
    expect(ids(original)).toEqual(["a", "b"]);
    expect(moved).not.toBe(original);
  });
});

describe("moving a card to an end", () => {
  it("moves it to the start", () => {
    expect(ids(moveToStart(placements("a", "b", "c"), "c"))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("moves it to the end", () => {
    expect(ids(moveToEnd(placements("a", "b", "c"), "a"))).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("lands before the first DRAWN card and after the last", () => {
    const list = placements("x", "a", "b", "y");
    const removed = list.map(p =>
      p.id === "x" || p.id === "y" ? { ...p, removed: true } : p
    );
    // The removed cards keep their places at the edges; what moves is the
    // order of what is drawn.
    expect(ids(moveToStart(removed, "b"))).toEqual(["x", "b", "a", "y"]);
    expect(ids(moveToEnd(removed, "a"))).toEqual(["x", "b", "a", "y"]);
  });
});

describe("a move that cannot happen", () => {
  it("is unavailable at the ends", () => {
    const list = placements("a", "b", "c");
    expect(moveAvailability(list, "a")).toEqual({
      start: false,
      earlier: false,
      later: true,
      end: true,
    });
    expect(moveAvailability(list, "b")).toEqual({
      start: true,
      earlier: true,
      later: true,
      end: true,
    });
    expect(moveAvailability(list, "c")).toEqual({
      start: true,
      earlier: true,
      later: false,
      end: false,
    });
  });

  it("counts the ends among the DRAWN cards", () => {
    // `b` is the last card drawn; the removed card after it is not a place
    // the reader can move it past.
    const list = placements("a", "b", "x").map(p =>
      p.id === "x" ? { ...p, removed: true } : p
    );
    expect(moveAvailability(list, "b").later).toBe(false);
    expect(moveAvailability(list, "b").end).toBe(false);
  });

  it("offers nothing for a lone card, or one that is not drawn", () => {
    const none = { start: false, earlier: false, later: false, end: false };
    expect(moveAvailability(placements("a"), "a")).toEqual(none);
    expect(moveAvailability(withRemoved(), "x")).toEqual(none);
    expect(moveAvailability(placements("a", "b"), "nope")).toEqual(none);
  });

  it("leaves the list alone when asked anyway", () => {
    const list = placements("a", "b", "c");
    expect(ids(moveEarlier(list, "a"))).toEqual(["a", "b", "c"]);
    expect(ids(moveToStart(list, "a"))).toEqual(["a", "b", "c"]);
    expect(ids(moveLater(list, "c"))).toEqual(["a", "b", "c"]);
    expect(ids(moveToEnd(list, "c"))).toEqual(["a", "b", "c"]);
    expect(ids(moveLater(list, "nope"))).toEqual(["a", "b", "c"]);
  });
});

describe("where a card is drawn", () => {
  it("counts only the drawn cards, one-based", () => {
    expect(drawnPosition(withRemoved(), "c")).toEqual({
      position: 3,
      count: 4,
    });
    expect(drawnPosition(withRemoved(), "x")).toBeUndefined();
  });
});

describe("a drag", () => {
  it("puts the dragged card where the target was", () => {
    expect(ids(movePlacementTo(placements("a", "b", "c"), "a", "c"))).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(ids(movePlacementTo(placements("a", "b", "c"), "c", "a"))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("leaves the order alone for a drop on nothing or on itself", () => {
    const list = placements("a", "b");
    expect(ids(movePlacementTo(list, "a", "nope"))).toEqual(["a", "b"]);
    expect(ids(movePlacementTo(list, "nope", "a"))).toEqual(["a", "b"]);
    expect(ids(movePlacementTo(list, "a", "a"))).toEqual(["a", "b"]);
  });
});

describe("choosing a width", () => {
  it("sets an allowed width on that card only", () => {
    const next = setPlacementWidth(placements("a", "b"), "a", "half", [
      "half",
      "full",
    ]);
    expect(next.map(p => p.width)).toEqual(["half", "full"]);
  });

  it("refuses a width the widget does not allow", () => {
    // The server refuses a CHANGED width outside the widget's list, so a draft
    // holding one could never be saved.
    const list = placements("a");
    expect(setPlacementWidth(list, "a", "quarter", ["half", "full"])).toEqual(
      list
    );
    expect(setPlacementWidth(list, "a", "quarter", undefined)).toEqual(list);
  });
});

describe("removing and restoring", () => {
  it("removing KEEPS the card, its place, its width and its settings", () => {
    const list = placements("a", "b", "c").map(p =>
      p.id === "b" ? { ...p, width: "third", config: { limit: 5 } } : p
    );
    const removed = removePlacement(list, "b");
    expect(ids(removed)).toEqual(["a", "b", "c"]);
    expect(removed[1]).toEqual({
      id: "b",
      widgetId: "core/b",
      width: "third",
      removed: true,
      config: { limit: 5 },
    });
  });

  it("restoring puts it back exactly where it was", () => {
    const list = placements("a", "b", "c");
    expect(restorePlacement(removePlacement(list, "b"), "b")).toEqual(list);
  });
});

describe("adding a widget", () => {
  it("appends it at the widget's default width", () => {
    const added = addPlacement(placements("a"), "core/z", "third");
    expect(ids(added).slice(0, 1)).toEqual(["a"]);
    expect(added[1]).toMatchObject({
      widgetId: "core/z",
      width: "third",
      removed: false,
    });
  });

  it("names the first card of a widget after the widget", () => {
    // The id the default dashboard gives that card, so a card added back is
    // the same card the default would have drawn.
    expect(addPlacement(placements("a"), "core/z", "full")[1].id).toBe(
      "core/z"
    );
  });

  it("mints a fresh id for a second card of the same widget", () => {
    const once = addPlacement([], "core/z", "full");
    const twice = addPlacement(once, "core/z", "full");
    expect(twice[1].id).not.toBe("core/z");
    expect(new Set(ids(twice)).size).toBe(2);
  });

  it("mints a fresh id when another card already holds the widget's id", () => {
    const holder: WidgetPlacement[] = [
      { id: "core/z", widgetId: "core/other", width: "full", removed: false },
    ];
    const added = addPlacement(holder, "core/z", "full");
    expect(added[1].id).not.toBe("core/z");
  });

  it("mints distinct ids", () => {
    expect(newPlacementId()).not.toBe(newPlacementId());
  });
});

describe("adding at the write contract's ceiling", () => {
  function full(): WidgetPlacement[] {
    return Array.from({ length: MAX_PLACEMENTS }, (_, i) => ({
      id: `p${i}`,
      widgetId: `core/w${i}`,
      width: "full",
      removed: false,
    }));
  }

  it("refuses rather than building an arrangement no write can carry", () => {
    expect(addPlacement(full(), "core/extra", "full")).toHaveLength(
      MAX_PLACEMENTS
    );
  });

  it("returns a NEW array even when it refuses", () => {
    const list = full();
    expect(addPlacement(list, "core/extra", "full")).not.toBe(list);
  });

  it("still adds one below the ceiling", () => {
    expect(addPlacement(full().slice(1), "core/extra", "full")).toHaveLength(
      MAX_PLACEMENTS
    );
  });
});

describe("whether anything changed", () => {
  it("says no for an untouched arrangement", () => {
    const list = placements("a", "b");
    expect(hasChanges(list, [...list])).toBe(false);
  });

  it("says no for a move that put the card back", () => {
    const list = placements("a", "b", "c");
    expect(hasChanges(list, moveEarlier(moveLater(list, "a"), "a"))).toBe(
      false
    );
  });

  it("notices a move", () => {
    const list = placements("a", "b");
    expect(hasChanges(list, moveLater(list, "a"))).toBe(true);
  });

  it("notices a width change alone", () => {
    const list = placements("a");
    expect(
      hasChanges(list, setPlacementWidth(list, "a", "half", ["half"]))
    ).toBe(true);
  });

  it("notices a removal alone", () => {
    const list = placements("a");
    expect(hasChanges(list, removePlacement(list, "a"))).toBe(true);
  });

  it("notices a settings change alone", () => {
    const list = placements("a");
    expect(hasChanges(list, setPlacementConfig(list, "a", { limit: 3 }))).toBe(
      true
    );
  });

  it("says no when a config holds the same values in another order", () => {
    const before = placements("a").map(p => ({
      ...p,
      config: { a: 1, b: [1, { c: 2 }] },
    }));
    const after = placements("a").map(p => ({
      ...p,
      config: { b: [1, { c: 2 }], a: 1 },
    }));
    expect(hasChanges(before, after)).toBe(false);
  });

  it("treats an absent config and an emptied one as the same state", () => {
    const list = placements("a");
    expect(hasChanges(list, setPlacementConfig(list, "a", {}))).toBe(false);
  });
});

describe("recording what a reader chose for one card", () => {
  it("stores the answer against its own placement", () => {
    const next = setPlacementConfig(placements("a", "b"), "b", { limit: 3 });
    expect(next[0].config).toBeUndefined();
    expect(next[1].config).toEqual({ limit: 3 });
  });

  it("replaces the stored answer rather than merging into it", () => {
    const list = setPlacementConfig(placements("a"), "a", { x: 1, y: 2 });
    expect(setPlacementConfig(list, "a", { x: 5 })[0].config).toEqual({ x: 5 });
  });

  it("drops the key entirely when nothing is left", () => {
    const list = setPlacementConfig(placements("a"), "a", { x: 1 });
    expect("config" in setPlacementConfig(list, "a", {})[0]).toBe(false);
  });

  it("does not mutate the placements it was given", () => {
    const list = placements("a");
    setPlacementConfig(list, "a", { x: 1 });
    expect(list[0].config).toBeUndefined();
  });
});

describe("a save over the submission limit", () => {
  const at = (i: number, removed = false): WidgetPlacement => ({
    id: `p${i}`,
    widgetId: `w/${i}`,
    width: "full",
    removed,
  });

  it("is left alone while it fits", () => {
    const placements = [at(0), at(1, true)];
    expect(withinSubmissionLimit(placements)).toBe(placements);
  });

  it("sheds removed cards, latest first, until it fits", () => {
    // A row can hold more than one save may carry, when a reader regains
    // access to cards that accumulated while they could not see them. The
    // only cards that can go are ones the reader has removed.
    const placements = Array.from({ length: MAX_PLACEMENTS + 3 }, (_, i) =>
      at(i, i % 2 === 0)
    );
    const kept = withinSubmissionLimit(placements);
    expect(kept).toHaveLength(MAX_PLACEMENTS);
    // Every card still on the dashboard is kept, in order.
    expect(kept.filter(p => !p.removed)).toEqual(
      placements.filter(p => !p.removed)
    );
    // The removed cards that went are the last three of them.
    const dropped = placements.filter(p => !kept.includes(p)).map(p => p.id);
    expect(dropped).toEqual([
      `p${MAX_PLACEMENTS - 2}`,
      `p${MAX_PLACEMENTS}`,
      `p${MAX_PLACEMENTS + 2}`,
    ]);
  });

  it("sheds removed cards when the payload, not the count, is too large", () => {
    // 🔴 The separating case for a count-only limit: well under
    // `MAX_PLACEMENTS` cards, but removed cards keep their settings, and
    // the removed ones here are large enough that the save is over the
    // server's byte limit. The cards on the dashboard fit on their own.
    const big = { note: "x".repeat(2_000) };
    const placements = Array.from({ length: 40 }, (_, i) =>
      i % 2 === 0 ? { ...at(i, true), config: big } : at(i)
    );
    expect(layoutSizeProblem(placements)).toBeDefined();
    const kept = withinSubmissionLimit(placements);
    // It fits by the server's own measure, not a copy of it.
    expect(layoutSizeProblem(kept)).toBeUndefined();
    expect(kept.filter(p => !p.removed)).toEqual(
      placements.filter(p => !p.removed)
    );
    // Only as many as it took, and the latest removed ones first: shedding
    // one fewer would still be too large.
    const dropped = placements.filter(p => !kept.includes(p));
    expect(dropped.every(p => p.removed)).toBe(true);
    const shedOneFewer = placements.filter(p => !dropped.slice(1).includes(p));
    expect(layoutSizeProblem(shedOneFewer)).toBeDefined();
    const removedIds = placements.filter(p => p.removed).map(p => p.id);
    expect(dropped.map(p => p.id)).toEqual(removedIds.slice(-dropped.length));
  });

  it("keeps every card on the dashboard even when that is still too many", () => {
    // Nothing removed to shed: the server says why, rather than this
    // dropping a card the reader can see.
    const placements = Array.from({ length: MAX_PLACEMENTS + 1 }, (_, i) =>
      at(i)
    );
    expect(withinSubmissionLimit(placements)).toEqual(placements);
  });
});
