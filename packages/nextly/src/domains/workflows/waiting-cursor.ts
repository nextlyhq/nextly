/**
 * The waiting list's cursor: an opaque position in the list's order, handed out as
 * `meta.nextBefore` and taken back as `before`. Clients never read it; they pass it back as it
 * came. Inside, it is the position of the last part a page consumed, so the next request reads from
 * just past it.
 *
 * The list holds two kinds of part: those with a review state, and those no step has moved yet,
 * which stand in their workflow's first stage with no review state at all. Its order is by time
 * first (a review state's entry into its stage; an unmoved part's document's creation, since it
 * has stood in the first stage ever since), then review states before unmoved parts at the same
 * moment, then each kind by its own key: a review state's key; an unmoved part's collection, its
 * document's id (as the database orders it) and its part. One position in that order says where
 * both kinds go on from.
 *
 * @module domains/workflows/waiting-cursor
 */
import { z } from "zod";

/**
 * A place in the waiting list's order: at a review state (its entry into its stage and its key, a
 * lowercase hex digest unique per part), or at a part no step has moved yet (its document's
 * creation, the collection, the document's id and the part). Together they order every part
 * exactly once.
 *
 * @experimental
 */
export type WaitingPosition =
  | { source: "state"; enteredAt: Date; partKey: string }
  | {
      source: "unmoved";
      enteredAt: Date;
      scopeSlug: string;
      entryId: string;
      part: string | null;
    };

/**
 * The latest time a cursor may name: the end of 9999, the last moment MySQL's `datetime` holds
 * (PostgreSQL's `timestamptz` and SQLite's integer seconds hold more). A position past it could
 * never have been handed out, and reading from it would ask a database for a time it can't store.
 */
const LATEST_ENTRY_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

const At = z.number().int().min(0).max(LATEST_ENTRY_MS);

/**
 * What a cursor carries, once decoded: the time in milliseconds, which kind of part it stands at,
 * and that kind's key. A cursor from before unmoved parts were listed carries no kind, and is
 * refused like any other cursor this list never gave.
 */
const EncodedPosition = z.discriminatedUnion("s", [
  z
    .object({
      s: z.literal("r"),
      at: At,
      key: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .strict(),
  z
    .object({
      s: z.literal("u"),
      at: At,
      c: z.string().min(1).max(255),
      id: z.string().min(1).max(255),
      p: z.string().min(1).max(64).nullable(),
    })
    .strict(),
]);

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
  const at = position.enteredAt.getTime();
  const body =
    position.source === "state"
      ? { s: "r", at, key: position.partKey }
      : {
          s: "u",
          at,
          c: position.scopeSlug,
          id: position.entryId,
          p: position.part,
        };
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

/**
 * `before` as a request carries it: an opaque position from `nextBefore`, read back. Text that is
 * not a well-formed position, or names a time no part can hold, is refused as invalid input, never
 * read as the list's start. The token is not signed: a hand-made position only moves where the
 * caller's own read starts, and every part it reaches is still checked for their access.
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
    const { data } = parsed;
    return data.s === "r"
      ? {
          source: "state",
          enteredAt: new Date(data.at),
          partKey: data.key,
        }
      : {
          source: "unmoved",
          enteredAt: new Date(data.at),
          scopeSlug: data.c,
          entryId: data.id,
          part: data.p,
        };
  });
