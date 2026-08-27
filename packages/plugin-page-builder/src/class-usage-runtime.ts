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
 * The VARIANT decides which read can answer. A draft is asked for in two ways
 * because two different stored things are both drafts — see `readDraft`. A
 * published subject is asked for through the lifecycle filter alone.
 *
 * `locale` is the subject's, except that the SHARED sentinel is sent as
 * `undefined` rather than as `""`. A shared field stores one value that every
 * language reads, and that value is what a read with no locale resolves to;
 * asking for the empty-string locale asks for a language nobody configured.
 *
 * `depth: 0` because the rows are derived from the stored blocks JSON. Populating
 * relationships would replace ids with documents, which changes the shape the
 * derivation walks while adding reads a save does not need.
 */
export function classUsageDocumentReader(
  nextly: ClassUsageDirectApi
): ClassUsageDocumentReader {
  return async (subject: ClassUsageSubject) => {
    const row =
      subject.variant === "draft"
        ? await readDraft(nextly, subject)
        : await readByLifecycle(nextly, subject, "published");
    return documentIn(row, subject);
  };
}

/**
 * The document a DRAFT subject names, which two different reads can hold.
 *
 * "Is this a draft" has one authoritative answer and it is not a property of
 * any single column, which is why this asks twice instead of inspecting a row.
 *
 * A document that has been published and edited since keeps its main row
 * published and its pending edits in a SIDECAR. Only the by-id read overlays
 * that sidecar, and the overlay is the more current draft content, so it is
 * asked for first and wins.
 *
 * Everything else that is a draft is a stored ROW whose lifecycle state says
 * so, and the list read's `status` filter is the only thing that can name it:
 * it is authoritative and it also constrains a localized companion's own
 * `_status`. That covers the two cases no marker can:
 *
 * - a document that has NEVER been published, whose main row is itself the
 *   draft with no sidecar to overlay and therefore no marker;
 * - a non-default LOCALE that was explicitly unpublished while the default
 *   stays published, where the companion goes draft and the main row is
 *   deliberately left published
 *   (`domains/i18n/writes-status.integration.test.ts:157`).
 *
 * Reading the main row's `status` answered the first of those and got the
 * second exactly backwards, because that column belongs to the entry and not
 * to the language being asked about. Both were the same mistake: deriving a
 * lifecycle answer from a column instead of from the filter that owns it.
 *
 * A published document with no pending draft is refused by both reads — no
 * marker on the by-id fallback, and nothing matching `status: "draft"` — which
 * is correct, because it has no draft variant to record.
 */
async function readDraft(
  nextly: ClassUsageDirectApi,
  subject: ClassUsageSubject
): Promise<unknown> {
  const overlaid = await readWorkingDraftOverlay(nextly, subject);
  if (overlaid !== undefined) return overlaid;
  return readByLifecycle(nextly, subject, "draft");
}

/**
 * The pending working draft, which only the DETAIL read can produce.
 *
 * The overlay is implemented only on the by-id path (`includeWorkingDraft`,
 * `collection-query-service.ts:2722`). The marker is set exactly when a sidecar
 * was surfaced (`collection-query-service.ts:3378`), so it identifies the
 * overlay and nothing else — this call falls back to the live row when there is
 * no sidecar, and answering that would file published classes under a draft.
 */
async function readWorkingDraftOverlay(
  nextly: ClassUsageDirectApi,
  subject: ClassUsageSubject
): Promise<unknown> {
  const row = await nextly.findByID({
    collection: subject.entity,
    id: subject.entityKey,
    draft: true,
    ...localeOptions(subject),
    depth: 0,
    // No error suppression. `disableErrors` converts EVERY unsuccessful result
    // to null, not only a missing row — so a failing `afterRead` hook or a
    // broken overlay query would read as "this document has no draft", and the
    // subject would be left alone with the caller told nothing. A raised
    // failure is reported instead, which is what tells a caller the index is
    // stale.
    //
    // Nothing is lost by dropping it: a document with no pending draft is a
    // SUCCESSFUL read of the live row, which the marker test below refuses.
    // Absence and failure were never the same answer here.
    ...AS_THE_SYSTEM,
  });
  const record = rowForSubject(row, subject);
  if (record === undefined) return undefined;
  return record._isWorkingDraft === true ? record : undefined;
}

/**
 * The row this document has in one lifecycle state, through the filter.
 *
 * The list read is the only one carrying `status`, which is authoritative and
 * also constrains a localized companion's own `_status`. The by-id path has no
 * lifecycle parameter at all, so it can neither name a variant nor see a
 * per-language one.
 */
async function readByLifecycle(
  nextly: ClassUsageDirectApi,
  subject: ClassUsageSubject,
  status: "published" | "draft"
): Promise<unknown> {
  const page = await nextly.find({
    collection: subject.entity,
    where: { id: { equals: subject.entityKey } },
    limit: 1,
    status,
    ...localeOptions(subject),
    depth: 0,
    ...AS_THE_SYSTEM,
  });
  return rowForSubject(page.items[0], subject);
}

/**
 * The row a read answered, once it is confirmed to BE the document asked for.
 *
 * A predicate is a request, not a guarantee. `beforeOperation` and `beforeRead`
 * can replace the supplied filter or clear it outright, and the query service
 * honours that deliberately — returning `null` from `beforeRead` means "this
 * read has no filter" and is preserved as such
 * (`collection-query-service.ts:688-713`). Those hooks run regardless of
 * `overrideAccess`, so nothing this module passes can prevent it.
 *
 * The first row of an unfiltered read is then simply some other document, and
 * taking it would derive that document's classes and file them under this
 * subject — while removing the rows the real document's references had earned.
 * A class the live page still renders would read as unused and become
 * deletable, which is the one direction that loses data.
 *
 * So a mismatch RAISES rather than resolving to nothing. Answering `undefined`
 * would be indistinguishable from an absent document, and absence deliberately
 * leaves a subject's rows alone — the caller would be told the subject was
 * reconciled when the read never reached it. A raised failure is reported to
 * the caller and says the index is stale.
 *
 * An empty result is NOT a mismatch: no row means no document, which is a
 * different and legitimate answer.
 */
function rowForSubject(
  row: unknown,
  subject: ClassUsageSubject
): Record<string, unknown> | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const record = row as Record<string, unknown>;
  if (record.id === subject.entityKey) return record;
  throw new Error(
    `Class-usage read for ${subject.entity}:${subject.entityKey} answered ` +
      `id="${String(record.id)}"; the read was widened past its predicate and ` +
      `its document must not be filed under this subject.`
  );
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
