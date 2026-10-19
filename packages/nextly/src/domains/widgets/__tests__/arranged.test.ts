/**
 * Whether a stored row was ARRANGED, and what a row that was not contributes.
 *
 * Pure, so both halves are asserted here rather than only through the
 * endpoint: the flag's round trip through serialisation, including the rows
 * written before it existed, and the one function that turns a dismissal-only
 * row into what the reader sees.
 */
import { describe, expect, it } from "vitest";

import {
  LAYOUT_SCHEMA_VERSION,
  dismissalsApplied,
  layoutIsArranged,
  readStoredLayout,
  serializeLayout,
  type WidgetPlacement,
} from "../layout";

function placement(
  widgetId: string,
  patch: Partial<WidgetPlacement> = {}
): WidgetPlacement {
  return {
    id: widgetId,
    widgetId,
    width: "full",
    removed: false,
    ...patch,
  };
}

describe("whether a stored row was arranged", () => {
  it("reads a row written as an arrangement as arranged", () => {
    const row = readStoredLayout(serializeLayout([placement("a")]));
    expect(layoutIsArranged(row)).toBe(true);
  });

  it("reads a row a dismissal wrote as not arranged", () => {
    const row = readStoredLayout(
      serializeLayout([placement("a", { removed: true })], false)
    );
    expect(layoutIsArranged(row)).toBe(false);
  });

  it("reads a row written before the field existed as arranged", () => {
    // 🔴 Every row already stored was written by an edit-mode save. Reading
    // their silence any other way would replace readers' own arrangements with
    // the live defaults the moment this shipped.
    const legacy = JSON.stringify({
      schemaVersion: 2,
      columnCount: 3,
      placements: [
        { id: "a", widgetId: "a", column: 0, order: 0, hidden: false },
      ],
    });
    expect(layoutIsArranged(readStoredLayout(legacy))).toBe(true);
  });

  it("stores nothing at all on an arranged row", () => {
    // The rare-case negative: the ordinary row carries no key, so an arranged
    // row written now is byte-for-byte the shape every earlier one has.
    expect(JSON.parse(serializeLayout([placement("a")]))).not.toHaveProperty(
      "unarranged"
    );
  });

  it("reads only a literal true as not arranged", () => {
    // Anything else this core did not write is the ordinary row. A truthy
    // stray value demoting a reader's arrangement to the defaults is the
    // expensive direction to be wrong in.
    const odd = JSON.stringify({
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      placements: [placement("a")],
      unarranged: "yes",
    });
    expect(layoutIsArranged(readStoredLayout(odd))).toBe(true);
  });
});

describe("a reader's dismissals over the live defaults", () => {
  const defaults = [
    placement("a", { width: "half" }),
    placement("b", { width: "third" }),
    placement("new"),
  ];

  it("hides the widgets the row hid, and nothing else", () => {
    const row = readStoredLayout(
      serializeLayout(
        [placement("a", { removed: true }), placement("b")],
        false
      )
    );

    expect(
      dismissalsApplied(defaults, row).map(p => [p.widgetId, p.removed])
    ).toEqual([
      ["a", true],
      ["b", false],
      // Never in the row at all, so never dismissed: it arrives visible.
      ["new", false],
    ]);
  });

  it("takes positions and widths from the defaults, never from the row", () => {
    // 🔴 The row was written against an EARLIER default. Reading its order or
    // widths back would keep a reader who never arranged anything on a
    // dashboard the default has since moved away from.
    const row = readStoredLayout(
      serializeLayout(
        [placement("new"), placement("b", { width: "quarter", removed: true })],
        false
      )
    );

    const applied = dismissalsApplied(defaults, row);
    expect(applied.map(p => p.widgetId)).toEqual(["a", "b", "new"]);
    expect(applied[1]).toMatchObject({ width: "third", removed: true });
  });

  it("returns the defaults unchanged for a reader with no row", () => {
    expect(dismissalsApplied(defaults, undefined)).toEqual(defaults);
  });
});
