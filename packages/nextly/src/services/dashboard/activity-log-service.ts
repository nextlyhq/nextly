/**
 * Activity Log Service
 *
 * Records and queries user activity (create/update/delete) across all
 * collections. Designed for the dashboard activity feed — not a full
 * audit log. Writes are fire-and-forget; failures never propagate to
 * the caller.
 *
 * @module services/dashboard/activity-log-service
 * @since 1.0.0
 */

import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { WhereClause } from "@nextlyhq/adapter-drizzle/types";
import { type Column, type Table } from "drizzle-orm";

import { toDbError } from "../../database/errors";
// PR 4 migration: switched from ServiceError.fromDatabaseError to
// NextlyError.fromDatabaseError. Public message stays generic per §13.8;
// the underlying DbError is preserved as `cause` and rich DB context
// (kind, dialect, code) flows into logContext automatically.
import { insertErasureAware } from "../../domains/audit/erasure-aware-insert";
import { NextlyError } from "../../errors";
import { BaseService } from "../base-service";
import {
  resolveDocumentVisibilityScope,
  visibleDocuments,
  type DocumentRef,
  type DocumentVisibilityScope,
} from "../lib/document-visibility";
import { existingDocumentIds } from "../lib/readable-documents";
import type { Logger } from "../shared";

import {
  someResources,
  type ReadableResources,
  type ReadCaller,
} from "./readable-resources";

/** The three mutation actions tracked in the activity log. */
export type ActivityLogAction = "create" | "update" | "delete";

/** A single activity log record as returned by queries. */
export interface ActivityLogEntry {
  id: string;
  /**
   * The actor, as an opaque reference that outlives their account.
   *
   * Still set after the account is deleted — that is what keeps one deleted
   * actor's entries distinguishable from another's.
   */
  userId: string;
  /** NULL once the actor's account was deleted and their identity erased. */
  userName: string | null;
  /** NULL once the actor's account was deleted and their identity erased. */
  userEmail: string | null;
  action: ActivityLogAction;
  collection: string;
  entryId: string | null;
  entryTitle: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  /**
   * When THIS ROW's identity was erased. NULL while the actor still exists.
   *
   * The row's own erasure, deliberately, not the account's deletion. For an
   * entry erased by a deletion the two coincide, because the erasure runs
   * inside that transaction. For one written after the account was already
   * gone they do not: nothing retains when that deletion happened, and
   * claiming otherwise would put a number in an audit field that no record
   * supports. Separate from a NULL name because "erased" and "never carried a
   * name" are different facts, and only this one answers when.
   */
  identityErasedAt: string | null;
}

/** Input for recording a new activity. */
export interface LogActivityInput {
  userId: string;
  /**
   * Display name to denormalize onto the row. Omit to take it from the account
   * itself, which is what a caller that holds only an actor id does — the write
   * already reads that row to decide whether the account still exists, so the
   * name comes from the same look, under the same lock, as that decision.
   */
  userName?: string;
  /** Email to denormalize onto the row; omit to take it from the account. */
  userEmail?: string;
  action: ActivityLogAction;
  collection: string;
  entryId?: string;
  entryTitle?: string;
  /** The language this write was made in; NULL means the default one. */
  locale?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * A page of activity, and whether more of it exists.
 *
 * 🔴 There is deliberately no `total`. It used to be a `COUNT(*)` over the rows
 * a caller's COLLECTION scope admitted, which counted edits to documents the
 * caller may not read — the same disclosure the rows themselves carried, in a
 * number. It cannot simply be narrowed either: a document rule can be an
 * arbitrary function, so an authorized total means authorizing every matching
 * row, which is unbounded over an audit table that grows forever.
 *
 * Publishing a number that cannot be made correct is worse than publishing
 * none, so `hasMore` carries the pagination instead — the cursor-shaped answer
 * this endpoint was already moving toward, and the one that does not put an
 * unbounded aggregate on a growing table in front of every dashboard load.
 */
export interface ActivityLogResult {
  activities: ActivityLogEntry[];
  hasMore: boolean;
}

/** Options for querying the activity log. */
export interface ActivityLogQueryOptions {
  limit?: number;
  offset?: number;
  collection?: string;
  userId?: string;
  /**
   * Which resources the caller may read. An omitted scope denies: this feed
   * exposes entry titles across every collection, so a caller that forgets to
   * scope it must get nothing rather than everything.
   */
  scope?: ReadableResources;
  /**
   * WHO is reading, so each row's document can be authorized.
   *
   * 🔴 Required in practice for the same reason `scope` is, and omitted the
   * same way: no caller means no document can be authorized, so a feed asked
   * without one answers empty rather than answering about everything the scope
   * admits. The scope decides which collections are in reach; only the caller
   * decides which of their documents are, and a stored `owner-only` or `custom`
   * read rule makes those different sets.
   */
  caller?: ReadCaller;
}

const TABLE = "activity_log";

/**
 * Rows read per refill round.
 *
 * Larger than a dashboard page on purpose: a card asks for five, and reading
 * five at a time would spend a round trip per unreadable row. Small enough that
 * a round is a cheap read on a table that only grows.
 */
const ACTIVITY_PAGE_SIZE = 100;

/**
 * How many rounds a page will refill before answering short.
 *
 * The bound on an install whose recent activity is almost entirely unreadable
 * to this caller. Reaching it returns FEWER rows than asked for, never rows the
 * caller may not see, so the failure direction is a thin feed rather than a
 * disclosure.
 */
const MAX_REFILL_ROUNDS = 10;

/**
 * The document an activity row is about, or `null` when it is about no document.
 *
 * The row's `collection` is a FREE STRING whose namespace is deliberately wider
 * than the registries — settings mutations are filed under names that are
 * neither a collection nor a single — so the registry lookup is what separates
 * a content event from an install-level one. Guessing a kind instead would send
 * a settings row to a content read path that cannot answer about it.
 */
function documentRefOf(
  row: Record<string, unknown>,
  kinds: ReadonlyMap<string, "collection" | "single">
): DocumentRef | null {
  const slug = typeof row.collection === "string" ? row.collection : undefined;
  const entryId = typeof row.entryId === "string" ? row.entryId : undefined;
  if (!slug || !entryId) return null;
  const kind = kinds.get(slug);
  if (!kind) return null;
  // 🔴 The language the write was made IN, so the read rule is evaluated for
  // that translation. A localized field answers differently per language, so a
  // row judged without one is judged against the default — and an edit made in
  // a language the rule denies would still show its title. NULL on unlocalized
  // documents and on rows written before the column existed; both mean "the
  // default language", which is exactly what those rows always meant.
  const locale = typeof row.locale === "string" ? row.locale : null;
  return { kind, slug, entryId, locale };
}

/** One existence probe's worth of refused rows: a collection, in a language. */
interface ProbeUnit {
  slug: string;
  locale: string | null;
  entries: { row: Record<string, unknown>; entryId: string }[];
}

/**
 * `refused` grouped into the units one existence probe can answer for.
 *
 * Per collection AND language, matching how the read path is asked: a localized
 * document is a different row per translation, so one probe per slug would ask
 * about whichever language the read defaulted to.
 *
 * Singles are excluded, and their absence is deliberate rather than an omission.
 * A Single's document is REPLACED rather than removed, so
 * `resolveSingleDocumentId` still answers and the read path can decide — there
 * is no "gone" case here for a probe to find.
 */
function probeUnits(
  refused: readonly Record<string, unknown>[],
  scope: DocumentVisibilityScope
): ProbeUnit[] {
  const units = new Map<string, ProbeUnit>();
  for (const row of refused) {
    const ref = documentRefOf(row, scope.kinds);
    if (!ref || ref.kind !== "collection") continue;
    const locale = ref.locale ?? null;
    const key = `${ref.slug} ${locale ?? ""}`;
    const entry = { row, entryId: ref.entryId };
    const unit = units.get(key);
    if (unit) unit.entries.push(entry);
    else units.set(key, { slug: ref.slug, locale, entries: [entry] });
  }
  return [...units.values()];
}

/**
 * The Drizzle surface an activity write needs.
 *
 * Structural rather than the concrete types because the real ones are
 * dialect-specific (NodePgDatabase / MySql2Database / BetterSQLite3Database),
 * while the fluent API is identical.
 */
export interface ActivityWriteDb {
  insert(table: unknown): { values(data: unknown): Promise<unknown> };
  select(fields: unknown): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(count: number): Promise<Record<string, unknown>[]> & {
          // `.for("share")` exists on the Postgres and MySQL builders. SQLite
          // has no row lock and never reaches the call.
          for(strength: "share"): Promise<Record<string, unknown>[]>;
        };
      };
    };
  };
}

/** The same surface plus the transaction a lock has to be held inside. */
interface TransactionalActivityDb extends ActivityWriteDb {
  transaction<T>(work: (tx: ActivityWriteDb) => Promise<T>): Promise<T>;
}

/** The two tables an activity write reads and writes. */
interface ActivityWriteTables {
  activityLog: Table & { identityErasedAt: Column };
  users: Table & { id: Column; name: Column; email: Column };
}

/**
 * One query filter, in the single spelling its only consumer needs.
 *
 * `adapter.select` resolves a name against the Drizzle table, so the schema
 * property is what a filter carries. It used to carry the physical column
 * beside it for a hand-written count query; that query is gone, and with it the
 * only reason this type knew two names for one thing.
 *
 * A discriminated union rather than `op: "=" | "IN"` paired with
 * `value: string | string[]`: those two fields varying independently let
 * `{ op: "=", value: ["a", "b"] }` type-check, which is a filter no consumer
 * can honour. Tying `op` to `value`'s shape makes that state unrepresentable.
 */
interface ActivityFilterBase {
  /** The Drizzle schema property, for `adapter.select`. */
  property: string;
}

type ActivityFilter =
  | (ActivityFilterBase & { op: "="; value: string })
  | (ActivityFilterBase & { op: "IN"; value: string[] });

/** A position in the feed's `(createdAt desc, id desc)` order. */
interface ActivityCursor {
  createdAt: Date;
  id: string;
}

/** `row` as a cursor, or undefined when it cannot name a position exactly. */
function cursorOf(
  row: Record<string, unknown> | undefined
): ActivityCursor | undefined {
  if (!row) return undefined;
  const { createdAt, id } = row;
  if (typeof id !== "string") return undefined;
  // Drivers disagree about whether a timestamp arrives decoded: the adapter's
  // Drizzle path returns a Date, and a raw string is still a valid instant.
  const at =
    createdAt instanceof Date
      ? createdAt
      : typeof createdAt === "string"
        ? new Date(createdAt)
        : undefined;
  if (!at || Number.isNaN(at.getTime())) return undefined;
  return { createdAt: at, id };
}

/**
 * Strictly after `cursor` in `createdAt DESC, id DESC` order.
 *
 * Spelled as the two-branch disjunction rather than a row constructor, because
 * `(a, b) < (x, y)` is not portable across the three dialects this runs on.
 */
function olderThan(cursor: ActivityCursor): WhereClause {
  return {
    or: [
      { and: [{ column: "createdAt", op: "<", value: cursor.createdAt }] },
      {
        and: [
          { column: "createdAt", op: "=", value: cursor.createdAt },
          { column: "id", op: "<", value: cursor.id },
        ],
      },
    ],
  };
}

/** `where`, narrowed to rows strictly after `cursor`. */
function withCursor(
  where: WhereClause | undefined,
  cursor: ActivityCursor
): WhereClause {
  return where ? { and: [where, olderThan(cursor)] } : olderThan(cursor);
}

/**
 * Safely convert an unknown driver-returned value to a nullable string.
 * Avoids `Object.toString()` fallthrough that triggers no-base-to-string.
 */
function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

export class ActivityLogService extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  /**
   * The columns of one entry that erasure never touches.
   *
   * The identity columns are decided by the write itself, against an account
   * that may be being deleted at that moment, so they are supplied separately.
   */
  private entryValues(
    input: LogActivityInput,
    createdAt: Date
  ): Record<string, unknown> {
    return {
      id: randomUUID(),
      userId: input.userId,
      action: input.action,
      collection: input.collection,
      entryId: input.entryId ?? null,
      entryTitle: input.entryTitle ?? null,
      locale: input.locale ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt,
    };
  }

  /**
   * Record an activity log entry as a self-contained write.
   *
   * For callers that own no transaction of their own — the auth and account
   * seams. Supplies the transaction the identity decision needs (see
   * {@link logActivityInTx}) and swallows failures: these callers have already
   * committed by the time they log, so a throw here could only turn a recorded
   * action into a failed one. A mutation recording inside its own write
   * transaction wants the opposite and calls {@link logActivityInTx} directly.
   */
  async logActivity(input: LogActivityInput): Promise<void> {
    try {
      if (this.dialect === "sqlite") {
        await this.logActivityInTx(this.db as ActivityWriteDb, input);
        return;
      }

      await (this.db as TransactionalActivityDb).transaction(tx =>
        this.logActivityInTx(tx, input)
      );
    } catch (error) {
      this.logger.error("Failed to log activity", {
        error: error instanceof Error ? error.message : String(error),
        input: {
          action: input.action,
          collection: input.collection,
          entryId: input.entryId,
        },
      });
    }
  }

  /**
   * Write one activity entry through an executor the CALLER owns.
   *
   * Holds the whole erasure-aware identity decision, so the two writers — the
   * standalone {@link logActivity} above and the mutation seam that records
   * inside a content transaction — cannot come to disagree about what a row may
   * carry. Both dialect mechanisms live here; only the transaction the
   * statements run in differs between callers.
   *
   * Failures PROPAGATE, deliberately. A caller recording inside a content
   * transaction needs the write to fail with it — an entry that cannot be
   * written must take the change it describes down with it, rather than leaving
   * a committed mutation nothing recorded. Swallowing is the standalone
   * caller's decision to make, and it makes it above.
   *
   * The identity a row may carry has to be decided against an account that may
   * be deleted at this very moment, and the two dialect families need
   * different mechanisms for it.
   *
   * **Postgres and MySQL** first take a SHARED lock on the account row.
   * `deleteUser` takes an EXCLUSIVE lock on that row before it erases anything,
   * so the two cannot be in flight at once: either this lock is taken first and
   * the deletion waits, so its erasure covers a row that already exists, or the
   * deletion holds the row and this waits for its commit and then correctly
   * finds the account gone. The lock is what closes the gap a single statement
   * cannot — its subquery is answered when it STARTS while its row becomes
   * visible when it COMMITS, and an insert spanning the deletion's commit
   * satisfies neither the deletion's own erasure nor its post-commit sweep.
   * Shared rather than exclusive so concurrent writes by the same author do not
   * serialise against each other; only the deletion has to exclude them, for
   * the length of one insert.
   *
   * **SQLite** has one writer, so its insert cannot interleave with the
   * deletion's transaction at all and needs no lock. It decides the identity
   * inside the statement instead, because a check followed by a separate
   * insert would leave a durable row that a second statement was still going
   * to correct.
   */
  async logActivityInTx(
    db: ActivityWriteDb,
    input: LogActivityInput
  ): Promise<void> {
    const { activityLog, users } = this.tables as ActivityWriteTables;
    // The caller's identity when it supplied one, otherwise the account's own.
    // Taking it from the account is what a caller holding only an actor id
    // does: the write already looks at that row to decide whether the account
    // exists, so the name comes from the same look as that decision.
    const supplied: Record<string, unknown> = {};
    const fromAccount: Record<string, Column> = {};
    if (input.userName !== undefined) supplied.userName = input.userName;
    else fromAccount.userName = users.name;
    if (input.userEmail !== undefined) supplied.userEmail = input.userEmail;
    else fromAccount.userEmail = users.email;

    await insertErasureAware(db, this.dialect, {
      table: activityLog,
      users,
      row: this.entryValues(input, new Date()),
      identity: supplied,
      identityFromAccount: fromAccount,
      actorUserId: input.userId,
    });
  }

  /**
   * Query recent activity log entries with optional filters.
   *
   * Uses the `limit + 1` pattern to determine `hasMore` without a
   * separate COUNT query. The `total` field uses a separate count query
   * only when needed.
   */
  async getRecentActivity(
    options?: ActivityLogQueryOptions
  ): Promise<ActivityLogResult> {
    const limit = Math.min(options?.limit ?? 10, 50);
    const offset = options?.offset ?? 0;

    // Fail-closed default: an omitted scope must deny, not grant. This feed
    // exposes entry titles across every collection, so a caller that forgets
    // to pass one gets nothing rather than everything.
    const scope = options?.scope ?? someResources([]);
    const caller = options?.caller;

    try {
      // Named by Drizzle SCHEMA PROPERTY, which is what `adapter.select`
      // resolves against the table. Naming the physical column here instead
      // silently dropped the ordering and made a filtered query fail outright.
      const filters: ActivityFilter[] = [];

      if (options?.collection) {
        filters.push({
          property: "collection",
          op: "=",
          value: options.collection,
        });
      }
      if (options?.userId) {
        filters.push({
          property: "userId",
          op: "=",
          value: options.userId,
        });
      }
      if (scope.kind === "some") {
        // An empty scope yields an `IN ()`, which matches nothing -- the
        // intended answer for a caller who may read nothing. Short-circuit
        // instead, because an empty IN list is a syntax error on some
        // dialects, and the short-circuit must happen BEFORE the query is
        // built rather than let the driver reject it.
        if (scope.resources.size === 0) {
          return { activities: [], hasMore: false };
        }
        filters.push({
          property: "collection",
          op: "IN",
          value: [...scope.resources],
        });
      }

      const where =
        filters.length > 0
          ? {
              and: filters.map(f => ({
                column: f.property,
                op: f.op,
                value: f.value,
              })),
            }
          : undefined;

      // One past the page, so `hasMore` is an observation rather than a guess:
      // the extra row is fetched, AUTHORIZED, and then dropped. Counting
      // candidates instead would promise another page that document rules may
      // empty.
      const visible = await this.visibleActivity(
        where,
        limit + 1,
        offset,
        caller
      );
      return {
        activities: visible.slice(0, limit).map(this.mapRow),
        hasMore: visible.length > limit,
      };
    } catch (error) {
      this.logger.error("Failed to query activity log", {
        error: error instanceof Error ? error.message : String(error),
      });
      // PR 4 migration: NextlyError.fromDatabaseError yields a generic
      // public message ("An unexpected error occurred." for non-DbError,
      // or the §13.8 mapping for DbError) and preserves the original
      // error as `cause` for operator logs. Normalise raw driver errors
      // via toDbError(dialect) so the right kind is mapped instead of
      // collapsing to INTERNAL_ERROR / 500.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /**
   * Up to `want` activity rows the caller may actually be told about.
   *
   * 🔴 Authorization happens AFTER the read and cannot be pushed into it. A
   * stored read rule is a constraint over the COLLECTION's own fields, and
   * `activity_log` carries none of them — only a free-text collection name, an
   * entry id and a denormalised title — so there is no predicate to add here.
   * Filtering afterwards is what makes the page short, which is why it refills.
   *
   * Refilling rather than filtering one page: a page whose rows are mostly
   * unreadable would otherwise answer with two rows and `hasMore: false`, and
   * the reader would take that as the end of the feed rather than as the end of
   * what this page happened to contain.
   */
  private async visibleActivity(
    where: WhereClause | undefined,
    want: number,
    offset: number,
    caller?: ReadCaller
  ): Promise<Record<string, unknown>[]> {
    // No caller means no document can be authorized, and this feed carries
    // entry titles -- so it answers nothing rather than everything the scope
    // admits. Same fail-closed direction as an omitted scope.
    if (!caller) return [];

    // 🔴 Resolved ONCE for the whole refill, not per page. The registry and the
    // locale config both answer an unreachable dependency with an empty result,
    // so a read per page lets a transient failure drop one page's rows while
    // its neighbours keep theirs -- and the paging then reports a short feed as
    // though it were the whole answer.
    const scope = await resolveDocumentVisibilityScope();
    if (scope.degraded) {
      // 🔴 REFUSE rather than answer, and this direction is the whole point of
      // the pass. `authorizedRows` reads a slug missing from `scope.kinds` as an
      // install-level event and keeps it WITHOUT asking the read path — correct
      // when the map is complete, because settings namespaces are neither a
      // collection nor a single. When the registry could not be enumerated the
      // same rule admits every document row unauthorized, so a transient
      // dependency failure would turn the feed back into exactly the disclosure
      // this service was repaired for, and turn it on silently.
      //
      // The empty-map case is not this one: an install that has registered
      // nothing has no document rows to admit, and `degraded` is what tells the
      // two apart.
      throw NextlyError.internal({
        logContext: { reason: "content-registry-unreachable" },
      });
    }
    return this.refill(where, want, offset, caller, scope);
  }

  /**
   * Read pages until `want` readable rows are found or the rounds run out.
   *
   * Separate from the checks that precede it so each reads as one decision: the
   * caller and the scope decide WHETHER to answer, and this decides how much to
   * read to do it.
   */
  private async refill(
    where: WhereClause | undefined,
    want: number,
    offset: number,
    caller: ReadCaller,
    scope: DocumentVisibilityScope
  ): Promise<Record<string, unknown>[]> {
    const visible: Record<string, unknown>[] = [];
    let after: ActivityCursor | undefined;

    // Bounded so an install whose recent activity is almost entirely
    // unreadable cannot walk the whole table for one card. Reaching it returns
    // a SHORT page, never a wrong one.
    for (let round = 0; round < MAX_REFILL_ROUNDS; round++) {
      const page = await this.adapter.select<Record<string, unknown>>(TABLE, {
        // 🔴 Rounds after the first are anchored to the LAST ROW READ, not to a
        // running offset. `activity_log` grows while the feed is being built —
        // every create, update and delete appends to it — and under OFFSET a row
        // inserted between two rounds shifts every later position by one, so the
        // next round repeats a row already seen and SKIPS one that was never
        // read. The skipped row is lost silently: de-duplicating what arrived
        // cannot reveal what did not, and the feed then reports the wrong
        // `hasMore` about it too. The caller's own `offset` still positions the
        // FIRST round, which is the only place it means what it says.
        where: after ? withCursor(where, after) : where,
        // Ending in a UNIQUE column is what lets that anchor name a position
        // exactly. `createdAt` alone is not total -- MySQL stores these at
        // second precision, so a burst of writes ties -- and a cursor over a
        // non-unique key cannot say which of the tied rows a page ended on.
        orderBy: [
          { column: "createdAt", direction: "desc" },
          { column: "id", direction: "desc" },
        ],
        limit: ACTIVITY_PAGE_SIZE,
        ...(after ? {} : { offset }),
      });
      if (page.length === 0) break;
      after = cursorOf(page[page.length - 1]) ?? after;

      visible.push(...(await this.authorizedRows(page, scope, caller)));
      if (visible.length >= want) break;
      // A short page is the end of the table, not the end of this round.
      if (page.length < ACTIVITY_PAGE_SIZE) break;
      // A page whose last row cannot be read as a cursor would make the next
      // round repeat it forever; stop rather than loop on an unknown position.
      if (!after) break;
    }

    return visible.slice(0, want);
  }

  /**
   * The rows of `page` whose subject this caller may read.
   *
   * Three kinds of row, and only one of them names a document:
   *
   * - A row with NO entry id is an install-level event -- a settings mutation
   *   filed under a namespace that is neither a collection nor a single. There
   *   is no document to authorize, and the caller's scope already admitted the
   *   namespace, so it is kept. Dropping these would remove SMTP-credential
   *   rotations and their kin from the feed entirely.
   * - A row naming a slug in NEITHER registry is the same case wearing an entry
   *   id, and is kept for the same reason: the scope admitted the namespace and
   *   there is no content read path that could answer about it. It is not a way
   *   in -- the scope is built from the registries plus those namespaces, so a
   *   slug outside both never reaches this method.
   * - A row naming a registered collection or single is authorized as the
   *   document it names, by the same decision the pending-edit cards use.
   */
  private async authorizedRows(
    page: readonly Record<string, unknown>[],
    scope: DocumentVisibilityScope,
    caller: ReadCaller
  ): Promise<Record<string, unknown>[]> {
    const documentRows = page.filter(
      row => documentRefOf(row, scope.kinds) !== null
    );
    const readable = new Set(
      await visibleDocuments(
        documentRows,
        row => documentRefOf(row, scope.kinds),
        caller,
        scope
      )
    );
    const redacted = await this.historyOfRemovedDocuments(
      documentRows.filter(row => !readable.has(row)),
      scope
    );
    return page.flatMap(row => {
      if (documentRefOf(row, scope.kinds) === null) return [row];
      if (readable.has(row)) return [row];
      const kept = redacted.get(row);
      return kept ? [kept] : [];
    });
  }

  /**
   * The refused rows that describe documents which no longer EXIST, redacted.
   *
   * 🔴 Without this, every deletion disappears from the feed. A collection
   * delete removes the row and only then appends `entry.deleted`, so the
   * document the event names can never be found again — and a filter that keeps
   * only readable documents therefore drops the deletion, and all earlier
   * history for that document, for everyone including a super admin. The most
   * consequential events in the trail were the ones it silently lost.
   *
   * Refused and GONE are the same absence to a read that enforces access, so
   * they are told apart by a privileged existence probe — asked only about rows
   * already refused, and used only to decide whether anything remains to
   * authorize.
   *
   * What survives is the event, not the document: the stored title and metadata
   * are dropped, because the rule that would have decided who may read them died
   * with the document and nothing can evaluate it now. A reader learns that
   * something was deleted, by whom and when; they do not learn what it was
   * called.
   */
  private async historyOfRemovedDocuments(
    refused: readonly Record<string, unknown>[],
    scope: DocumentVisibilityScope
  ): Promise<Map<Record<string, unknown>, Record<string, unknown>>> {
    const kept = new Map<Record<string, unknown>, Record<string, unknown>>();
    if (refused.length === 0) return kept;

    for (const unit of probeUnits(refused, scope)) {
      let existing: Set<string>;
      try {
        existing = await existingDocumentIds(
          unit.slug,
          unit.entries.map(entry => entry.entryId),
          unit.locale
        );
      } catch {
        // A probe that could not answer has told us nothing, and nothing must
        // not read as "deleted" -- that would publish a refused row.
        continue;
      }
      for (const entry of unit.entries) {
        if (existing.has(entry.entryId)) continue;
        kept.set(entry.row, {
          ...entry.row,
          entryTitle: null,
          metadata: null,
        });
      }
    }
    return kept;
  }

  private mapRow = (row: Record<string, unknown>): ActivityLogEntry => {
    let metadata: Record<string, unknown> | null = null;
    if (row.metadata) {
      try {
        metadata =
          typeof row.metadata === "string"
            ? JSON.parse(row.metadata)
            : (row.metadata as Record<string, unknown>);
      } catch {
        metadata = null;
      }
    }

    // Keyed by the Drizzle SCHEMA PROPERTY, not the column: `adapter.select`
    // runs `db.select().from(table)` and throws outright when the table is not
    // in the registry, so there is no raw-SQL path that would return
    // `user_name`. Reading the column spelling yielded undefined for every
    // field and surfaced as the string "undefined" in the feed.
    const createdAt = row.createdAt;
    const identityErasedAt = row.identityErasedAt;

    return {
      id: String(row.id),
      userId: String(row.userId),
      // Through the same narrowing as the other nullable columns: an erased
      // row holds SQL NULL here, and `String(null)` would surface the literal
      // text "null" as the actor's name.
      userName: toNullableString(row.userName),
      userEmail: toNullableString(row.userEmail),
      action: String(row.action) as ActivityLogAction,
      collection: String(row.collection),
      // Type-narrow before stringification so we don't fall through to
      // Object#toString for non-primitive driver values.
      entryId: toNullableString(row.entryId),
      entryTitle: toNullableString(row.entryTitle),
      metadata,
      createdAt:
        createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
      identityErasedAt:
        identityErasedAt instanceof Date
          ? identityErasedAt.toISOString()
          : toNullableString(identityErasedAt),
    };
  };
}
