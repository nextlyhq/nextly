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
  findByID(args: {
    collection: string;
    id: string;
    locale?: string;
    fallbackLocale?: false | string;
    draft?: boolean;
    depth?: number;
    disableErrors?: boolean;
    overrideAccess?: boolean;
  }): Promise<unknown>;
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
  nextly: ClassUsageDirectApi,
  /**
   * The index collection's RESOLVED slug.
   *
   * Passed in rather than read from the module constant, because an integrator
   * may rename a plugin's collections and the schema then creates only the
   * renamed one. A store holding the declared name would issue every write
   * against a collection that does not exist, and each save would report a
   * maintenance failure on an installation that is otherwise correct.
   */
  indexCollection: string
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
        collection: indexCollection,
        where: args.where,
        limit: args.limit,
        page: args.page,
        sort: args.sort,
        ...AS_THE_SYSTEM,
      }),
    create: args =>
      nextly.create({
        collection: indexCollection,
        data: args.data,
        ...AS_THE_SYSTEM,
      }),
    delete: args =>
      nextly.delete({
        collection: indexCollection,
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
    const row =
      subject.variant === "draft"
        ? await readWorkingDraft(nextly, subject)
        : await readPublished(nextly, subject);
    return documentIn(row, subject);
  };
}

/**
 * The pending working draft, which only the DETAIL read can produce.
 *
 * A document that is already published keeps its main row at `published` and
 * its pending edits in a sidecar. The list read filters the main table, so it
 * returns nothing for such a document — and reading "nothing" as the draft's
 * content would record a pending draft as applying no classes at all.
 *
 * The overlay is implemented only on the by-id path (`includeWorkingDraft`,
 * `collection-query-service.ts:2722`), so draft subjects go through it. The
 * marker is what distinguishes an actual draft from the live row this call
 * falls back to when no draft exists.
 */
async function readWorkingDraft(
  nextly: ClassUsageDirectApi,
  subject: ClassUsageSubject
): Promise<unknown> {
  const row = await nextly.findByID({
    collection: subject.entity,
    id: subject.entityKey,
    draft: true,
    ...localeOptions(subject),
    depth: 0,
    disableErrors: true,
    ...AS_THE_SYSTEM,
  });
  if (typeof row !== "object" || row === null) return undefined;
  // Without the marker this is the live row, not a draft. Answering it would
  // file the published classes under a draft that does not exist.
  return (row as Record<string, unknown>)._isWorkingDraft === true
    ? row
    : undefined;
}

/**
 * The published row, read through the LIFECYCLE filter.
 *
 * The list read is used here because it is the only one that carries `status`,
 * which is authoritative and also constrains a localized companion's own
 * `_status`. The by-id path has no lifecycle parameter at all, so a published
 * subject read that way would accept a document whose only row is a draft.
 */
async function readPublished(
  nextly: ClassUsageDirectApi,
  subject: ClassUsageSubject
): Promise<unknown> {
  const page = await nextly.find({
    collection: subject.entity,
    where: { id: { equals: subject.entityKey } },
    limit: 1,
    status: "published",
    ...localeOptions(subject),
    depth: 0,
    ...AS_THE_SYSTEM,
  });
  return page.items[0];
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
 * not exist rows of its own.
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
 * array and a record has none.
 */
function documentIn(row: unknown, subject: ClassUsageSubject): unknown {
  if (typeof row !== "object" || row === null) return undefined;
  return (row as Record<string, unknown>)[subject.field];
}
