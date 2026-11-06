/**
 * Whether a stored row was ARRANGED, and what a row that was not contributes.
 *
 * Pure, so both halves are asserted here rather than only through the
 * endpoint: the flag's round trip through serialisation, and the one function
 * that turns a dismissal-only row into what the reader sees.
 */
import { describe, expect, it } from "vitest";

import {
  LAYOUT_SCHEMA_VERSION,
  dismissalsApplied,
  layoutIsArranged,
  readStoredLayout,
  serializeLayout,
  type StoredLayout,
  type WidgetPlacement,
} from "../layout";

/** A current-format row, read: a test expecting one fails here if it is not. */
function readRow(raw: string): StoredLayout {
  const read = readStoredLayout(raw);
  if (read === undefined) throw new Error("expected a current-format row");
  return read;
}

function placement(
  widgetId: string,
  patch: Partial<WidgetPlacement> = {}
): WidgetPlacement {
  return {
    id: widgetId,
    widgetId,
    w: 12,
    h: 3,
    removed: false,
    ...patch,
  };
}

describe("whether a stored row was arranged", () => {
  it("reads a row written as an arrangement as arranged", () => {
    const row = readRow(serializeLayout([placement("a")]));
    expect(layoutIsArranged(row)).toBe(true);
  });

  it("reads a row a dismissal wrote as not arranged", () => {
    const row = readRow(
      serializeLayout([placement("a", { removed: true })], false)
    );
    expect(layoutIsArranged(row)).toBe(false);
  });

  it("reads a row of an earlier format as no row, never as an arrangement", () => {
    // An earlier row is no saved arrangement whatever it says about itself:
    // its reader follows the default, as somebody with no row does.
    const earlier = JSON.stringify({
      schemaVersion: 3,
      placements: [{ id: "a", widgetId: "a", width: "full", removed: false }],
    });
    expect(readStoredLayout(earlier)).toBeUndefined();
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
    expect(layoutIsArranged(readRow(odd))).toBe(true);
  });
});

describe("a reader's dismissals over the live defaults", () => {
  const defaults = [
    placement("a", { w: 6, h: 3 }),
    placement("b", { w: 4, h: 2 }),
    placement("new"),
  ];

  it("hides the widgets the row hid, and nothing else", () => {
    const row = readRow(
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

  it("takes positions and sizes from the defaults, never from the row", () => {
    // 🔴 The row was written against an EARLIER default. Reading its order or
    // sizes back would keep a reader who never arranged anything on a
    // dashboard the default has since moved away from.
    const row = readRow(
      serializeLayout(
        [placement("new"), placement("b", { w: 3, h: 6, removed: true })],
        false
      )
    );

    const applied = dismissalsApplied(defaults, row);
    expect(applied.map(p => p.widgetId)).toEqual(["a", "b", "new"]);
    expect(applied[1]).toMatchObject({ w: 4, h: 2, removed: true });
  });

  it("carries a reader's settings for a card, and keeps the default's position and size", () => {
    // A setting changed outside customise mode is written to a row that still
    // follows the default. Reading only removals back dropped it every time.
    const row = readRow(
      serializeLayout(
        [
          placement("b", { w: 3, h: 6, config: { items: 9 } }),
          placement("a", { removed: true, config: { range: "7d" } }),
        ],
        false
      )
    );

    const applied = dismissalsApplied(defaults, row);
    expect(
      applied.map(p => [p.widgetId, p.w, p.h, p.removed, p.config])
    ).toEqual([
      // A removed card keeps its settings, for the day it is put back.
      ["a", 6, 3, true, { range: "7d" }],
      ["b", 4, 2, false, { items: 9 }],
      // Never in the row: the default, with no settings of its own.
      ["new", 12, 3, false, undefined],
    ]);
  });

  it("returns the defaults unchanged for a reader with no row", () => {
    expect(dismissalsApplied(defaults, undefined)).toEqual(defaults);
  });
});
