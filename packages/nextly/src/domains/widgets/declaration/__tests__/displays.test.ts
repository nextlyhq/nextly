/**
 * The run-time shapes core's displays draw are the canonical result type, as
 * a check: every key `WidgetResult` gives a display's data is checked, so a
 * plain JavaScript example or answer with a malformed one is refused.
 *
 * Each sample is typed `Required<…>` of the canonical shape, so a key added to
 * `WidgetResult` fails to compile here until it is sampled, and the loop then
 * fails until the run-time schema checks it.
 */
import { describe, expect, it } from "vitest";

import {
  displayDataProblem,
  type CoreDisplay,
  type DisplayOp,
  type QueryAnswer,
} from "../displays";

type Canonical<D extends CoreDisplay> = Required<
  Omit<QueryAnswer<DisplayOp<D>>, "op">
>;

const SAMPLES: { [D in CoreDisplay]: Canonical<D> } = {
  metric: { total: 3, atLeast: false },
  list: {
    items: [{ title: "A" }],
    fields: [{ name: "title", label: "Title", type: "string" }],
  },
  table: {
    items: [{ title: "A" }],
    fields: [{ name: "title", label: "Title", type: "string" }],
  },
  bars: { buckets: [{ value: "paid", count: 1 }], truncated: false },
  timeseries: { points: [{ start: "2026-10-01", count: 1 }], interval: "day" },
};

/** A value no key of any canonical shape holds. */
const WRONG_KIND = Symbol("wrong kind");

describe("the data core's displays draw, checked at run time", () => {
  it.each(Object.keys(SAMPLES) as CoreDisplay[])(
    "%s: passes its canonical sample, and refuses each key of it given the wrong kind",
    display => {
      const sample: Record<string, unknown> = SAMPLES[display];
      expect(displayDataProblem(display, sample)).toBeUndefined();
      for (const key of Object.keys(sample)) {
        expect(
          displayDataProblem(display, { ...sample, [key]: WRONG_KIND }),
          `${display}.${key}`
        ).toBeDefined();
      }
    }
  );

  it.each(["list", "table"] as const)(
    "%s: refuses each property of a column given the wrong kind",
    display => {
      const column = SAMPLES[display].fields[0];
      for (const key of Object.keys(column)) {
        expect(
          displayDataProblem(display, {
            ...SAMPLES[display],
            fields: [{ ...column, [key]: WRONG_KIND }],
          }),
          `${display}.fields.0.${key}`
        ).toContain(`fields.0.${key}`);
      }
    }
  );

  it("refuses a list's column that names no field", () => {
    expect(
      displayDataProblem("list", { items: [], fields: [{ label: "Title" }] })
    ).toContain("fields.0.name");
  });
});
