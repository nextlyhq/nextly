/**
 * How a refusal or a failure becomes a tool's answer.
 *
 * Every refusal is a tool error (`isError: true`), never a protocol error, so
 * the agent reads it and can act on it. Its text names core's error code,
 * says in one or two plain sentences what to do next, and carries the request
 * ID; its structured content carries the same, beside core's public JSON for
 * the error. The text is built only from constants and from names the caller
 * may use: a `NextlyError`'s public message stays in the structured content,
 * since some quote stored values, and stored text is never written into the
 * answer's own words.
 *
 * Anything that is not a `NextlyError` is answered as core's internal error,
 * and logged by its kind and call frames only: a driver's or a network
 * error's message can quote a connection string or a token, and a stack's
 * first line repeats that message.
 *
 * @module errors
 * @experimental
 */
import { randomUUID } from "node:crypto";

import type { CallToolResult } from "@modelcontextprotocol/server";
import {
  NextlyError,
  type NextlyErrorCode,
  type NextlyErrorResponseJSON,
} from "nextly/errors";

/** Where a tool's unexpected failures are written. */
export interface ToolLogger {
  error(message: string, context: Record<string, unknown>): void;
}

/** What to do next, for the codes whose advice is more exact than their status's. */
const NEXT_BY_CODE: Readonly<Partial<Record<NextlyErrorCode, string>>> = {
  STALE_VERSION:
    "The item changed since the version you sent. Read it again and make the change against what you read.",
  VERSION_REQUIRED:
    "This change must say which version of the item it changes. Read the item and send its version back with the change.",
  RATE_LIMITED:
    "Too many requests in a short time. Wait (for `error.data.retryAfterSeconds`, where given), then call again.",
  PAYLOAD_TOO_LARGE:
    "The call or its answer is too large. Send less in one call, or ask for less: fewer fields, a smaller page or a filter.",
  NOT_FOUND:
    "Nothing by that name or ID exists, or this connection may not see it. Check the name or ID, looking it up with a list or find tool first.",
  AUTH_REQUIRED:
    "This call needs a signed-in person. Ask the person to connect this app again, then call again.",
  TOKEN_EXPIRED:
    "The sign-in this connection uses has expired. Ask the person to connect this app again, then call again.",
};

/** What to do next for each status, when the code has no advice of its own. */
const NEXT_BY_STATUS: Readonly<Record<number, string>> = {
  400: "Check the input against the tool's input schema, fix what `error.data` names, and call again.",
  401: "This connection is not signed in. Ask the person to connect this app again, then call again.",
  403: "The person this connection acts for may not do this. Do something the connection allows, or ask a site owner for the access.",
  404: NEXT_BY_CODE.NOT_FOUND ?? "",
  405: "This action isn't available on this item. Use a tool meant for it.",
  409: "The item changed, is busy, or clashes with another. Read it again, then retry with what you read.",
  410: "That has expired or was already used. Call the tool that issued it again to get a new one.",
  413: NEXT_BY_CODE.PAYLOAD_TOO_LARGE ?? "",
  415: "That kind of file or content isn't accepted here. Send one the tool's description allows.",
  416: "The range asked for is outside the item. Ask for a range inside it.",
  422: "The call breaks one of the site's rules. Change the input so it meets the rule `error.data` names, then call again.",
  428: NEXT_BY_CODE.VERSION_REQUIRED ?? "",
  429: NEXT_BY_CODE.RATE_LIMITED ?? "",
};

/** What to do next when the site failed, whatever its status. */
const NEXT_ON_FAILURE =
  "The site couldn't finish this. Try again in a moment; if it keeps failing, give the site owner the request ID.";

/** What to do next for a status nothing more exact covers. */
const NEXT_OTHERWISE =
  "The call was refused. Read `error.code` and `error.data`, change the call, and try again.";

/** What to do next after an error with `code` and HTTP `status`. */
export function nextStepFor(code: string, status: number): string {
  const byCode = (NEXT_BY_CODE as Readonly<Record<string, string | undefined>>)[
    code
  ];
  if (byCode !== undefined) return byCode;
  return (
    NEXT_BY_STATUS[status] ?? (status >= 500 ? NEXT_ON_FAILURE : NEXT_OTHERWISE)
  );
}

/** The number of single-letter insertions, deletions and changes that turn `a` into `b`. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const change = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(
        Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, change)
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** The most suggestions one refusal names. */
const MAX_SUGGESTIONS = 3;

/**
 * The names in `choices` closest to `name`, at most three, nearest first:
 * those within a few edits (more for a longer name), or that contain it or
 * are contained in it, ignoring case.
 */
export function nearestNames(
  name: string,
  choices: readonly string[]
): string[] {
  const wanted = name.toLowerCase();
  const reach = Math.max(2, Math.floor(wanted.length / 3));
  return [...new Set(choices)]
    .map(choice => {
      const lower = choice.toLowerCase();
      const contains =
        wanted.length > 2 && (lower.includes(wanted) || wanted.includes(lower));
      return { choice, distance: contains ? 0.5 : editDistance(wanted, lower) };
    })
    .filter(({ choice, distance }) => choice !== name && distance <= reach)
    .sort((a, b) => a.distance - b.distance || (a.choice < b.choice ? -1 : 1))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ choice }) => choice);
}

/** The kinds of thing an unknown-name refusal may name, each worded in the answer. */
const UNKNOWN_NAME_KINDS: readonly ["field", "collection", "single", "block"] =
  ["field", "collection", "single", "block"] as const;

export type UnknownNameKind = (typeof UNKNOWN_NAME_KINDS)[number];

/**
 * The shape an operation's refusal takes in `error.data` to name something
 * that doesn't exist, so the answer can suggest names: what kind of thing it
 * is, the name asked for, and the names the caller may use instead. The
 * operation fills `choices` only with names the caller may read, so a
 * suggestion never reveals one they can't.
 */
export interface UnknownNameData {
  readonly unknown: {
    readonly kind: UnknownNameKind;
    readonly name: string;
    readonly choices: readonly string[];
  };
}

function isUnknownNameKind(value: unknown): value is UnknownNameKind {
  return (UNKNOWN_NAME_KINDS as readonly unknown[]).includes(value);
}

/** The `key` field of `value` when it is an object, else `undefined`. */
function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)[key]
    : undefined;
}

function unknownNameOf(data: unknown): UnknownNameData["unknown"] | undefined {
  const unknown = fieldOf(data, "unknown");
  const kind = fieldOf(unknown, "kind");
  const name = fieldOf(unknown, "name");
  const choices = fieldOf(unknown, "choices");
  // A kind the answer has no words for is read as no unknown name at all.
  if (
    !isUnknownNameKind(kind) ||
    typeof name !== "string" ||
    !Array.isArray(choices)
  ) {
    return undefined;
  }
  const names = choices.filter(
    (choice): choice is string => typeof choice === "string"
  );
  return { kind, name, choices: names };
}

/** A name as inline code, with backticks it holds made harmless. */
function code(name: string): string {
  return `\`${name.replace(/`/g, "'")}\``;
}

/** What the error answer carries in structured content. */
export interface ErrorAnswerData {
  readonly error: NextlyErrorResponseJSON & {
    readonly next: string;
    readonly suggestions?: readonly string[];
  };
}

/** What a caller of {@link errorAnswer} adds to the error itself. */
export interface ErrorAnswerOptions {
  readonly requestId: string;
  readonly logger: ToolLogger;
  /** The tool that failed, for the log. */
  readonly tool: string;
  /** Advice that replaces the code's own, for a refusal the adapter made. */
  readonly next?: string;
  /** Names to suggest when the refusal names nothing itself. */
  readonly suggestions?: readonly string[];
}

/** A line of a stack that names a call frame (`    at …`). */
const FRAME_LINE = /^\s+at\s/;

/**
 * Where `error` was thrown: its stack's call frames, without the message line
 * V8 puts first, which can quote a secret.
 */
function framesOf(error: Error): string[] {
  const frames: string[] = [];
  for (const line of (error.stack ?? "").split("\n")) {
    if (FRAME_LINE.test(line)) frames.push(line.trim());
  }
  return frames;
}

/**
 * `error` as a `NextlyError`: itself, or core's internal error for anything
 * else, which is logged by its kind and call frames, never its message.
 */
function refusalFor(error: unknown, options: ErrorAnswerOptions): NextlyError {
  if (NextlyError.is(error)) return error;
  options.logger.error("@nextlyhq/mcp: a tool failed", {
    requestId: options.requestId,
    tool: options.tool,
    error:
      error instanceof Error
        ? { name: error.name, frames: framesOf(error) }
        : { type: typeof error },
  });
  return NextlyError.internal();
}

/** The answer's line about close names, or none when it has none to name. */
function suggestionLine(
  unknown: UnknownNameData["unknown"] | undefined,
  suggestions: readonly string[]
): string | undefined {
  const close = suggestions.map(code).join(", ");
  if (!unknown)
    return suggestions.length > 0
      ? `Close names you may use: ${close}.`
      : undefined;
  const missing = `No ${unknown.kind} is called ${code(unknown.name)}`;
  return suggestions.length > 0
    ? `${missing}. Close names you may use: ${close}.`
    : `${missing}, and none you may use is close to it.`;
}

/** The tool error answering `error`. */
export function errorAnswer(
  error: unknown,
  options: ErrorAnswerOptions
): CallToolResult {
  const { requestId } = options;
  const refusal = refusalFor(error, options);
  const json = refusal.toResponseJSON(requestId);
  const next = options.next ?? nextStepFor(json.code, refusal.statusCode);
  const unknown = unknownNameOf(json.data);
  const suggestions = unknown
    ? nearestNames(unknown.name, unknown.choices)
    : [...(options.suggestions ?? [])];
  const close = suggestionLine(unknown, suggestions);
  const lines = [
    `**Refused: ${code(json.code)}**`,
    "",
    next,
    ...(close === undefined ? [] : ["", close]),
    "",
    `Request ID: ${code(requestId)}. \`structuredContent.error\` has the same, with the details as data.`,
  ];
  const data: ErrorAnswerData = {
    error: {
      ...json,
      next,
      ...(suggestions.length > 0 ? { suggestions } : {}),
    },
  };
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: { ...data },
    isError: true,
  };
}

/** A fresh request ID, for a door that has none of its own. */
export function newRequestId(): string {
  return randomUUID();
}
