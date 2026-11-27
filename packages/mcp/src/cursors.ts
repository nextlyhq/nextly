/**
 * Opaque cursors for list tools.
 *
 * An operation pages with a cursor of its own (`page.next`, taken back as
 * `after`). The adapter wraps it in a token that also names the tool and a
 * fingerprint of the call's other inputs, so a cursor from one list can't be
 * sent to another tool, or with different filters, and silently answer with
 * the wrong page. The token is opaque to agents by contract, not by
 * encryption: the operation still checks the cursor it is given, as it does
 * one typed on the command line.
 *
 * @module cursors
 * @experimental
 */
import { createHash } from "node:crypto";

import { AFTER_KEY, FORMAT_KEY, LIMIT_KEY } from "./schemas";

/**
 * Inputs that may change from one page to the next: the page size, the
 * cursor itself, the answer's format and the field choice.
 */
const PAGE_FREE_KEYS: ReadonlySet<string> = new Set([
  LIMIT_KEY,
  AFTER_KEY,
  FORMAT_KEY,
  "fields",
]);

/** `value` as JSON with every object's keys in order, so equal inputs hash equally. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A short fingerprint of the inputs that must stay the same across pages. */
function queryFingerprint(input: Readonly<Record<string, unknown>>): string {
  const query: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (!PAGE_FREE_KEYS.has(key)) query[key] = entry;
  }
  return createHash("sha256")
    .update(canonical(query))
    .digest("base64url")
    .slice(0, 22);
}

interface CursorBody {
  readonly v: 1;
  readonly t: string;
  readonly q: string;
  readonly n: string;
}

function isCursorBody(value: unknown): value is CursorBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    body.v === 1 &&
    typeof body.t === "string" &&
    typeof body.q === "string" &&
    typeof body.n === "string"
  );
}

/** The token an answer hands out for the operation's cursor `next`. */
export function encodeCursor(
  tool: string,
  input: Readonly<Record<string, unknown>>,
  next: string
): string {
  const body: CursorBody = {
    v: 1,
    t: tool,
    q: queryFingerprint(input),
    n: next,
  };
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

/** Why a cursor was refused, in a phrase that follows "The cursor". */
export type CursorProblem =
  | "is not one this server issued"
  | "belongs to another tool"
  | "was issued for different inputs";

/**
 * The operation's cursor inside `token`, or why the token can't be used for
 * this call: it is not one of ours, or it came from another tool or from a
 * call with other inputs.
 */
export function decodeCursor(
  token: string,
  tool: string,
  input: Readonly<Record<string, unknown>>
): { readonly next: string } | { readonly problem: CursorProblem } {
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return { problem: "is not one this server issued" };
  }
  if (!isCursorBody(body)) return { problem: "is not one this server issued" };
  if (body.t !== tool) return { problem: "belongs to another tool" };
  if (body.q !== queryFingerprint(input)) {
    return { problem: "was issued for different inputs" };
  }
  return { next: body.n };
}
