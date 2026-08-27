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
import { emptyBlockDocument } from "./fields/blocks-document";

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
 * The VARIANT decides only whether the read opts into the working draft.
 * Neither read carries a lifecycle filter, because an explicit `status`
 * constrains the main row and the localized companion TOGETHER and drops
 * documents that are legitimately in neither state — see `readPublished`.
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
        : await readPublished(nextly, subject);
    return documentIn(row, subject);
  };
}

/**
 * The document a DRAFT subject names.
 *
 * A document published and edited since keeps its main row published and its
 * pending edits in a SIDECAR, and only the by-id read overlays that sidecar.
 * The marker is set exactly when one was surfaced
 * (`collection-query-service.ts:3378`), so it identifies the overlay and
 * nothing else — this call falls back to the live row when there is no
 * sidecar, and answering that would file published classes under a draft that
 * does not exist.
 *
 * Nothing is lost by refusing it, because the published subject below reads
 * the main row WITHOUT a lifecycle filter. A document whose only row is a
 * draft is therefore recorded under that subject rather than nowhere, which is
 * where the never-published case is answered.
 */
async function readDraft(
  nextly: ClassUsageDirectApi,
  subject: ClassUsageSubject
): Promise<unknown> {
  const record = await readById(nextly, subject, { draft: true });
  if (record === undefined) return undefined;
  return record._isWorkingDraft === true ? record : undefined;
}

/**
 * The document a PUBLISHED subject names, read WITHOUT a lifecycle filter.
 *
 * The obvious shape here is `find({ status: "published" })`, and it is wrong in
 * three ways that all lose rows. `listEntries` pushes
 * `eq(schema.status, statusFilter.value)` for the MAIN row and then hands the
 * same value to the localized context for the companion's `_status`
 * (`collection-query-service.ts:1143-1159`), so an explicit status is a
 * CONJUNCTION over both:
 *
 * - a translation unpublished while the default stays published has a draft
 *   companion under a published main row, and matches neither `published` nor
 *   `draft`;
 * - the inverse state matches neither, symmetrically;
 * - a collection with `status: true` whose draft split is INELIGIBLE (drafts
 *   off, or a reachable password field) enumerates only this subject, so
 *   filtering it to `published` excludes its sole row whenever the entry is
 *   currently a draft — indexing that document nowhere at all.
 *
 * The by-id read applies no lifecycle filter for a trusted caller:
 * `resolveStatusFilter` returns null when `overrideAccess` is set and no status
 * is named (`lib/status-filter.ts`), and this asks as the system. So it answers
 * the row that exists, whatever state it is in.
 *
 * The cost is an over-count and it is the direction to fail in: a document
 * whose only row is a draft has its classes recorded under this subject, which
 * warns about a delete that was safe. Filtering it away permits deleting a
 * class a live document still renders, and only one of those is recoverable.
 */
async function readPublished(
  nextly: ClassUsageDirectApi,
  subject: ClassUsageSubject
): Promise<unknown> {
  return readById(nextly, subject, {});
}

/**
 * One by-id read of this subject's document, as the system.
 *
 * Shared so the locale, the depth, the error policy and the identity check are
 * stated once. The variants differ only in whether they opt into the working
 * draft.
 */
async function readById(
  nextly: ClassUsageDirectApi,
  subject: ClassUsageSubject,
  options: { draft?: boolean }
): Promise<Record<string, unknown> | undefined> {
  const row = await nextly.findByID({
    collection: subject.entity,
    id: subject.entityKey,
    ...options,
    ...localeOptions(subject),
    depth: 0,
    // No error suppression. `disableErrors` converts EVERY unsuccessful result
    // to null, not only a missing row — so a failing `afterRead` hook or a
    // broken overlay query would read as "this document is not there", and the
    // subject would be left alone with the caller told nothing. A raised
    // failure is reported instead, which is what tells a caller the index is
    // stale.
    ...AS_THE_SYSTEM,
  });
  return recordOf(row, subject);
}

/**
 * The record a read answered, once it identifies itself as the subject's.
 *
 * NEITHER end of this call can be trusted on its own, which is what decides the
 * rule:
 *
 * - the REQUEST can be retargeted. A `beforeOperation` read hook may rewrite
 *   the id, and the service builds its predicate from the rewritten one —
 *   `resolveReadEntryId` does `beforeOpArgs?.id ?? params.entryId`
 *   (`collection-query-service.ts:757`). So asking for a document is not the
 *   same as being answered about it.
 * - the RESPONSE can be reshaped. `afterRead` REPLACES the document, so a
 *   collection may rewrite or drop `id` for reasons that have nothing to do
 *   with which row was read.
 *
 * Those two make each other undecidable: a returned id that differs from the
 * subject is either a legitimate reshape or another document entirely, and
 * nothing available to a plugin tells them apart. There is no read this module
 * can issue that a hook cannot redirect, and no field of the answer that a hook
 * cannot rewrite.
 *
 * So the rule is the ruled asymmetry rather than a guess about which hook is
 * more likely. Reconciling an unconfirmed document files ITS classes under this
 * subject and removes the rows the real document earned — the class it still
 * renders then reads as unused and becomes deletable, which is the data loss
 * this index exists to prevent. Refusing costs a maintenance pass: the rows are
 * left alone, the index over-counts, a delete is refused, the caller is told,
 * and the next rebuild corrects it. Only one of those is recoverable.
 *
 * The cost is real and worth naming: a collection whose `afterRead` rewrites or
 * strips `id` cannot have its class usage maintained, and every save on it will
 * report a maintenance failure. That is a loud, diagnosable refusal rather than
 * a silent corruption, and it is the direction to fail in.
 */
function recordOf(
  row: unknown,
  subject: ClassUsageSubject
): Record<string, unknown> | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const record = row as Record<string, unknown>;
  if (record.id === subject.entityKey) return record;
  throw new Error(
    `Class-usage read for ${subject.entity}:${subject.entityKey} was answered ` +
      `by a document identifying as "${String(record.id)}". A read hook can ` +
      `retarget the query and another can rewrite the answer, so this cannot ` +
      `be confirmed as the subject's document; its rows are left untouched.`
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
  const value = (row as Record<string, unknown>)[subject.field];

  // An explicitly stored NULL is a definite answer: no classes. The column is
  // null for a document whose blocks were never written — `blocksField`
  // declares no `defaultValue`, so it starts null and stays that way until
  // something saves. Reporting that as an absence retained whatever the
  // subject last had, for a document that now applies nothing.
  //
  // Answered as the engine's own empty document rather than a literal, so this
  // and the field's own read path agree about what "no blocks" is.
  if (value === null) return emptyBlockDocument();

  if (value !== undefined) return value;

  // The key is NOT THERE, which is a different thing and must not be read as
  // an empty document. `afterRead` replaces the record and may project a field
  // away — filtering fields is supported and tested
  // (`hooks/__tests__/hooks-integration.test.ts`) — so the document may still
  // apply every class it did before. Treating that as empty would remove the
  // rows of a live document and let safe-delete take a class its pages render.
  //
  // Indeterminate, therefore, and handled like any absence: the subject's rows
  // are left alone, which over-counts until the next rebuild.
  return undefined;
}
