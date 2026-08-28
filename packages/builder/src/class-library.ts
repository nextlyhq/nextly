/**
 * What the editor's two class surfaces show, and what an edit to them produces.
 *
 * A projection over {@link named-class}, which owns what a class IS. This owns
 * only the authoring questions the engine has no opinion about: which classes a
 * selected node carries, which remain applicable, whether a typed name can
 * become one, and what a rename or a removal leaves behind.
 *
 * The split follows {@link tokens-studio}: rules here, presentation in the
 * panels, so every decision below is testable without a DOM. It also keeps the
 * two surfaces answering from ONE set of rules — a selector that decided
 * applicability differently from the manager would let an author apply a class
 * the manager does not list.
 *
 * ## Nothing here writes
 *
 * Every function returns a new value and stores nothing. Persistence belongs to
 * whoever owns the document, which in the page builder is the section-scoped
 * site-style write this package cannot reach. The same reason the tokens studio
 * lifts its edits.
 *
 * ## The listed set is the set the compiler emits
 *
 * A stored library is not the library that renders. `compilePageCss` bounds it
 * to `MAX_NAMED_CLASSES` in STORED order, then drops entries that are malformed
 * or that reuse a slug or an id an earlier entry already claimed. A surface
 * built on the stored array would therefore offer classes that reach no
 * stylesheet: applying one would change nothing and give no reason why.
 *
 * So {@link siteClasses} reproduces that bound, and every list here derives
 * from it. Repairing an entry the compiler dropped is not this module's job —
 * the compile warnings carry the position and the reason, which is the only
 * place that can distinguish two entries holding the same slug.
 *
 * ## A usage count is a LOWER BOUND, in both directions
 *
 * The counts handed in are read from an index maintained on write, and that
 * index has no concurrency control. It can over-count, and — this is the part
 * that decides the design — it can also UNDER-count: two saves to one document
 * can each plan to remove the other's row, and if both removals land the class
 * keeps rendering with no row left to say so. `class-usage-maintenance` records
 * that case at the point the diff is computed.
 *
 * A zero therefore means "nothing known", never "nothing". That is why
 * {@link deletionWarning} confirms unconditionally rather than treating zero as
 * permission, and why the filter is named for the absence of EVIDENCE rather
 * than for the absence of usage.
 *
 * @module class-library
 */
import {
  MAX_NAMED_CLASSES,
  MAX_NAMED_CLASS_NAME_LENGTH,
  NAMED_CLASS_SLUG_RE,
  namedClassName,
  usableNamedClasses,
  type NamedClass,
} from "@nextlyhq/blocks-engine";

/**
 * How many documents are KNOWN to reference a class, keyed by class id.
 *
 * Keyed by ID rather than by name for the reason documents are: a rename must
 * not orphan a count, and a name is free to change under it.
 */
export type ClassUsageCounts = Readonly<Record<string, number>>;

/** Which classes the manager lists. */
export type ClassFilter = "all" | "no-known-usage" | "on-this-page";

/**
 * A class as the surfaces name it, carrying nothing about where it is used.
 *
 * Separate from {@link ClassRow} so that a list which has not been given usage
 * data cannot present a fabricated zero. A selector offering classes knows
 * nothing about the index, and a type that made it say `knownDocuments: 0`
 * would have it contradict the manager for the same class.
 */
export interface ClassChoice {
  /** Stable identity, which documents reference and rename never changes. */
  id: string;
  /** The CSS-facing slug, as stored. */
  slug: string;
  /** The emitted class name, which is what appears in a page's markup. */
  className: string;
}

/** A class together with what is known about the documents using it. */
export interface ClassRow extends ClassChoice {
  /**
   * Documents known to reference this class — a lower bound, never a count.
   *
   * Absent from the index means nothing is known, which is reported as zero
   * because there is no third answer to give a filter. It does not mean the
   * class is unused, and nothing may treat it as permission.
   */
  knownDocuments: number;
  /** Whether the document currently open applies this class to any node. */
  onThisPage: boolean;
}

/**
 * The classes the compiler will actually emit rules for, in precedence order.
 *
 * The bound is the compiler's, applied the compiler's way: the cap slices the
 * STORED order, before any sorting, so it is not the same set as the first
 * `MAX_NAMED_CLASSES` by precedence. Reproducing it here rather than ordering
 * the whole library keeps a tail entry from being offered as though applying it
 * would do something.
 */
export function siteClasses(library: readonly NamedClass[]): ClassChoice[] {
  const bounded =
    library.length > MAX_NAMED_CLASSES
      ? library.slice(0, MAX_NAMED_CLASSES)
      : library;
  return usableNamedClasses(bounded).map(entry => ({
    id: entry.id,
    slug: entry.slug,
    className: namedClassName(entry.slug),
  }));
}

/**
 * What is known about one class's usage, as a number a filter can read.
 *
 * Read as an OWN property. A class id is any string the library accepted, which
 * includes `constructor` and `toString`, and an ordinary record answers those
 * from its prototype — the count would arrive as a function, compare false
 * against every threshold, and quietly hide the class from the very filter that
 * exists to surface it. A value that is not a usable count is treated as
 * nothing known, which is safe here only because nothing decides on zero.
 */
function knownUsage(usage: ClassUsageCounts, classId: string): number {
  if (!Object.hasOwn(usage, classId)) return 0;
  const count = usage[classId];
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    return 0;
  }
  return count;
}

/**
 * Every class the site renders, in the order that decides precedence.
 *
 * Ordered by the library's own precedence rather than by name, because that
 * order is what resolves a conflict between two classes on one node — sorting
 * the list alphabetically for display would show an override relationship that
 * is not the one the page renders.
 */
export function classRows(
  library: readonly NamedClass[],
  usage: ClassUsageCounts,
  documentClassIds: readonly string[]
): ClassRow[] {
  const onPage = new Set(documentClassIds);
  return siteClasses(library).map(choice => ({
    ...choice,
    knownDocuments: knownUsage(usage, choice.id),
    onThisPage: onPage.has(choice.id),
  }));
}

/**
 * The rows one filter shows.
 *
 * "No known usage" asks the index and "on this page" asks the open document,
 * and they are different questions rather than two views of one: a class
 * applied only by an unpublished draft is referenced while appearing on no page
 * an author has open. Keeping them separate is what lets the manager report an
 * absence of evidence without contradicting the canvas.
 */
export function filterClassRows(
  rows: readonly ClassRow[],
  filter: ClassFilter
): ClassRow[] {
  if (filter === "no-known-usage") {
    return rows.filter(row => row.knownDocuments === 0);
  }
  if (filter === "on-this-page") return rows.filter(row => row.onThisPage);
  return [...rows];
}

/**
 * The classes a node carries, in library order.
 *
 * Ordered by the library and not by the node's own array, because two nodes
 * listing the same classes in a different order resolve identically — showing
 * them in the stored order would imply a precedence the renderer does not
 * apply.
 *
 * An id the site does not render is dropped rather than shown as an unnamed
 * chip, whether the library never held it or the compiler declined it. A chip
 * for one would offer to edit something no page can display.
 */
export function appliedClasses(
  library: readonly NamedClass[],
  nodeClassIds: readonly string[]
): ClassChoice[] {
  const applied = new Set(nodeClassIds);
  return siteClasses(library).filter(choice => applied.has(choice.id));
}

/**
 * The classes a node could still be given, narrowed by what the author typed.
 *
 * Matched against the SLUG rather than the emitted class name, because the
 * prefix every emitted name carries is identical on all of them and would make
 * an author's first keystrokes match everything.
 */
export function applicableClasses(
  library: readonly NamedClass[],
  nodeClassIds: readonly string[],
  query: string
): ClassChoice[] {
  const applied = new Set(nodeClassIds);
  const needle = query.trim().toLowerCase();
  return siteClasses(library)
    .filter(choice => !applied.has(choice.id))
    .filter(choice => needle === "" || choice.slug.includes(needle));
}

/** Why a name cannot become a class. */
export type NameRefusal = "empty" | "too-long" | "not-a-slug" | "already-taken";

/**
 * A name's verdict, carrying the slug to store when there is one.
 *
 * The accepted slug is RETURNED rather than left for the caller to re-derive.
 * This function trims before it validates, so a caller that stored the typed
 * text after being told it was acceptable would persist a value the engine's
 * own grammar rejects — a class held in the library that no selector ever
 * matches. One normalization, owned here.
 */
export type ClassNameOutcome =
  | { readonly ok: true; readonly slug: string }
  | { readonly ok: false; readonly refusal: NameRefusal };

/**
 * Whether a typed name can become a new class, and what to store if it can.
 *
 * The grammar is the engine's, not a second one: a slug reaches a CSS selector,
 * and a name this module accepted but the compiler refused would be stored as a
 * class no renderer ever puts on an element.
 *
 * A collision is refused rather than merged. Two classes with one slug emit the
 * same selector, so the compiler drops the later one outright and the author
 * would be left with an entry that styles nothing.
 */
export function newClassName(
  name: string,
  library: readonly NamedClass[]
): ClassNameOutcome {
  const slug = name.trim();
  if (slug.length === 0) return { ok: false, refusal: "empty" };
  if (slug.length > MAX_NAMED_CLASS_NAME_LENGTH) {
    return { ok: false, refusal: "too-long" };
  }
  if (!NAMED_CLASS_SLUG_RE.test(slug)) {
    return { ok: false, refusal: "not-a-slug" };
  }
  if (library.some(entry => entry.slug === slug)) {
    return { ok: false, refusal: "already-taken" };
  }
  return { ok: true, slug };
}

/**
 * Whether a class may take a new name, and what to store if it may.
 *
 * The same grammar, and the same collision rule, except that a class keeping
 * its own slug is not a collision with itself — an author opening a rename and
 * confirming it unchanged is not an error.
 */
export function renamedClassName(
  name: string,
  classId: string,
  library: readonly NamedClass[]
): ClassNameOutcome {
  const others = library.filter(entry => entry.id !== classId);
  return newClassName(name, others);
}

/**
 * A node's class ids with one added, or unchanged if it already carries it.
 *
 * Appended rather than inserted in library order. The stored order does not
 * decide precedence, so rewriting it would produce a document change that
 * renders identically — a diff an author cannot explain and a version history
 * entry that means nothing.
 */
export function withClassApplied(
  nodeClassIds: readonly string[],
  classId: string
): string[] {
  if (nodeClassIds.includes(classId)) return [...nodeClassIds];
  return [...nodeClassIds, classId];
}

/** A node's class ids with one removed. */
export function withClassRemoved(
  nodeClassIds: readonly string[],
  classId: string
): string[] {
  return nodeClassIds.filter(id => id !== classId);
}

/** What an author is told before a class is deleted. */
export interface DeletionWarning {
  /** Documents known to reference it. A floor on the damage, not its size. */
  knownDocuments: number;
  /**
   * Whether there is a number worth naming in the prompt.
   *
   * This chooses the WORDING, never whether to ask. False means the index knows
   * of no document, which is not the same as there being none.
   */
  hasKnownUsage: boolean;
  /**
   * Always. Typed as the literal so no caller can make it conditional without
   * the change being visible in this file.
   */
  requiresConfirmation: true;
}

/**
 * What deleting a class would cost, in the terms the confirmation states.
 *
 * Deleting a class REMOVES it from every document that references it, rather
 * than leaving those nodes pointing at a definition that no longer exists.
 * Detaching instead — copying the styles onto each node so the appearance
 * survives — is a separate action an author asks for explicitly, because a
 * delete that silently preserved the look would be a delete the author cannot
 * see the effect of.
 *
 * The confirmation is unconditional. Skipping it when the count is zero would
 * put the whole weight of an irreversible edit on the one value the index is
 * known to produce wrongly: a class live on the site reads as zero whenever two
 * concurrent saves each removed the other's row. Zero is the cheapest case to
 * confirm and the only one that can be silently wrong, so it is the last one
 * that should be waved through.
 */
export function deletionWarning(
  row: Pick<ClassRow, "knownDocuments">
): DeletionWarning {
  return {
    knownDocuments: row.knownDocuments,
    hasKnownUsage: row.knownDocuments > 0,
    requiresConfirmation: true,
  };
}
