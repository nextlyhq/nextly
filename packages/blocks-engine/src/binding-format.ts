/**
 * Turning a bound value into the text a reader sees: dates, numbers and
 * currency amounts, in the page's language, over `Intl`.
 *
 * A stored format is outside input, and `Intl` throws a `RangeError` for an
 * unknown currency, a malformed locale or an option out of range. So a format
 * is checked here against a closed list of options before any formatter is
 * built, and the formatter is still built only inside `try`, as the last
 * guard. A format that fails either never reaches a block.
 *
 * Time zones are the format's to decide, never the stored binding's:
 *
 * - a date picked as a day (or a month) is a calendar date with no time zone.
 *   It is stored as UTC midnight, so it is formatted in UTC and keeps its day
 *   under every offset;
 * - a date-time is an instant, formatted in the site's time zone, which the
 *   caller supplies. The server's own zone never decides what a reader sees.
 *
 * Shared by the renderer and anything else that shows a bound value, so a
 * value formats one way wherever it is shown.
 *
 * @module binding-format
 */
import type { BindingIssueCode } from "./binding-issues";
import type { BindablePropKind, BindingFieldShape } from "./binding-rules";
import { bindingKindOf } from "./binding-vocabulary";
import { BINDING_FORMAT_TYPES, type BindingFormatType } from "./document";
import { isPlainRecord } from "./plain-record";
import { ownEntry, ownKeys } from "./safe-record";

/** One option's accepted values, as a predicate over what was stored. */
type OptionRule = (value: unknown) => boolean;

/** A validated option set, holding only keys and values a rule accepted. */
type FormatOptions = Readonly<Record<string, string | number | boolean>>;

/**
 * A format whose options passed every check, ready to be built.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type CheckedFormat =
  | {
      readonly type: "date";
      readonly options: FormatOptions;
      /** The binding's own language, when it names one. */
      readonly locale?: string;
    }
  | {
      readonly type: "number";
      readonly options: FormatOptions;
      readonly locale?: string;
    }
  | {
      readonly type: "currency";
      /** An ISO 4217 code this runtime knows. */
      readonly currency: string;
      readonly options: FormatOptions;
      readonly locale?: string;
    };

/**
 * What checking a stored format found.
 *
 * `unsupported` names a format the stored shape allows and this release does
 * not apply: the value is shown as it is when it fits the prop by itself.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type FormatCheck =
  | {
      readonly ok: true;
      readonly format: CheckedFormat | null;
      readonly unsupported?: BindingFormatType;
    }
  | {
      readonly ok: false;
      readonly code: BindingIssueCode;
      readonly message: string;
    };

function oneOf(values: readonly string[]): OptionRule {
  return value => typeof value === "string" && values.includes(value);
}

function wholeNumber(min: number, max: number): OptionRule {
  return value =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max;
}

const isBoolean: OptionRule = value => typeof value === "boolean";

const STYLES = ["full", "long", "medium", "short"];
const TEXT_WIDTHS = ["long", "short", "narrow"];
const NUMERIC = ["numeric", "2-digit"];

/** The options a date format may set, each with the values it takes. */
const DATE_OPTIONS: Readonly<Record<string, OptionRule>> = {
  dateStyle: oneOf(STYLES),
  timeStyle: oneOf(STYLES),
  weekday: oneOf(TEXT_WIDTHS),
  era: oneOf(TEXT_WIDTHS),
  year: oneOf(NUMERIC),
  month: oneOf([...NUMERIC, ...TEXT_WIDTHS]),
  day: oneOf(NUMERIC),
  hour: oneOf(NUMERIC),
  minute: oneOf(NUMERIC),
  second: oneOf(NUMERIC),
  fractionalSecondDigits: wholeNumber(1, 3),
  dayPeriod: oneOf(TEXT_WIDTHS),
  hour12: isBoolean,
  hourCycle: oneOf(["h11", "h12", "h23", "h24"]),
  timeZoneName: oneOf([
    "short",
    "long",
    "shortOffset",
    "longOffset",
    "shortGeneric",
    "longGeneric",
  ]),
};

/** The two presets, which `Intl` refuses beside any single component. */
const DATE_PRESETS: ReadonlySet<string> = new Set(["dateStyle", "timeStyle"]);

/**
 * Options that choose how a time is written rather than which parts are shown,
 * which `Intl` accepts beside a preset.
 */
const HOUR_STYLE: ReadonlySet<string> = new Set(["hour12", "hourCycle"]);

/** The options that show a time of day, which a calendar date does not have. */
const TIME_OF_DAY: ReadonlySet<string> = new Set([
  "timeStyle",
  "hour",
  "minute",
  "second",
  "fractionalSecondDigits",
  "dayPeriod",
  "hour12",
  "hourCycle",
  "timeZoneName",
]);

/** The options that show a calendar date, which a time of day does not have. */
const CALENDAR_PARTS: ReadonlySet<string> = new Set([
  "dateStyle",
  "weekday",
  "era",
  "year",
  "month",
  "day",
]);

/**
 * What a time of day, and a month, are shown with when their format picks
 * none of the parts that are theirs: `Intl` would otherwise fill in a full
 * numeric date, and the date of a time, like the day of a month, is a
 * placeholder. `parts` are the options that pick one of those parts.
 */
const PLACEHOLDER_FREE_DEFAULTS: Readonly<
  Partial<
    Record<
      DateGranularity,
      { readonly parts: ReadonlySet<string>; readonly defaults: FormatOptions }
    >
  >
> = {
  time: {
    parts: new Set([
      "timeStyle",
      "hour",
      "minute",
      "second",
      "fractionalSecondDigits",
      "dayPeriod",
    ]),
    defaults: { hour: "numeric", minute: "2-digit" },
  },
  month: {
    parts: new Set(["year", "month"]),
    defaults: { year: "numeric", month: "long" },
  },
};

/**
 * A format's options with the parts its granularity shows by default, when the
 * format picks none of them. What it does set is kept beside the defaults: an
 * hour style, a zone name, an era.
 */
function withDefaultParts(
  options: FormatOptions,
  granularity: DateGranularity
): FormatOptions {
  const own = PLACEHOLDER_FREE_DEFAULTS[granularity];
  if (own === undefined) return options;
  if (Object.keys(options).some(key => own.parts.has(key))) return options;
  return { ...own.defaults, ...options };
}

/** The options every number format may set. */
const DIGIT_OPTIONS: Readonly<Record<string, OptionRule>> = {
  minimumIntegerDigits: wholeNumber(1, 21),
  minimumFractionDigits: wholeNumber(0, 100),
  maximumFractionDigits: wholeNumber(0, 100),
  minimumSignificantDigits: wholeNumber(1, 21),
  maximumSignificantDigits: wholeNumber(1, 21),
  useGrouping: value =>
    typeof value === "boolean" || oneOf(["always", "auto", "min2"])(value),
  notation: oneOf(["standard", "scientific", "engineering", "compact"]),
  compactDisplay: oneOf(["short", "long"]),
  signDisplay: oneOf(["auto", "never", "always", "exceptZero", "negative"]),
};

const NUMBER_OPTIONS: Readonly<Record<string, OptionRule>> = {
  ...DIGIT_OPTIONS,
  style: oneOf(["decimal", "percent"]),
};

const CURRENCY_OPTIONS: Readonly<Record<string, OptionRule>> = {
  ...DIGIT_OPTIONS,
  currencyDisplay: oneOf(["symbol", "narrowSymbol", "code", "name"]),
  currencySign: oneOf(["standard", "accounting"]),
};

/** Pairs where the first may not exceed the second, as `Intl` requires. */
const BOUNDED_PAIRS: readonly (readonly [string, string])[] = [
  ["minimumFractionDigits", "maximumFractionDigits"],
  ["minimumSignificantDigits", "maximumSignificantDigits"],
];

/** The option naming a binding's own language, beside the formatter's. */
const LOCALE_OPTION = "locale";

const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * A language tag in its canonical form, when this runtime formats in it.
 *
 * Canonicalised first, because `getCanonicalLocales` is what throws for a
 * malformed tag; then asked of the formatter, because a well-formed tag the
 * runtime has no data for would silently format in the runtime's own default,
 * which differs from one server to the next.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function supportedLocale(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    const [canonical] = Intl.getCanonicalLocales(value);
    if (canonical === undefined) return undefined;
    return Intl.DateTimeFormat.supportedLocalesOf([canonical]).length > 0 &&
      Intl.NumberFormat.supportedLocalesOf([canonical]).length > 0
      ? canonical
      : undefined;
  } catch {
    return undefined;
  }
}

/** Whether this runtime knows an ISO 4217 currency code. */
function knownCurrency(code: string): boolean {
  if (!CURRENCY_CODE.test(code)) return false;
  try {
    return Intl.supportedValuesOf("currency").includes(code);
  } catch {
    return false;
  }
}

function invalid(message: string): FormatCheck {
  return { ok: false, code: "binding-format-invalid", message };
}

function misfit(message: string): FormatCheck {
  return { ok: false, code: "binding-format-misfit", message };
}

/** The first stored option no rule accepts, the language aside. */
function refusedOption(
  stored: Readonly<Record<string, unknown>>,
  rules: Readonly<Record<string, OptionRule>>
): string | undefined {
  for (const key of ownKeys(stored)) {
    if (key === LOCALE_OPTION) continue;
    const rule = ownEntry(rules, key);
    if (rule === undefined || !rule(ownEntry(stored, key))) {
      return key;
    }
  }
  return undefined;
}

/**
 * The accepted options, walked in the rules' order rather than the stored
 * one, so two formats naming the same options build the same formatter and
 * share its cache. Every value here already passed its rule.
 */
function acceptedOptions(
  stored: Readonly<Record<string, unknown>>,
  rules: Readonly<Record<string, OptionRule>>
): Record<string, string | number | boolean> {
  const options: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(rules)) {
    const value = ownEntry(stored, key);
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      options[key] = value;
    }
  }
  return options;
}

/** The first minimum set past its maximum, which `Intl` refuses. */
function inverted(options: FormatOptions): string | undefined {
  return BOUNDED_PAIRS.find(([low, high]) => {
    const min = options[low];
    const max = options[high];
    return typeof min === "number" && typeof max === "number" && min > max;
  })?.[0];
}

/**
 * A stored `options` record narrowed to what the rules accept, or the first
 * key they refuse.
 */
function readOptions(
  stored: unknown,
  rules: Readonly<Record<string, OptionRule>>
):
  | { readonly options: FormatOptions; readonly locale?: string }
  | { readonly refused: string } {
  if (stored === undefined) return { options: {} };
  if (!isPlainRecord(stored)) return { refused: "options" };
  const refused = refusedOption(stored, rules);
  if (refused !== undefined) return { refused };
  const options = acceptedOptions(stored, rules);
  const pastMaximum = inverted(options);
  if (pastMaximum !== undefined) return { refused: pastMaximum };
  if (!Object.prototype.hasOwnProperty.call(stored, LOCALE_OPTION)) {
    return { options };
  }
  const locale = supportedLocale(ownEntry(stored, LOCALE_OPTION));
  return locale === undefined
    ? { refused: LOCALE_OPTION }
    : { options, locale };
}

/**
 * Check a stored format against the field it formats and the prop it fills,
 * before anything is built from it.
 *
 * A format turns a value into text, so it is allowed only on a text prop, and
 * only on a field of its kind: a date format on a date, a number or currency
 * format on a number. `field` is absent when the source's schema is not known;
 * the value's own shape is then judged when it is read.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function checkFormat(
  format: unknown,
  kind: BindablePropKind | undefined,
  field: BindingFieldShape | undefined
): FormatCheck {
  if (format === undefined) return { ok: true, format: null };
  const type = isPlainRecord(format) ? ownEntry(format, "type") : undefined;
  const known = BINDING_FORMAT_TYPES.find(name => name === type);
  if (!isPlainRecord(format) || known === undefined) {
    return invalid(
      `A binding's format must be one of: ${BINDING_FORMAT_TYPES.join(", ")}.`
    );
  }
  if (known === "relativeTime" || known === "list") {
    return { ok: true, format: null, unsupported: known };
  }
  if (kind !== undefined && kind !== "text") {
    return misfit(
      "A format turns a value into text, so it is allowed only on a text prop; bind it unformatted."
    );
  }
  if (known === "date") return checkDateFormat(format, field);
  return checkNumberFormat(format, known, field);
}

/** No part is missing from a date-time. */
const NO_PARTS: ReadonlySet<string> = new Set();

/** The options that show a day, which a month picked alone does not have. */
const DAY_PARTS: ReadonlySet<string> = new Set([
  ...TIME_OF_DAY,
  "dateStyle",
  "weekday",
  "day",
]);

/**
 * The options a field cannot show, because what it holds has no such part:
 * a day has no time, a month no day, a time of day no date. Showing one would
 * show the placeholder the value is stored on.
 */
function partsTheFieldLacks(field: BindingFieldShape | undefined): {
  readonly parts: ReadonlySet<string>;
  readonly message: string;
} {
  if (field?.monthOnly === true) {
    return {
      parts: DAY_PARTS,
      message:
        "This field holds a month and year, so its format cannot show a day or a time.",
    };
  }
  if (field?.dateOnly === true) {
    return {
      parts: TIME_OF_DAY,
      message:
        "This field holds a calendar date with no time of day, so its format cannot show one.",
    };
  }
  if (field?.timeOnly === true) {
    return {
      parts: CALENDAR_PARTS,
      message:
        "This field holds a time of day with no date, so its format cannot show one.",
    };
  }
  return { parts: NO_PARTS, message: "" };
}

/**
 * The options that pick which parts of a date are shown, as opposed to how a
 * time is written: everything but the hour style.
 */
function displayParts(keys: readonly string[]): string[] {
  return keys.filter(key => !HOUR_STYLE.has(key));
}

/** A preset beside a single component, which `Intl` refuses. */
function presetConflict(keys: readonly string[]): FormatCheck | undefined {
  const shown = displayParts(keys);
  const presets = shown.filter(key => DATE_PRESETS.has(key)).length;
  if (presets === 0 || presets === shown.length) return undefined;
  return invalid(
    "A date format uses either dateStyle and timeStyle, or single parts such as month and day, not both."
  );
}

/** An option showing a part the field's value does not have. */
function fieldPartConflict(
  keys: readonly string[],
  field: BindingFieldShape | undefined
): FormatCheck | undefined {
  const hidden = partsTheFieldLacks(field);
  return keys.some(key => hidden.parts.has(key))
    ? misfit(hidden.message)
    : undefined;
}

/** Why a date format's options cannot be used together, or for this field. */
function dateOptionProblem(
  keys: readonly string[],
  field: BindingFieldShape | undefined
): FormatCheck | undefined {
  return presetConflict(keys) ?? fieldPartConflict(keys, field);
}

function checkDateFormat(
  format: Readonly<Record<string, unknown>>,
  field: BindingFieldShape | undefined
): FormatCheck {
  if (field !== undefined && bindingKindOf(field) !== "date") {
    return misfit(`A date format cannot format a ${field.type} field.`);
  }
  const read = readOptions(ownEntry(format, "options"), DATE_OPTIONS);
  if ("refused" in read) {
    return invalid(`A date format cannot take "${read.refused}" as it is set.`);
  }
  const problem = dateOptionProblem(Object.keys(read.options), field);
  if (problem !== undefined) return problem;
  return {
    ok: true,
    format: {
      type: "date",
      options: read.options,
      ...(read.locale === undefined ? {} : { locale: read.locale }),
    },
  };
}

function checkNumberFormat(
  format: Readonly<Record<string, unknown>>,
  type: "number" | "currency",
  field: BindingFieldShape | undefined
): FormatCheck {
  if (field !== undefined && bindingKindOf(field) !== "number") {
    return misfit(`A ${type} format cannot format a ${field.type} field.`);
  }
  const read = readOptions(
    ownEntry(format, "options"),
    type === "number" ? NUMBER_OPTIONS : CURRENCY_OPTIONS
  );
  if ("refused" in read) {
    return invalid(
      `A ${type} format cannot take "${read.refused}" as it is set.`
    );
  }
  const locale = read.locale === undefined ? {} : { locale: read.locale };
  if (type === "number") {
    return { ok: true, format: { type, options: read.options, ...locale } };
  }
  const currency = ownEntry(format, "currency");
  if (typeof currency !== "string" || !knownCurrency(currency)) {
    return invalid(
      "A currency format needs a three-letter ISO 4217 code, such as EUR."
    );
  }
  return {
    ok: true,
    format: { type, currency, options: read.options, ...locale },
  };
}

/**
 * A time zone a formatter accepts, or UTC.
 *
 * `valid` is false only for a zone that was given and refused, so a caller can
 * say so; nothing given is UTC by intent.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function safeTimeZone(zone: unknown): {
  readonly zone: string;
  readonly valid: boolean;
} {
  if (zone === undefined || zone === null || zone === "") {
    return { zone: "UTC", valid: true };
  }
  if (typeof zone !== "string") return { zone: "UTC", valid: false };
  try {
    return {
      zone: new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions()
        .timeZone,
      valid: true,
    };
  } catch {
    return { zone: "UTC", valid: false };
  }
}

/** A calendar date as stored by a date picked as a day: `2026-03-29`. */
const DAY_STRING = /^\d{4}-\d{2}-\d{2}$/;
/**
 * An ISO 8601 date-time with its offset, the only text read as an instant.
 * Without a `Z` or an offset, `Date` would read it in the server's own zone,
 * so one stored value would be a different instant on each host.
 */
const INSTANT_STRING =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** How much of a date a value means. */
type DateGranularity = "day" | "month" | "time" | "dateTime";

/** Whether a granularity is a calendar date, with no time of day. */
function isCalendarDate(granularity: DateGranularity): boolean {
  return granularity === "day" || granularity === "month";
}

/**
 * Whether the calendar date a string starts with exists. `Date` rolls an
 * impossible one over, so `2026-02-30` would otherwise read as March 2.
 */
function isRealCalendarDate(value: string): boolean {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** The instant a stored value names, read only from ISO 8601 text or a Date. */
function instantOf(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !isRealCalendarDate(value)) return undefined;
  if (DAY_STRING.test(value)) return new Date(`${value}T00:00:00.000Z`);
  return INSTANT_STRING.test(value) ? new Date(value) : undefined;
}

/**
 * A bound date as an instant and what it means, or nothing for a value that
 * is not a date.
 *
 * Only ISO 8601 text is read: `Date.parse` accepts other forms and reads them
 * in the server's own zone, which is the shift this module exists to avoid.
 * Without a field to say what was picked, a bare day or an instant at exactly
 * UTC midnight is read as a calendar date, which is what a date picked as a
 * day is stored as.
 */
function readDate(
  value: unknown,
  field: BindingFieldShape | undefined
):
  | { readonly instant: Date; readonly granularity: DateGranularity }
  | undefined {
  const instant = instantOf(value);
  if (instant === undefined || Number.isNaN(instant.getTime())) {
    return undefined;
  }
  return { instant, granularity: granularityOf(value, instant, field) };
}

/** Whether an instant falls exactly on a UTC midnight. */
function atUtcMidnight(instant: Date): boolean {
  return instant.getTime() % 86_400_000 === 0;
}

/** What the field says was picked; without one, what the value looks like. */
function granularityOf(
  value: unknown,
  instant: Date,
  field: BindingFieldShape | undefined
): DateGranularity {
  if (field !== undefined) {
    if (field.monthOnly === true) return "month";
    if (field.timeOnly === true) return "time";
    return field.dateOnly === true ? "day" : "dateTime";
  }
  const bareDay = typeof value === "string" && DAY_STRING.test(value);
  return bareDay || atUtcMidnight(instant) ? "day" : "dateTime";
}

/** The machine-readable form of a date of the given granularity. */
function machineForm(instant: Date, granularity: DateGranularity): string {
  const iso = instant.toISOString();
  if (granularity === "day") return iso.slice(0, 10);
  if (granularity === "month") return iso.slice(0, 7);
  // A time of day is stored on a placeholder date in UTC: only its time is
  // meant, as `HH:MM:SS`.
  if (granularity === "time") return iso.slice(11, 19);
  return iso;
}

/**
 * A bound date's machine-readable value, as `<time datetime>` takes it, or
 * nothing for a value that is not a date.
 *
 * A calendar date gives its day (`2026-03-29`) or month (`2026-03`), read in
 * UTC as it is stored; a date-time gives its instant.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function machineDate(
  value: unknown,
  field?: BindingFieldShape
): { readonly datetime: string; readonly dateOnly: boolean } | undefined {
  const date = readDate(value, field);
  if (date === undefined) return undefined;
  return {
    datetime: machineForm(date.instant, date.granularity),
    dateOnly: isCalendarDate(date.granularity),
  };
}

/**
 * Where a page is formatted: its language and the site's time zone.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface FormatEnv {
  readonly locale: string;
  readonly timeZone: string;
}

/**
 * A formatted value: the text, and for a date its machine-readable value.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface FormattedValue {
  readonly text: string;
  readonly date?: { readonly datetime: string; readonly dateOnly: boolean };
}

/**
 * What formatting one value gave: the text, a value the format cannot take,
 * or a formatter the runtime would not build.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type FormatResult =
  | { readonly ok: true; readonly value: FormattedValue }
  | { readonly ok: false; readonly reason: "value" | "formatter" };

/**
 * Formats bound values for one render, building each formatter once.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface BindingFormatter {
  format(
    value: unknown,
    format: CheckedFormat,
    field: BindingFieldShape | undefined
  ): FormatResult;
}

/**
 * A formatter from a cache, built on first use. A build that throws is cached
 * as `null`, so a refused option set is tried once per render, not per value.
 */
function buildOnce<T>(
  cache: Map<string, T | null>,
  key: string,
  make: () => T
): T | null {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let formatter: T | null;
  try {
    formatter = make();
  } catch {
    formatter = null;
  }
  cache.set(key, formatter);
  return formatter;
}

/**
 * A formatter for one render.
 *
 * Each `Intl` formatter is built once per language, zone and option set and
 * reused, since a list of a hundred entries formats the same way a hundred
 * times. Building happens only inside `try`, after the format's options were
 * checked, so a runtime that still refuses one answers `formatter` rather than
 * throwing into the page.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function createBindingFormatter(env: FormatEnv): BindingFormatter {
  const dates = new Map<string, Intl.DateTimeFormat | null>();
  const numbers = new Map<string, Intl.NumberFormat | null>();

  const formatDate = (
    value: unknown,
    format: Extract<CheckedFormat, { type: "date" }>,
    field: BindingFieldShape | undefined
  ): FormatResult => {
    const date = readDate(value, field);
    if (date === undefined) return { ok: false, reason: "value" };
    const locale = format.locale ?? env.locale;
    // A calendar date and a time of day have no time zone of their own and
    // are stored in UTC, so they are read in UTC; an instant is shown in the
    // site's zone.
    const timeZone = date.granularity === "dateTime" ? env.timeZone : "UTC";
    const options = withDefaultParts(format.options, date.granularity);
    const formatter = buildOnce(
      dates,
      JSON.stringify([locale, timeZone, options]),
      () => new Intl.DateTimeFormat(locale, { ...options, timeZone })
    );
    if (formatter === null) return { ok: false, reason: "formatter" };
    try {
      return {
        ok: true,
        value: {
          text: formatter.format(date.instant),
          date: {
            datetime: machineForm(date.instant, date.granularity),
            dateOnly: isCalendarDate(date.granularity),
          },
        },
      };
    } catch {
      return { ok: false, reason: "formatter" };
    }
  };

  const formatNumber = (
    value: unknown,
    format: Exclude<CheckedFormat, { type: "date" }>
  ): FormatResult => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, reason: "value" };
    }
    const locale = format.locale ?? env.locale;
    const currency =
      format.type === "currency"
        ? { style: "currency" as const, currency: format.currency }
        : {};
    const formatter = buildOnce(
      numbers,
      JSON.stringify([locale, currency, format.options]),
      () => new Intl.NumberFormat(locale, { ...format.options, ...currency })
    );
    if (formatter === null) return { ok: false, reason: "formatter" };
    try {
      return { ok: true, value: { text: formatter.format(value) } };
    } catch {
      return { ok: false, reason: "formatter" };
    }
  };

  return {
    format: (value, format, field) =>
      format.type === "date"
        ? formatDate(value, format, field)
        : formatNumber(value, format),
  };
}
