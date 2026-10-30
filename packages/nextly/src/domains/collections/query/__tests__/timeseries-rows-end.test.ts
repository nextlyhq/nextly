/**
 * Where the rows a timeseries window counts end (`windowRowsEnd`): at the end
 * of its last interval, or, for a window ending now, at the end of the whole
 * second it is read in, with the interval that sliver falls in folded into the
 * last, so a row a database stored rounded across a boundary is counted there.
 */
import { describe, expect, it } from "vitest";

import { windowRowsEnd } from "../timeseries-interval";

const at = (iso: string) => new Date(iso);

describe("windowRowsEnd", () => {
  it("ends at the last interval's end, folding nothing, without a rows end or with one inside it", () => {
    const lastStart = at("2026-06-15T00:00:00.000Z");
    expect(windowRowsEnd(lastStart, "day", undefined)).toEqual({
      end: at("2026-06-16T00:00:00.000Z"),
    });
    // Mid-afternoon: the whole second is well inside the day.
    expect(
      windowRowsEnd(lastStart, "day", at("2026-06-15T14:00:01.001Z"))
    ).toEqual({ end: at("2026-06-16T00:00:00.000Z") });
  });

  it.each([
    ["day", "2026-06-15T00:00:00.000Z", "2026-06-16T00:00:00.000Z"],
    // A week from Monday, 15 June, to the Monday after.
    ["week", "2026-06-15T00:00:00.000Z", "2026-06-22T00:00:00.000Z"],
    ["month", "2026-06-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z"],
  ] as const)(
    "folds the next %s's first second into the last, read in the last fraction of a second before it",
    (interval, lastStart, boundary) => {
      // Read at 0.2 s before the boundary: the whole second it is read in ends
      // one millisecond past the boundary, where MySQL stores a row written at
      // 0.3 s before it.
      const rowsEnd = new Date(at(boundary).getTime() + 1);
      expect(windowRowsEnd(at(lastStart), interval, rowsEnd)).toEqual({
        end: rowsEnd,
        foldedStart: at(boundary),
      });
    }
  );

  it("never reads past the interval after the last, whatever end it is handed", () => {
    expect(
      windowRowsEnd(
        at("2026-06-15T00:00:00.000Z"),
        "day",
        at("2026-06-20T00:00:00.000Z")
      )
    ).toEqual({
      end: at("2026-06-17T00:00:00.000Z"),
      foldedStart: at("2026-06-16T00:00:00.000Z"),
    });
  });
});
