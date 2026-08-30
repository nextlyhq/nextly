/**
 * The key one document's lock row is addressed by, and the bound it is held to.
 *
 * A leaf module with no imports, so the repository (which writes the row) and
 * any caller that needs to name a lock without opening a connection read the
 * same derivation. Two spellings of "which row is this document's" would agree
 * on the day they were written and drift into an editor locking one row and
 * releasing another.
 *
 * @module domains/document-lock/lock-key
 */

/**
 * Which kind of thing is being edited.
 *
 * Part of the key rather than a detail beside it: a collection and a Single may
 * carry the same slug, and their entries live in different tables, so an entry
 * id is unique only within its own kind. Without this, a Single and a
 * collection entry sharing both would be ONE lock — taking over the one would
 * silently release the other, and each author would be told they held a
 * document the other was editing.
 */
export type DocumentScopeKind = "collection" | "single";

/**
 * What separates the parts of a key.
 *
 * A colon rather than a hyphen or a dot, because slugs are kebab-case and entry
 * ids are uuids: both may contain a hyphen, neither may contain a colon, so
 * this is the one character that cannot appear inside any part.
 */
export const DOCUMENT_LOCK_KEY_SEPARATOR = ":";

/**
 * The longest key MySQL will index in `varchar(191)` utf8mb4 — the narrowest of
 * the three dialects, so it is the bound all of them are held to. A key that
 * worked on two dialects and threw on the third would surface as an editor that
 * cannot open a document, on one deployment only.
 */
export const MAX_DOCUMENT_LOCK_KEY_LENGTH = 191;

/**
 * The key for one document, or `undefined` when no valid key describes it.
 *
 * 🔴 Returns rather than throws, because both answers are ordinary here: the
 * caller decides whether an unrepresentable document is a bad request or a
 * programming mistake, and those are different responses. Throwing would make
 * that choice on the caller's behalf.
 *
 * A part containing the separator is refused rather than escaped. Escaping
 * would make the key non-obvious to read in a database session — which is where
 * anybody debugging "who holds this lock" actually looks — and no supported
 * slug or entry id can contain one.
 */
export function documentLockKey(
  scopeKind: DocumentScopeKind,
  slug: string,
  entryId: string
): string | undefined {
  if (slug === "" || entryId === "") return undefined;
  if (
    slug.includes(DOCUMENT_LOCK_KEY_SEPARATOR) ||
    entryId.includes(DOCUMENT_LOCK_KEY_SEPARATOR)
  ) {
    return undefined;
  }
  const key = [scopeKind, slug, entryId].join(DOCUMENT_LOCK_KEY_SEPARATOR);
  return key.length > MAX_DOCUMENT_LOCK_KEY_LENGTH ? undefined : key;
}
