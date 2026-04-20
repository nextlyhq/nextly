export interface GlobalDateTimeConfig {
  timezone?: string;
  dateFormat?: string;
  timeFormat?: string;
  locale?: string;
}

export interface GlobalFormatDateOptions extends Intl.DateTimeFormatOptions {
  locale?: string;
}

const DATE_OPTION_KEYS: Array<keyof Intl.DateTimeFormatOptions> = [
  "weekday",
  "era",
  "year",
  "month",
  "day",
  "dateStyle",
];

const TIME_OPTION_KEYS: Array<keyof Intl.DateTimeFormatOptions> = [
  "hour",
  "minute",
  "second",
  "timeStyle",
  "hour12",
];

const ISO_DATE_TIME_WITH_OPTIONAL_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

const MYSQL_DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/;

const HAS_EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;

let activeConfig: GlobalDateTimeConfig = {};

function isValidTimezone(timezone: string | undefined): boolean {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function resolveLocalTimezone(): string | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimezone(localTimezone) ? localTimezone : undefined;
  } catch {
    return undefined;
  }
}

function shouldDebugTimezone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("NEXTLY_TZ_DEBUG") === "1";
  } catch {
    return false;
  }
}

function debugTimezone(stage: string, details: Record<string, unknown>): void {
  if (!shouldDebugTimezone()) return;
  console.debug(`[timezone][${stage}]`, details);
}

function hasAnyOptions(
  options: Intl.DateTimeFormatOptions,
  keys: Array<keyof Intl.DateTimeFormatOptions>
): boolean {
  return keys.some(key => options[key] !== undefined);
}

function buildConfiguredDateString(
  date: Date,
  locale: string,
  timezone: string | undefined,
  configuredFormat: string | undefined
): string | null {
  if (!configuredFormat) return null;

  const numericParts = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = numericParts.find(p => p.type === "year")?.value;
  const month = numericParts.find(p => p.type === "month")?.value;
  const day = numericParts.find(p => p.type === "day")?.value;

  if (!year || !month || !day) return null;

  switch (configuredFormat) {
    case "MM/DD/YYYY":
      return `${month}/${day}/${year}`;
    case "DD/MM/YYYY":
      return `${day}/${month}/${year}`;
    case "YYYY-MM-DD":
      return `${year}-${month}-${day}`;
    case "DD.MM.YYYY":
      return `${day}.${month}.${year}`;
    case "MMM DD, YYYY": {
      const shortMonth = new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        month: "short",
      }).format(date);
      return `${shortMonth} ${day}, ${year}`;
    }
    default:
      return null;
  }
}

function buildConfiguredTimeString(
  date: Date,
  locale: string,
  timezone: string | undefined,
  options: Intl.DateTimeFormatOptions,
  configuredTimeFormat: string | undefined
): string {
  const forceHour12 =
    configuredTimeFormat === "12h"
      ? true
      : configuredTimeFormat === "24h"
        ? false
        : undefined;

  if (options.timeStyle) {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      timeStyle: options.timeStyle,
      hour12: forceHour12 ?? options.hour12,
    }).format(date);
  }

  const showSeconds = options.second !== undefined;

  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: options.hour ?? "2-digit",
    minute: options.minute ?? "2-digit",
    ...(showSeconds ? { second: options.second } : {}),
    hour12: forceHour12 ?? options.hour12,
  }).format(date);
}

function parseDateInput(value: string | number | Date): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const raw = value.trim();
  if (!raw) return null;

  const normalizedInput = MYSQL_DATE_TIME.test(raw)
    ? raw.replace(" ", "T")
    : raw;

  const parseInput =
    ISO_DATE_TIME_WITH_OPTIONAL_ZONE.test(normalizedInput) &&
    !HAS_EXPLICIT_TIMEZONE.test(normalizedInput)
      ? `${normalizedInput}Z`
      : normalizedInput;

  const parsed = new Date(parseInput);
  if (Number.isNaN(parsed.getTime())) {
    debugTimezone("parse-failed", { raw, parseInput });
    return null;
  }

  debugTimezone("parsed", {
    raw,
    parseInput,
    iso: parsed.toISOString(),
  });

  return parsed;
}

export function setGlobalDateTimeConfig(config: GlobalDateTimeConfig): void {
  activeConfig = { ...config };
}

export function getGlobalDateTimeConfig(): GlobalDateTimeConfig {
  return activeConfig;
}

export function formatGlobalDateTime(
  value: string | number | Date | null | undefined,
  options: GlobalFormatDateOptions = {},
  fallback: string = "N/A"
): string {
  if (!value) return fallback;
  const configuredTimezone = isValidTimezone(activeConfig.timezone)
    ? activeConfig.timezone
    : undefined;

  const parsed = parseDateInput(value);
  if (!parsed) return fallback;

  const { locale: localeFromOptions, ...intlOptions } = options;
  const locale = localeFromOptions ?? activeConfig.locale ?? "en-US";
  const explicitTimezone = isValidTimezone(intlOptions.timeZone)
    ? intlOptions.timeZone
    : undefined;
  const timezone =
    explicitTimezone ?? configuredTimezone ?? resolveLocalTimezone();

  const hasDate = hasAnyOptions(intlOptions, DATE_OPTION_KEYS);
  const hasTime = hasAnyOptions(intlOptions, TIME_OPTION_KEYS);

  const useDate = hasDate || (!hasDate && !hasTime);
  const useTime = hasTime || (!hasDate && !hasTime);

  let datePart: string | undefined;
  let timePart: string | undefined;

  if (useDate) {
    datePart =
      buildConfiguredDateString(
        parsed,
        locale,
        timezone,
        activeConfig.dateFormat
      ) ?? undefined;

    if (!datePart) {
      const dateIntlOptions: Intl.DateTimeFormatOptions = intlOptions.dateStyle
        ? {
            timeZone: timezone,
            dateStyle: intlOptions.dateStyle,
          }
        : {
            timeZone: timezone,
            weekday: intlOptions.weekday,
            era: intlOptions.era,
            year: intlOptions.year ?? "numeric",
            month: intlOptions.month ?? "short",
            day: intlOptions.day ?? "numeric",
          };

      datePart = new Intl.DateTimeFormat(locale, {
        ...dateIntlOptions,
      }).format(parsed);
    }
  }

  if (useTime) {
    timePart = buildConfiguredTimeString(
      parsed,
      locale,
      timezone,
      {
        ...intlOptions,
        hour: intlOptions.hour ?? "2-digit",
        minute: intlOptions.minute ?? "2-digit",
      },
      activeConfig.timeFormat
    );
  }

  const formatted =
    datePart && timePart
      ? `${datePart} ${timePart}`
      : (datePart ?? timePart ?? fallback);

  debugTimezone("formatted", {
    raw: value instanceof Date ? value.toISOString() : String(value),
    timezone,
    timezoneSource: configuredTimezone ? "settings" : "browser-local",
    locale,
    dateFormat: activeConfig.dateFormat,
    timeFormat: activeConfig.timeFormat,
    output: formatted,
  });

  return formatted;
}

export function formatGlobalDateOnly(
  value: string | number | Date | null | undefined,
  fallback: string = "N/A"
): string {
  return formatGlobalDateTime(
    value,
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: undefined,
      minute: undefined,
      second: undefined,
    },
    fallback
  );
}

/**
 * Formats a date string or Date object into a human-readable format with time.
 */
export function formatDateTime(
  dateValue?: string | number | Date,
  options?: Intl.DateTimeFormatOptions
): string {
  return formatGlobalDateTime(
    dateValue,
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      ...options,
    },
    "N/A"
  );
}

/**
 * Formats a date string or Date object into a human-readable format without time.
 */
export function formatDateOnly(dateValue?: string | number | Date): string {
  return formatDateTime(dateValue, {
    hour: undefined,
    minute: undefined,
    second: undefined,
  });
}
