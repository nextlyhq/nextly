/**
 * A short, stable fingerprint of a pattern's content.
 *
 * It exists to answer one question later: has the pattern a copy came from
 * changed since the copy was taken? A copy records the digest it was made at,
 * and a surface asking "is this out of date" hashes the pattern as it stands
 * now and compares.
 *
 * ## Content, not a version number
 *
 * The engine is handed a document and never an entry row — it can hash what it
 * was given and cannot see what the store calls it. Content is also the better
 * answer to the question being asked: a re-save that changed nothing bumps a
 * version and leaves a digest alone, so a version comparison reports "changed"
 * for every touch and trains a reader to ignore it.
 *
 * ## What it is NOT
 *
 * Not a security boundary and not a deduplication key. Two different patterns
 * can collide, and nothing here depends on them not doing so: the worst a
 * collision costs is one missed "upstream changed" notice. That is why a short
 * non-cryptographic hash is the right size — this is a change hint, and paying
 * for a cryptographic digest would buy a guarantee no caller needs.
 *
 * ## Why the whole document is not hashed
 *
 * Only `nodes`. A pattern's settings are not copied into a page, so a change to
 * them is not a change to what any copy holds — and reporting one as an
 * upstream change would ask an author to accept an edit that would not alter
 * their page.
 *
 * @module pattern-digest
 */
import type { BlockNode } from "./document";
import { hashId } from "./style/node-class";

/**
 * The digest of a pattern's stored nodes.
 *
 * Serialized with `JSON.stringify`, which is what makes this comparable across
 * reads: the pattern is stored as JSON and parsed back with its key order
 * intact, so two reads of one unchanged row serialize identically. Node field
 * order is normalised by the op layer whenever a document is edited through it,
 * and prop order is authored data that the format treats as meaningful — so
 * neither is something this should reorder on its own.
 *
 * A node the serializer cannot carry makes this throw, which is the same answer
 * every other reader of such a document gives. Callers that must not throw ask
 * the op layer's document rule first; the planners do.
 */
export function patternDigest(nodes: readonly BlockNode[]): string {
  return hashId(JSON.stringify(nodes));
}
