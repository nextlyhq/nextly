/**
 * How a stored date value is written into each kind of date input, branch by
 * branch, in a zone west of UTC: a day, a month and a time of day in UTC, a
 * date and time in the reader's own zone, and nothing for a value that names
 * no date. `DateInput.test.tsx` covers the same through the drawn input.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { toInputValue } from "../date-input-value";

const zone = process.env.TZ;
beforeAll(() => {
  // Node reads TZ when a date is formatted, so this applies to the tests below.
  process.env.TZ = "America/Los_Angeles";
});
afterAll(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

/** 05:06 UTC on 4 March 2025: 21:06 on 3 March in Los Angeles. */
const MOMENT = "2025-03-04T05:06:00.000Z";

describe("toInputValue", () => {
  it("runs in a zone behind UTC", () => {
    // The control: without it, a test run in UTC would pass the zone cases for the wrong reason.
    expect(new Date(MOMENT).getDate()).toBe(3);
  });

  it("writes nothing for no value, a blank one, or one that names no date", () => {
    expect(toInputValue(null, "date")).toBe("");
    expect(toInputValue(undefined, "date")).toBe("");
    expect(toInputValue("", "date")).toBe("");
    expect(toInputValue("not a date", "date")).toBe("");
    expect(toInputValue(new Date(Number.NaN), "datetime")).toBe("");
    // Neither text nor a date, as a value read from storage can be: reading
    // it throws, and the input is left empty rather than the form failing.
    expect(toInputValue(86_400_000 as unknown as Date, "date")).toBe("");
  });

  it("writes a day, a month and a time of day as their UTC parts, each padded to two", () => {
    expect(toInputValue(MOMENT, "date")).toBe("2025-03-04");
    expect(toInputValue(MOMENT, "month")).toBe("2025-03");
    expect(toInputValue(MOMENT, "time")).toBe("05:06");
  });

  it("writes a date and time in the reader's own zone", () => {
    expect(toInputValue(MOMENT, "datetime")).toBe("2025-03-03T21:06");
  });

  it("reads a Date as it reads the same moment written as text", () => {
    const formats = ["date", "month", "time", "datetime"] as const;
    expect(
      formats.map(format => toInputValue(new Date(MOMENT), format))
    ).toEqual(formats.map(format => toInputValue(MOMENT, format)));
    // The control: the text form answers something in every format.
    expect(formats.map(format => toInputValue(MOMENT, format))).not.toContain(
      ""
    );
  });
});
