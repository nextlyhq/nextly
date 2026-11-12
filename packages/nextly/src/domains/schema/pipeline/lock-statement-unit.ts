/**
 * The name a statement marked with a schema-lock claim carries after the claim: the migration file
 * or ledger key it was sent for, or, for a statement sent for none, the command that sent it.
 *
 * A run that takes over a lapsed lock and is refused by an earlier holder's statement that would
 * not stop names that statement by this name and by its database session, never by its text: a
 * hand-written statement can hold a literal value, such as a key or a password, that must not reach
 * a message or a log.
 *
 * The name is written encoded, in a comment of its own, so no name can close the comment early and
 * put anything of its own into the statement; the database hands back only the comment's content,
 * and `unitOf` passes on nothing that is not a name this module could have written.
 *
 * @module domains/schema/pipeline/lock-statement-unit
 */

/** How the comment naming a statement's unit opens, after the claim's comment. */
export const UNIT_COMMENT_OPEN = "/* nextly-unit:";

/** How the comment naming a statement's unit closes. */
export const UNIT_COMMENT_CLOSE = " */";

/**
 * The longest encoded name written. Short enough that the claim's comment and this one fit well
 * inside the 1024 bytes PostgreSQL keeps of a running statement by default
 * (`track_activity_query_size`); a longer name is left out rather than cut.
 */
const MAX_ENCODED_LENGTH = 512;

/** What an encoded name may hold: letters, digits, `%`, `.`, `_` and `-`, and nothing else. */
const ENCODED_UNIT = /^[A-Za-z0-9%._-]+$/;

/**
 * What a decoded name may not hold: control and format characters (a line break, a terminal
 * escape, a direction override) and the backtick a message quotes it with.
 */
const UNPRINTABLE = /[\p{Cc}\p{Cf}`]/u;

/** `name` percent-encoded down to letters, digits, `%`, `.`, `_` and `-`; undefined where it cannot be. */
function encoded(name: string): string | undefined {
  try {
    // `encodeURIComponent` leaves `!'()*~`; they are encoded too, so the comment holds no quote
    // and no character a driver or a pooler might read as more than text.
    return encodeURIComponent(name).replace(
      /[!'()*~]/g,
      c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    );
  } catch {
    // A lone surrogate cannot be encoded; the statement is marked without a name.
    return undefined;
  }
}

/**
 * The comment naming `name`, with the space that follows it, or the empty string where the name is
 * empty, cannot be encoded, would be too long to survive, or could not be read back as written.
 */
export function unitComment(name: string): string {
  if (name.length === 0 || UNPRINTABLE.test(name)) return "";
  const text = encoded(name);
  if (text === undefined || text.length > MAX_ENCODED_LENGTH) return "";
  return `${UNIT_COMMENT_OPEN}${text}${UNIT_COMMENT_CLOSE} `;
}

/**
 * The name a listed statement's comment holds, decoded, from the comment's content as the database
 * cut it out. Null where there was none, or where what came back is not a name `unitComment` could
 * have written, so nothing else of a statement is ever passed on as a name.
 */
export function unitOf(listed: unknown): string | null {
  if (
    typeof listed !== "string" ||
    listed.length > MAX_ENCODED_LENGTH ||
    !ENCODED_UNIT.test(listed)
  ) {
    return null;
  }
  let name: string;
  try {
    name = decodeURIComponent(listed);
  } catch {
    return null;
  }
  return name.length === 0 || UNPRINTABLE.test(name) ? null : name;
}
