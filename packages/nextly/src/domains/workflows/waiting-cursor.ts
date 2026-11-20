/**
 * The waiting list's cursor: an opaque position in the list's order (entry into the stage, then the
 * review state's own key), handed out as `meta.nextBefore` and taken back as `before`. Clients
 * never read it; they pass it back as it came. Inside, it is the position of the last review state
 * a page consumed, so the next request reads from just past it.
 */
import { z } from "zod";

/**
 * A place in the waiting list's order: a review state's entry into its stage and its key (a
 * lowercase hex digest, unique per part), which together order every part exactly once.
 *
 * @experimental
 */
export interface WaitingPosition {
  enteredAt: Date;
  partKey: string;
}

/**
 * The latest entry time a cursor may name: the end of 9999, the last moment MySQL's `datetime` holds
 * (PostgreSQL's `timestamptz` and SQLite's integer seconds hold more). A position past it could
 * never have been handed out, and reading from it would ask a database for a time it can't store.
 */
const LATEST_ENTRY_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

/** What a cursor carries, once decoded: the entry time in milliseconds, and the part's key. */
const EncodedPosition = z
  .object({
    at: z.number().int().min(0).max(LATEST_ENTRY_MS),
    key: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

/** The decoded body of a token, or undefined where it is not base64url JSON. */
function decodedBody(token: string): unknown {
  // Base64url only: Node decodes any other character by skipping it, which would let two different
  // tokens name one position.
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return undefined;
  try {
    return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

/**
 * The cursor for `position`: opaque to clients, who pass it back as `before`.
 *
 * @experimental
 */
export function encodeWaitingCursor(position: WaitingPosition): string {
  return Buffer.from(
    JSON.stringify({ at: position.enteredAt.getTime(), key: position.partKey }),
    "utf8"
  ).toString("base64url");
}

/**
 * `before` as a request carries it: an opaque position from `nextBefore`, read back. Text that is
 * not a well-formed position, or names a time no review state can hold, is refused as invalid
 * input, never read as the list's start. The token is not signed: a hand-made position only moves
 * where the caller's own read starts, and every row it reaches is still checked for their access.
 *
 * @experimental
 */
export const WaitingCursor = z
  .string()
  .trim()
  .min(1)
  .transform((token, ctx): WaitingPosition => {
    const parsed = EncodedPosition.safeParse(decodedBody(token));
    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        message:
          "before takes the nextBefore of an earlier page of this list, passed back as it came.",
      });
      return z.NEVER;
    }
    return { enteredAt: new Date(parsed.data.at), partKey: parsed.data.key };
  });
