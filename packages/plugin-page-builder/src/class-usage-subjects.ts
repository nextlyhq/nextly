/**
 * Which index subjects one written document has.
 *
 * A save tells the write path that a document changed. It does not say WHICH
 * translation or WHICH stored form changed, because a collection hook is handed
 * only the collection, the operation and the data: the locale exists at the
 * mutation service's call site and is not forwarded, and `_status` is stripped
 * from the data on the way out as a companion-only column. So the hook cannot
 * name the one subject that moved.
 *
 * This enumerates them all instead, and the cost is bounded and one-sided.
 * Reconciliation issues NO writes when a subject's rows already agree with its
 * document, so the locales and variants that did not change cost a read each
 * and nothing more. Being unable to tell them apart is therefore a performance
 * question rather than a correctness one — which is the whole reason this shape
 * was chosen over teaching the hook to know.
 *
 * Pure, and deliberately so: it takes the configuration as values rather than
 * reading it. The decisions here — that an unlocalized field has exactly one
 * subject per variant, that a collection without drafts has no draft subject —
 * are the ones worth testing without a database in the way.
 *
 * @module class-usage-subjects
 */
import type { ClassUsageSubject } from "./class-usage-reconcile";
import type { ClassUsageVariant } from "./collections/class-usage-index";

/** The locale sentinel for a field whose values are not per-language. */
const NOT_LOCALIZED = "";

/** One blocks field on the written collection, and whether it stores per locale. */
export interface BlocksFieldDescriptor {
  /** The field's name, which is the `field` column of every row it owns. */
  name: string;
  /**
   * Whether this FIELD is localized, which is not the same as whether the
   * collection is.
   *
   * A collection can be localized while a given blocks field is not, and then
   * the field stores one document for the whole site. Enumerating a subject per
   * locale for it would file identical rows under every language and leave the
   * `""` subject — the one a read actually resolves — with none.
   */
  localized: boolean;
}

/** Everything about the written collection that decides its subjects. */
export interface WrittenDocument {
  /** The collection's slug, stored as `entity`. */
  collection: string;
  /** The document's id, stored as `entityKey`. */
  entityKey: string;
  /** Every blocks field declared on the collection. */
  fields: readonly BlocksFieldDescriptor[];
  /**
   * The site's configured locales, or empty when localization is off.
   *
   * Used only for fields that are themselves localized. An empty list and an
   * unlocalized field reach the same place — one subject under the `""`
   * sentinel — but for different reasons, and both are exercised.
   */
  locales: readonly string[];
  /**
   * Whether this collection keeps a working draft beside its published row.
   *
   * When it does, one id addresses TWO documents that can apply different
   * classes, and each is its own subject. When it does not, a draft subject
   * would describe a document that cannot exist, and its rows could never be
   * reconciled against anything — the unaddressable state the sweep cannot
   * reach.
   */
  hasDrafts: boolean;
}

/**
 * Every variant a document is stored in, given whether the collection drafts.
 *
 * Ordered published-first so the enumeration is stable, which matters because
 * a caller reconciles in this order and a test asserting the sequence would
 * otherwise be asserting a property of `Object.keys`.
 */
function variantsFor(hasDrafts: boolean): ClassUsageVariant[] {
  return hasDrafts ? ["published", "draft"] : ["published"];
}

/**
 * Every locale a FIELD is stored under.
 *
 * An unlocalized field answers the `""` sentinel whatever the site is
 * configured with, and a localized field on a site with no configured locales
 * answers the same — there is one document either way, and it is the one a read
 * with no locale resolves to.
 */
function localesFor(
  field: BlocksFieldDescriptor,
  locales: readonly string[]
): readonly string[] {
  if (!field.localized) return [NOT_LOCALIZED];
  return locales.length > 0 ? locales : [NOT_LOCALIZED];
}

/**
 * Enumerate the subjects a written document owns.
 *
 * The product of fields, their locales and the collection's variants. A
 * document with two blocks fields on a three-locale site with drafts has
 * twelve; one with a single unlocalized field on a site without drafts has one.
 *
 * Every subject carries `scope: "collection"`. Singles are addressed by slug
 * with an empty `entityKey` and are not reachable from a collection hook, so
 * they are not enumerated here — a plugin has no supported way to read a
 * Single's document, and inventing one would materialise every Single in the
 * app as a side effect of reading it.
 */
export function classUsageSubjectsFor(
  document: WrittenDocument
): ClassUsageSubject[] {
  const variants = variantsFor(document.hasDrafts);
  const subjects: ClassUsageSubject[] = [];

  for (const field of document.fields) {
    for (const locale of localesFor(field, document.locales)) {
      for (const variant of variants) {
        subjects.push({
          scope: "collection",
          entity: document.collection,
          entityKey: document.entityKey,
          field: field.name,
          locale,
          variant,
        });
      }
    }
  }

  return subjects;
}
