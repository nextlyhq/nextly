/**
 * Request-parameter validation and coercion helpers shared by every
 * domain dispatcher.
 *
 * Query params arrive as strings; handler code needs numbers, booleans,
 * dates, parsed JSON objects, and validated enum values. These helpers
 * centralize that parsing so each handler stays focused on business
 * logic.
 */

import { NextlyError } from "../../errors";
import type { RichTextOutputFormat } from "../../lib/rich-text-html";
import type { StatusOption } from "../../lib/status-filter";
import { readSelectParam } from "../../query/select-param";
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
 * The select map a request asked for, or nothing when it asked for no
 * projection.
 *
 * REFUSES a select it cannot read, rather than falling back to the whole
 * document. Those two answers were the same value here, so a caller who wrote
 * the parameter in any shape but the one accepted got a correct-looking
 * response carrying every field of every row — the format has no writer that
 * callers could reach, so working it out wrong was the normal case rather than
 * the exceptional one. See ../../query/select-param, which is now that writer.
 */
export const parseSelectParam = (
  selectParam?: string
): Record<string, boolean> | undefined => {
  const request = readSelectParam(selectParam);
  if (request.kind === "unreadable") {
    throw NextlyError.invalidInput({
      message: request.reason,
      logContext: { param: "select" },
    });
  }
  return request.kind === "fields" ? request.fields : undefined;
};

/**
 * Parse a JSON-encoded where clause from a query string parameter.
 * The key[op]=value query-param format is parsed elsewhere via
 * `parseWhereQuery` -- this helper handles the JSON form.
 */
/**
 * System owner column (both the snake_case name and the camelCase alias). It is
 * stripped from response payloads, so a client must not be able to filter, sort,
 * or otherwise address rows by it either — otherwise a caller who knows/guesses
 * a user id could learn or target rows by creator through the query controls.
 */
export const OWNER_QUERY_COLUMNS = new Set(["created_by", "createdBy"]);

/**
 * Remove any owner-column condition from a client-supplied `where` tree
 * (recursing through `and`/`or`), so a REST caller cannot filter/count by the
 * system owner column. The service's own owner-only constraint is added
 * separately, downstream of this, and is unaffected.
 */
const stripOwnerFromWhere = (node: unknown): unknown => {
  if (Array.isArray(node)) {
    return node
      .map(stripOwnerFromWhere)
      .filter(
        n => n != null && (typeof n !== "object" || Object.keys(n).length > 0)
      );
  }
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>
    )) {
      // Drop an owner-column filter. A dotted key like `created_by.any` still
      // targets the owner column because the query builder keys on the first
      // path segment (`column.split(".")[0]`), so match on that segment — not
      // just the exact key — or the dotted form would slip through.
      if (OWNER_QUERY_COLUMNS.has(key.split(".")[0])) continue;
      if (key === "and" || key === "or") {
        const arr = stripOwnerFromWhere(value);
        if (Array.isArray(arr) && arr.length > 0) out[key] = arr;
      } else {
        out[key] = value; // a field condition — its op object is not a field
      }
    }
    return out;
  }
  return node;
};

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
    return stripOwnerFromWhere(parsed) as WhereFilter;
  } catch {
    return undefined;
  }
};

/**
 * Strip owner-column conditions from an already-parsed client `where` object.
 * The JSON query-string path goes through {@link parseWhereParam}; this covers
 * the request-body path (e.g. the bulk-update-by-query handler reads
 * `body.where` directly) so a client cannot target rows by the system owner
 * column via the body either. Returns `undefined` unchanged.
 */
export const stripOwnerColumnsFromWhere = (
  where: WhereFilter | undefined
): WhereFilter | undefined =>
  where === undefined ? undefined : (stripOwnerFromWhere(where) as WhereFilter);

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

/**
 * Parse the `?status=` read filter. Absent (or empty) resolves to `undefined`,
 * so the query service applies its published-only default for untrusted callers
 * (a trusted `overrideAccess` call still sees every status). A recognized value
 * passes through. An UNRECOGNIZED value is REJECTED with a 400 rather than
 * silently widened to "all" or narrowed to the default — silent widening on bad
 * input is a draft-leak, and a typo must never quietly change what a read
 * returns.
 */
export const parseStatusParam = (
  statusParam?: unknown
): StatusOption | undefined => {
  if (statusParam === undefined || statusParam === null || statusParam === "") {
    return undefined;
  }
  if (
    statusParam === "all" ||
    statusParam === "draft" ||
    statusParam === "published"
  ) {
    return statusParam;
  }
  throw NextlyError.validation({
    errors: [
      {
        path: "status",
        code: "INVALID_VALUE",
        message: 'Invalid status filter. Use "all", "draft", or "published".',
      },
    ],
    logContext: { param: "status", value: statusParam },
  });
};

/**
 * Coerce a boolean-ish query param (`?flag=1`, `?flag=true`) to `true`. Query values arrive as
 * strings; `1`/`true`/`yes` (any case) are truthy, everything else (including absent) is `false`.
 */
export const isTruthyParam = (value?: unknown): boolean => {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
};
