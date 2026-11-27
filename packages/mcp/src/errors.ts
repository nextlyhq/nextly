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

/** What to do next for a status, when the code has no advice of its own. */
function nextForStatus(status: number): string {
  if (status === 400) {
    return "Check the input against the tool's input schema, fix what `error.data` names, and call again.";
  }
  if (status === 401) {
    return "This connection is not signed in. Ask the person to connect this app again, then call again.";
  }
  if (status === 403) {
    return "The person this connection acts for may not do this. Do something the connection allows, or ask a site owner for the access.";
  }
  if (status === 404) return NEXT_BY_CODE.NOT_FOUND ?? "";
  if (status === 405)
    return "This action isn't available on this item. Use a tool meant for it.";
  if (status === 409) {
    return "The item changed, is busy, or clashes with another. Read it again, then retry with what you read.";
  }
  if (status === 410) {
    return "That has expired or was already used. Call the tool that issued it again to get a new one.";
  }
  if (status === 413) return NEXT_BY_CODE.PAYLOAD_TOO_LARGE ?? "";
  if (status === 415) {
    return "That kind of file or content isn't accepted here. Send one the tool's description allows.";
  }
  if (status === 416)
    return "The range asked for is outside the item. Ask for a range inside it.";
  if (status === 422) {
    return "The call breaks one of the site's rules. Change the input so it meets the rule `error.data` names, then call again.";
  }
  if (status === 428) return NEXT_BY_CODE.VERSION_REQUIRED ?? "";
  if (status === 429) return NEXT_BY_CODE.RATE_LIMITED ?? "";
  if (status >= 500) {
    return "The site couldn't finish this. Try again in a moment; if it keeps failing, give the site owner the request ID.";
  }
  return "The call was refused. Read `error.code` and `error.data`, change the call, and try again.";
}

/** What to do next after an error with `code` and HTTP `status`. */
export function nextStepFor(code: string, status: number): string {
  return code in NEXT_BY_CODE
    ? (NEXT_BY_CODE[code as NextlyErrorCode] ?? nextForStatus(status))
    : nextForStatus(status);
}

/** The edit distance between `a` and `b`, counting a swap of two neighbours as one edit. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        (d[i - 1]?.[j] ?? 0) + 1,
        (d[i]?.[j - 1] ?? 0) + 1,
        (d[i - 1]?.[j - 1] ?? 0) + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, (d[i - 2]?.[j - 2] ?? 0) + 1);
      }
      const row = d[i];
      if (row) row[j] = best;
    }
  }
  return d[a.length]?.[b.length] ?? 0;
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

/**
 * The shape an operation's refusal takes in `error.data` to name something
 * that doesn't exist, so the answer can suggest names: what kind of thing it
 * is (a field, a collection, a block), the name asked for, and the names the
 * caller may use instead.
 */
export interface UnknownNameData {
  readonly unknown: {
    readonly kind: string;
    readonly name: string;
    readonly choices: readonly string[];
  };
}

function unknownNameOf(data: unknown): UnknownNameData["unknown"] | undefined {
  if (typeof data !== "object" || data === null || !("unknown" in data))
    return undefined;
  const unknown: unknown = data.unknown;
  if (typeof unknown !== "object" || unknown === null) return undefined;
  const kind = "kind" in unknown ? unknown.kind : undefined;
  const name = "name" in unknown ? unknown.name : undefined;
  const choices = "choices" in unknown ? unknown.choices : undefined;
  if (
    typeof kind !== "string" ||
    typeof name !== "string" ||
    !Array.isArray(choices)
  ) {
    return undefined;
  }
  return {
    kind,
    name,
    choices: choices.filter(
      (choice): choice is string => typeof choice === "string"
    ),
  };
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

/** The call frames of `error`'s stack, without the message line V8 puts first. */
function callFramesOf(error: Error): string[] {
  return (error.stack ?? "")
    .split("\n")
    .filter(line => /^\s+at\s/.test(line))
    .map(line => line.trim());
}

/** The tool error answering `error`. */
export function errorAnswer(
  error: unknown,
  options: ErrorAnswerOptions
): CallToolResult {
  const { requestId } = options;
  let refusal: NextlyError;
  if (NextlyError.is(error)) {
    refusal = error;
  } else {
    options.logger.error("@nextlyhq/mcp: a tool failed", {
      requestId,
      tool: options.tool,
      error:
        error instanceof Error
          ? { name: error.name, frames: callFramesOf(error) }
          : { type: typeof error },
    });
    refusal = NextlyError.internal();
  }
  const json = refusal.toResponseJSON(requestId);
  const next = options.next ?? nextStepFor(json.code, refusal.statusCode);
  const unknown = unknownNameOf(json.data);
  const suggestions = unknown
    ? nearestNames(unknown.name, unknown.choices)
    : [...(options.suggestions ?? [])];

  const lines = [`**Refused: ${code(json.code)}**`, "", next];
  if (unknown) {
    lines.push(
      "",
      suggestions.length > 0
        ? `No ${unknown.kind} is called ${code(unknown.name)}. Close names you may use: ${suggestions.map(code).join(", ")}.`
        : `No ${unknown.kind} is called ${code(unknown.name)}, and none you may use is close to it.`
    );
  } else if (suggestions.length > 0) {
    lines.push(
      "",
      `Close names you may use: ${suggestions.map(code).join(", ")}.`
    );
  }
  lines.push(
    "",
    `Request ID: ${code(requestId)}. \`structuredContent.error\` has the same, with the details as data.`
  );
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
