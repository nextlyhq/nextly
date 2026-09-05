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
 * ## What is hashed is what a COPY would carry
 *
 * Only `nodes`. A pattern's settings are not copied into a page, so a change to
 * them is not a change to what any copy holds — and reporting one as an
 * upstream change would ask an author to accept an edit that would not alter
 * their page.
 *
 * The rule inside the nodes is one question asked of each field: does a copy
 * carry this, or does inserting regenerate it? A field the copy regenerates
 * contributes nothing to any copy, so hashing it reports changes no author can
 * see — and after an identity-only rewrite that means every existing copy reads
 * as stale at once.
 *
 * EXCLUDED, because inserting replaces them outright:
 *
 * - every node `id`, which `reidForestWithMap` mints fresh at every depth;
 * - a ROOT's own `origin`, which the insert overwrites with the pattern it is
 *   copying from.
 *
 * KEPT, because the copy derives from them and a change to one is visible in
 * every copy: `cssId` and `attributes.id`, whose minted replacements are built
 * FROM the stored value (`pricing` becomes `pricing-<suffix>`, so renaming it
 * to `plans` changes what every copy renders); the id-reference attributes and
 * fragment props remapped alongside them; `locked`, which is taken off for the
 * insert and put back by the same group; and an `origin` deeper than a root,
 * which is copied as it stands.
 *
 * The exclusion lives here rather than at the call site so the fingerprint and
 * the thing it fingerprints cannot be asked about different content — a later
 * staleness check hashes the pattern as it stands now and compares, and it must
 * be running the identical rule.
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
  return hashId(JSON.stringify(nodes.map(node => copiedShape(node, true))));
}

/**
 * One node reduced to what a copy of it would carry.
 *
 * Structure-aware rather than a `JSON.stringify` replacer keyed on the name
 * `id`: a replacer drops every `id` anywhere in the tree, which would silently
 * exclude a prop an author named `id` and an `attributes.id` the copy does
 * carry. The field being dropped is the NODE's identity, and only a walk that
 * knows where it is can say that.
 *
 * Recursion is bounded by the same depth `JSON.stringify` already imposes on
 * this very input, so it adds no limit the caller did not already have.
 */
function copiedShape(node: BlockNode, isRoot: boolean): unknown {
  const { id: _id, origin, slots, ...rest } = node;
  const shape: Record<string, unknown> = { ...rest };
  // A root's record is overwritten on insert; a deeper one travels with the copy.
  if (!isRoot && origin !== undefined) shape.origin = origin;
  if (slots !== undefined) {
    shape.slots = Object.fromEntries(
      Object.entries(slots).map(([name, children]) => [
        name,
        // A malformed slot value is carried through rather than normalised: it
        // is content the copy would carry too, and changing it is a change.
        Array.isArray(children)
          ? children.map(child => copiedShape(child, false))
          : children,
      ])
    );
  }
  return shape;
}
