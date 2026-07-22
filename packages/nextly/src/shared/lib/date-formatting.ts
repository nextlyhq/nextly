import { container } from "../../di/container";
import type { SupportedDialect } from "../../types/database";

// ============================================================================
// Global API Date/Time Formatting Constants
// ============================================================================

export const ISO_DATE_TIME_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

export const MYSQL_DATE_TIME_REGEX =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/;

export const HAS_EXPLICIT_TIMEZONE_REGEX = /(?:Z|[+-]\d{2}:\d{2})$/i;

/**
 * Response header opting a JSON body out of server-side timezone normalization.
 *
 * `withTimezoneFormatting` rewrites any string that looks like a date, by value,
 * not just known timestamp fields. Set this on a response whose body carries
 * opaque captured text that must survive verbatim — a webhook delivery's raw
 * response snippet, for example, which is a debugging record and could itself be
 * a bare date string. Timestamps in such a response are returned in UTC for the
 * client to localize. The header is internal and stripped before the response
 * leaves the formatter.
 */
export const SKIP_TIMEZONE_FORMAT_HEADER = "x-nextly-skip-timezone-format";

// Restrict normalization to known timestamp-like keys to avoid mutating
// user content fields that merely look like dates.
export const TIMESTAMP_KEY_REGEX =
  /(?:^|_)(createdAt|updatedAt|created_at|updated_at|publishedAt|published_at|deletedAt|deleted_at|lastLoginAt|last_login_at|expires|expiresAt|expires_at|date|time|timestamp|at|on)$/i;

// ============================================================================
// Utility Functions
// ============================================================================

export function shouldDebugTimezone(): boolean {
  return process.env.NEXTLY_DEBUG_TIMEZONE === "1";
}

export function debugTimezone(
  stage: string,
  details: Record<string, unknown>
): void {
  if (!shouldDebugTimezone()) return;
  console.debug(`[timezone][${stage}]`, details);
}

export function isTimestampFieldKey(key: string | undefined): boolean {
  if (!key) return false;
  return TIMESTAMP_KEY_REGEX.test(key);
}

/**
 * Formats a Date object as an ISO 8601 string with the correct offset for a given timezone.
 * Uses native Intl.DateTimeFormat to avoid heavy date library dependencies.
 */
export function formatIsoWithTimezone(date: Date, timezone: string): string {
  try {
    // 1. Get localized parts (YYYY, MM, DD, HH, mm, ss.SSS)
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      hourCycle: "h23",
    });

    const parts = formatter.formatToParts(date);
    const map: Record<string, string> = {};
    parts.forEach(p => {
      map[p.type] = p.value;
    });

    // Ensure we have all parts, providing defaults if missing
    const year = map.year || date.getFullYear().toString();
    const month =
      map.month || (date.getMonth() + 1).toString().padStart(2, "0");
    const day = map.day || date.getDate().toString().padStart(2, "0");
    const hour = map.hour || date.getHours().toString().padStart(2, "0");
    const minute = map.minute || date.getMinutes().toString().padStart(2, "0");
    const second = map.second || date.getSeconds().toString().padStart(2, "0");
    const fractionalSecond = map.fractionalSecond || "000";

    const isoNoOffset = `${year}-${month}-${day}T${hour}:${minute}:${second}.${fractionalSecond}`;

    // 2. Get numeric offset (e.g., "GMT+5", "GMT-07:00")
    const offsetFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    });
    const offsetPart =
      offsetFormatter.formatToParts(date).find(p => p.type === "timeZoneName")
        ?.value || "GMT";

    let formattedOffset = offsetPart.replace("GMT", "").trim();
    if (!formattedOffset || formattedOffset === "Z") return `${isoNoOffset}Z`;

    // Normalize offset to +/-HH:mm format
    if (!formattedOffset.includes(":")) {
      const sign = formattedOffset[0];
      const hours = formattedOffset.substring(1).padStart(2, "0");
      formattedOffset = `${sign}${hours}:00`;
    }

    return `${isoNoOffset}${formattedOffset}`;
  } catch (_error) {
    // Fallback to UTC if timezone is invalid or unsupported
    return date.toISOString();
  }
}

export function normalizeTimestampString(
  value: string,
  timezone?: string | null
): string {
  if (!ISO_DATE_TIME_REGEX.test(value) && !MYSQL_DATE_TIME_REGEX.test(value)) {
    return value;
  }

  const hasExplicitTimezone = HAS_EXPLICIT_TIMEZONE_REGEX.test(value);
  const normalizedInput = MYSQL_DATE_TIME_REGEX.test(value)
    ? value.replace(" ", "T")
    : value;

  // IMPORTANT: If no timezone is provided in the string, we assume UTC.
  const parseInput = hasExplicitTimezone
    ? normalizedInput
    : `${normalizedInput}Z`;
  const parsed = new Date(parseInput);

  if (Number.isNaN(parsed.getTime())) {
    debugTimezone("parse-failed", {
      raw: value,
      parseInput,
      reason: "Invalid Date",
    });
    return value;
  }

  // If a timezone is configured, return the string with the correct offset
  if (timezone) {
    const localized = formatIsoWithTimezone(parsed, timezone);
    debugTimezone("localized", {
      raw: value,
      timezone,
      localized,
    });
    return localized;
  }

  const normalized = parsed.toISOString();
  debugTimezone("normalized", {
    raw: value,
    parseInput,
    normalized,
    hasExplicitTimezone,
  });

  return normalized;
}

/**
 * Normalize a value from the database into a standard ISO 8601 UTC string.
 *
 * Crucial for dynamic tables where the DB driver might parse
 * naive datetime strings using the server's local timezone.
 *
 * @param value - The value from the database (Date, string, or unknown)
 * @returns Optimized ISO string with explicit UTC 'Z' offset
 */
export function normalizeDbTimestamp(value: unknown): string | null {
  if (value == null) return null;

  // 1. If it's a Date object, it likely reflects the driver's local parsing.
  // We re-interpret the local parts as UTC to undo the shift.
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;

    // Use Date.UTC with local parts to "un-offset" the date.
    // If DB had 08:00, driver parsed as 08:00 Local (+5).
    // value.getHours() is 08. Date.UTC(..., 08) creates 08:00 UTC.
    const utcDate = new Date(
      Date.UTC(
        value.getFullYear(),
        value.getMonth(),
        value.getDate(),
        value.getHours(),
        value.getMinutes(),
        value.getSeconds(),
        value.getMilliseconds()
      )
    );
    return utcDate.toISOString();
  }

  // 2. If it's a string, we check for an explicit offset.
  if (typeof value === "string") {
    const trimmed = value.trim();
    // If it looks like 'YYYY-MM-DD HH:MM:SS' (MySQL/Postgres naive format) with no Z/+/- offset:
    // We explicitly append 'Z' to treat it as UTC.
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
      const normalized = trimmed.replace(" ", "T");
      return `${normalized}Z`;
    }

    // If it's already an ISO string or has an offset, Date(value) handles it correctly.
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(value);
}

/**
 * Recover the correct instant from a database timestamp `Date`, across dialects.
 *
 * SQLite stores timestamps as epoch integers, so its driver builds a `Date` that
 * already holds the right instant — it is returned unchanged. Postgres
 * (`timestamp without time zone`) and MySQL (`datetime`) are naive columns whose
 * drivers construct a `Date` from the stored calendar fields in the server's
 * local timezone; that `Date`'s UTC value is therefore shifted by the local
 * offset. Its calendar fields are reinterpreted as UTC to recover the stored
 * instant, so later JSON serialization emits the correct time on a non-UTC
 * server instead of one shifted by the server's timezone.
 *
 * Unlike {@link normalizeDbTimestamp} (which assumes every `Date` is naive and
 * always un-offsets), this is dialect-aware and safe for SQLite.
 */
export function dbTimestampToInstant(
  value: Date,
  dialect: SupportedDialect
): Date;
export function dbTimestampToInstant(
  value: Date | null,
  dialect: SupportedDialect
): Date | null;
export function dbTimestampToInstant(
  value: Date | null,
  dialect: SupportedDialect
): Date | null {
  if (value == null) return null;
  if (Number.isNaN(value.getTime())) return null;
  // SQLite's epoch-backed Date is already the correct instant.
  if (dialect === "sqlite") return value;
  // Postgres/MySQL naive Date: reinterpret its local calendar fields as UTC.
  return new Date(
    Date.UTC(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
      value.getMilliseconds()
    )
  );
}

export function normalizeTimestampsInPayload(
  value: unknown,
  timezone: string | null,
  currentKey?: string
): unknown {
  // Normalize if either the key matches our timestamp pattern OR the value itself
  // looks like a date string (ISO or MySQL format).
  if (typeof value === "string") {
    const isKnownDateKey = isTimestampFieldKey(currentKey);
    const looksLikeDateValue =
      ISO_DATE_TIME_REGEX.test(value) || MYSQL_DATE_TIME_REGEX.test(value);

    if (isKnownDateKey || looksLikeDateValue) {
      return normalizeTimestampString(value, timezone);
    }
  }

  if (Array.isArray(value)) {
    return value.map(item => normalizeTimestampsInPayload(item, timezone));
  }

  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, nested] of Object.entries(input)) {
      output[key] = normalizeTimestampsInPayload(nested, timezone, key);
    }

    return output;
  }

  return value;
}

/**
 * Higher-order function to apply timezone formatting to a JSON response.
 */
export async function withTimezoneFormatting(
  response: Response
): Promise<Response> {
  // Opt-out: a handler marked this body as carrying opaque text that must not be
  // rewritten. Checked first, before any early return, so the internal marker is
  // always stripped and never reaches the client (even on a non-JSON body).
  if (response.headers.get(SKIP_TIMEZONE_FORMAT_HEADER) === "1") {
    const headers = new Headers(response.headers);
    headers.delete(SKIP_TIMEZONE_FORMAT_HEADER);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return response;
  }

  // Keep error payloads untouched to avoid accidental message mutation.
  if (response.status >= 400) {
    return response;
  }

  let parsed: unknown;
  try {
    parsed = await response.clone().json();
  } catch {
    return response;
  }

  let timezone: string | null = null;
  try {
    if (container.has("generalSettingsService")) {
      const svc = container.get<{ getTimezone(): Promise<string | null> }>(
        "generalSettingsService"
      );
      timezone = await svc.getTimezone();
    }
  } catch (_err) {
    // Fall back to system default below
  }

  // If no timezone is explicitly configured in settings, keep payloads in UTC
  // so browser-side formatters can apply the user's local timezone consistently.
  const activeTimezone = timezone ?? null;

  const transformed = normalizeTimestampsInPayload(parsed, activeTimezone);

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json");

  return new Response(JSON.stringify(transformed), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
