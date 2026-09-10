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
