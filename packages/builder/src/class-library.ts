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
 * the manager calls unused.
 *
 * ## Nothing here writes
 *
 * Every function returns a new value and stores nothing. Persistence belongs to
 * whoever owns the document, which in the page builder is the section-scoped
 * site-style write this package cannot reach. The same reason the tokens studio
 * lifts its edits.
 *
 * ## A usage count is evidence, not a fact
 *
 * The counts handed in are read from an index maintained on write, and that
 * index has no concurrency control: two saves that interleave can leave a count
 * that is too high. It is corrected by the next rebuild, and it errs upward by
 * design, because over-counting refuses a deletion that was safe while
 * under-counting permits one that was not.
 *
 * So a count is treated here as a lower bound on safety rather than a
 * measurement: {@link deletionWarning} names the number without asserting it is
 * exact, and nothing in this module decides on a count alone.
 *
 * @module class-library
 */
import {
  NAMED_CLASS_SLUG_RE,
  MAX_NAMED_CLASS_NAME_LENGTH,
  namedClassName,
  orderedNamedClasses,
  type NamedClass,
} from "@nextlyhq/blocks-engine";

/**
 * How many documents reference a class, keyed by class id.
 *
 * Keyed by ID rather than by name for the reason documents are: a rename must
 * not orphan a count, and a name is free to change under it.
 */
export type ClassUsageCounts = Readonly<Record<string, number>>;

/** Which classes the manager lists. */
export type ClassFilter = "all" | "unused" | "on-this-page";

/** One row of the class manager, and one entry in the selector's list. */
export interface ClassRow {
  /** Stable identity, which documents reference and rename never changes. */
  id: string;
  /** The CSS-facing slug, as stored. */
  slug: string;
  /** The emitted class name, which is what appears in a page's markup. */
  className: string;
  /**
   * Documents referencing this class, best-effort and biased upward.
   *
   * Absent from the counts means zero: a class no document has ever referenced
   * has no row in the index, and treating that as unknown would leave every
   * newly created class unfilterable.
   */
  documents: number;
  /** Whether the document currently open applies this class to any node. */
  onThisPage: boolean;
}

/**
 * Every class in the library, in the order that decides precedence.
 *
 * Ordered by the library's own `orderIndex` rather than by name, because that
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
  return orderedNamedClasses(library).map(entry => ({
    id: entry.id,
    slug: entry.slug,
    className: namedClassName(entry.slug),
    documents: usage[entry.id] ?? 0,
    onThisPage: onPage.has(entry.id),
  }));
}

/**
 * The rows one filter shows.
 *
 * "Unused" asks the index and "on this page" asks the open document, and they
 * are different questions rather than two views of one: a class applied only by
 * an unpublished draft counts as used while appearing on no page an author has
 * open. Keeping them separate is what lets the manager say "unused site-wide"
 * without contradicting the canvas.
 */
export function filterClassRows(
  rows: readonly ClassRow[],
  filter: ClassFilter
): ClassRow[] {
  if (filter === "unused") return rows.filter(row => row.documents === 0);
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
 * An id the library does not know is dropped rather than rendered as an unnamed
 * chip. The engine omits such a class from the stylesheet, so a chip for it
 * would offer to edit something no page can display.
 */
export function appliedClasses(
  library: readonly NamedClass[],
  nodeClassIds: readonly string[]
): ClassRow[] {
  const applied = new Set(nodeClassIds);
  return classRows(library, {}, []).filter(row => applied.has(row.id));
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
): ClassRow[] {
  const applied = new Set(nodeClassIds);
  const needle = query.trim().toLowerCase();
  return classRows(library, {}, [])
    .filter(row => !applied.has(row.id))
    .filter(row => needle === "" || row.slug.includes(needle));
}

/** Why a name cannot become a class, or null when it can. */
export type NameRefusal = "empty" | "too-long" | "not-a-slug" | "already-taken";

/**
 * Whether a typed name can become a new class.
 *
 * The grammar is the engine's, not a second one: a slug reaches a CSS selector,
 * and a name this module accepted but the compiler refused would be stored as a
 * class no renderer ever puts on an element.
 *
 * A collision is refused rather than merged. Two classes with one slug emit the
 * same selector, so the later would silently override the earlier for every
 * node carrying it, and neither author would see why.
 */
export function newClassRefusal(
  name: string,
  library: readonly NamedClass[]
): NameRefusal | null {
  const slug = name.trim();
  if (slug.length === 0) return "empty";
  if (slug.length > MAX_NAMED_CLASS_NAME_LENGTH) return "too-long";
  if (!NAMED_CLASS_SLUG_RE.test(slug)) return "not-a-slug";
  if (library.some(entry => entry.slug === slug)) return "already-taken";
  return null;
}

/**
 * Whether a class may take a new name.
 *
 * The same grammar, and the same collision rule, except that a class keeping
 * its own slug is not a collision with itself — an author opening a rename and
 * confirming it unchanged is not an error.
 */
export function renameRefusal(
  name: string,
  classId: string,
  library: readonly NamedClass[]
): NameRefusal | null {
  const others = library.filter(entry => entry.id !== classId);
  return newClassRefusal(name, others);
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
  /** Documents that reference it, as counted. */
  documents: number;
  /** Whether the author must confirm against the count rather than just accept. */
  requiresConfirmation: boolean;
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
 * A referenced class therefore requires a confirmation naming the number, and
 * the number is the count's own value: it is biased upward, so a confirmation
 * built on it warns about deletions that were safe rather than waving through
 * ones that were not.
 */
export function deletionWarning(
  row: Pick<ClassRow, "documents">
): DeletionWarning {
  return {
    documents: row.documents,
    requiresConfirmation: row.documents > 0,
  };
}
