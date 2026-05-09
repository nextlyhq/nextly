/**
 * Request-parameter validation and coercion helpers shared by every
 * domain dispatcher.
 *
 * Query params arrive as strings; handler code needs numbers, booleans,
 * dates, parsed JSON objects, and validated enum values. These helpers
 * centralize that parsing so each handler stays focused on business
 * logic.
 */

import type { RichTextOutputFormat } from "../../lib/rich-text-html";
import type { WhereFilter } from "../../services/collections/query-operators";
import type { Params } from "../types";

// ============================================================
// Required-value guards
// ============================================================

/** Throws if the required parameter is missing. */
export function requireParam(p: Params, key: string, label?: string): string {
  if (!p[key]) throw new Error(`${label ?? key} parameter is required`);
  return p[key];
}

/** Throws if the required body is missing; otherwise returns it cast to `T`. */
export function requireBody<T>(body: unknown, errorMsg: string): T {
  if (!body) throw new Error(errorMsg);
  return body as T;
}

/** Throws if a named field is missing on `body`. */
export function requireBodyField<T extends Record<string, unknown>>(
  body: unknown,
  field: keyof T,
  errorMsg: string
): T {
  const b = body as T | undefined;
  if (!b || !b[field]) throw new Error(errorMsg);
  return b;
}

// ============================================================
// Type coercion
// ============================================================

export const toNumber = (v?: string): number | undefined =>
  v !== undefined ? Number(v) : undefined;

export const toBoolean = (v?: string): boolean | undefined =>
  v !== undefined ? v === "true" : undefined;

export const toDate = (v?: string): Date | undefined =>
  v ? new Date(v) : undefined;

// ============================================================
// JSON parsing helpers
// ============================================================

/**
 * Parse a JSON-encoded select map from a query string parameter.
 * Returns only keys whose values are booleans so the select object is
 * always a valid field map.
 */
export const parseSelectParam = (
  selectParam?: string
): Record<string, boolean> | undefined => {
  if (!selectParam) return undefined;

  try {
    const parsed: unknown = JSON.parse(selectParam);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return undefined;
    }
    const result: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") {
        result[key] = value;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Parse a JSON-encoded where clause from a query string parameter.
 * The key[op]=value query-param format is parsed elsewhere via
 * `parseWhereQuery` -- this helper handles the JSON form.
 */
export const parseWhereParam = (
  whereParam?: string
): WhereFilter | undefined => {
  if (!whereParam) return undefined;

  try {
    const parsed: unknown = JSON.parse(whereParam);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return undefined;
    }
    return parsed as WhereFilter;
  } catch {
    return undefined;
  }
};

// ============================================================
// Rich text format validation
// ============================================================

const VALID_RICH_TEXT_FORMATS: RichTextOutputFormat[] = [
  "json",
  "html",
  "both",
];

/**
 * Parse and validate a `richTextFormat` query parameter. Returns
 * `undefined` for invalid input, which lets the entry service fall back
 * to its default ("json").
 */
export const parseRichTextFormat = (
  formatParam?: string
): RichTextOutputFormat | undefined => {
  if (!formatParam) return undefined;

  const normalized = formatParam.toLowerCase() as RichTextOutputFormat;
  if (VALID_RICH_TEXT_FORMATS.includes(normalized)) {
    return normalized;
  }
  return undefined;
};
