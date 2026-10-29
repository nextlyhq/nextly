/**
 * Reading a thrown value's own words, for the Why line of an error.
 *
 * @module cli/errors/messages
 */

import { immediateMessage } from "../../errors/describe-error";

/** How far a cause chain is followed: the database path alone nests four deep. */
const MAX_DEPTH = 5;

/**
 * The deepest message in `cause`'s chain, or undefined when it has none.
 *
 * The deepest link names the fault: a driver says "no such column: localized" where every wrapper
 * above it says "Failed query". A wrapper that only repeats it adds nothing.
 */
export function deepestMessage(cause: unknown): string | undefined {
  let found: string | undefined;
  let current: unknown = cause;
  for (let depth = 0; depth < MAX_DEPTH && current != null; depth += 1) {
    const message = immediateMessage(current).trim();
    if (message.length > 0) found = message;
    current = current instanceof Error ? current.cause : undefined;
  }
  return found;
}

/**
 * `error`'s own message with the deepest cause after it, each said once.
 *
 * For an error no code anticipated: the message says where it failed and the cause what failed,
 * and a cause that repeats the message, or is part of it, is dropped.
 */
export function messageWithCause(message: string, cause: unknown): string {
  const deepest = deepestMessage(cause);
  if (deepest === undefined || message.includes(deepest)) return message;
  if (deepest.includes(message)) return deepest;
  // "Failed query: no such column" — a colon where the message has no stop of its own.
  return /[.!?:]$/.test(message)
    ? `${message} ${deepest}`
    : `${message}: ${deepest}`;
}
