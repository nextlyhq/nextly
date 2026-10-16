/**
 * Request-parameter validation and coercion helpers shared by every
 * domain dispatcher.
 *
 * Query params arrive as strings; handler code needs numbers, booleans,
 * dates, parsed JSON objects, and validated enum values. These helpers
 * centralize that parsing so each handler stays focused on business
 * logic.
 */

import {
  filterShapeProblems,
  refuseFilterProblems,
  type FilterProblem,
} from "../../domains/collections/query/filter-shape";
import { NextlyError } from "../../errors";
import type { RichTextOutputFormat } from "../../lib/rich-text-html";
import type { StatusOption } from "../../lib/status-filter";
import { readSelectParam } from "../../query/select-param";
import type { WhereFilter } from "../../services/collections/query-operators";
import { parseWhereQuery } from "../../services/collections/query-parser";
import { toSnakeCase } from "../../shared/lib/case-conversion";
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
 * System owner column (both the snake_case name and the camelCase alias). It is
 * stripped from response payloads, so a client must not be able to filter, sort,
 * or otherwise address rows by it either — otherwise a caller who knows/guesses
 * a user id could learn or target rows by creator through the query controls.
 */
export const OWNER_QUERY_COLUMNS = new Set(["created_by", "createdBy"]);

/**
 * Whether a filter key reaches the owner column. Judged by its first segment
 * under the same snake_case mapping the condition builder resolves a column
 * by, so `CreatedBy` — which that mapping turns into `created_by` — is caught
 * as well as the two documented spellings.
 */
function namesOwnerColumn(key: string): boolean {
  const head = key.split(".")[0];
  return (
    OWNER_QUERY_COLUMNS.has(head) || OWNER_QUERY_COLUMNS.has(toSnakeCase(head))
  );
}

/**
 * Every place a client filter names the system owner column, as a refusal.
 *
 * A dotted key like `created_by.any` still targets the owner column, because
 * the query builder keys on the first path segment, so the first segment is
 * what is compared — not just the exact key.
 */
function ownerColumnProblems(
  node: unknown,
  path: string,
  into: FilterProblem[]
): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const at = `${path}.${key}`;
    if ((key === "and" || key === "or") && Array.isArray(value)) {
      value.forEach((child, i) =>
        ownerColumnProblems(child, `${at}.${i}`, into)
      );
    } else if (namesOwnerColumn(key)) {
      into.push({
        path: at,
        code: "FIELD_NOT_FILTERABLE",
        message:
          "Entries cannot be filtered by who created them. That column is never returned, so it cannot be used to choose rows either.",
      });
    }
  }
}

/**
 * A client-supplied `where`, checked: refused unless it is a well-formed
 * filter that names no owner column.
 *
 * Refused rather than repaired. Removing the part the server will not use —
 * which is what happened to an owner condition here before — runs the read
 * under a wider filter than the caller wrote: `or: [{ createdBy: … }]` became
 * no condition at all, and every row matched. Covers the request-body path
 * (the bulk-update-by-query handler reads `body.where` directly) as well as
 * {@link parseWhereParam}. Returns `undefined` unchanged.
 */
export const readClientWhere = (where: unknown): WhereFilter | undefined => {
  if (where === undefined) return undefined;
  const problems = filterShapeProblems(where, { allowTranslated: true });
  ownerColumnProblems(where, "where", problems);
  refuseFilterProblems(problems);
  return where as WhereFilter;
};

/**
 * The filter a REST request carries, from a JSON `where` parameter or from
 * bracket parameters (`where[title][equals]=…`, forwarded unparsed as
 * `whereBrackets` by the route parser), checked by {@link readClientWhere}.
 *
 * A parameter that is present and cannot be parsed answers 400. It used to be
 * read as no filter, so a typo in the JSON returned every row the caller could
 * see instead of the few they asked for. A filter given both ways is refused
 * too: the bracket conditions used to be dropped whenever a JSON `where` was
 * present, so the read ran under part of what the caller wrote.
 */
export const parseWhereParam = (
  whereParam?: string,
  whereBrackets?: string
): WhereFilter | undefined => {
  if (whereBrackets) {
    if (whereParam !== undefined) {
      throw NextlyError.validation({
        errors: [
          {
            path: "where",
            code: "FILTER_GIVEN_TWICE",
            message:
              "Give the filter once: either a JSON where parameter or where[field][operator] parameters, not both.",
          },
        ],
      });
    }
    return readClientWhere(parseWhereQuery(new URLSearchParams(whereBrackets)));
  }
  if (!whereParam) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(whereParam);
  } catch {
    throw NextlyError.validation({
      errors: [
        {
          path: "where",
          code: "FILTER_INVALID_JSON",
          message:
            'The where parameter is not valid JSON. Send a JSON object of field conditions, such as {"status":{"equals":"published"}}.',
        },
      ],
      logContext: { param: "where" },
    });
  }
  return readClientWhere(parsed);
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
