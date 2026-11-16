import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkFormat,
  createBindingFormatter,
  machineDate,
  safeTimeZone,
  type CheckedFormat,
} from "./binding-format";
import type { BindingFieldShape } from "./binding-rules";

const DAY_FIELD: BindingFieldShape = {
  name: "publishedAt",
  type: "date",
  dateOnly: true,
};
const MONTH_FIELD: BindingFieldShape = {
  name: "issue",
  type: "date",
  monthOnly: true,
};
const DATE_TIME_FIELD: BindingFieldShape = { name: "startsAt", type: "date" };

/** A format's checked form, failing the test when the check refuses it. */
function checked(format: unknown, field?: BindingFieldShape): CheckedFormat {
  const result = checkFormat(format, "text", field);
  if (!result.ok || result.format === null) {
    throw new Error(`the format was refused: ${JSON.stringify(result)}`);
  }
  return result.format;
}

/** The text one value formats to, failing the test when it does not format. */
function text(
  env: { locale: string; timeZone: string },
  value: unknown,
  format: CheckedFormat,
  field?: BindingFieldShape
): string {
  const result = createBindingFormatter(env).format(value, format, field);
  if (!result.ok) throw new Error(`not formatted: ${result.reason}`);
  // Intl separates a currency from its amount, and a time from its day
  // period, with no-break spaces.
  return result.value.text.replace(/[\u00a0\u202f]/g, " ");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("formatting a bound value for the reader", () => {
  it("formats a date preset, an Intl pattern, a number and a currency in en and de", () => {
    const en = { locale: "en", timeZone: "UTC" };
    const de = { locale: "de", timeZone: "UTC" };
    const day = "2026-03-29T00:00:00.000Z";
    const preset = checked(
      { type: "date", options: { dateStyle: "long" } },
      DAY_FIELD
    );
    const pattern = checked(
      {
        type: "date",
        options: { year: "numeric", month: "short", day: "numeric" },
      },
      DAY_FIELD
    );
    const number = checked({ type: "number" });
    const currency = checked({ type: "currency", currency: "EUR" });

    expect(text(en, day, preset, DAY_FIELD)).toBe("March 29, 2026");
    expect(text(de, day, preset, DAY_FIELD)).toBe("29. März 2026");
    expect(text(en, day, pattern, DAY_FIELD)).toBe("Mar 29, 2026");
    expect(text(de, day, pattern, DAY_FIELD)).toBe("29. März 2026");
    expect(text(en, 1234.5, number)).toBe("1,234.5");
    expect(text(de, 1234.5, number)).toBe("1.234,5");
    expect(text(en, 1234.5, currency)).toBe("€1,234.50");
    expect(text(de, 1234.5, currency)).toBe("1.234,50 €");
  });

  it("formats in a binding's own language when its format names one", () => {
    const format = checked({ type: "number", options: { locale: "de" } });
    expect(text({ locale: "en", timeZone: "UTC" }, 1234.5, format)).toBe(
      "1.234,5"
    );
  });

  it("keeps a date-only value's day under -10:00 and +14:00", () => {
    const format = checked(
      {
        type: "date",
        options: { year: "numeric", month: "long", day: "numeric" },
      },
      DAY_FIELD
    );
    const day = "2026-03-29T00:00:00.000Z";
    for (const timeZone of ["Pacific/Honolulu", "Pacific/Kiritimati"]) {
      expect(text({ locale: "en", timeZone }, day, format, DAY_FIELD)).toBe(
        "March 29, 2026"
      );
    }
  });

  it("formats a date-time in the site's zone, and in UTC when the site sets none, never the process zone", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    // The control: the process zone really is Los Angeles for this test, so
    // an output that followed it would read 11:30.
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "America/Los_Angeles"
    );
    const format = checked(
      {
        type: "date",
        options: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
      },
      DATE_TIME_FIELD
    );
    const instant = "2026-03-29T18:30:00.000Z";
    const paris = {
      locale: "en",
      timeZone: safeTimeZone("Europe/Paris").zone,
    };
    const unset = { locale: "en", timeZone: safeTimeZone(undefined).zone };
    expect(text(paris, instant, format, DATE_TIME_FIELD)).toBe("20:30");
    expect(text(unset, instant, format, DATE_TIME_FIELD)).toBe("18:30");
  });

  it("formats a time-only value's time in UTC and never its date", () => {
    const opens: BindingFieldShape = {
      name: "opensAt",
      type: "date",
      timeOnly: true,
    };
    const time = "1970-01-01T09:30:00.000Z";
    const env = { locale: "en", timeZone: "Pacific/Kiritimati" };
    expect(text(env, time, checked({ type: "date" }, opens), opens)).toBe(
      "9:30 AM"
    );
    expect(
      text(
        env,
        time,
        checked(
          {
            type: "date",
            options: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
          },
          opens
        ),
        opens
      )
    ).toBe("09:30");
    expect(machineDate(time, opens)).toEqual({
      datetime: "09:30:00",
      dateOnly: false,
    });
    expect(
      checkFormat(
        { type: "date", options: { dateStyle: "long" } },
        "text",
        opens
      )
    ).toMatchObject({ ok: false, code: "binding-format-misfit" });
  });

  it("gives a date-only value its day and a date-time its instant as the machine value", () => {
    expect(machineDate("2026-03-29T00:00:00.000Z", DAY_FIELD)).toEqual({
      datetime: "2026-03-29",
      dateOnly: true,
    });
    expect(machineDate("2026-03-01T00:00:00.000Z", MONTH_FIELD)).toEqual({
      datetime: "2026-03",
      dateOnly: true,
    });
    expect(machineDate("2026-03-29T18:30:00.000Z", DATE_TIME_FIELD)).toEqual({
      datetime: "2026-03-29T18:30:00.000Z",
      dateOnly: false,
    });
    // Without a schema, what an admin's day picker stores reads as a day.
    expect(machineDate("2026-03-29")).toEqual({
      datetime: "2026-03-29",
      dateOnly: true,
    });
    expect(machineDate("2026-03-29T00:00:00.000Z")?.dateOnly).toBe(true);
    expect(machineDate("2026-03-29T18:30:00.000Z")?.dateOnly).toBe(false);
    expect(machineDate("March 29")).toBeUndefined();

    const formatted = createBindingFormatter({
      locale: "en",
      timeZone: "UTC",
    }).format(
      "2026-03-29T00:00:00.000Z",
      checked({ type: "date", options: { dateStyle: "long" } }, DAY_FIELD),
      DAY_FIELD
    );
    expect(formatted).toEqual({
      ok: true,
      value: {
        text: "March 29, 2026",
        date: { datetime: "2026-03-29", dateOnly: true },
      },
    });
  });
});

describe("reading and formatting dates without the server's zone or a placeholder", () => {
  it("reads a date-time only with its offset, never in the server's zone", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "America/Los_Angeles"
    );
    expect(machineDate("2026-03-29T18:30")).toBeUndefined();
    expect(machineDate("2026-03-29T18:30:00", DATE_TIME_FIELD)).toBeUndefined();
    const format = checked({ type: "date", options: { dateStyle: "long" } });
    expect(
      createBindingFormatter({ locale: "en", timeZone: "UTC" }).format(
        "2026-03-29T18:30",
        format,
        DATE_TIME_FIELD
      )
    ).toEqual({ ok: false, reason: "value" });
    expect(machineDate("2026-03-29T20:30:00+02:00", DATE_TIME_FIELD)).toEqual({
      datetime: "2026-03-29T18:30:00.000Z",
      dateOnly: false,
    });
  });

  it("keeps a time-only value's time when its format sets only the hour style", () => {
    const opens: BindingFieldShape = {
      name: "opensAt",
      type: "date",
      timeOnly: true,
    };
    const env = { locale: "en", timeZone: "UTC" };
    const time = "1970-01-01T21:30:00.000Z";
    for (const options of [{ hour12: false }, { hourCycle: "h23" }]) {
      expect(
        text(env, time, checked({ type: "date", options }, opens), opens)
      ).toBe("21:30");
    }
  });

  it("keeps a time-only value's time when its format sets only a zone name", () => {
    const opens: BindingFieldShape = {
      name: "opensAt",
      type: "date",
      timeOnly: true,
    };
    const format = checked(
      { type: "date", options: { timeZoneName: "short" } },
      opens
    );
    expect(
      text(
        { locale: "en", timeZone: "UTC" },
        "1970-01-01T21:30:00.000Z",
        format,
        opens
      )
    ).toBe("9:30 PM UTC");
  });

  it("refuses a calendar date that does not exist, alone or inside a date-time", () => {
    expect(machineDate("2026-02-30")).toBeUndefined();
    expect(
      machineDate("2026-02-30T10:00:00Z", DATE_TIME_FIELD)
    ).toBeUndefined();
    expect(machineDate("2026-13-01")).toBeUndefined();
    // A real leap day is a date.
    expect(machineDate("2024-02-29")).toEqual({
      datetime: "2024-02-29",
      dateOnly: true,
    });
  });

  it("allows hour12 and hourCycle beside a preset", () => {
    const short = checked(
      { type: "date", options: { timeStyle: "short", hour12: false } },
      DATE_TIME_FIELD
    );
    expect(
      text(
        { locale: "en", timeZone: "UTC" },
        "2026-03-29T18:30:00.000Z",
        short,
        DATE_TIME_FIELD
      )
    ).toBe("18:30");
    expect(
      checkFormat(
        {
          type: "date",
          options: {
            dateStyle: "medium",
            timeStyle: "short",
            hourCycle: "h23",
          },
        },
        "text",
        DATE_TIME_FIELD
      ).ok
    ).toBe(true);
  });

  it("shows a month-only value as its month and year, never its placeholder day", () => {
    const env = { locale: "en", timeZone: "UTC" };
    const issue = "2026-03-01T00:00:00.000Z";
    expect(
      text(env, issue, checked({ type: "date" }, MONTH_FIELD), MONTH_FIELD)
    ).toBe("March 2026");
    expect(
      text(
        env,
        issue,
        checked(
          { type: "date", options: { year: "numeric", month: "short" } },
          MONTH_FIELD
        ),
        MONTH_FIELD
      )
    ).toBe("Mar 2026");
    for (const options of [
      { day: "numeric" },
      { weekday: "long" },
      { dateStyle: "long" },
    ]) {
      expect(
        checkFormat({ type: "date", options }, "text", MONTH_FIELD)
      ).toMatchObject({ ok: false, code: "binding-format-misfit" });
    }
  });
});

describe("checking a stored format before anything is built from it", () => {
  it.each([
    ["an unknown currency", { type: "currency", currency: "XYZ" }],
    ["a malformed currency code", { type: "currency", currency: "eur!" }],
    ["a malformed locale", { type: "date", options: { locale: "en_US!!" } }],
    ["an unknown preset", { type: "date", options: { dateStyle: "bogus" } }],
    [
      "a preset beside a component",
      { type: "date", options: { dateStyle: "long", hour: "numeric" } },
    ],
    [
      "a digit count out of range",
      { type: "number", options: { minimumFractionDigits: 200 } },
    ],
    [
      "a minimum past its maximum",
      {
        type: "number",
        options: { minimumFractionDigits: 3, maximumFractionDigits: 1 },
      },
    ],
    ["a time zone of its own", { type: "date", options: { timeZone: "UTC" } }],
    ["an unknown type", { type: "percent" }],
  ])("refuses %s", (_name, format) => {
    const result = checkFormat(format, "text", undefined);
    expect(result).toMatchObject({ ok: false, code: "binding-format-invalid" });
  });

  it("refuses a format on a prop that is not text, and a format the field cannot take", () => {
    expect(checkFormat({ type: "number" }, "number", undefined)).toMatchObject({
      ok: false,
      code: "binding-format-misfit",
    });
    expect(
      checkFormat({ type: "number" }, "text", { name: "title", type: "text" })
    ).toMatchObject({ ok: false, code: "binding-format-misfit" });
    expect(
      checkFormat(
        { type: "date", options: { hour: "numeric" } },
        "text",
        DAY_FIELD
      )
    ).toMatchObject({ ok: false, code: "binding-format-misfit" });
  });

  it("passes a format this release does not apply as unsupported, not as broken", () => {
    expect(checkFormat({ type: "relativeTime" }, "text", undefined)).toEqual({
      ok: true,
      format: null,
      unsupported: "relativeTime",
    });
  });

  it("answers UTC for a zone that is unset, and says when one given is refused", () => {
    expect(safeTimeZone(undefined)).toEqual({ zone: "UTC", valid: true });
    expect(safeTimeZone("Not/AZone")).toEqual({ zone: "UTC", valid: false });
    expect(safeTimeZone("Europe/Paris")).toEqual({
      zone: "Europe/Paris",
      valid: true,
    });
  });
});
