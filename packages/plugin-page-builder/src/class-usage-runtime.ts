/**
 * Reaching the database from inside a save hook.
 *
 * `class-usage-write` decides WHICH subjects a save owes an update to and
 * `class-usage-maintenance` reconciles one of them. Both take their database
 * access as an interface so they can be tested against values. This is the one
 * place that turns those interfaces into real calls, through the Direct API a
 * hook is handed on `ctx.req.nextly`.
 *
 * Kept separate from both so the decisions stay testable without a database,
 * and so everything that knows how this runtime addresses a locale or a variant
 * lives in one file.
 *
 * @module class-usage-runtime
 */
import type { ClassUsageIndexStore } from "./class-usage-maintenance";
import type { ClassUsageSubject } from "./class-usage-reconcile";
import type { ClassUsageDocumentReader } from "./class-usage-write";

/**
 * The part of the Direct API this needs.
 *
 * Declared structurally rather than imported as `Nextly`, because a hook may be
 * handed nothing — `ctx.req.nextly` is optional — and because naming only the
 * three calls used keeps what this module can do legible. A wider type would
 * let a later edit reach for `update` or `delete` on a content collection
 * without that showing up here.
 */
export interface ClassUsageDirectApi {
  find(args: {
    collection: string;
    where?: Record<string, unknown>;
    limit?: number;
    page?: number;
    sort?: string;
    locale?: string;
    fallbackLocale?: false | string;
    status?: "published" | "draft" | "all";
    depth?: number;
    overrideAccess?: boolean;
  }): Promise<{ items: unknown[]; meta: { hasNext: boolean } }>;
  create(args: {
    collection: string;
    data: Record<string, unknown>;
    overrideAccess?: boolean;
  }): Promise<unknown>;
  delete(args: {
    collection: string;
    id: string;
    overrideAccess?: boolean;
  }): Promise<unknown>;
}

/**
 * The index table is written on the system's behalf, never a user's.
 *
 * Its access rules deny everything, which is what keeps these rows private —
 * `internal` only sets `admin.hidden`, so the rules are the single layer and
 * not a second one behind a first. A maintenance write that respected the
 * acting user would therefore fail for every user, and the index would simply
 * never be maintained.
 */
const AS_THE_SYSTEM = { overrideAccess: true } as const;

/**
 * The index store, backed by the Direct API.
 *
 * The paging shape is translated here rather than at the call site: the Direct
 * API answers `{ docs, hasNextPage }` and the reconciler asks for
 * `{ items, meta: { hasNext } }`. A missing `docs` becomes an EMPTY page rather
 * than an error, because the reconciler reads a page of no rows as "this
 * subject has no rows recorded" — which is the correct reading of a collection
 * that has never been written to.
 */
export function classUsageIndexStore(
  nextly: ClassUsageDirectApi
): ClassUsageIndexStore {
  return {
    // Passed through, not translated. The Direct API already answers
    // `{ items, meta: { hasNext } }` — the same envelope the reconciler asks
    // for. An adapter here would be a second statement of one shape, and the
    // one it stated was the SERVICE's inner `{ docs, hasNextPage }`, which this
    // never sees: every page came back empty, so no stored row was ever found,
    // nothing was removed, and every save re-inserted rows it already had.
    find: args =>
      nextly.find({
        collection: args.collection,
        where: args.where,
        limit: args.limit,
        page: args.page,
        sort: args.sort,
        ...AS_THE_SYSTEM,
      }),
    create: args =>
      nextly.create({
        collection: args.collection,
        data: args.data,
        ...AS_THE_SYSTEM,
      }),
    delete: args =>
      nextly.delete({
        collection: args.collection,
        id: args.id,
        ...AS_THE_SYSTEM,
      }),
  };
}

/**
 * Resolve a subject to the document behind it.
 *
 * The three mappings here are the whole reason this file exists, and each is a
 * place the index can be filed against the wrong document:
 *
 * `draft` is derived from the VARIANT and is passed on both branches. The
 * Direct API overlays the pending working draft only when asked, so omitting it
 * for a draft subject reads the published row and files its classes as the
 * draft's — and passing it for a published subject does the reverse wherever a
 * draft exists. The two subjects are separate rows precisely because those two
 * documents can differ.
 *
 * `locale` is the subject's, except that the SHARED sentinel is sent as
 * `undefined` rather than as `""`. A shared field stores one value that every
 * language reads, and that value is what a read with no locale resolves to;
 * asking for the empty-string locale asks for a language nobody configured.
 *
 * `depth: 0` because the rows are derived from the stored blocks JSON. Populating
 * relationships would replace ids with documents, which changes the shape the
 * derivation walks while adding reads a save does not need.
 *
 * `disableErrors` turns a missing document into `null`, which the caller treats
 * as "leave this subject alone" rather than as a failure. That is the right
 * reading for an untranslated locale or a document with no pending draft, both
 * ordinary states.
 */
export function classUsageDocumentReader(
  nextly: ClassUsageDirectApi
): ClassUsageDocumentReader {
  return async (subject: ClassUsageSubject) => {
    const page = await nextly.find({
      collection: subject.entity,
      where: { id: { equals: subject.entityKey } },
      limit: 1,
      // The LIFECYCLE filter, which is the authoritative way to name a variant
      // and the only one that works everywhere. `findByID`'s `draft` flag is
      // documented as effective "only on a drafts-enabled, NON-LOCALIZED
      // collection", and drafts and localization are not mutually exclusive —
      // so on a localized collection it is inert and every draft subject would
      // silently read the live row. `status` also constrains the localized
      // companion's own `_status`, which is what makes a per-locale draft
      // addressable at all.
      status: subject.variant,
      ...localeOptions(subject),
      // Rows derive from the stored blocks JSON. Populating relationships
      // replaces ids with documents, changing the shape the derivation walks
      // while adding reads a save does not need.
      depth: 0,
      ...AS_THE_SYSTEM,
    });
    return documentIn(page.items[0], subject);
  };
}

/**
 * How a subject's locale is asked for.
 *
 * The SHARED sentinel asks with no locale at all: a shared field stores one
 * value every language reads, and that value is what a read with no locale
 * resolves to. Asking for the `""` locale asks for a language nobody
 * configured.
 *
 * A real locale asks with FALLBACK OFF. Fallback is on by default, so a locale
 * with no translation resolves the field from its fallback chain — and filing
 * that document's classes under `subject.locale` gives a translation that does
 * not exist rows of its own. Every subject has to be derived from its own
 * stored translation or the per-locale model the reconciler and the rebuild
 * share stops being true.
 */
function localeOptions(subject: ClassUsageSubject): {
  locale?: string;
  fallbackLocale?: false;
} {
  if (subject.locale === "") return {};
  return { locale: subject.locale, fallbackLocale: false };
}

/**
 * The block document a row carries for one subject.
 *
 * The row is the whole record; the document this subject is keyed by lives at
 * `record[field]`, which is where the rebuild reads it. Returning the record
 * instead derives NO rows at all — the derivation walks a top-level `nodes`
 * array and a record has none — so every class the document applies reads as
 * unused, which is the state that licences deleting one a page still renders.
 *
 * An absent row answers `undefined`, and that is a DEFINITE answer rather than
 * an unknown one: the query named this document and this lifecycle state, and
 * a read that could not be performed throws instead of answering empty. So the
 * subject reconciles to zero rows, which is what removes the rows of a draft
 * that has since been published or discarded. Leaving them would keep every
 * class that draft once applied recorded forever, blocking deletion of classes
 * the published document no longer uses.
 */
function documentIn(row: unknown, subject: ClassUsageSubject): unknown {
  if (typeof row !== "object" || row === null) return undefined;
  return (row as Record<string, unknown>)[subject.field];
}
