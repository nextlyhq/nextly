/**
 * The picker's preview of a bound date or number: formatted in the page's
 * language and the site's time zone, resolved as the published render
 * resolves them, never in the browser's. Each case is held to the render's
 * own formatter for the same language and zone (the oracle), and to the text
 * itself, so a preview that reached neither would not pass by agreeing with
 * a formatter built the same wrong way.
 */
import {
  checkFormat,
  createBindingFormatter,
  type BindingFieldShape,
  type BindingFormat,
} from "@nextlyhq/blocks-engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { previewWithFormat } from "./binding-format-field";

const INSTANT: BindingFieldShape = { name: "updatedAt", type: "date" };
const NUMBER: BindingFieldShape = { name: "price", type: "number" };
const LONG_DATE: BindingFormat = {
  type: "date",
  options: { dateStyle: "long" },
};
const PLAIN_NUMBER: BindingFormat = { type: "number" };

/**
 * 21:30 UTC on 8 November: already the 9th in Karachi (UTC+5), still the
 * 8th in UTC and in Los Angeles, the browser's zone below.
 */
const LATE_EVENING = "2026-11-08T21:30:00.000Z";
/** 03:30 UTC on 8 November: still the 7th in Los Angeles (UTC-8). */
const EARLY_MORNING = "2026-11-08T03:30:00.000Z";

const PAGE = { locale: "ar-EG", timeZone: "Asia/Karachi" } as const;

/** The browser's own language and zone, unlike the page's. */
const BROWSER = { locale: "en-US", timeZone: "America/Los_Angeles" } as const;

const RealDateTimeFormat = Intl.DateTimeFormat;

/**
 * `Intl.DateTimeFormat` answering, where it is given no language or zone,
 * with the browser's above rather than the test machine's, so a preview read
 * from the browser's defaults shows it.
 */
class BrowserDateTimeFormat extends RealDateTimeFormat {
  constructor(
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions
  ) {
    super(locales ?? BROWSER.locale, {
      timeZone: BROWSER.timeZone,
      ...options,
    });
  }
}

beforeEach(() => {
  Object.defineProperty(Intl, "DateTimeFormat", {
    value: BrowserDateTimeFormat,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  Object.defineProperty(Intl, "DateTimeFormat", {
    value: RealDateTimeFormat,
    configurable: true,
    writable: true,
  });
});

/** The published render's text for one value, in `env`. */
function rendered(
  env: { readonly locale: string; readonly timeZone: string },
  value: unknown,
  format: BindingFormat,
  field: BindingFieldShape
): string {
  const check = checkFormat(format, "text", field);
  if (!check.ok || check.format === null) {
    throw new Error(`the format was refused: ${JSON.stringify(check)}`);
  }
  const result = createBindingFormatter(env).format(value, check.format, field);
  if (!result.ok) throw new Error(`not formatted: ${result.reason}`);
  return result.value.text;
}

describe("a bound value's preview in the picker", () => {
  it("is the stub's browser default, the control that the stub reaches Intl", () => {
    expect(new Intl.DateTimeFormat().resolvedOptions()).toMatchObject(BROWSER);
  });

  it("shows a date in the page's language and the site's zone", () => {
    const shown = previewWithFormat(
      LATE_EVENING,
      LONG_DATE,
      "text",
      INSTANT,
      PAGE
    );
    expect(shown).toBe(rendered(PAGE, LATE_EVENING, LONG_DATE, INSTANT));
    // The 9th, in Arabic digits: the browser's language would write Latin
    // ones, and its zone, or UTC, the 8th.
    expect(shown).toBe("٩ نوفمبر ٢٠٢٦");
  });

  it("shows a number in the page's language", () => {
    const shown = previewWithFormat(
      "1234.5",
      PLAIN_NUMBER,
      "text",
      NUMBER,
      PAGE
    );
    expect(shown).toBe(rendered(PAGE, 1234.5, PLAIN_NUMBER, NUMBER));
    expect(shown).toBe("١٬٢٣٤٫٥");
  });

  it("is English and UTC where neither is known, as a render with neither", () => {
    const shown = previewWithFormat(
      EARLY_MORNING,
      LONG_DATE,
      "text",
      INSTANT,
      undefined
    );
    expect(shown).toBe(
      rendered(
        { locale: "en", timeZone: "UTC" },
        EARLY_MORNING,
        LONG_DATE,
        INSTANT
      )
    );
    // The 8th: the browser's zone would show the 7th.
    expect(shown).toBe("November 8, 2026");
  });

  it("resolves a language and a zone the runtime refuses as the render does", () => {
    const shown = previewWithFormat(EARLY_MORNING, LONG_DATE, "text", INSTANT, {
      locale: "not a language",
      timeZone: "Not/AZone",
    });
    expect(shown).toBe("November 8, 2026");
  });
});
