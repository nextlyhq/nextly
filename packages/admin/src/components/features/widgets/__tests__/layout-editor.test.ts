/**
 * The arrangement rules, at the edges a rendered grid makes hard to reach.
 */
import { describe, expect, it } from "vitest";

import type { WidgetPlacement } from "@admin/types/dashboard/widgets";

import {
  addPlacement,
  columnAffordance,
  columnDropId,
  resolveDrop,
  moveToColumn,
  placementsByColumn,
  hasChanges,
  moveAffordance,
  movePlacement,
  newPlacementId,
  removePlacement,
  renumber,
  togglePlacementHidden,
} from "../layout-editor";

import { MAX_PLACEMENTS } from "nextly/config";

function placements(...ids: string[]): WidgetPlacement[] {
  return ids.map((id, index) => ({
    id,
    widgetId: `core/${id}`,
    order: index * 10,
    hidden: false,
  }));
}

describe("moving a card", () => {
  it("moves it and shifts the rest", () => {
    const moved = movePlacement(placements("a", "b", "c"), 0, 2);
    expect(moved.map(p => p.id)).toEqual(["b", "c", "a"]);
  });

  it("returns a new array rather than mutating", () => {
    const original = placements("a", "b");
    const moved = movePlacement(original, 0, 1);
    expect(original.map(p => p.id)).toEqual(["a", "b"]);
    expect(moved).not.toBe(original);
  });

  it.each([
    ["a drag that ended nowhere", 0, -1],
    ["a move past the end", 0, 9],
    ["a move from nowhere", 9, 0],
    ["a move onto itself", 1, 1],
  ])("leaves the order alone for %s", (_label, from, to) => {
    // Each of these is an ordinary gesture — a drag released outside the list,
    // a keyboard move at the last position — rather than an error. Throwing
    // here would take the whole grid down over one of them.
    const before = placements("a", "b", "c");
    expect(movePlacement(before, from, to).map(p => p.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("what a card can do", () => {
  it.each([
    [0, 3, false, true],
    [1, 3, true, true],
    [2, 3, true, false],
    [0, 1, false, false],
  ])(
    "index %i of %i: up=%s down=%s",
    (index, count, canMoveUp, canMoveDown) => {
      expect(moveAffordance(index, count)).toEqual({ canMoveUp, canMoveDown });
    }
  );

  it("offers nothing in an empty arrangement", () => {
    expect(moveAffordance(0, 0)).toEqual({
      canMoveUp: false,
      canMoveDown: false,
    });
  });
});

describe("hiding and removing", () => {
  it("hiding KEEPS the placement, so bringing it back restores its position", () => {
    // The difference between hide and remove. A hidden card holds its slot and
    // its config; a removed one is gone, and re-adding it appends to the end.
    const hidden = togglePlacementHidden(placements("a", "b", "c"), "b");
    expect(hidden.map(p => p.id)).toEqual(["a", "b", "c"]);
    expect(hidden[1].hidden).toBe(true);
    expect(togglePlacementHidden(hidden, "b")[1].hidden).toBe(false);
  });

  it("removing drops it", () => {
    expect(removePlacement(placements("a", "b"), "a").map(p => p.id)).toEqual([
      "b",
    ]);
  });

  it("leaves a config intact while hidden", () => {
    const withConfig: WidgetPlacement[] = [
      {
        id: "a",
        widgetId: "core/a",
        order: 0,
        hidden: false,
        config: { n: 1 },
      },
    ];
    expect(togglePlacementHidden(withConfig, "a")[0].config).toEqual({ n: 1 });
  });
});

describe("adding a widget", () => {
  it("appends it, where the reader who just chose it will look", () => {
    const added = addPlacement(placements("a", "b"), "core/new");
    expect(added.map(p => p.widgetId)).toEqual([
      "core/a",
      "core/b",
      "core/new",
    ]);
  });

  it("takes the geometry its author declared", () => {
    const [added] = addPlacement([], "core/new", {
      size: "md",
      height: "tall",
    });
    expect(added).toMatchObject({ size: "md", height: "tall" });
  });

  it("omits geometry the widget did not declare", () => {
    const [added] = addPlacement([], "core/new", { size: "md" });
    expect(added).not.toHaveProperty("height");
  });

  it("gives it an id that is not the widget id", () => {
    // A placement id is opaque and independent, which is what lets the same
    // widget appear twice with different config.
    const [added] = addPlacement([], "core/new");
    expect(added.id).not.toBe("core/new");
    expect(added.id.length).toBeGreaterThan(8);
  });

  it("mints distinct ids", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newPlacementId()));
    expect(ids.size).toBe(200);
  });
});

describe("renumbering on the way out", () => {
  it("renumbers from the array order, not from what a card carried in", () => {
    // 🔴 The editor reorders an ARRAY, so a moved card still carries the
    // `order` it had before. Sent as-is, the server sorts by a number that no
    // longer matches what the reader sees, and their arrangement comes back
    // rearranged.
    const moved = movePlacement(placements("a", "b", "c"), 2, 0);
    expect(moved.map(p => p.order)).toEqual([20, 0, 10]);
    expect(renumber(moved).map(p => p.order)).toEqual([0, 10, 20]);
    expect(renumber(moved).map(p => p.id)).toEqual(["c", "a", "b"]);
  });

  it("leaves gaps, so a later insertion renumbers nothing", () => {
    const orders = renumber(placements("a", "b")).map(p => p.order);
    expect(orders[1] - orders[0]).toBeGreaterThan(1);
  });
});

describe("whether anything changed", () => {
  it("says no for an untouched arrangement", () => {
    const before = placements("a", "b");
    expect(hasChanges(before, [...before])).toBe(false);
  });

  it("says no for a move that put the card back", () => {
    // Compared on stored FIELDS, not references — every operation returns new
    // objects, so a reference check would report a change here.
    const before = placements("a", "b", "c");
    const there = movePlacement(before, 0, 2);
    expect(hasChanges(before, movePlacement(there, 2, 0))).toBe(false);
  });

  it.each([
    ["a reorder", (p: WidgetPlacement[]) => movePlacement(p, 0, 1)],
    ["a hide", (p: WidgetPlacement[]) => togglePlacementHidden(p, "a")],
    ["a removal", (p: WidgetPlacement[]) => removePlacement(p, "a")],
    ["an addition", (p: WidgetPlacement[]) => addPlacement(p, "core/new")],
  ])("says yes after %s", (_label, edit) => {
    const before = placements("a", "b");
    expect(hasChanges(before, edit(before))).toBe(true);
  });

  it("notices a geometry change alone", () => {
    const before = placements("a");
    const resized = [{ ...before[0], size: "xl" }];
    expect(hasChanges(before, resized)).toBe(true);
  });
});

describe("addPlacement at the write contract's ceiling", () => {
  /** `MAX_PLACEMENTS` placements, which is exactly one submission's worth. */
  function full(): WidgetPlacement[] {
    return Array.from({ length: MAX_PLACEMENTS }, (_, i) => ({
      id: `p${i}`,
      widgetId: `core/w${i}`,
      order: i * 10,
      hidden: false,
    }));
  }

  it("refuses rather than building an arrangement no write can carry", () => {
    // 🔴 An install declaring more widgets than one submission may hold offers
    // the surplus through `available`, so an unguarded add produced a draft the
    // server was always going to refuse -- and the reader met a generic "could
    // not be saved" naming no limit they knew they had reached.
    const before = full();
    const after = addPlacement(before, "core/surplus");

    expect(after).toHaveLength(MAX_PLACEMENTS);
    expect(after.map(p => p.widgetId)).not.toContain("core/surplus");
  });

  it("returns a NEW array even when it refuses", () => {
    // The caller assigns the result into draft state, so returning the same
    // reference would be indistinguishable from a change that did not render.
    const before = full();
    expect(addPlacement(before, "core/surplus")).not.toBe(before);
  });

  it("still adds one below the ceiling", () => {
    // The control. Without it the refusal above is satisfied by an
    // `addPlacement` that never adds anything at all.
    const before = full().slice(0, MAX_PLACEMENTS - 1);
    const after = addPlacement(before, "core/surplus");

    expect(after).toHaveLength(MAX_PLACEMENTS);
    expect(after.map(p => p.widgetId)).toContain("core/surplus");
  });
});

describe("arranging across columns", () => {
  const at = (id: string, column: number, order: number): WidgetPlacement => ({
    id,
    widgetId: `w-${id}`,
    column,
    order,
    hidden: false,
  });

  describe("grouping for the grid", () => {
    it("puts each placement under its own column, in order", () => {
      const grouped = placementsByColumn(
        [at("a", 0, 0), at("b", 1, 10), at("c", 0, 20)],
        2
      );
      expect(grouped.map(col => col.map(p => p.id))).toEqual([
        ["a", "c"],
        ["b"],
      ]);
    });

    it("KEEPS a card whose column no longer exists", () => {
      // 🔴 The property that decides whether narrowing the dashboard destroys
      // work. A reader who moves 4 columns down to 2 still owns the cards that
      // were in columns 2 and 3; dropping them would silently delete an
      // arrangement, which is worse than showing them somewhere unexpected.
      const grouped = placementsByColumn([at("a", 0, 0), at("far", 3, 10)], 2);
      expect(grouped.flat().map(p => p.id)).toContain("far");
      expect(grouped).toHaveLength(2);
    });

    it("returns one bucket PER COLUMN even when a column is empty", () => {
      // 🔴 The control an empty column needs: a drop target only exists if the
      // grid renders that column, so collapsing empty buckets would make a
      // column unreachable the moment its last card left it.
      const grouped = placementsByColumn([at("a", 0, 0)], 3);
      expect(grouped).toHaveLength(3);
      expect(grouped[1]).toEqual([]);
      expect(grouped[2]).toEqual([]);
    });
  });

  describe("moving between columns", () => {
    it("moves a card into the column asked for", () => {
      const moved = moveToColumn([at("a", 0, 0), at("b", 1, 10)], "a", 1);
      expect(moved.find(p => p.id === "a")?.column).toBe(1);
    });

    it("leaves the other placements' columns alone", () => {
      // The control: a rebuild that renumbered every column would satisfy the
      // assertion above while quietly rearranging the whole dashboard.
      const moved = moveToColumn([at("a", 0, 0), at("b", 1, 10)], "a", 1);
      expect(moved.find(p => p.id === "b")?.column).toBe(1);
      expect(moved).toHaveLength(2);
    });

    it("ignores an id it does not hold, rather than throwing", () => {
      const before = [at("a", 0, 0)];
      expect(moveToColumn(before, "nope", 1)).toEqual(before);
    });
  });

  describe("what the single-pointer controls may offer", () => {
    it("refuses left at the first column and right at the last", () => {
      // 🔴 WCAG 2.2 SC 2.5.7: crossing columns must be reachable by CLICK, not
      // only by dragging — so these buttons are the conformance, and their
      // enabled state has to be right or they are a control that lies.
      expect(columnAffordance(0, 3)).toEqual({
        canMoveLeft: false,
        canMoveRight: true,
      });
      expect(columnAffordance(2, 3)).toEqual({
        canMoveLeft: true,
        canMoveRight: false,
      });
    });

    it("offers both in the middle", () => {
      expect(columnAffordance(1, 3)).toEqual({
        canMoveLeft: true,
        canMoveRight: true,
      });
    });
  });
});

describe("resolving where a drag landed", () => {
  const at = (id: string, column: number, order: number): WidgetPlacement => ({
    id,
    widgetId: `w-${id}`,
    column,
    order,
    hidden: false,
  });
  const start = [at("a", 0, 0), at("b", 0, 10), at("c", 1, 20)];

  it("drops onto an EMPTY column when the target is the column itself", () => {
    // 🔴 The case a card-to-card resolution cannot express. An empty column
    // holds no card to drop onto, so unless the column itself is a target it
    // is reachable only until its last card leaves and never again.
    const next = resolveDrop(start, "a", columnDropId(2), 3);
    expect(next.find(p => p.id === "a")?.column).toBe(2);
  });

  it("takes the column of the card it was dropped onto", () => {
    const next = resolveDrop(start, "a", "c", 3);
    expect(next.find(p => p.id === "a")?.column).toBe(1);
  });

  it("REORDERS within a column rather than only re-columning", () => {
    // 🔴 The control for the case above. Setting the column and stopping there
    // passes "took the column" while every card lands in arrival order, so a
    // reader can never place one BELOW another in the same column.
    const next = resolveDrop(start, "b", "a", 3);
    const column0 = next.filter(p => (p.column ?? 0) === 0).map(p => p.id);
    expect(column0).toEqual(["b", "a"]);
  });

  it("leaves the arrangement alone when the drop resolves to nothing", () => {
    // A drag released over empty space is an ordinary outcome, not an error.
    expect(resolveDrop(start, "a", null, 3)).toEqual(start);
  });

  it("leaves the arrangement alone when a card is dropped on itself", () => {
    expect(resolveDrop(start, "a", "a", 3)).toEqual(start);
  });
});
