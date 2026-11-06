/**
 * A document's version, as reads give it and updates send it back.
 *
 * Every write this plugin makes to a document says which version it was made
 * from, so a save made by someone else in between refuses it rather than
 * being overwritten. A write that sets a value regardless of what is stored,
 * such as putting back a stored copy, says so instead, with the overwrite
 * choice. The server's keys are written here once.
 *
 * @module document-version
 */

/** The key a read gives a document's version under, and an update sends it under. */
const DOCUMENT_VERSION_KEY = "_rev";

/** The key an update sets to `true` to apply whatever the stored version. */
const DOCUMENT_OVERWRITE_KEY = "_overwrite";

/** A row's version, as a read gave it, or `undefined` when it gave none. */
export function documentVersionOf(row: unknown): string | undefined {
  const value = (row as Record<string, unknown> | null)?.[DOCUMENT_VERSION_KEY];
  return typeof value === "string" ? value : undefined;
}

/**
 * The data of an update made from a read: it carries the version that read
 * gave. A read that gave none (a server that issues no versions) adds nothing.
 */
export function withVersionFrom(
  data: Record<string, unknown>,
  rev: string | undefined
): Record<string, unknown> {
  return rev === undefined ? data : { ...data, [DOCUMENT_VERSION_KEY]: rev };
}

/**
 * The data of an update that means to set these values whatever is stored:
 * a stored copy put back, a publish of every matching row, a fixture.
 */
export function asOverwrite(
  data: Record<string, unknown>
): Record<string, unknown> {
  return { ...data, [DOCUMENT_OVERWRITE_KEY]: true };
}
