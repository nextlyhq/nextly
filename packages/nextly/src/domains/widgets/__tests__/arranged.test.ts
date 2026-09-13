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
  DEFAULT_COLUMN_COUNT,
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
    column: 0,
    order: 0,
    hidden: false,
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
      serializeLayout(
        [placement("a", { hidden: true })],
        DEFAULT_COLUMN_COUNT,
        false
      )
    );
    expect(layoutIsArranged(row)).toBe(false);
  });

  it("reads a row written before the field existed as arranged", () => {
    // 🔴 Every row already stored was written by an edit-mode save. Reading
    // their silence any other way would replace readers' own arrangements with
    // the live defaults the moment this shipped.
    const legacy = JSON.stringify({
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      columnCount: DEFAULT_COLUMN_COUNT,
      placements: [placement("a")],
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
      columnCount: DEFAULT_COLUMN_COUNT,
      placements: [placement("a")],
      unarranged: "yes",
    });
    expect(layoutIsArranged(readStoredLayout(odd))).toBe(true);
  });
});

describe("a reader's dismissals over the live defaults", () => {
  const defaults = [
    placement("a", { order: 0, column: 0 }),
    placement("b", { order: 10, column: 1 }),
    placement("new", { order: 20, column: 2 }),
  ];

  it("hides the widgets the row hid, and nothing else", () => {
    const row = readStoredLayout(
      serializeLayout(
        [placement("a", { hidden: true }), placement("b")],
        DEFAULT_COLUMN_COUNT,
        false
      )
    );

    expect(
      dismissalsApplied(defaults, row).map(p => [p.widgetId, p.hidden])
    ).toEqual([
      ["a", true],
      ["b", false],
      // Never in the row at all, so never dismissed: it arrives visible.
      ["new", false],
    ]);
  });

  it("takes its positions from the defaults, never from the row", () => {
    // 🔴 The row was written against an EARLIER registry. Its orders are that
    // registry's indices, so reading them back would put a card where a plugin
    // has since stopped declaring it -- and could tie with a widget that did
    // not exist when the row was written.
    const row = readStoredLayout(
      serializeLayout(
        [placement("b", { order: 999, column: 2, hidden: true })],
        DEFAULT_COLUMN_COUNT,
        false
      )
    );

    const b = dismissalsApplied(defaults, row).find(p => p.widgetId === "b");
    expect(b).toMatchObject({ order: 10, column: 1, hidden: true });
  });

  it("returns the defaults unchanged for a reader with no row", () => {
    expect(dismissalsApplied(defaults, undefined)).toEqual(defaults);
  });
});
