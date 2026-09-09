/**
 * What every usage index has in common, and what each one supplies for itself.
 *
 * Two indexes derive rows from the same documents by the same rules and differ
 * only in WHAT they record a reference to: `nx_pb_class_usage` records the
 * named classes a document applies, and the component index records the
 * component definitions it embeds. Everything between — which subjects a
 * written document has, how stored rows are read back, which are inserted and
 * which removed, how a rebuild sweeps — is one question, and this is what lets
 * it have one implementation.
 *
 * ## Why a descriptor rather than two families
 *
 * Measured before this existed: the class-usage modules are 2,655 non-test
 * lines and the token `classId` appears in FOUR of the ten, fourteen times.
 * `subjectWhere` already binds only the six subject columns; a row reaches
 * storage by being spread, so the row's own field name is the column name. The
 * machinery was already generic in all but name, and a second copy of it would
 * have agreed with the first on the day it was written and drifted afterwards —
 * which is the failure the repository has a rule about, and which the clone
 * detector would have reported besides.
 *
 * ## What a descriptor may NOT decide
 *
 * The SUBJECT. Both indexes answer questions about the same documents, so a
 * row that identified its subject differently could not be reconciled or swept
 * by the shared pass — and the two would disagree about which document a row
 * describes, which is the one thing no amount of per-index freedom is worth.
 *
 * @module usage-index
 */
import type { DocumentLimits } from "@nextlyhq/blocks-engine";

/**
 * Which kind of content a row points at.
 *
 * Collections and singles are addressed differently and the difference is not
 * cosmetic, so the kind is stored rather than inferred from whether
 * `entityKey` happens to be empty.
 */
export type UsageScope = "collection" | "single";

/**
 * Which of a document's two stored forms a row was read from.
 *
 * A closed set rather than free text. Both are stored as text and both
 * partition the index into subject families, so a value outside the set
 * produces rows that no query built from a real subject can ever select —
 * neither to reconcile nor to sweep. A typo does not fail, it accumulates.
 */
export type UsageVariant = "published" | "draft";

/**
 * The document a row describes, without the reference it records.
 *
 * SHARED between indexes deliberately, and the one thing a descriptor cannot
 * override. Six columns identify a subject and every query binds all six; an
 * index that identified its subjects differently could not be reconciled by
 * the shared pass at all.
 *
 * `entityKey` and `locale` are empty strings rather than null, because the
 * columns have to form a total key and a nullable member of a uniqueness
 * constraint compares as unknown on most dialects. Nothing in the database
 * enforces that key today — a collection's declared indexes do not reach the
 * schema pipeline — so the reconciler is what keeps rows unique instead.
 */
export interface UsageSubject {
  scope: UsageScope;
  /** The collection's or single's slug. */
  entity: string;
  /**
   * Which document within `entity`, or empty for a single.
   *
   * A single has one document, and its ROW MAY NOT EXIST — an unedited single
   * still renders its declared defaults. So a single is addressed by its slug
   * alone, in `entity`, and this stays empty rather than holding an id that is
   * absent until somebody types.
   *
   * Kept as an empty string rather than null so the five columns form a total
   * key. Nothing in the database enforces that today — a collection's declared
   * indexes do not reach the schema pipeline, so the composite constraint this
   * key describes cannot currently be created — and it is the reconciler that
   * keeps the rows unique instead. A null here would still be wrong the day
   * that changes, because a nullable member of a uniqueness constraint compares
   * as unknown on most dialects.
   */
  entityKey: string;
  /** The blocks field the reference was found in. */
  field: string;
  /**
   * Which locale's document the reference was found in, or empty when the field
   * is not localized.
   *
   * A localized blocks field stores a DOCUMENT PER LOCALE, and each may apply a
   * different set of classes. Without this column every locale would share one
   * key, so maintaining one locale's document would remove the rows for classes
   * only another locale uses — and a class still rendered by that other locale
   * would read as unused, which is the answer that permits deleting it.
   *
   * Empty rather than null for the reason `entityKey` is: the columns have to
   * form a total key, and a nullable member of a uniqueness constraint compares
   * as unknown on most dialects.
   */
  locale: string;
  /**
   * Which stored variant of the document the reference was found in —
   * `"published"` or `"draft"`.
   *
   * A collection with drafts holds TWO documents under one id, and they can
   * apply different classes: a pure draft edit leaves the live row untouched,
   * so the published page and the pending draft disagree until it is
   * published. Without this column they share one key, and indexing either
   * removes the rows the other justifies — so a class the published page still
   * renders reads as unused because a draft dropped it.
   *
   * Both are worth counting rather than only the published one. The count
   * answers "is this class safe to delete", and deleting a class an unpublished
   * draft applies breaks that draft the moment somebody publishes it.
   */
  variant: UsageVariant;
}

/** What a document references, and whether the whole of it could be read. */
export interface UsageDerivation {
  /** The reference ids the document holds, without repeats. */
  ids: readonly string[];
  /**
   * Whether the whole document was read.
   *
   * False means `ids` is a PREFIX. A caller must not read a missing id as
   * absent while this is false — an absence produced by a bound is what
   * permits deleting something a page still renders.
   */
  complete: boolean;
}

/**
 * One index's own answers, supplied to the shared machinery.
 *
 * Generic over the row so each index keeps a TYPED row rather than a record of
 * unknowns: the reference column's name differs between them, and reading it
 * through a string key would give up the checking that stops a row being built
 * with the wrong column in the first place.
 */
export interface UsageIndex<TRow extends UsageSubject> {
  /**
   * The stored column the reference id lives in.
   *
   * A string because the row PARSER validates columns by name against data
   * that arrives unvalidated. Everywhere a row is built or read as a value,
   * the typed members below are used instead.
   */
  readonly referenceColumn: string;

  /** The reference a row records. */
  referenceOf(row: TRow): string;

  /** A row recording that `subject` references `referenceId`. */
  rowFor(subject: UsageSubject, referenceId: string): TRow;

  /**
   * The row recording that `subject` could not be read whole.
   *
   * ONE row rather than a row per reference the walk managed, because a
   * partial list stored as a list is indistinguishable from a complete one.
   * Each index chooses how to make it disjoint from every real reference: the
   * class index can exceed the length its ids are capped at, and the component
   * index cannot, because a component id is constrained by nothing but being a
   * nonempty string.
   */
  markerFor(subject: UsageSubject): TRow;

  /** Whether a row is that marker rather than a reference. */
  isMarker(row: TRow): boolean;

  /** What the stored document references, under the bounds it is drawn with. */
  derive(document: unknown, limits: DocumentLimits): UsageDerivation;
}
