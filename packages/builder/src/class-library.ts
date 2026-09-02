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
  MAX_CLASSES_PER_NODE,
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

/**
 * How a usage figure is described, wherever it appears.
 *
 * One vocabulary, derived once. A row saying "3 known" beside a confirmation
 * saying the same number may be wrong in either direction is two uncertainty
 * policies for one value, and the shorter one is the one an author reads most.
 * Everything here names the INDEX and claims nothing about usage.
 */
export function usageSummary(row: Pick<ClassRow, "indexedDocuments">): string {
  return row.indexedDocuments === 0
    ? "Not in index"
    : `${row.indexedDocuments} in index`;
}

/**
 * How many classes the selector offers at once.
 *
 * A library may hold `MAX_NAMED_CLASSES`, and an empty query matches all of
 * them. Rendering that is neither usable — nobody reads two thousand rows —
 * nor cheap, and it puts every one of them in front of an author who is
 * typing to narrow. The remainder is REPORTED rather than dropped quietly:
 * a list that silently stops is a list an author believes is complete.
 */
export const MAX_SELECTOR_OPTIONS = 50;

/** Which classes the manager lists. */
export type ClassFilter = "all" | "not-in-index" | "on-this-page";

/**
 * A class as the surfaces name it, carrying nothing about where it is used.
 *
 * Separate from {@link ClassRow} so that a list which has not been given usage
 * data cannot present a fabricated zero. A selector offering classes knows
 * nothing about the index, and a type that made it say `indexedDocuments: 0`
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
   * Documents the usage index records for this class.
   *
   * Named for the INDEX rather than for usage, because that is all it can
   * report. The index loses rows to interleaved saves and retains them when a
   * removal fails, so it errs in both directions — this is neither a count nor
   * a bound on one. Absent means zero, because a filter has no third answer to
   * give, and nothing may read that zero as permission.
   */
  indexedDocuments: number;
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
function indexedUsage(usage: ClassUsageCounts, classId: string): number {
  if (!Object.hasOwn(usage, classId)) return 0;
  const count = usage[classId];
  // A document count is a whole number of documents. A fraction is as much a
  // sign of a corrupted row as a negative one, and admitting it would put a
  // number on screen that cannot describe anything the index counted.
  if (!Number.isInteger(count) || count < 0) return 0;
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
    indexedDocuments: indexedUsage(usage, choice.id),
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
  if (filter === "not-in-index") {
    return rows.filter(row => row.indexedDocuments === 0);
  }
  if (filter === "on-this-page") return rows.filter(row => row.onThisPage);
  return [...rows];
}

/**
 * The rows whose name contains what the author typed.
 *
 * Beside {@link filterClassRows} rather than inside it, because they answer
 * different questions: a filter narrows by what the INDEX or the open document
 * says, and this narrows by the name. Folding them together would make one
 * function whose result depends on two unrelated inputs, and the chips would
 * then have to know about the query to explain an empty list.
 *
 * Matched on the SLUG alone. A class has no other name — the id is storage and
 * an author never sees it — so matching an id would return rows for a string
 * they cannot see in the list.
 *
 * Case-insensitive because a slug is lowercase by construction and an author
 * typing capitals means the same class rather than none. Substring rather than
 * prefix: the useful search on `hero-banner-wide` is `banner`.
 */
export function searchClassRows(
  rows: readonly ClassRow[],
  query: string
): ClassRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...rows];
  return rows.filter(row => row.slug.toLowerCase().includes(needle));
}

/**
 * The class ids on a node that the compiler will actually read.
 *
 * The engine applies the first `MAX_CLASSES_PER_NODE` and warns about the rest,
 * so a node holding more is a node whose tail styles nothing. `styleSubjectFor`
 * bounds its own read the same way; this is the same bound, not a second one.
 */
export function readableNodeClassIds(
  nodeClassIds: readonly string[]
): string[] {
  return nodeClassIds.slice(0, MAX_CLASSES_PER_NODE);
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
  const applied = new Set(readableNodeClassIds(nodeClassIds));
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
  /*
   * The WHOLE stored array, deliberately not the readable prefix that
   * {@link appliedClasses} uses. The two answer different questions: that one
   * asks what the page renders, this one asks what applying would ADD. A class
   * stored past the cap renders nothing and yet is already on the node, so
   * offering it would append a second copy of an id the node already holds.
   */
  const applied = new Set(nodeClassIds);
  const needle = query.trim().toLowerCase();
  return siteClasses(library)
    .filter(choice => !applied.has(choice.id))
    .filter(choice => needle === "" || choice.slug.includes(needle));
}

/**
 * One thing the selector can do with what the author typed.
 *
 * The two are one list rather than a list plus a special case, because they
 * compete for the same keystroke: pressing Enter has to resolve to exactly one
 * action, and a surface holding "the matches" separately from "the new name"
 * has to invent a precedence between them. Here the order IS the precedence.
 */
export type ClassOption =
  | { readonly kind: "apply"; readonly choice: ClassChoice }
  | { readonly kind: "create"; readonly slug: string };

export interface SelectorOptions {
  /** The rows to draw, in the order Enter would take them. */
  readonly options: ClassOption[];
  /**
   * Applicable classes NOT offered, because the list is capped.
   *
   * Reported so the surface can say so. A truncated list that says nothing
   * reads as "these are all of them", which is the one thing it is not.
   */
  readonly hidden: number;
}

/**
 * What the selector offers for a query, applying first and creating last.
 *
 * Creating is offered only when the typed name could become a class, which
 * already excludes a name the library holds — so a query naming an existing
 * class never offers to create a second one under the same slug, and a query
 * naming a class the node already carries offers nothing at all. Both fall out
 * of {@link newClassName} rather than being re-decided here.
 *
 * Create sits LAST so that Enter on a partially typed name applies the match
 * rather than creating a near-duplicate. An author who means to create keeps
 * typing until nothing matches, which is the same gesture that makes the name
 * unambiguous. It is never dropped by the cap, for the same reason: it is the
 * one row the author's own typing produced.
 */
export function selectorOptions(
  library: readonly NamedClass[],
  nodeClassIds: readonly string[],
  query: string
): SelectorOptions {
  const applicable = applicableClasses(library, nodeClassIds, query);
  const shown = applicable.slice(0, MAX_SELECTOR_OPTIONS);
  const options: ClassOption[] = shown.map(choice => ({
    kind: "apply",
    choice,
  }));
  const outcome = newClassName(query, library);
  if (outcome.ok) options.push({ kind: "create", slug: outcome.slug });
  return { options, hidden: applicable.length - shown.length };
}

/** Why a name cannot become a class. */
export type NameRefusal =
  | "empty"
  | "too-long"
  | "not-a-slug"
  | "already-taken"
  | "library-full";

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
 * Whether the library has room for another class.
 *
 * Exported because two surfaces need the answer and only one of them is naming
 * a class. `newClassName` refuses a name when there is no room; the manager
 * panel has to decide whether to tell an author a class can be made at all,
 * and inferring that from an empty drawn list is wrong in exactly the case
 * that matters — `siteClasses` drops entries the compiler cannot use, so a
 * library of malformed entries draws nothing while every slot is taken.
 *
 * Counts the STORED entries, which is what capacity is about. The drawn list
 * is a different question and answering one with the other is the bug.
 */
export function classLibraryHasRoom(library: readonly NamedClass[]): boolean {
  return library.length < MAX_NAMED_CLASSES;
}

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
  /*
   * Capacity last, so a name that is ALSO malformed or taken reports the
   * problem the author can act on rather than one about the library.
   *
   * A class added to a full library becomes the first entry outside the
   * compiler's prefix, so it emits no rule — and `checkStoredClasses` refuses
   * the save outright rather than storing it quietly. Accepting the name here
   * would offer an author a class that cannot be saved OR rendered.
   */
  if (!classLibraryHasRoom(library)) {
    return { ok: false, refusal: "library-full" };
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

/** Why a class cannot go on a node. */
export type ApplyRefusal = "node-full";

/**
 * Whether a node can take one more class at all.
 *
 * Asked BEFORE a class exists, which is the case {@link withClassApplied}
 * cannot answer: creating a class and putting it on the selected node is one
 * intent, and the id it would use does not exist yet. Without this the create
 * path would reach a host that must either append a reference validation
 * rejects, or rediscover this same limit on its own.
 */
export function nodeHasRoom(nodeClassIds: readonly string[]): boolean {
  return nodeClassIds.length < MAX_CLASSES_PER_NODE;
}

/**
 * How many stored references the page does not apply.
 *
 * Zero for every node in a valid document. A legacy or hand-edited one can
 * store more, and those references style nothing while still being on the
 * node — a state the author has no way to discover from the canvas, and one
 * that makes a removal look as though it applied a class it never touched.
 */
export function unappliedNodeClassCount(
  nodeClassIds: readonly string[]
): number {
  return Math.max(nodeClassIds.length - MAX_CLASSES_PER_NODE, 0);
}

/** A node's new class ids, or why the class cannot go on it. */
export type ClassApplyOutcome =
  | { readonly ok: true; readonly classIds: string[] }
  | { readonly ok: false; readonly refusal: ApplyRefusal };

/**
 * A node's class ids with one added, or a refusal.
 *
 * Appended rather than inserted in library order. The stored order does not
 * decide precedence, so rewriting it would produce a document change that
 * renders identically — a diff an author cannot explain and a version history
 * entry that means nothing.
 *
 * A node already holding `MAX_CLASSES_PER_NODE` classes REFUSES rather than
 * appending. The compiler reads only that many and strict validation rejects
 * the document outright, so an appended reference would be recorded as an
 * application that neither renders nor can be published — the worst of the
 * three outcomes, because the editor would show it as done.
 *
 * A class the node already carries is not a refusal: nothing is wrong, and the
 * answer is simply the ids unchanged.
 */
export function withClassApplied(
  nodeClassIds: readonly string[],
  classId: string
): ClassApplyOutcome {
  if (nodeClassIds.includes(classId)) {
    return { ok: true, classIds: [...nodeClassIds] };
  }
  if (nodeClassIds.length >= MAX_CLASSES_PER_NODE) {
    return { ok: false, refusal: "node-full" };
  }
  return { ok: true, classIds: [...nodeClassIds, classId] };
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
  /** Documents the index records. Not a count, and not a bound on one. */
  indexedDocuments: number;
  /**
   * Whether there is a number worth naming in the prompt.
   *
   * This chooses the WORDING, never whether to ask. False means the index holds
   * no row, which is not the same as there being no document.
   */
  hasIndexedUsage: boolean;
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
  row: Pick<ClassRow, "indexedDocuments">
): DeletionWarning {
  return {
    indexedDocuments: row.indexedDocuments,
    hasIndexedUsage: row.indexedDocuments > 0,
    requiresConfirmation: true,
  };
}
