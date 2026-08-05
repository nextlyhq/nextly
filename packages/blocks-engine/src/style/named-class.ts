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
import { MAX_NAMED_CLASSES } from "../document";
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
 * one place because the compiler and the resolver have to agree: a class the stylesheet omits
 * but the resolver still applies would report a value the browser never receives, which is the
 * one failure a provenance indicator must not have.
 */
export function isUsableNamedClass(value: unknown): value is NamedClass {
  if (!isPlainRecord(value)) return false;
  const candidate = value as Partial<NamedClass>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.slug === "string" &&
    // Length BEFORE the pattern. A slug of megabytes of otherwise-valid characters is scanned in
    // full by the regex, on every compile and every resolution, only to be rejected afterwards —
    // so the cheap test that rejects it has to come first for the cap to bound anything.
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
 * The compiler writes exactly this list and the resolver reads exactly this list, which is what
 * keeps a class the stylesheet dropped from being reported as the source of a value.
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
    // Dropping the later keeps one id to one class everywhere — emission, application, and
    // resolution all read this list.
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
  return [...classes].sort(
    (a, b) =>
      index(a) - index(b) || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0)
  );
}

/**
 * The classes a node references, in library order, skipping ids the library does not have.
 *
 * An unknown id is not an error. A document is data and a class library is configuration, and
 * configuration that has not loaded yet must not make a document invalid — the same reason an
 * unresolved token name is a warning. The node keeps its other classes and its own values; the
 * caller reports the gap, and nothing here decides whether that is worth telling the author.
 */
export function resolveNodeClasses(
  ids: readonly string[],
  library: readonly NamedClass[]
): NamedClass[] {
  // The library arrives as the ordered list, not as a map keyed by id, and that is the whole
  // point: a map is built by the caller, and building one collapses two entries sharing an id
  // before anything here can see the collision. The compiler keeps the FIRST of those and warns;
  // a map keeps the last, so the resolver would report a class the stylesheet never emitted.
  //
  // Narrowed to what the compiler writes BEFORE anything is looked up, so a class dropped for
  // colliding on its name or its id cannot be reported as the source of a value it never
  // contributed.
  // Capped exactly where the compiler caps it. The compiler slices the stored library before
  // building its usable list, so a class past the bound is never written; resolving from the whole
  // library would hand one back and report its values as visible on a page that has no rule for it.
  const emitted = new Map(
    usableNamedClasses(
      library.length > MAX_NAMED_CLASSES
        ? library.slice(0, MAX_NAMED_CLASSES)
        : library
    ).map(cls => [cls.id, cls])
  );
  const found: NamedClass[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    // A node listing the same class twice applies it once. Applying it twice would emit nothing
    // different, since both copies carry identical values at identical specificity.
    if (seen.has(id)) continue;
    seen.add(id);
    // Unusable is treated exactly as unknown: the compiler writes nothing for it, so reporting
    // it here would name a source the page does not have.
    const cls = emitted.get(id);
    if (cls !== undefined) found.push(cls);
  }
  return orderedNamedClasses(found);
}
