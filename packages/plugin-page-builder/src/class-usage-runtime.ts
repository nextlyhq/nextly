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
import type { ClassUsageDocumentStore } from "./class-usage-index-rebuild";
import type { ClassUsageIndexStore } from "./class-usage-maintenance";
import type { ClassUsageSubject } from "./class-usage-reconcile";
import type { ClassUsageDocumentReader } from "./class-usage-write";
import type { BackfillStateStore } from "./usage-backfill";
import type { GroupedUsageReader } from "./usage-index";

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
  /**
   * A GROUPED read, for the question a listing cannot answer affordably.
   *
   * "How many documents reference this" is a count of DISTINCT documents, and
   * the index holds a row per field, per locale and per stored variant — so one
   * page using one component in two languages while holding a pending draft
   * contributes several. Paging every row into the plugin to deduplicate would
   * spend exactly the population the index exists to make cheap; grouping
   * answers it in the database.
   *
   * `truncated` is part of the answer rather than an aside. The server caps how
   * many buckets it returns, so a component used on more documents than that
   * cap comes back short AND complete-looking, which is the reading that would
   * report a widely used component as barely used.
   */
  group(args: {
    collection: string;
    groupBy: string;
    where?: Record<string, unknown>;
    bucketLimit?: number;
    overrideAccess?: boolean;
  }): Promise<{
    buckets: { value: string | null; count: number }[];
    truncated: boolean;
  }>;
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
  const readRow = classUsageDocumentRowReader(nextly);
  return async (subject: ClassUsageSubject) =>
    documentIn(await readRow(subject), subject);
}

/**
 * Where one document lives, without saying which field is wanted from it.
 *
 * A rebuild walks whole documents and picks the field out itself, so the field
 * is not part of addressing a row. Separating them is what lets both callers
 * share one variant rule.
 */
export interface UsageDocumentAddress {
  /** The collection holding it. */
  entity: string;
  /** The document's id. */
  entityKey: string;
  /** The locale to resolve, or the empty string for a shared field. */
  locale: string;
  /** Which stored form to read. */
  variant: ClassUsageSubject["variant"];
}

/**
 * The stored ROW a subject names, before any field is taken from it.
 *
 * The variant rule lives here and nowhere else. Both callers need it and they
 * want different things out of the answer — the write path wants one field's
 * block document, a rebuild wants the whole row because it carries the `id`
 * the sweep records as visited — so the projection is what differs and the
 * READ is what is shared. Written the other way round, a rebuild would either
 * re-decide draft-versus-published for itself, or index the published row
 * under the draft subject the first time the two disagreed.
 */
export function classUsageDocumentRowReader(
  nextly: ClassUsageDirectApi
): (address: UsageDocumentAddress) => Promise<unknown> {
  return async address => {
    // `field` is not part of the address and no read below consults it; the
    // empty string is what the shared subject shape requires, never a claim
    // that some field is named that.
    const subject: ClassUsageSubject = {
      scope: "collection",
      field: "",
      ...address,
    };
    return subject.variant === "draft"
      ? readDraft(nextly, subject)
      : readPublished(nextly, subject);
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
  return (row as Record<string, unknown>)[subject.field];
}

/**
 * A grouped reader over one usage index, backed by the Direct API.
 *
 * Reads AS THE SYSTEM for the reason every other read of these tables does:
 * the index denies every access rule it declares, so an untrusted read answers
 * an empty set — and an empty set is indistinguishable from a thing nothing
 * uses, which is the answer that makes deleting it look safe.
 *
 * The bucket cap is left to the server rather than named here. Asking for a
 * specific one would be a second opinion about a bound this package does not
 * own, and the answer carries `truncated` either way — so the count reports the
 * limit it actually met rather than the one it hoped for.
 */
export function usageCountReader(
  nextly: ClassUsageDirectApi,
  /** The index collection's RESOLVED slug, since an integrator may rename it. */
  indexCollection: string
): GroupedUsageReader {
  return async args => {
    const grouped = await nextly.group({
      collection: indexCollection,
      groupBy: args.groupBy,
      where: args.where,
      ...AS_THE_SYSTEM,
    });
    // The bucket KEYS, not the row counts inside them. Each bucket is one
    // distinct value; the counts inside would put per-row multiplicity back.
    return {
      buckets: grouped.buckets.map(bucket => bucket.value),
      truncated: grouped.truncated,
    };
  };
}

/**
 * How many recorded scopes one page of the progress read returns.
 *
 * The population is small by construction — one row per (collection, field,
 * locale, variant), so tens on a large site rather than thousands — but it is
 * PAGED anyway, because "small" is a property of today's configuration and a
 * single unpaged read that silently returns the server's default page would
 * report the scopes past it as outstanding. A backfill would then walk them
 * again on every tick, for ever, never reporting complete.
 */
const PROGRESS_PAGE_SIZE = 200;

/**
 * The backfill's progress record, backed by the Direct API.
 *
 * Read as the system for the reason every access to these tables is: the
 * collection denies every rule it declares, so a read respecting the acting
 * user answers an empty set — which reads as "no scope has been walked" and
 * sends the backfill round again from the start.
 */
/**
 * Sort one page of progress rows into what counts and what must go.
 *
 * Its own function because classifying a row is a different job from paging a
 * collection, and it is the job carrying every branch: which generation a row
 * belongs to, whether its key is usable, whether it can be addressed for
 * deletion.
 *
 * Writes into the caller's collections rather than returning new ones, because
 * the caller is accumulating across pages and merging per page would allocate
 * two objects for every page of a walk that exists to be cheap.
 */
/**
 * The id a stale progress row can be discarded by — or a refusal.
 *
 * REFUSED rather than skipped when the id is not a string. A stale row that
 * cannot be addressed cannot be deleted, so it outlives the discard, and the
 * next time a host's bounds return to its generation it is read as completed
 * progress over an index that another generation has since rebuilt. That is
 * the exact defect the discard exists to prevent, and the delete-failure path
 * below already refuses for the same reason; an unaddressable row is the same
 * outcome arriving one step earlier.
 */
function staleRowId(row: { id?: unknown }): string {
  if (typeof row.id === "string" && row.id.length > 0) return row.id;
  throw new Error(
    "[page-builder] the usage backfill found a progress row from another derivation with no readable id, so it cannot be discarded and would survive to be reused"
  );
}

function sortProgressRows(
  items: readonly unknown[],
  generation: string,
  keys: Set<string>,
  stale: string[]
): void {
  for (const item of items) {
    const row = item as {
      scopeKey?: unknown;
      generation?: unknown;
      id?: unknown;
    };
    if (row.generation !== generation) {
      // Another generation's progress, which cannot be reused and must not be
      // left to be reused later. Collected rather than deleted here, so the
      // paging is not walking a collection it is mutating.
      stale.push(staleRowId(row));
      continue;
    }
    const key = row.scopeKey;
    // A row whose key is not a string records nothing this can act on. Skipped
    // rather than refused: the scope it meant to name is then simply
    // outstanding, which costs a repeat walk and is the safe direction —
    // treating it as a completed scope of unknown identity is what would leave
    // a real scope permanently unwalked.
    if (typeof key === "string" && key.length > 0) keys.add(key);
  }
}

export function usageBackfillStateStore(
  nextly: Pick<ClassUsageDirectApi, "find" | "create" | "delete">,
  /** The progress collection's RESOLVED slug, since an integrator may rename it. */
  stateCollection: string,
  /**
   * The derivation the current index is being built under.
   *
   * Rows from any other generation are DISCARDED, not merely ignored, and the
   * first version of this got that wrong for a reason worth writing down: it
   * kept them so that moving the bounds back would not cost a re-walk, on the
   * grounds that progress recorded under the bounds a host returned to is still
   * true.
   *
   * It is not. Progress is a claim about the INDEX, and the intervening
   * generation mutated it — lowering `maxNodes` removes references beyond the
   * new bound, so returning to the old one finds the old progress rows intact
   * over an index those references are missing from, and reports an undercount
   * as exact. Reusing them is only sound if the index snapshot is restored with
   * them, which nothing does.
   *
   * So a generation transition costs a re-walk, in both directions. That is the
   * price of the answer meaning anything.
   */
  generation: string
): BackfillStateStore {
  return {
    completed: async () => {
      const keys = new Set<string>();
      const stale: string[] = [];
      for (let page = 1; ; page += 1) {
        const result = await nextly.find({
          collection: stateCollection,
          // EVERY row, not only this generation's. The rows belonging to other
          // generations are the ones that have to be removed, and a filtered
          // read cannot see them — so it would leave them to be reused the next
          // time a host moved the bounds back.
          limit: PROGRESS_PAGE_SIZE,
          page,
          // Sorted so the pages partition the rows. An unsorted paged read has
          // no defined order between pages, so a row can appear twice or not at
          // all — and a key missed here is a scope walked again on every tick.
          sort: "id",
          depth: 0,
          ...AS_THE_SYSTEM,
        });
        sortProgressRows(result.items, generation, keys, stale);
        if (!result.meta.hasNext) break;
      }

      // AFTER the walk, for the reason the rebuild sweeps after its own: a
      // delete during an offset-paged read shifts the rows behind it and the
      // next page skips one.
      //
      // A failure PROPAGATES. The first version swallowed it, reasoning that a
      // surviving stale row costs one repeat of this cleanup on the next pass —
      // true only if the cleanup runs again BEFORE the bounds return to that
      // row's generation, and nothing guarantees that ordering. A row that
      // outlives the discard is then accepted as progress over an index the
      // intervening generation changed, which is exactly the defect the discard
      // exists to prevent.
      //
      // Failing the pass is cheap by comparison: the sweep is re-queued and the
      // queue is durable, so refusing costs a tick and claims nothing.
      for (const id of stale) {
        try {
          await nextly.delete({
            collection: stateCollection,
            id,
            ...AS_THE_SYSTEM,
          });
        } catch (failure) {
          throw new Error(
            `[page-builder] the usage backfill could not discard stale progress row "${id}", so progress from another derivation would survive to be reused`,
            { cause: failure }
          );
        }
      }

      return keys;
    },
    record: async key => {
      await nextly.create({
        collection: stateCollection,
        data: { scopeKey: key, generation },
        ...AS_THE_SYSTEM,
      });
    },
  };
}

/**
 * The document store a rebuild walks, backed by the Direct API.
 *
 * Its absence is why `rebuildPageBuilderUsageIndexes` had no production caller:
 * the rebuild has always taken this interface, and nothing turned it into real
 * calls. Tests supplied their own, which is exactly the shape that leaves a
 * mechanism fully tested and never run.
 *
 * ## Why it lists ids and then reads each document by id
 *
 * A list read cannot answer a VARIANT correctly. `readPublished` above sets out
 * why an explicit `status` on a list is a conjunction across the main row and
 * its localized companion, and a working draft lives in a sidecar that only the
 * by-id read overlays. So a page of documents taken straight from a list would
 * record published content under the draft subject — filing one variant's
 * classes as the other's, which is the mis-attribution that makes a class a
 * pending draft still uses look safe to delete.
 *
 * Listing ids and resolving each through `classUsageDocumentReader` reuses the
 * per-subject read the write path already uses, so both derive their documents
 * the same way. It costs a query per document, which is the price of the walk
 * agreeing with the index it is repairing.
 */
export function usageRebuildDocumentStore(
  nextly: ClassUsageDirectApi
): ClassUsageDocumentStore {
  const readRow = classUsageDocumentRowReader(nextly);
  // The last id this walk handed back, which is where the next page resumes.
  // Held per STORE, and a store is built per scope, so one walk's cursor cannot
  // reach another's.
  let after: string | undefined;

  return {
    find: async args => {
      // Keyset paging, not offsets, and the difference decides whether a
      // backfill can be trusted.
      //
      // An offset walk over a collection other writers are changing SKIPS a
      // document: delete one the walk already passed and everything behind it
      // shifts back, so the row now sitting at the next offset was already
      // read and the one that moved across the boundary is never visited. The
      // rebuild tolerates that when it runs as a REPAIR, because a document it
      // misses keeps the rows it already had and `exists` refuses to sweep
      // them.
      //
      // A first fill has no such protection. A document that predates the index
      // has no rows at all, so there is nothing for the orphan sweep to
      // inspect and nothing to notice it was missed — the walk returns without
      // a failure, the scope is recorded, and it is never revisited.
      //
      // Resuming after the last id seen removes the shift entirely: a deletion
      // behind the cursor cannot move anything across it, because position is
      // no longer what decides the next page.
      if (args.page === 1) after = undefined;
      // The cursor is an id, so a walk ordered by anything else would resume at
      // a point in a different sequence. Refused rather than quietly falling
      // back to offsets, which is the behaviour this exists to remove.
      if (args.sort !== "id") {
        throw new Error(
          `[page-builder] the usage backfill pages by id and was asked to sort by "${args.sort}"`
        );
      }

      const listed = await nextly.find({
        collection: args.collection,
        limit: args.limit,
        // Always the first page OF WHAT REMAINS. The window moves by the
        // `where` below rather than by an offset, so asking for page N of a
        // filtered set would skip N-1 windows' worth of documents.
        page: 1,
        sort: args.sort,
        ...(after === undefined
          ? {}
          : { where: { id: { greater_than: after } } }),
        // No `status`, deliberately, and for the reason `readPublished` gives
        // at length: an explicit one is a conjunction over the main row and the
        // companion, so a translation unpublished while the default stays
        // published matches neither value and is indexed nowhere. This lists
        // whatever rows exist and lets the by-id read below decide the variant.
        depth: 0,
        ...AS_THE_SYSTEM,
      });

      const items: unknown[] = [];
      for (const row of listed.items) {
        const id = (row as { id?: unknown }).id;
        // REFUSED, not skipped, and the first version had this the wrong way
        // round. Skipping reasoned that failing a whole scope over one
        // malformed row was worse than losing the row — but losing it is
        // silent: no rows are written for that document, no marker is left,
        // and the scope is recorded complete, so its references are missing
        // while health reports the count exact. Nothing later notices, because
        // a document with no rows is indistinguishable from one that references
        // nothing.
        //
        // It also stalls the walk. The cursor advances to the last id SEEN, so
        // a page ending in an unreadable row leaves it where it was and the
        // next read returns the same window — until the page guard trips.
        //
        // Reachable rather than theoretical: a collection's own `afterRead`
        // hook may strip fields from list results, and `id` is not exempt.
        if (typeof id !== "string" || id.length === 0) {
          throw new Error(
            `[page-builder] the usage backfill listed a row of "${args.collection}" with no usable id, so the document cannot be read or recorded`
          );
        }
        // The whole ROW, not one field's value: the rebuild picks the field out
        // itself, and it needs the `id` to record the document as visited. A
        // page of field values would be swept as documents that do not exist.
        const document = await readRow({
          entity: args.collection,
          entityKey: id,
          locale: args.locale,
          variant: args.variant,
        });
        // A row the variant read declines — an id whose draft was discarded
        // between the list and this read — contributes nothing. Pushing
        // `undefined` would make the rebuild skip it as unreadable, and the
        // sweep would then not count it as visited either.
        if (document !== undefined) items.push(document);
        // Advanced for every LISTED row, including one whose variant read
        // declined and one this loop skipped. The cursor records where the
        // listing got to, not what the walk kept — advancing only on kept rows
        // would re-read a declined document for ever and never finish.
        after = id;
      }

      return { items, meta: { hasNext: listed.meta.hasNext } };
    },
    exists: async args => {
      // The same variant-scoped read the walk uses, asked about one document.
      // Scoping matters here: a published document and a working draft come and
      // go independently, so an unscoped check answers `true` for a draft that
      // is gone and its rows survive every future pass.
      const document = await readRow({
        entity: args.collection,
        entityKey: args.id,
        locale: args.locale,
        variant: args.variant,
      });
      return document !== undefined;
    },
  };
}
