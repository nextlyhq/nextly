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

import { isBlockType, MAX_NAMED_CLASSES, type NodeStyles } from "../document";
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
export const NAMED_CLASS_SLUG_RE: RegExp = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

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
  /**
   * The name an author gave the class, shown where the slug would read as code. Display text
   * only: nothing compiled reads it, and an entry without one is named by its slug.
   */
  label?: string;
  /**
   * Set while the class is locked: its styles, name and slug may not change and it may not be
   * removed until someone allowed to lock classes unlocks it. Absent, never `false`, when
   * unlocked. Nothing compiled reads it.
   */
  locked?: true;
  /**
   * The block type this class is a look of (`core/button` for Outline), or absent for a shared
   * style any block may wear.
   *
   * A look is a block type's named variant, worn under the shared styles a site makes: every
   * look is written before every other class, whatever their positions, so a shared style and
   * the block's own values still win over it. Among looks, `orderIndex` decides as usual.
   *
   * @experimental
   */
  blockType?: string;
  /**
   * Set on the look that IS its block type's own look (a button's Primary): its `styles` are the
   * site's edits to that type's base styles, laid over the base for every block of the type.
   * Absent, never `false`, on any other class, and usable only with a `blockType`.
   *
   * Never written as a class: no node wears it, it claims no name or id, and a page reads it only
   * through {@link blockDefaultsOf}. So a block's own look comes before its other looks, its
   * shared style and its own values, as its base does.
   *
   * @experimental
   */
  isDefault?: true;
}

/**
 * Whether a class is a look: bound to one block type, so written before every shared style.
 * A `blockType` that is not a string is read as absent, as persisted data may carry one.
 */
export function isLook(cls: NamedClass): boolean {
  return isBlockType((cls as { blockType?: unknown } | null)?.blockType);
}

/**
 * Whether a class is its block type's own look, which edits the type's base rather than being
 * worn. Read from data that may not be a record, as {@link isLook} is.
 *
 * @experimental
 */
export function isDefaultLook(cls: NamedClass): boolean {
  return (
    isLook(cls) && (cls as { isDefault?: unknown } | null)?.isDefault === true
  );
}

/**
 * The site's edits to its block types' own looks, keyed by type: each default look's styles, read
 * from the part of the library the compiler reads, in its order. Where two default looks name one
 * type, the first in that order is read, as the first of two classes sharing an id is.
 *
 * The one reading of a default look, so a renderer laying them over the bases and anything asking
 * what a block's own look holds see the same styles.
 *
 * @experimental
 */
export function blockDefaultsOf(library: unknown): Record<string, NodeStyles> {
  const defaults: Record<string, NodeStyles> = {};
  for (const cls of ownLooksRead(library)) {
    defaults[cls.blockType as string] = cls.styles;
  }
  return defaults;
}

/**
 * The own looks {@link blockDefaultsOf} reads, one per block type at most: what a check asking
 * whether a stored own look takes effect asks, since an own look is never written as a class.
 *
 * @experimental
 */
export function ownLooksRead(library: unknown): NamedClass[] {
  // The library is one site-settings record, read whether or not anything validated it, so a
  // non-array is no edits rather than a throw on every page.
  if (!Array.isArray(library)) return [];
  const read = namedClassesRead(library as readonly NamedClass[]);
  const types = new Set<string>();
  const own: NamedClass[] = [];
  for (const cls of orderedNamedClasses(read)) {
    if (!isUsableNamedClass(cls) || !isDefaultLook(cls)) continue;
    const type = cls.blockType as string;
    if (types.has(type)) continue;
    types.add(type);
    own.push(cls);
  }
  return own;
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
    isPlainRecord(candidate.styles) &&
    // A binding is a block type, or absent: a look bound to nothing a block
    // can be would sit in the look tier and apply to no node.
    (candidate.blockType === undefined || isBlockType(candidate.blockType)) &&
    // The own-look mark is `true` or absent, and only on a look: an own look of no block type
    // would edit no base.
    (candidate.isDefault === undefined ||
      (candidate.isDefault === true && isBlockType(candidate.blockType)))
  );
}

/**
 * The part of a class library the compiler reads: its first `MAX_NAMED_CLASSES` shared styles,
 * its first `MAX_LOOKS` worn looks and its first `MAX_OWN_LOOKS` own looks, in library order,
 * before any ordering or claim rule. An entry past its cap is never read, so it neither renders nor takes a slug or an id from an entry
 * that does.
 *
 * The one statement of the cap's reading, so a caller asking which classes a page can use asks
 * exactly what the compiler reads rather than a library the compiler would cut short.
 */
export function namedClassesRead(
  library: readonly NamedClass[]
): readonly NamedClass[] {
  // Looks are counted apart, under a cap of their own, so the looks a site's
  // blocks supply never take a shared style's place under the cap: a site at
  // the cap keeps every style it had. Read in library order, and no further
  // than both quotas allow, so an oversized stored library is never scanned
  // past them.
  // Own looks have an allowance of their own too: they are never written as
  // classes, so seeding one per block type never takes a worn look's place.
  const read: NamedClass[] = [];
  let shared = 0;
  let looks = 0;
  let own = 0;
  const scan = Math.min(
    library.length,
    MAX_NAMED_CLASSES + MAX_LOOKS + MAX_OWN_LOOKS
  );
  for (let at = 0; at < scan; at += 1) {
    const entry = library[at];
    if (isDefaultLook(entry)) {
      if (own < MAX_OWN_LOOKS) read.push(entry);
      own += 1;
    } else if (isLook(entry)) {
      if (looks < MAX_LOOKS) read.push(entry);
      looks += 1;
    } else {
      if (shared < MAX_NAMED_CLASSES) read.push(entry);
      shared += 1;
    }
  }
  // The library itself when nothing was left out, so a caller comparing
  // identities sees the same library.
  return read.length === library.length ? library : read;
}

/**
 * How many looks the compiler reads, apart from the shared-style cap: well
 * above what any site's blocks declare, so only data already wrong reaches it.
 */
const MAX_LOOKS = 512;

/** How many own looks the compiler reads, one per block type a site could hold, apart from looks. */
const MAX_OWN_LOOKS = 512;

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
  return usableNamedClassPositions(classes).map(position => classes[position]);
}

/**
 * The same list, as positions in the stored array rather than as entries.
 *
 * Which SLOT was written, not which value. A caller can supply one object in two slots, and only
 * the first is written — asking "was this entry written" answers yes for the slot that was
 * dropped, so the duplicate goes unreported and an editor is never told which slot to repair.
 *
 * Shares the ordering and the claim rules with `usableNamedClasses` rather than restating them,
 * because the list of what is written and the list of where it was written have to be the same
 * list.
 */
export function usableNamedClassPositions(
  classes: readonly NamedClass[]
): number[] {
  const takenSlugs = new Set<string>();
  const takenIds = new Set<string>();
  const usable = new Set<number>();
  const ordered = orderedNamedClassPositions(classes);
  // Shared styles claim their names first, then looks: a look is written first, but a
  // site's own style holding a name a look would take keeps it, so seeding a look never
  // drops a style documents already use. The emitted order is unchanged.
  const claim = (looks: boolean): void => {
    for (const position of ordered) {
      const cls = classes[position];
      if (!isUsableNamedClass(cls) || isLook(cls) !== looks) continue;
      // A block's own look edits its base and is never worn, so it claims no name or id.
      if (isDefaultLook(cls)) continue;
      if (takenSlugs.has(cls.slug)) continue;
      // An id claimed twice is as unusable as a name claimed twice, and quieter about it. A
      // document references a class by id, so two entries sharing one make that reference
      // ambiguous: whichever is looked up last is the only one reachable, while both were
      // written. Dropping the later keeps one id to one class in both the rules emitted and
      // the class list put on the element, which read this same list.
      if (takenIds.has(cls.id)) continue;
      takenSlugs.add(cls.slug);
      takenIds.add(cls.id);
      usable.add(position);
    }
  };
  claim(false);
  claim(true);
  return ordered.filter(position => usable.has(position));
}

/** The emitted class name for a slug. */
export function namedClassName(slug: string): string {
  return `${NAMED_CLASS_PREFIX}${slug}`;
}

/** The prefix a look's class is written under, apart from shared styles'. */
export const LOOK_CLASS_PREFIX = "nx-l-";

/**
 * The emitted class name for one class: a look's under its own prefix, so a
 * look and a shared style can never be told apart by name alone, nor one
 * mistaken for the other where a renderer reads the class string.
 */
export function classNameOf(
  cls: Pick<NamedClass, "slug" | "blockType">
): string {
  return isLook(cls as NamedClass)
    ? `${LOOK_CLASS_PREFIX}${cls.slug}`
    : namedClassName(cls.slug);
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
  // Built by counting rather than by mapping the input. `Array.prototype.map` preserves a sparse
  // array's holes, and a stored library is persisted data that can arrive with them, so the list
  // would carry holes where positions should be and every warning built from one would address
  // `/classes/undefined`.
  const positions: number[] = [];
  for (let position = 0; position < classes.length; position += 1) {
    positions.push(position);
  }
  return positions.sort((a, b) => {
    const left = classes[a];
    const right = classes[b];
    return (
      // Looks first: a look is worn under the shared styles, whatever its index.
      Number(!isLook(left)) - Number(!isLook(right)) ||
      index(left) - index(right) ||
      (id(left) < id(right) ? -1 : id(left) > id(right) ? 1 : 0) ||
      // Two entries that compare equal keep their stored order. `Array.prototype.sort` is
      // stable, so this only matters for entries whose comparison never reaches here — but
      // stating it keeps the positions a total order rather than one that depends on it.
      a - b
    );
  });
}
