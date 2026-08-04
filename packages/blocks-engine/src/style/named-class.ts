// A named class is a set of styles an author can apply to many nodes and change in one place.
// It is the authoring model every comparable builder converged on, and the one thing this engine
// could not express: before it, every value was a per-node local, so changing a look meant
// visiting every node that had it.
//
// Two decisions shape everything here.
//
// A document references a class by ID, never by name. The user-facing name is therefore free to
// change: renaming regenerates the sheet and rewrites no document, and "where is this used" and
// "is this safe to delete" are reference queries rather than text searches. It is the same reason
// node styles key on node id rather than on anything an author types.
//
// Precedence between classes is the library's explicit order, carried on the class itself, not
// the order a node happens to list them in. A node listing [a, b] and another listing [b, a] must
// resolve the same way, or the same two classes mean different things on different nodes — the
// complaint most often made about combo classes elsewhere. The order is data the author controls,
// and it is the documented way one class overrides another.

import type { NodeStyles } from "../document";

/** The prefix every named class carries in the emitted CSS. */
export const NAMED_CLASS_PREFIX = "nx-c-";

/**
 * The slugs this engine can emit.
 *
 * A slug reaches a selector, and this compiler reads persisted data whether or not a caller
 * validated it, so the grammar is enforced rather than escaped into something safe. Held to the
 * same shape as a block type for the same reason: a name that is not a slug is not a class this
 * engine can style, and quietly rewriting it would emit a class no renderer puts on an element.
 */
export const NAMED_CLASS_SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * A reusable set of styles, applied to nodes by ID.
 *
 * `styles` is the same `NodeStyles` envelope a node carries, so a class is stored, validated,
 * compiled and resolved by everything that already understands node styles. A second shape would
 * have meant a second validator and a second emitter that could disagree with the first.
 */
export interface NamedClass {
  /** Stable identity. What documents reference, and what rename never changes. */
  id: string;
  /** The CSS-facing name, from the author's label. Free to change; see the module note. */
  slug: string;
  /**
   * Position in the library, and therefore precedence: a later class overrides an earlier one.
   *
   * Carried here rather than derived from a node's class list so two nodes with the same classes
   * in a different order resolve identically.
   */
  orderIndex: number;
  /** The styles this class applies, in the same envelope a node uses. */
  styles: NodeStyles;
}

/** The emitted class name for a slug. */
export function namedClassName(slug: string): string {
  return `${NAMED_CLASS_PREFIX}${slug}`;
}

/**
 * The classes to emit, in the order they override one another.
 *
 * Sorted by `orderIndex`, then by `id` so two classes sharing an index still serialize the same
 * way on every compile — a stylesheet that reorders itself between builds would invalidate caches
 * and make diffs unreadable, and at equal specificity it would silently change which class wins.
 */
export function orderedNamedClasses(
  classes: readonly NamedClass[]
): NamedClass[] {
  return [...classes].sort(
    (a, b) =>
      a.orderIndex - b.orderIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * The classes a node references, in library order, skipping ids the library does not have.
 *
 * An unknown id is not an error. A document is data and a class library is configuration, and
 * configuration that has not loaded yet must not make a document invalid — the same rule PR-S2
 * settled for unknown tokens. The node keeps its other classes and its own values; the caller
 * reports the gap, and nothing here decides whether that is worth telling the author about.
 */
export function resolveNodeClasses(
  ids: readonly string[],
  library: ReadonlyMap<string, NamedClass>
): NamedClass[] {
  const found: NamedClass[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    // A node listing the same class twice applies it once. Applying it twice would emit nothing
    // different, since both copies carry identical values at identical specificity.
    if (seen.has(id)) continue;
    seen.add(id);
    const cls = library.get(id);
    if (cls !== undefined) found.push(cls);
  }
  return orderedNamedClasses(found);
}
