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
import { isPlainRecord } from "../plain-record";

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
 * The longest slug or id this engine will accept from the stored library.
 *
 * `MAX_NAMED_CLASSES` bounds how MANY entries are read and says nothing about their size, so one
 * corrupted entry with a syntactically valid but enormous slug is copied into a selector on every
 * page render. Well above any name a person would type, so the cap is only ever reached by data
 * that is already wrong.
 */
export const MAX_NAMED_CLASS_NAME_LENGTH = 128;

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

/**
 * Whether this record is a class the engine can use at all.
 *
 * Persisted data reaches here whether or not a caller validated it, so a library entry may be
 * `null`, may be missing its slug, or may carry a name that cannot be written to CSS. Asked in
 * one place so that a class the stylesheet omits is omitted everywhere: the rule the compiler
 * writes and the class list a renderer is handed both read this one answer, and if they could
 * disagree a node would carry a class token for a selector that was never emitted.
 */
export function isUsableNamedClass(value: unknown): value is NamedClass {
  if (!isPlainRecord(value)) return false;
  const candidate = value as Partial<NamedClass>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.slug === "string" &&
    // Length BEFORE the pattern. A slug of megabytes of otherwise-valid characters is scanned in
    // full by the regex, on every compile, only to be rejected afterwards — so the cheap test
    // that rejects it has to come first for the cap to bound anything.
    candidate.slug.length <= MAX_NAMED_CLASS_NAME_LENGTH &&
    candidate.id.length <= MAX_NAMED_CLASS_NAME_LENGTH &&
    NAMED_CLASS_SLUG_RE.test(candidate.slug) &&
    // Held to the same plain-record test the compiler applies to the envelope itself, not merely
    // to "is an object". An array passes the looser test and then produces no declarations, so
    // the class reserved its slug and wrote nothing — and a later, valid class wanting that name
    // was dropped as a duplicate, taking the styling of every node referencing it.
    isPlainRecord(candidate.styles)
  );
}

/**
 * The classes the engine will actually use, in the order they override one another.
 *
 * Usability cannot be decided one class at a time, because two of them can collide: a name is
 * only usable if no earlier class in library order already took it. Emitting both would put two
 * different rule sets on one `.nx-c-<slug>` selector, so a block applying either would receive
 * the other's declarations — and the later entry could override a class the block never
 * referenced.
 *
 * The compiler writes exactly this list and hands the renderer exactly this list, so a class
 * dropped here is dropped from both rather than from one of them.
 */
export function usableNamedClasses(
  classes: readonly NamedClass[]
): NamedClass[] {
  const takenSlugs = new Set<string>();
  const takenIds = new Set<string>();
  const usable: NamedClass[] = [];
  for (const cls of orderedNamedClasses(classes)) {
    if (!isUsableNamedClass(cls)) continue;
    if (takenSlugs.has(cls.slug)) continue;
    // An id claimed twice is as unusable as a name claimed twice, and quieter about it. A
    // document references a class by id, so two entries sharing one make that reference
    // ambiguous: whichever is looked up last is the only one reachable, while both were written.
    // Dropping the later keeps one id to one class in both the rules emitted and the class list
    // put on the element, which read this same list.
    if (takenIds.has(cls.id)) continue;
    takenSlugs.add(cls.slug);
    takenIds.add(cls.id);
    usable.push(cls);
  }
  return usable;
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
  return orderedNamedClassPositions(classes).map(position => classes[position]);
}

/**
 * The same order, as positions in the stored array rather than as entries.
 *
 * A warning has to point at WHERE an entry is stored, and a malformed library can hold the same
 * primitive twice: `[null, null]` is two separate repairs at two separate pointers, so anything
 * that identifies an entry by its value collapses them into one report and leaves the second
 * entry unfixed. A position is unique whatever the entry is.
 *
 * The ordering itself lives here rather than in `orderedNamedClasses` so there is one comparator:
 * the order a warning is reported in and the order the classes override one another are the same
 * order, and two copies of it could drift apart.
 */
export function orderedNamedClassPositions(
  classes: readonly NamedClass[]
): number[] {
  // Sorting runs BEFORE anything checks whether an entry is usable, because the caller wants the
  // whole library in order to report on. So every read here tolerates an entry that is not a
  // record: a `null` in persisted data must cost a warning, not the entire stylesheet.
  //
  // A missing or non-numeric index sorts as 0 rather than making the comparison NaN, which would
  // leave the order dependent on the input sequence and therefore unstable between compiles.
  const index = (cls: NamedClass): number => {
    const value = (cls as { orderIndex?: unknown } | null)?.orderIndex;
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  const id = (cls: NamedClass): string => {
    const value = (cls as { id?: unknown } | null)?.id;
    // Bounded before it is compared. Sorting runs over the whole stored library, ahead of the
    // check that rejects an oversized id, so a few thousand entries sharing a long prefix made
    // the tie-break scan megabytes of settings text on every render — for entries thrown away
    // immediately afterwards.
    return typeof value === "string"
      ? value.slice(0, MAX_NAMED_CLASS_NAME_LENGTH + 1)
      : "";
  };
  return classes
    .map((_unused, position) => position)
    .sort((a, b) => {
      const left = classes[a];
      const right = classes[b];
      return (
        index(left) - index(right) ||
        (id(left) < id(right) ? -1 : id(left) > id(right) ? 1 : 0) ||
        // Two entries that compare equal keep their stored order. `Array.prototype.sort` is
        // stable, so this only matters for entries whose comparison never reaches here — but
        // stating it keeps the positions a total order rather than one that depends on it.
        a - b
      );
    });
}
