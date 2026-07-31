/**
 * Renames the key a dynamic-zone instance announces its type under, inside a
 * stored content document.
 *
 * This is a different problem from rewriting a field *definition*, and the two
 * are deliberately not one function. A definition is a structure this codebase
 * authored, so it can be walked by node kind and every rewrite anchored to a
 * node already identified as a field group. A content document is the author's
 * data: an entry snapshot or a webhook envelope, whose shape is whatever their
 * fields produced. There is no definition tree to steer by.
 *
 * Nor can the entry's *current* field definitions steer it. A snapshot was
 * written under the schema of its day, so a field since deleted or retyped has
 * no definition to guide a walk — and those are precisely the oldest documents,
 * the ones a rename most needs to reach. A guided walk would leave them behind
 * while reporting success.
 *
 * So this targets the key itself, everywhere in the document. The exposure is
 * an author's own JSON holding a key of the same name; the key is underscore
 * prefixed and reserved by the storage format, which is what makes that
 * acceptable rather than merely unlikely.
 *
 * @module domains/field-groups/migration/rewrite-content-key
 */

/**
 * Rename one key throughout a JSON document.
 *
 * Returns a new structure and leaves the input untouched, so a caller writes
 * back only when the whole document rewrote cleanly.
 *
 * Direction is the argument order, so a rollback is this call with `from` and
 * `to` exchanged.
 */
export function rewriteContentKey(
  document: unknown,
  from: string,
  to: string
): unknown {
  if (Array.isArray(document)) {
    return document.map(entry => rewriteContentKey(entry, from, to));
  }
  if (!isRecord(document)) return document;

  const rewritten: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    // Rebuilt in place rather than deleted and reappended, so the renamed key
    // keeps its position. A snapshot is read by humans when a restore is being
    // judged, and reordering every instance would be a large meaningless diff.
    const name = key === from ? to : key;
    // A document already carrying the target key keeps what is there rather
    // than being overwritten by a stale one. Nothing writes both today; this
    // decides the collision rather than leaving it to key order.
    if (name === to && key !== to && to in document) continue;
    rewritten[name] = rewriteContentKey(value, from, to);
  }
  return rewritten;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
