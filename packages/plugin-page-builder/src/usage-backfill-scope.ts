/**
 * What one unit of an index backfill is, and how the units are enumerated.
 *
 * A rebuild repairs ONE (collection, field, locale, variant) at a time, walking
 * every document in it. That tuple is therefore the unit of work a backfill can
 * finish, record and resume from - anything smaller is not a state the rebuild
 * can be asked to stop at, and anything larger cannot be recorded as done.
 *
 * ## Why this derives the locale and variant rules rather than stating them
 *
 * Which locales a field is stored under, and whether a collection has a draft
 * variant, are decided in `class-usage-subjects`. Restating them here would be
 * a second implementation of a question that already has one, and the two would
 * agree until somebody changed one of them - at which point a backfill would
 * either skip a subject the write path maintains, leaving it permanently
 * unindexed while readiness reported complete, or claim one that does not exist
 * and never finish.
 *
 * So a scope is that enumeration with the DOCUMENT dropped: the same product,
 * asked of a collection rather than of one row in it.
 *
 * @module usage-backfill-scope
 */
import type { DocumentLimits } from "@nextlyhq/blocks-engine";

import {
  classUsageSubjectsFor,
  type BlocksFieldDescriptor,
} from "./class-usage-subjects";
import type { ClassUsageVariant } from "./collections/class-usage-index";

/**
 * The character joining a scope key's parts.
 *
 * A unit separator, because it is the one character none of the parts can
 * contain: slugs, field names and locales are identifiers, and the variant is
 * one of two literals. Joining on something they COULD hold - a dash, a colon,
 * a slash - lets two different scopes produce one key, and the row that key
 * names says "this scope is backfilled". A collision therefore marks a scope
 * done that was never walked, which is the direction that leaves an index
 * permanently short while readiness reports complete.
 */
const KEY_SEPARATOR = "\u001F";

/** One unit of backfill work: everything a rebuild needs except the stores. */
export interface BackfillScope {
  /** The collection whose documents are walked. */
  entity: string;
  /** The blocks field on those documents. */
  field: string;
  /** The locale being rebuilt, or the empty string when not localized. */
  locale: string;
  /** Which stored variant is being rebuilt. */
  variant: ClassUsageVariant;
}

/** A collection, described by what decides its scopes. */
export interface BackfillCollection {
  /** The collection's slug. */
  collection: string;
  /** Its blocks fields, and whether each stores per locale. */
  fields: readonly BlocksFieldDescriptor[];
  /** The site's configured locales. */
  locales: readonly string[];
  /** Whether this collection stores a draft beside its published row. */
  hasDrafts: boolean;
}

/**
 * Every scope a collection contributes.
 *
 * Delegates the product to `classUsageSubjectsFor` and drops `entityKey`, which
 * is the one field a per-collection walk does not have. The empty string passed
 * for it is never read back: a scope is projected out of the result, so that
 * value only has to be one the enumeration accepts.
 */
export function backfillScopesFor(
  collection: BackfillCollection
): BackfillScope[] {
  return classUsageSubjectsFor({
    collection: collection.collection,
    entityKey: "",
    fields: collection.fields,
    locales: collection.locales,
    hasDrafts: collection.hasDrafts,
  }).map(subject => ({
    entity: subject.entity,
    field: subject.field,
    locale: subject.locale,
    variant: subject.variant,
  }));
}

/**
 * The stable id a completed scope is recorded under.
 *
 * Total in the scope: the four parts are never optional and their order is
 * fixed, so two scopes are equal exactly when their keys are.
 */
export function backfillScopeKey(scope: BackfillScope): string {
  return [scope.entity, scope.field, scope.locale, scope.variant].join(
    KEY_SEPARATOR
  );
}

/**
 * Which DERIVATION a recorded scope belongs to.
 *
 * A scope says WHICH documents were walked; this says what they were read as.
 * The index is derived under the same bounds the renderer draws under, so
 * changing `pageBuilder({ limits })` changes what every row should say — and a
 * scope recorded under the old bounds is not finished work under the new ones.
 *
 * Both directions are wrong and they are wrong differently. Lowering `maxNodes`
 * leaves rows for nodes the renderer no longer reaches, counted as usage.
 * Raising it leaves `unreadable` markers standing, so every count stays a floor
 * for ever — and that one reads as the completeness flag working rather than as
 * stale state, which is why it would not be noticed.
 *
 * ## Why a generation beside the key rather than inside it
 *
 * Folding the bounds into {@link backfillScopeKey} was the other option and it
 * is worse. The key is an IDENTITY for a scope, so two records of the same
 * scope would compare unequal — which turns "redo this work" into "this is
 * different work" and leaves the old row with nothing that will ever reconcile
 * it. A generation invalidates progress while the identity stays put, so the
 * same scope is walked again and its existing rows are reconciled rather than
 * orphaned.
 *
 * ## Why the INDEX collections are part of it
 *
 * A generation says what the documents were read as; it also has to say where
 * the result was put. A host may `.rename()` either usage index, and core then
 * registers the new slug as a new code-first collection while keeping the old
 * one as an orphan — so the rows this progress certifies sit in a table nothing
 * reads any more, and the new index is EMPTY. With the bounds unchanged the
 * generation would be unchanged too, the completed-scope rows would be accepted
 * against that empty index, and health would report its zero counts as exact. A
 * count of zero reported as exact is what permits deleting a component every
 * existing document still uses, which is the outcome this index exists to stop.
 *
 * BOTH indexes, not only the one being read: a scope's walk writes to each, so a
 * scope recorded before either was remapped is not finished work after it.
 */
export function backfillGeneration(derivation: {
  limits: DocumentLimits;
  /** The RESOLVED slug class-usage rows were written to. */
  classIndex: string;
  /** The RESOLVED slug component-usage rows were written to. */
  componentIndex: string;
}): string {
  const { limits, classIndex, componentIndex } = derivation;
  // Spelled out rather than JSON-stringified: key order in a serialisation is
  // not part of the type, so a refactor that reorders the interface would
  // silently invalidate every site's progress. Naming each part means a change
  // to what the generation covers has to be written here.
  //
  // `|` rather than the `x` this used while it held only numbers: a slug matches
  // /^[a-z][a-z0-9_-]*$/ and so may contain an `x`, which would let two
  // different (bounds, slug) tuples serialise to one string. A fence that cannot
  // tell two derivations apart fails in the direction that accepts stale work.
  return [
    limits.maxDepth,
    limits.maxNodes,
    limits.maxBytes,
    classIndex,
    componentIndex,
  ].join("|");
}
