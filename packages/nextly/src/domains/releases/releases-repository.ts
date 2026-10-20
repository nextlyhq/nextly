/**
 * Repository for `nextly_releases` and `nextly_release_members`.
 *
 * Built on the same narrow database port the versions repository uses, so one
 * instance works with either the adapter or a transaction context. Column
 * names are the Drizzle property names (camelCase); the adapter maps them to
 * snake_case.
 *
 * The reads here answer only "which memberships exist"; whether a membership
 * is IN EFFECT is `resolveReleaseEffect`'s judgement, and keeping that in one
 * pure place is what stops a read and the materialisation that follows it
 * disagreeing about the same release.
 *
 * @module domains/releases/releases-repository
 */
import { NextlyError } from "../../errors";
import type { CacheRevalidator } from "../../revalidation/types";
import {
  RELEASE_CANCELLABLE_FROM,
  RELEASE_DELETABLE_FROM,
  RELEASE_STATES,
  RELEASE_STATES_AFFECTING_CONTENT,
  type ReleaseMemberAction,
  type ReleaseKind,
  type ReleaseState,
} from "../../schemas/releases/types";
import type { VersionScopeKind } from "../../schemas/versions/types";
import { uuidV7 } from "../../utils/uuid-v7";
import type {
  VersionsDbApi,
  VersionsSelectOptions,
  VersionsWhere,
  VersionsWhereCondition,
} from "../versions/db-api";

import {
  tallyByDay,
  placedWithinCondition,
  type ReleaseCalendarDay,
  type ReleaseTimeSpan,
  type ZonedDay,
} from "./release-calendar";
import { releaseDueCondition } from "./release-due";
import { releaseMemberKey } from "./release-member-key";
import { releaseRevalidationIntent } from "./release-revalidation";
import { NO_DECISIONS } from "./release-scope";
import type { ReleaseDecisions } from "./release-scope";
import {
  releaseTabQuery,
  type ReleaseAttentionReason,
  type ReleaseTab,
  type ReleaseTabOrder,
  type ReleaseTabQuery,
} from "./release-tabs";
import type { DueMember } from "./resolve-release-effect";
import { resolveReleaseEffect } from "./resolve-release-effect";
import { invalidateTransitionCacheFor } from "./transition-cache-registry";

/**
 * The database surface this repository needs.
 *
 * Aliased rather than restated: it is the same narrow port — insert, select,
 * update, delete — and a second declaration of the same shape would drift from
 * this one silently, which is the divergence this codebase has a rule about.
 */
/**
 * The versions port, plus the one capability materialisation needs.
 *
 * `VersionsDbApi.update` returns nothing, which is enough for everything that
 * edits a stored version. Marking a release published is different: it is a
 * state transition that must happen exactly once even though the runner
 * delivering it is AT-LEAST-ONCE, so the write has to say whether it was the
 * one that moved the row. Widened here rather than in the versions port,
 * because that port's own note says any widening should be a deliberate act.
 */
export type ReleasesDbApi = Omit<VersionsDbApi, "select"> & {
  /**
   * The versions port's select, with the text-matching operator the list
   * search needs. Widened here rather than in the versions port, which says a
   * widening there should be a deliberate act for its own readers.
   */
  select<T = unknown>(
    table: string,
    options?: ReleasesSelectOptions
  ): Promise<T[]>;
  /**
   * How many rows match, counted by the database.
   *
   * A list's total is the count of everything its query matches, and the only
   * other way to learn that number is to read every matching row and measure
   * the array — which transfers the whole table to report one integer.
   */
  count(table: string, options?: { where?: ReleasesWhere }): Promise<number>;
  updateCount(
    table: string,
    data: Record<string, unknown>,
    where: VersionsWhere
  ): Promise<number>;
  /**
   * Run `work` so that either all of its writes land or none do.
   *
   * REQUIRED rather than optional, which is safe for a reason worth stating:
   * the transaction context cannot satisfy `ReleasesDbApi` in the first place,
   * because it carries no `updateCount` of the adapter's shape — so the only
   * thing that ever satisfies this port is the adapter itself, and the adapter
   * always has a transaction. An optional member would buy nothing and would
   * hand every caller a silent non-atomic fallback to forget about.
   */
  transaction<T>(work: (tx: ReleasesTxApi) => Promise<T>): Promise<T>;
};

/**
 * The database surface a release transition needs INSIDE a transaction.
 *
 * The statements the atomic paths perform, and no others: a fenced
 * compare-and-set on the release, the read of the revision that compare-and-set
 * is fenced on, and the member write it guards. Each is declared in the
 * adapter's `TransactionContext` shape, narrowed to the where clause and
 * options this repository uses, so the transaction context satisfies it
 * without adapting. Kept separate from {@link ReleasesDbApi} rather than
 * reusing it, because a transaction context genuinely cannot do everything the
 * adapter can — declaring the wider type here would promise a caller counts,
 * nested transactions and revalidation that are either unavailable or actively
 * wrong before the commit.
 */
export interface ReleasesTxApi {
  /**
   * Hold one row's lock until the transaction ends. Taken on the release
   * before its revision is read, so two membership changes to one release
   * queue behind each other rather than both reading the same revision and
   * the second missing its own fence.
   */
  lockRow(table: string, id: string): Promise<void>;
  select<T = unknown>(
    table: string,
    options?: VersionsSelectOptions
  ): Promise<T[]>;
  insert<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    options?: { returning?: string[] | "*" }
  ): Promise<T>;
  delete(table: string, where: VersionsWhere): Promise<number>;
  updateCount(
    table: string,
    data: Record<string, unknown>,
    where: VersionsWhere
  ): Promise<number>;
}

const RELEASES = "nextly_releases";
const MEMBERS = "nextly_release_members";

/**
 * The rows a release holds: the one selection every read of membership uses,
 * so a list, a count and the limit judged under the release lock cannot come
 * to count different sets.
 */
function membersOf(releaseIds: readonly string[]) {
  // Inferred rather than annotated: it is read both through the port and
  // inside a transaction, whose where types differ only in name.
  return {
    and: [
      {
        column: "releaseId",
        op: "IN" as const,
        value: [...new Set(releaseIds)],
      },
    ],
  };
}
/**
 * Read ONLY to answer whether a member's author may still act. This module owns
 * no user behaviour and writes nothing here; the alternative is resolving an
 * identity per document on the hot read path, which is the cost the whole memo
 * in `pending-transition-cache` exists to avoid.
 */
const USERS = "users";

/** One release to stop, with the instant the pass planned against. */
export interface BlockRequest {
  id: string;
  scheduledAt: Date;
}

/** The document a member points at. */
export interface DocumentRef {
  scopeKind: VersionScopeKind;
  scopeSlug: string;
  entryId: string;
  /** `null` is the unlocalized document. */
  locale: string | null;
}

/**
 * Which end of the scheduled timeline a release listing is taken from.
 *
 * Named rather than a boolean, because both ends are real questions and neither
 * is the negation of the other: `"latest"` serves "what happened recently",
 * `"soonest"` serves "what ships next". A `soonestFirst: false` would read as
 * the absence of a preference rather than as the other choice.
 */
export const RELEASE_LIST_ORDERS = ["soonest", "latest"] as const;

/**
 * Declared as a const array with the type DERIVED from it, the way this
 * codebase spells every other closed vocabulary. A bare type union has no
 * runtime form, so nothing can check a value against it -- and this particular
 * field fails silently when unchecked: an unrecognised order does not throw and
 * does not return nothing, it returns the OPPOSITE END of the schedule, which
 * reads as a working query.
 */
export type ReleaseListOrder = (typeof RELEASE_LIST_ORDERS)[number];

/**
 * A condition the release list can put to the database: the versions port's
 * operators, plus the one the search uses to match text.
 */
export interface ReleasesWhereCondition
  extends Omit<VersionsWhereCondition, "op"> {
  op: VersionsWhereCondition["op"] | "ICONTAINS";
}

/** A where clause over {@link ReleasesWhereCondition}s. */
export interface ReleasesWhere {
  and?: (ReleasesWhereCondition | ReleasesWhere)[];
  or?: (ReleasesWhereCondition | ReleasesWhere)[];
}

/** The versions port's select options, over the wider where clause. */
export interface ReleasesSelectOptions
  extends Omit<VersionsSelectOptions, "where"> {
  where?: ReleasesWhere;
}

/**
 * What narrows a release listing, whichever way it is ordered or paged.
 *
 * @experimental `search` may change until the releases list redesign is
 *   complete.
 */
export interface ReleaseListFilters {
  /** Only these releases. An empty list means none, not "no filter". */
  ids?: string[];
  state?: string;
  /** Only releases of this kind: `release` leaves out single-document ones. */
  kind?: ReleaseKind;
  scheduledAfter?: Date;
  scheduledBefore?: Date;
  /**
   * Only releases placed in this span, from `start` up to but not including
   * `end`: a day in a zone, as `zonedDay` works it out. A published release is
   * placed at the instant it went out, any other at its scheduled instant
   * (`placedWithinCondition`).
   *
   * @experimental
   */
  placedWithin?: ReleaseTimeSpan;
  /**
   * Text the title or the description contains, without regard to case.
   * Matched literally: `%` and `_` are characters to find, not wildcards.
   */
  search?: string;
}

/**
 * One page of a release listing.
 *
 * `tab` takes the tab's own conditions and order; without one, the filters are
 * ordered by scheduled instant, latest first unless `order` says otherwise.
 *
 * @experimental
 */
export interface ReleasePageQuery extends ReleaseListFilters {
  tab?: ReleaseTab;
  /** One part of the attention tab only. Ignored with any other tab. */
  reason?: ReleaseAttentionReason;
  /** The moment overdue is judged at. Required with a tab. */
  now?: Date;
  order?: ReleaseListOrder;
  offset?: number;
  limit?: number;
}

/** @experimental */
export interface ReleasePage {
  rows: ReleaseRow[];
  /** Every release the query matches, across all pages. */
  total: number;
}

/**
 * The search, as a condition that ignores case on every engine.
 *
 * `ICONTAINS` is the adapter's literal substring match without regard to
 * case, even under a case-sensitive collation: a typed `%` or `_` is searched for,
 * not read as a wildcard, and a MySQL column under a case-sensitive collation
 * still matches "Spring" for "spring".
 */
export function releaseSearchCondition(
  column: "title" | "description",
  search: string
): ReleasesWhereCondition {
  return { column, op: "ICONTAINS", value: search };
}

export interface ReleaseRow {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: Date | null;
  timezone: string | null;
  state: ReleaseState;
  kind: ReleaseKind;
  publishedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  revision: number;
}

/** A field a rename can change. */
export type ReleaseDetailsField = "title" | "description";

/**
 * What a rename wrote: the release as the write left it, and which fields it
 * changed (none when the release already read that way).
 *
 * @experimental
 */
export interface ReleaseDetailsWrite {
  row: ReleaseRow;
  changed: ReleaseDetailsField[];
}

export interface ReleaseMemberRow {
  id: string;
  releaseId: string;
  scopeKind: VersionScopeKind;
  scopeSlug: string;
  entryId: string;
  locale: string | null;
  action: ReleaseMemberAction;
  memberKey: string;
  /**
   * 1 for the member of a single-document release, null otherwise: the column
   * the database holds unique per release, so a single release cannot take a
   * second member. Written by {@link ReleasesRepository.addMember} from the
   * release's kind.
   */
  singleSlot: number | null;
  createdBy: string | null;
  createdAt: Date;
}

/**
 * A member as the drain reads it: with its applied mark.
 *
 * Internal bookkeeping, kept off {@link ReleaseMemberRow} so no member read
 * a caller receives (the Direct API, REST) carries it: every read of that
 * shape selects {@link MEMBER_COLUMNS}, and only {@link
 * ReleasesRepository.listMembersOf}, the drain's read, adds the mark.
 */
export interface DrainMemberRow extends ReleaseMemberRow {
  /**
   * The release revision this member's action was last applied for, or null
   * when no write of it has landed. Written only in the transaction of the
   * content write itself; see {@link recordMemberApplied}. Read it through
   * {@link memberAppliedFor}, never on its own: a mark for any revision but
   * the release's current one describes a release that has since moved.
   */
  appliedRevision: number | null;
}

/**
 * The columns of {@link ReleaseMemberRow}, which every member read a caller
 * receives selects. Listed rather than left to `SELECT *`, so a bookkeeping
 * column the table gains (the applied mark) never reaches a response.
 */
const MEMBER_COLUMNS = [
  "id",
  "releaseId",
  "scopeKind",
  "scopeSlug",
  "entryId",
  "locale",
  "action",
  "memberKey",
  "singleSlot",
  "createdBy",
  "createdAt",
] as const satisfies readonly (keyof ReleaseMemberRow)[];

/**
 * Fails to compile when {@link ReleaseMemberRow} gains a field the list above
 * leaves out, which would otherwise read back as undefined from every member
 * read.
 */
type UnselectedMemberField = Exclude<
  keyof ReleaseMemberRow,
  (typeof MEMBER_COLUMNS)[number]
>;
type AssertEveryMemberFieldSelected = [UnselectedMemberField] extends [never]
  ? true
  : UnselectedMemberField;
const _everyMemberFieldSelected: AssertEveryMemberFieldSelected = true;

/**
 * Whether a member's action has been applied for the release as it now
 * stands: marked, by its own write, for exactly this revision.
 *
 * The ONE reading of the mark. Every move of a release raises its revision
 * (`advanceRevision`, and scheduling), so a mark left by an earlier pass is
 * stale the moment the release is rescheduled, cancelled, renamed or has its
 * membership changed, and nothing needs to clear it.
 */
export function memberAppliedFor(
  member: Pick<DrainMemberRow, "appliedRevision">,
  revision: number
): boolean {
  return member.appliedRevision === revision;
}

/**
 * Take a member's applied mark back, inside the transaction of a write that
 * left its document without the member's action: a hook that writes the
 * document back after the action's own write committed, say. Idempotent.
 */
export async function forgetMemberApplied(
  tx: Pick<ReleasesTxApi, "updateCount">,
  memberId: string
): Promise<void> {
  await tx.updateCount(
    MEMBERS,
    { appliedRevision: null },
    { and: [{ column: "id", op: "=", value: memberId }] }
  );
}

/**
 * Mark a member applied for `revision`, inside the transaction of the content
 * write that applied it, so the mark commits exactly when the write does: a
 * write that rolls back leaves no mark, and one that commits cannot be left
 * without it.
 *
 * Every other member naming the same document loses its mark in the same
 * transaction. The document now carries THIS member's action, so a mark that
 * said another member's action was in place is no longer true of it: without
 * this, a release whose member lost the document to another release's write,
 * and later won it back, would be passed over with the other action in place.
 *
 * Idempotent: a write that runs its transaction again writes the same values.
 */
export async function recordMemberApplied(
  tx: Pick<ReleasesTxApi, "updateCount">,
  member: { id: string; revision: number; ref: DocumentRef }
): Promise<void> {
  await tx.updateCount(
    MEMBERS,
    { appliedRevision: null },
    {
      and: [
        { column: "scopeKind", op: "=", value: member.ref.scopeKind },
        { column: "scopeSlug", op: "=", value: member.ref.scopeSlug },
        { column: "entryId", op: "=", value: member.ref.entryId },
        { column: "id", op: "!=", value: member.id },
        { column: "appliedRevision", op: "IS NOT NULL" },
      ],
    }
  );
  await tx.updateCount(
    MEMBERS,
    { appliedRevision: member.revision },
    { and: [{ column: "id", op: "=", value: member.id }] }
  );
}

export interface NewRelease {
  title: string;
  description?: string | null;
  /** `release` when not given. Fixed once the release exists. */
  kind?: ReleaseKind;
  createdBy?: string | null;
}

export interface NewReleaseMember extends DocumentRef {
  releaseId: string;
  action: ReleaseMemberAction;
  createdBy?: string | null;
}

/**
 * The key a batched lookup groups by.
 *
 * Exported and used by BOTH sides of that lookup so a caller cannot invent a
 * second spelling of the same document — two spellings would silently return
 * an empty member list, which reads exactly like "nothing is scheduled".
 */
/**
 * The due members of each document, keyed by ENTRY.
 *
 * By entry and not by entry-and-locale. A key carrying the locale produced two
 * groups for one document, each resolving its own winner — so an older
 * document-wide publish and a newer takedown could put the SAME id in both the
 * reveal and hide sets, and the two read paths then disagreed about it.
 *
 * A member whose release is not scheduled contributes nothing: an unscheduled
 * release is somebody still deciding, and consulting it would make adding a
 * document to a draft release change what readers see.
 */
function groupMembersByDocument(
  members: ReleaseMemberRow[],
  releases: Map<string, { scheduledAt: Date | null }>
): Map<string, DueMember[]> {
  const grouped = new Map<string, DueMember[]>();
  for (const member of members) {
    const release = releases.get(member.releaseId);
    if (release === undefined || release.scheduledAt === null) continue;
    const bucket = grouped.get(member.entryId) ?? [];
    bucket.push({
      memberId: member.id,
      releaseId: member.releaseId,
      action: member.action,
      scheduledAt: release.scheduledAt,
      createdAt: member.createdAt,
    });
    grouped.set(member.entryId, bucket);
  }
  return grouped;
}

/**
 * A membership change refused because its release is no longer in a state the
 * caller judged it could land on — scheduled, published or cancelled since —
 * or is not there at all. A conflict rather than a refusal of authority: a
 * retry judges the release as it now is.
 */
function releaseMovedConflict(
  releaseId: string,
  change: "add-member" | "remove-member" | "change-member-action"
): NextlyError {
  return NextlyError.conflict({
    logContext: { reason: "release-moved-since-judged", releaseId, change },
  });
}

export function documentRefKey(ref: DocumentRef): string {
  return [ref.scopeKind, ref.scopeSlug, ref.entryId, ref.locale ?? ""]
    .map(encodeURIComponent)
    .join(":");
}

/**
 * The plain listing's order: by scheduled instant, latest first by default.
 *
 * The product read with no tab, as opposed to `findDueReleases`, which answers
 * the drain's question and nothing else. A window and a limit come from the
 * caller, because a release index and a dashboard widget ask with different
 * bounds, and the bounds are pushed to the database rather than filtered in
 * memory.
 *
 * 🔴 The direction decides WHICH END of the window a `limit` keeps, so it
 * belongs to the caller's question. Descending answers "what happened
 * recently" and stays this method's default; ascending answers "what ships
 * next", which under the descending order returns the FURTHEST-OUT releases
 * while looking correct.
 */
function scheduleOrderQuery(order?: ReleaseListOrder): ReleaseTabQuery {
  const direction = order === "soonest" ? "asc" : "desc";
  return {
    where: [],
    orderBy: [
      // NULLS LAST in BOTH directions, stated rather than defaulted. An
      // unscheduled draft has a null instant, and the default differs per
      // dialect — on PostgreSQL a descending order puts nulls first, so a
      // limited "what ships next" query would return drafts and omit every
      // scheduled release. Ascending is no safer left implicit: PostgreSQL
      // puts nulls last there while SQLite and MySQL put them first, so the
      // same query would answer differently per dialect. A draft is not the
      // next thing to ship under either direction.
      { column: "scheduledAt", direction, nulls: "last" },
      { column: "createdAt", direction },
      // `id` last, so the order is actually total. `createdAt` is not unique
      // and is stored coarsely enough for concurrent releases to tie —
      // especially on SQLite — and two drafts tie on a null `scheduledAt` as
      // well, so without this a limited page can return different rows across
      // query plans and dialects.
      //
      // Both tiebreakers follow `direction` rather than staying descending,
      // so a tie breaks toward the same end the primary key does: under
      // "soonest" the earlier-created of two releases sharing an instant
      // comes first, which is the one a reader means by "next".
      { column: "id", direction },
    ],
  };
}

/**
 * The filters on when a release happens, as conditions: each bound given, and
 * none for a bound left out.
 */
function scheduleWindowConditions(
  filters: Pick<
    ReleaseListFilters,
    "scheduledAfter" | "scheduledBefore" | "placedWithin"
  >
): (VersionsWhereCondition | VersionsWhere)[] {
  const conditions: (VersionsWhereCondition | VersionsWhere)[] = [];
  if (filters.scheduledAfter !== undefined) {
    conditions.push({
      column: "scheduledAt",
      op: ">=",
      value: filters.scheduledAfter,
    });
  }
  if (filters.scheduledBefore !== undefined) {
    conditions.push({
      column: "scheduledAt",
      op: "<=",
      value: filters.scheduledBefore,
    });
  }
  if (filters.placedWithin !== undefined) {
    // The same condition the calendar places a release on its day by, so a
    // day's list and the calendar's count of that day hold the same releases.
    conditions.push(placedWithinCondition(filters.placedWithin));
  }
  return conditions;
}

export class ReleasesRepository {
  /**
   * @param revalidator flushed when a release's SCHEDULE changes, so pages
   *   cached before it was scheduled stop serving past the transition. Taken at
   *   construction rather than per call: there is one place per runtime that
   *   knows how to reach the cache, and a per-call parameter is a thing 31 call
   *   sites can each forget. A runtime with no cache passes nothing.
   */
  constructor(
    private readonly db: ReleasesDbApi,
    private readonly revalidator?: CacheRevalidator
  ) {}

  /**
   * Flush the tags of every document this release names.
   *
   * Best-effort and never throws: a schedule that committed must not be
   * reported as failed because a cache could not be reached, and the bound
   * computed at the next read is a second line of defence for exactly this.
   */
  private async revalidateMembersOf(releaseId: string): Promise<void> {
    // Drop the shared transition memo FIRST, and unconditionally. Flushing tags
    // re-renders the page, and the re-render reads that memo — a stale one
    // hands it the same "nothing scheduled" bound it had before, so the page is
    // cached tag-only again against a release the schedule already knows about.
    // Done even with no revalidator wired: the memo is wrong either way.
    invalidateTransitionCacheFor(this.db);

    if (this.revalidator === undefined) return;
    try {
      const intent = releaseRevalidationIntent(
        await this.listMembers(releaseId)
      );
      if (intent !== null) await this.revalidator.flush([intent]);
    } catch {
      // Deliberately swallowed; see the note above.
    }
  }

  async createRelease(input: NewRelease): Promise<ReleaseRow> {
    const now = new Date();
    const row: ReleaseRow = {
      // Time-ordered, because the list breaks ties on the id: SQLite stores
      // instants in whole seconds, so releases made within one second share a
      // creation time, and only an id that rises in creation order keeps
      // "newest first" true among them. A random id would order them by chance.
      id: uuidV7(),
      title: input.title,
      description: input.description ?? null,
      scheduledAt: null,
      timezone: null,
      // A new release is always assembled before it is scheduled, so it
      // starts in the one state the read rule never consults.
      state: "draft",
      kind: input.kind ?? "release",
      publishedAt: null,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
      revision: 0,
    };
    // The id is generated here and the insert asks for nothing back, because
    // MySQL has no RETURNING: a repository that read the inserted row from
    // the insert result would work on SQLite and Postgres and hand back
    // `undefined` on MySQL.
    await this.db.insert(RELEASES, { ...row }, { returning: [] });
    return row;
  }

  /**
   * Commit a release to an instant, and say whether it moved.
   *
   * FENCED on the states a schedule may legally leave. A `published` release is
   * excluded: moving one back to `scheduled` makes the drain re-apply members
   * whose documents have changed since, republishing or re-withdrawing content
   * nobody asked it to touch. `draft` and `cancelled` are both legitimate
   * sources — the second is how a called-off launch is put back on.
   *
   * And fenced on `expectedRevision`, the release's `revision` as the caller
   * read it. The revision is a counter every scheduling move and every
   * membership change raises by one, so it names one version of the release's
   * schedule AND its contents together. The state fence cannot tell two callers
   * apart when the state did not change: a draft whose only member was removed
   * after the caller judged it is still a draft, and a state-only update would
   * schedule it empty. The revision moved, so this update matches nothing.
   * Every schedule therefore bumps it, and is a compare-and-set on the value
   * read. The caller supplies that value because the adapter has no increment
   * expression: `revision + 1` cannot be written as an update, only as the
   * number one more than a revision somebody read.
   *
   * Answering `false` rather than throwing follows `markReleasesPublished`: the
   * repository reports what the fence did, and the caller decides whether a
   * refusal is a conflict for its transport.
   */
  async scheduleRelease(
    id: string,
    at: Date,
    timezone: string,
    from: readonly ReleaseState[],
    expectedRevision: number
  ): Promise<boolean> {
    const affected = await this.db.updateCount(
      RELEASES,
      {
        scheduledAt: at,
        timezone,
        state: "scheduled" satisfies ReleaseState,
        // Always moves, so MySQL — which counts CHANGED rows rather than
        // matched ones — reports a reschedule to the same instant as the write
        // it is, not as a fence miss.
        revision: expectedRevision + 1,
        updatedAt: new Date(),
        ...(expectedRevision === undefined
          ? {}
          : { revision: expectedRevision + 1 }),
      },
      {
        and: [
          { column: "id", op: "=", value: id },
          { column: "revision", op: "=", value: expectedRevision },
          // The fence IS the declaration, not a copy of it: the admin decides
          // which controls to offer from the same list, so a change here cannot
          // leave a button offering a move the database refuses.
          //
          // NARROWED BY THE CALLER when it has already formed a judgement about
          // this release's state. Scheduling a blocked release is a recovery
          // and is valid only once nothing blocks it, which the service decides
          // from a read; passing the state that read observed makes this update
          // a compare-and-set on it. A release blocked between the two simply
          // fails the fence, rather than being rescheduled with its blockers
          // never examined.
          {
            column: "state",
            op: "IN",
            value: [...from],
          },
        ],
      }
    );
    if (affected === 0) return false;
    await this.revalidateMembersOf(id);
    return true;
  }

  /**
   * Stop a whole component of releases the drain can never apply, ATOMICALLY.
   *
   * Takes a SET rather than one release, because the unit that has to move
   * together is the set of releases sharing a document. Blocking them one
   * statement at a time leaves the component split whenever the process dies
   * partway — and a split component is not a smaller version of the right
   * answer, it is a different one: the surviving release becomes the winner on
   * every document it shares, and can apply the OPPOSITE lifecycle action to
   * the one the whole component would have produced.
   *
   * ## Why ordering cannot substitute for a transaction
   *
   * The previous version blocked earliest-first, reasoning that any surviving
   * prefix leaves the later — and therefore winning — release scheduled. That
   * argument fails for tied instants, and not repairably. `resolveReleaseEffect`
   * breaks a tie on the MEMBER's creation time and then its id, and it does so
   * per document; two releases naming one instant can therefore each win on a
   * different document of the same component. No ordering of RELEASES can
   * preserve a winner that is chosen per member, so there is no comparator that
   * fixes this and the guarantee has to come from atomicity.
   *
   * Fenced on the state AND on the instant the pass planned against, the same
   * pair `isStillDueAt` judges by. State alone is not enough: an editor who
   * postpones a due release between the plan and this write leaves the row in
   * `scheduled`, so a state-only predicate matches and overwrites the schedule
   * they just chose.
   *
   * Fenced on the state AND on the instant the pass planned against, the same
   * pair `isStillDueAt` judges by. State alone is not enough: an editor who
   * postpones a due release between the plan and this write leaves the row in
   * `scheduled`, so a state-only predicate matches and overwrites the schedule
   * they just chose. The release would then never run at the replacement
   * instant, and nothing would say why.
   *
   * REVALIDATES, and the reason is worth stating because the opposite looks
   * right: only a DUE release is ever blocked, and a due release is already in
   * effect for readers — `resolveReleaseEffect` counts every member whose
   * instant has passed. So its projection is live, and stopping it removes
   * something a reader can currently see. A scheduled release whose instant has
   * NOT arrived would indeed need no flush; that is a different release.
   *
   * @returns the ids actually blocked — every id given, or none at all.
   */
  async blockReleases(
    entries: readonly BlockRequest[]
  ): Promise<readonly string[]> {
    const moved = await this.moveComponentWhole(entries, entry => ({
      set: { state: "blocked" satisfies ReleaseState },
      where: [{ column: "scheduledAt", op: "=", value: entry.scheduledAt }],
    }));

    // AFTER THE COMMIT, never inside it. Revalidation makes a change visible to
    // readers and drops the shared transition memo, and doing that from inside
    // the transaction would announce a transition that can still roll back —
    // the reader would then see a release stopped that is still scheduled.
    for (const entry of moved) await this.revalidateMembersOf(entry.id);
    return moved.map(entry => entry.id);
  }

  /**
   * Move every release of one component out of `scheduled`, in ONE
   * transaction, or none of them: the releases moved, or an empty list when
   * any one's fence matched nothing. `moveOf` says what each release's move
   * writes and what else its fence requires.
   *
   * A component is the set of releases sharing a document, and it moves
   * together because a split one is not a smaller version of the right answer:
   * the release left behind becomes the winner on every document it shares and
   * can apply the OPPOSITE action to the one the whole component produced.
   *
   * ORDERED BY ID. Correctness under partial failure belongs to the
   * transaction, so the order cannot affect the outcome; it exists so two
   * drains racing on overlapping components take the same row locks in the
   * same sequence and cannot deadlock against each other.
   */
  private async moveComponentWhole<E extends { id: string }>(
    entries: readonly E[],
    moveOf: (entry: E) => {
      set: Record<string, unknown>;
      where: readonly VersionsWhereCondition[];
    }
  ): Promise<readonly E[]> {
    if (entries.length === 0) return [];
    const ordered = [...entries].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    );

    // Distinguishes a fence that legitimately matched nothing from a database
    // failure. Both leave the transaction rolled back, and only the first is an
    // ordinary outcome the drain should absorb — so the flag decides, rather
    // than the shape of the error, which a caught-and-rethrown driver error
    // could imitate.
    let fenceMissed = false;
    try {
      await this.db.transaction(async tx => {
        for (const entry of ordered) {
          // Each row locked, its revision read and bumped, in id order: every
          // move of a release raises the revision a schedule is fenced on.
          const moved = await this.advanceRevision(
            tx,
            entry.id,
            ["scheduled"],
            moveOf(entry)
          );
          if (moved === null) {
            fenceMissed = true;
            throw NextlyError.conflict({
              logContext: {
                reason: "release-component-moved",
                releaseId: entry.id,
              },
            });
          }
        }
      });
    } catch (error) {
      // A release of the component moved between the plan and this write, so
      // the component is no longer the one that was judged. NOTHING moves
      // rather than the remainder, and the next pass re-plans against what is
      // now true.
      if (fenceMissed) return [];
      throw error;
    }
    return ordered;
  }

  /**
   * Call a release off, and say whether it moved.
   *
   * Nothing is undone and nothing is written to any document: the read rule
   * consults only the states in `RELEASE_STATES_AFFECTING_CONTENT`, so a
   * cancelled release simply stops being consulted. That is what makes
   * cancelling a due-but-unmaterialised release free, and why there is no
   * restore path here.
   *
   * Fenced away from `published` for the same reason scheduling is: that
   * release already happened, and marking it cancelled would describe history
   * that did not occur while leaving the published content in place.
   *
   * And it bumps the revision, under the release's lock. `cancelled` is a
   * state a schedule may leave, so a state fence alone would let a schedule
   * judged before this cancel put the launch straight back on; the revision
   * moved, so that schedule misses instead.
   */
  async cancelRelease(id: string): Promise<boolean> {
    const moved = await this.db.transaction(tx =>
      this.advanceRevision(tx, id, RELEASE_CANCELLABLE_FROM, {
        set: { state: "cancelled" satisfies ReleaseState },
      })
    );
    if (moved === null) return false;
    // AFTER THE COMMIT, for the reason `blockReleases` gives. Cancelling
    // changes what a read returns just as scheduling does: a page
    // cached with a lifetime derived from this release is now bounded by an
    // instant that will never arrive.
    await this.revalidateMembersOf(id);
    return true;
  }

  /**
   * Change a release's title or description, deciding under the release's
   * lock whether that changes anything, and answer the row as this write
   * left it with the fields it changed; `null` when the release is not there.
   *
   * Decided under the lock rather than from an earlier read, so two requests
   * setting one title cannot both count as the rename: the second finds the
   * title already set, writes nothing, and answers the row as it found it.
   * The answer is the row this transaction wrote, never a read after the
   * commit, which could return another request's later change as this one's.
   *
   * A change is a move like any other: a compare-and-set on the revision and
   * a bump of it (`advanceRevision`), so a schedule judged before this rename
   * misses on the revision and is judged again. Any state: the title is a
   * label, and renaming a release that ran changes nothing it did.
   *
   * `updatedAt` is left as it is, since a rename is not a lifecycle move: on
   * a published or cancelled release it is the instant the release finished,
   * and the Done tab orders by it, so a renamed launch keeps its place there.
   *
   * Nothing to revalidate. A release's title is not content, and no cached
   * page is bounded by it.
   *
   * @experimental
   */
  async updateReleaseDetails(
    id: string,
    details: { title?: string; description?: string | null }
  ): Promise<ReleaseDetailsWrite | null> {
    return this.db.transaction(async tx => {
      await tx.lockRow(RELEASES, id);
      const [current] = await tx.select<ReleaseRow>(RELEASES, {
        where: { and: [{ column: "id", op: "=", value: id }] },
      });
      if (current === undefined) return null;

      const changed: ReleaseDetailsField[] = [];
      const set: Record<string, unknown> = {};
      const next: ReleaseRow = { ...current };
      if (details.title !== undefined && details.title !== current.title) {
        changed.push("title");
        set.title = next.title = details.title;
      }
      if (
        details.description !== undefined &&
        details.description !== current.description
      ) {
        changed.push("description");
        set.description = next.description = details.description;
      }
      if (changed.length === 0) return { row: current, changed };

      const moved = await this.advanceRevision(tx, id, RELEASE_STATES, {
        set,
        keepUpdatedAt: true,
      });
      // Under the lock taken above nothing can have moved the release, so
      // this answers a release that is gone the way the read above does.
      if (moved === null) return null;
      return { row: { ...next, revision: current.revision + 1 }, changed };
    });
  }

  /**
   * Delete a release and its members, in one transaction, and answer the
   * release as this transaction found it under its lock.
   *
   * Fenced on {@link RELEASE_DELETABLE_FROM}, and on the release never having
   * been scheduled, through `advanceRevision`, so the
   * release is locked and its state checked by the same compare-and-set as
   * every other move: a release scheduled after the caller judged it is not
   * deleted, and neither are its members. A member row names its release with
   * no foreign key on any dialect, so the members are removed here, in the
   * same transaction, rather than left naming a release that is gone.
   *
   * The members are read before they are deleted, for the flush after the
   * commit, as `removeMember` does. A draft or cancelled release is not
   * consulted by a read, so the flush is a precaution for a release that
   * moved between a page's render and this delete, not a change readers see.
   *
   * The answer is the row read under the lock, not one the caller read
   * before: a rename landing between the two would otherwise be recorded
   * against the deleted release under the title it no longer had.
   *
   * `null` when the release is not there or not in a deletable state;
   * nothing is deleted then.
   *
   * @experimental
   */
  async deleteRelease(id: string): Promise<ReleaseRow | null> {
    const ofThisRelease: VersionsWhere = {
      and: [{ column: "releaseId", op: "=", value: id }],
    };
    const removed = await this.db.transaction(async tx => {
      await tx.lockRow(RELEASES, id);
      const [release] = await tx.select<ReleaseRow>(RELEASES, {
        where: { and: [{ column: "id", op: "=", value: id }] },
      });
      if (release === undefined) return null;
      if (
        (await this.advanceRevision(tx, id, RELEASE_DELETABLE_FROM, {
          // Never scheduled: a cancelled release that was is kept, since
          // nothing stored says whether it began to run.
          where: [{ column: "scheduledAt", op: "IS NULL" }],
        })) === null
      ) {
        return null;
      }
      const members = await tx.select<ReleaseMemberRow>(MEMBERS, {
        columns: [...MEMBER_COLUMNS],
        where: ofThisRelease,
      });
      await tx.delete(MEMBERS, ofThisRelease);
      await tx.delete(RELEASES, {
        and: [{ column: "id", op: "=", value: id }],
      });
      return { release, members };
    });
    if (removed === null) return null;
    // AFTER THE COMMIT, for the reason `blockReleases` gives.
    await this.flushMembers(removed.members);
    return removed.release;
  }

  /**
   * Drop the transition memo and flush the tags of these members' documents,
   * for members the caller has already removed and read.
   *
   * For a write after which the members can no longer be listed from the
   * release, so `revalidateMembersOf` would find nothing. Best-effort and
   * never throws, for the reason that method gives.
   */
  private async flushMembers(
    members: readonly ReleaseMemberRow[]
  ): Promise<void> {
    invalidateTransitionCacheFor(this.db);
    if (members.length === 0 || this.revalidator === undefined) return;
    try {
      const intent = releaseRevalidationIntent(members);
      if (intent !== null) await this.revalidator.flush([intent]);
    } catch {
      // Best-effort, as everywhere else this flushes.
    }
  }

  /**
   * Inside `tx`, raise this release's revision by one — only while it is in
   * one of `allowedStates` — and answer its kind, or `null` when it is not
   * there or not in those states.
   *
   * The ONE way a release row moves inside a transaction: every membership
   * change, cancel, block, publish, rename and delete goes through here, so
   * every one of them bumps the revision a schedule is fenced on. `move.set`
   * is what the move writes besides the revision — a new state, a publish
   * instant, a title — and
   * `move.where` narrows the fence further, as the drain's block does with the
   * instant it planned against.
   *
   * The release row is locked first, so the revision read here is the one the
   * update compares against: two moves of one release queue rather than miss
   * each other's fence. The update is a compare-and-set on that revision and
   * on the state, so a schedule that committed in between makes it match
   * nothing; and once it has matched, the row lock it holds until the commit
   * makes a schedule judged against the old revision wait and then miss.
   * SQLite takes no row lock, and needs none: it serializes writers.
   *
   * `updateCount` rather than `update({ returning })`: MySQL has no RETURNING,
   * and the adapter emulates it by re-selecting on a predicate this very write
   * invalidates. The revision always moves, which is also what MySQL —
   * counting changed rows rather than matched ones — needs of a
   * compare-and-set.
   */
  private async advanceRevision(
    tx: ReleasesTxApi,
    releaseId: string,
    allowedStates: readonly ReleaseState[],
    move: {
      set?: Record<string, unknown>;
      where?: readonly VersionsWhereCondition[];
      /**
       * Leave `updatedAt` as it is. For a write that is not a lifecycle move:
       * on a finished release `updatedAt` is the instant it finished, which
       * the Done tab orders by (`release-tabs`).
       */
      keepUpdatedAt?: boolean;
    } = {}
  ): Promise<{ kind: ReleaseKind } | null> {
    await tx.lockRow(RELEASES, releaseId);
    const [release] = await tx.select<{ revision: number; kind: ReleaseKind }>(
      RELEASES,
      {
        columns: ["revision", "kind"],
        where: { and: [{ column: "id", op: "=", value: releaseId }] },
      }
    );
    if (release === undefined) return null;
    const affected = await tx.updateCount(
      RELEASES,
      // The revision last, so no `set` can write a value of its own there.
      {
        ...(move.keepUpdatedAt === true ? {} : { updatedAt: new Date() }),
        ...move.set,
        revision: release.revision + 1,
      },
      {
        and: [
          { column: "id", op: "=", value: releaseId },
          { column: "revision", op: "=", value: release.revision },
          { column: "state", op: "IN", value: [...allowedStates] },
          ...(move.where ?? []),
        ],
      }
    );
    return affected === 0 ? null : { kind: release.kind };
  }

  /** One member by id, so a caller can learn which release it belongs to. */
  async findMember(memberId: string): Promise<ReleaseMemberRow | undefined> {
    const rows = await this.db.select<ReleaseMemberRow>(MEMBERS, {
      columns: [...MEMBER_COLUMNS],
      where: { and: [{ column: "id", op: "=", value: memberId }] },
    });
    return rows[0];
  }

  /**
   * Whether these author ids resolve to users who can still act.
   *
   * Public because the WRITE path needs the same question the read path asks. A
   * member whose author is deleted or deactivated is recorded, scheduled, and
   * then fails on every drain with `AUTHOR_UNAVAILABLE`, leaving the release
   * scheduled forever — a failure that only ever shows up as content that did
   * not appear.
   */
  async liveAuthors(ids: string[]): Promise<ReadonlySet<string>> {
    return this.liveAuthorIds(ids);
  }

  /**
   * Releases matching some filters, latest scheduled instant first unless
   * `order` says otherwise. The unpaged read the engine and the dashboard use;
   * {@link findReleasePage} is the same read with a page and a true total.
   */
  async findReleases(
    query: ReleaseListFilters & {
      limit?: number;
      offset?: number;
      order?: ReleaseListOrder;
    }
  ): Promise<ReleaseRow[]> {
    const listing = this.listingFor(query);
    if (listing === null) return [];
    return this.selectPage(listing, query);
  }

  /**
   * One page of releases, and how many match in all.
   *
   * With a `tab`, the tab's own conditions and order (`release-tabs`); without
   * one, the filters alone, in scheduled order. The filters narrow either.
   *
   * The rows and the total are two reads, as on every paged list here, not
   * one snapshot: a release that changes state between them (the drain
   * publishing one) can leave them one apart for that response. Holding a
   * transaction open across both to close that would cost every listing for
   * a gap the next request closes by itself.
   *
   * @experimental
   */
  async findReleasePage(query: ReleasePageQuery): Promise<ReleasePage> {
    const listing = this.listingFor(query);
    if (listing === null) return { rows: [], total: 0 };
    return {
      rows: await this.selectPage(listing, query),
      total: await this.db.count(RELEASES, { where: listing.where }),
    };
  }

  /**
   * How many releases a listing would hold, without reading them.
   *
   * The question a dashboard asks ("how many need attention?"). It counts the
   * same where clause {@link findReleasePage} counts for its total, built by
   * the same {@link listingFor}, so the two cannot disagree.
   *
   * @experimental
   */
  async countReleases(query: ReleasePageQuery): Promise<number> {
    const listing = this.listingFor(query);
    if (listing === null) return 0;
    return this.db.count(RELEASES, { where: listing.where });
  }

  /**
   * Each of these days' releases, counted by state, with the first `perDay` of
   * them read in full.
   *
   * One read of every release in the window, in the order the list filtered
   * to one day shows them. The counts and the releases each day shows are both
   * taken from it, so they describe the same moment: two reads would let the
   * drain publish a release between them, and a day would count it as
   * scheduled while showing it as published. Counting every release is what
   * makes the counts complete, since a count of a page would only count the
   * page. Releases are one per launch, so a six-week window holds tens of
   * them, and the window is the bound on this read. The port has no grouped
   * count, and a count per day and state would be one query per pair.
   *
   * Through {@link listingFor}, with the plain soonest-first order, so the
   * releases a day shows are the first rows of that day's list and the window
   * narrows by `kind` exactly as the list does.
   *
   * @experimental
   */
  async findReleaseCalendar(query: {
    days: readonly ZonedDay[];
    kind?: ReleaseKind;
    perDay: number;
  }): Promise<ReleaseCalendarDay[]> {
    const { days } = query;
    if (days.length === 0) return [];
    const listing = this.listingFor({
      kind: query.kind,
      placedWithin: { start: days[0].start, end: days[days.length - 1].end },
      order: "soonest",
    });
    const rows =
      listing === null
        ? []
        : await this.db.select<ReleaseRow>(RELEASES, {
            where: listing.where,
            orderBy: listing.orderBy,
          });
    const byId = new Map(rows.map(row => [row.id, row]));
    return tallyByDay(days, rows, query.perDay).map(
      ({ firstIds, ...tally }) => ({
        ...tally,
        // From the rows just counted, so a day never shows a release in a
        // state other than the one its counts hold it in.
        releases: firstIds.flatMap(id => byId.get(id) ?? []),
      })
    );
  }

  /**
   * A listing as one where clause and one order: its tab's, or the plain
   * scheduled order, narrowed by the filters. `null` when it can match
   * nothing.
   *
   * The ONE place a listing's conditions are put together, for the page, its
   * total and the count alike.
   */
  private listingFor(
    query: ReleasePageQuery
  ): { where: ReleasesWhere; orderBy: ReleaseTabOrder[] } | null {
    const extra = this.filterConditions(query);
    if (extra === null) return null;
    const tab = this.tabQueryFor(query);
    return { where: { and: [...tab.where, ...extra] }, orderBy: tab.orderBy };
  }

  /** The tab's own query, or the plain scheduled order with no conditions. */
  private tabQueryFor(query: ReleasePageQuery): ReleaseTabQuery {
    if (query.tab === undefined) return scheduleOrderQuery(query.order);
    if (query.now === undefined) {
      // A tab without a moment cannot say which scheduled releases are
      // overdue. Refused rather than defaulted to the clock, so the one place
      // that decides "now" for a request stays the caller.
      throw NextlyError.internal({
        logContext: { reason: "release-tab-without-now", tab: query.tab },
      });
    }
    return releaseTabQuery(query.tab, query.now, query.order, query.reason);
  }

  /**
   * The filters as conditions, or `null` when they can match nothing.
   *
   * `null` rather than a condition that is always false, because an explicitly
   * EMPTY id list means "none of them" — answering it with every release would
   * be the widest possible wrong answer — and `IN ()` is a syntax error on every
   * dialect this supports.
   */
  private filterConditions(
    filters: ReleaseListFilters
  ): (ReleasesWhereCondition | ReleasesWhere)[] | null {
    const conditions: (ReleasesWhereCondition | ReleasesWhere)[] = [];
    if (filters.ids !== undefined) {
      if (filters.ids.length === 0) return null;
      conditions.push({
        column: "id",
        op: "IN",
        value: [...new Set(filters.ids)],
      });
    }
    if (filters.state !== undefined) {
      conditions.push({ column: "state", op: "=", value: filters.state });
    }
    if (filters.kind !== undefined) {
      conditions.push({ column: "kind", op: "=", value: filters.kind });
    }
    conditions.push(...scheduleWindowConditions(filters));
    if (filters.search !== undefined && filters.search.length > 0) {
      // In the WHERE clause, before the count and the page, so the total and
      // every page cover all matching releases. A search applied to a page
      // after reading it finds only what that page happened to hold.
      conditions.push({
        or: [
          releaseSearchCondition("title", filters.search),
          releaseSearchCondition("description", filters.search),
        ],
      });
    }
    return conditions;
  }

  /** One page of a listing's rows, in its order. */
  private selectPage(
    listing: { where: ReleasesWhere; orderBy: ReleaseTabOrder[] },
    page: { offset?: number; limit?: number }
  ): Promise<ReleaseRow[]> {
    return this.db.select<ReleaseRow>(RELEASES, {
      where: listing.where,
      orderBy: listing.orderBy,
      ...(page.offset !== undefined && page.offset > 0
        ? { offset: page.offset }
        : {}),
      ...(page.limit !== undefined ? { limit: page.limit } : {}),
    });
  }

  /**
   * Every scheduled release whose instant has arrived, and no other.
   *
   * Asked of the database, on the `(state, scheduled_at)` index the table
   * carries for exactly this question, so a site with a year of launches
   * planned reads only the ones due rather than every scheduled release.
   * The due boundary is `releaseDueCondition`, the one `resolveReleaseEffect`
   * evaluates too; which member wins is still that function's alone.
   */
  async findDueReleases(now: Date): Promise<ReleaseRow[]> {
    return this.db.select<ReleaseRow>(RELEASES, {
      where: {
        and: [
          { column: "state", op: "=", value: "scheduled" },
          releaseDueCondition(now),
        ],
      },
    });
  }

  /**
   * Move a materialised COMPONENT of releases to `published`, all or none,
   * and say which THIS caller moved: every release given, or none.
   *
   * Fenced on `state = "scheduled"`, and the answer matters. The runner that
   * delivers materialisation is at-least-once by contract, so two passes can
   * apply the same release; the member writes are idempotent and survive that,
   * but the transition is not something to report twice. The fence also refuses
   * a release CANCELLED between the drain reading it and this write — without
   * it, calling a release off during its own materialisation would still mark
   * it published.
   *
   * And fenced on each release's `revision` and `scheduledAt` as the pass
   * planned against them. State alone admits a release POSTPONED, renamed or
   * otherwise moved after the plan was loaded: it is still `scheduled`, so a
   * pass whose actions were applied, or already marked applied, for the old
   * release would mark it published and lose the change. Any move since the
   * plan raised the revision, so it matches nothing.
   *
   * WHOLE OR NOT AT ALL, for the reason `blockReleases` gives: settling the
   * later release of a component while an earlier one, moved since the plan,
   * stays scheduled leaves the earlier one the winner on their shared
   * documents, and the next pass would republish what the component took down.
   *
   * Through `advanceRevision`, so publishing bumps each revision as every
   * other move of a release does.
   */
  async markReleasesPublished(
    entries: readonly { id: string; revision: number; scheduledAt: Date }[],
    at: Date
  ): Promise<readonly string[]> {
    const moved = await this.moveComponentWhole(entries, entry => ({
      set: {
        state: "published" satisfies ReleaseState,
        publishedAt: at,
        updatedAt: at,
      },
      where: [
        { column: "revision", op: "=", value: entry.revision },
        { column: "scheduledAt", op: "=", value: entry.scheduledAt },
      ],
    }));
    return moved.map(entry => entry.id);
  }

  /**
   * Whether this member's own write marked it applied for `revision`.
   *
   * Asked after each content write, resolved or rejected, because the
   * promise cannot say: a write commits before its `afterUpdate` hooks run, so
   * one whose hook threw rejects having landed, and one whose hook rewrote the
   * status resolves having applied nothing. The mark is set in the write's own
   * transaction only when the write stored the action's status, so it answers
   * both without reading the document, which a read hook could rewrite.
   */
  async isMemberApplied(memberId: string, revision: number): Promise<boolean> {
    const [row] = await this.db.select<Pick<DrainMemberRow, "appliedRevision">>(
      MEMBERS,
      {
        columns: ["appliedRevision"],
        where: { and: [{ column: "id", op: "=", value: memberId }] },
      }
    );
    return row !== undefined && memberAppliedFor(row, revision);
  }

  /**
   * Whether this release is still scheduled FOR THE SAME INSTANT the plan was
   * built against.
   *
   * Asked immediately before each content write, because cancelling is the one
   * thing a person does to a release BETWEEN a drain reading it and the drain
   * acting on it, and the fence on `markReleasesPublished` comes too late — it
   * stops the row being marked published and cannot un-publish the documents.
   *
   * This narrows the window to a single action rather than closing it: a cancel
   * landing during the write itself is still lost. Closing it entirely would
   * need a claim into a distinct in-progress state, which this schema's
   * `draft | scheduled | published | cancelled` cannot express, and which would
   * trade this race for a worse one — a crash mid-pass would strand the release
   * in a state no later drain picks up.
   */
  async isStillDueAt(id: string, scheduledAt: Date): Promise<boolean> {
    const rows = await this.db.select<{
      state: ReleaseState;
      scheduledAt: Date | null;
    }>(RELEASES, {
      columns: ["state", "scheduledAt"],
      where: { and: [{ column: "id", op: "=", value: id }] },
    });
    const row = rows[0];
    if (row === undefined || row.state !== "scheduled") return false;

    // The INSTANT too, not only the state. Postponing a due release leaves it
    // `scheduled`, so a state-only check sees nothing wrong and the stale plan
    // publishes at the moment somebody just moved it away from.
    //
    // Compared in whole seconds: SQLite stores epoch seconds, so a millisecond
    // comparison would hold on two dialects and fail on the third for a
    // difference that is not real.
    if (row.scheduledAt === null) return false;
    return (
      Math.floor(row.scheduledAt.getTime() / 1000) ===
      Math.floor(scheduledAt.getTime() / 1000)
    );
  }

  /**
   * Every member of one release, in the order they were added.
   *
   * Ordered, not left to the database: without an ORDER BY each engine may
   * return rows in whatever order its plan reads them, which happens to be
   * insertion order on a small table and stops being so without notice. The
   * id breaks ties on the creation time, and is time-ordered for that reason
   * (`addMember`).
   *
   * Members added before ids were time-ordered carry random ids, so two of
   * them sharing a creation instant — one second, on SQLite — keep a stable
   * but arbitrary order between themselves. Their creation times still order
   * them against every other member.
   */
  async listMembers(releaseId: string): Promise<ReleaseMemberRow[]> {
    return this.db.select<ReleaseMemberRow>(MEMBERS, {
      columns: [...MEMBER_COLUMNS],
      where: { and: [{ column: "releaseId", op: "=", value: releaseId }] },
      orderBy: [
        { column: "createdAt", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
    });
  }

  /**
   * Members of many releases in ONE query.
   *
   * The materialisation pass loads every due release's members before it writes
   * anything, and asking per release put N serial round trips in front of the
   * first content mutation — worst exactly when N is large, which is when a
   * deployment or an imported schedule leaves many releases due together.
   *
   * The empty case returns without asking: `IN ()` is a syntax error on every
   * dialect this supports, and "no releases" is an ordinary state, not a
   * caller's mistake.
   */
  /**
   * How many members each of these releases holds, keyed by release id; a
   * release holding none is absent. One query that reads the release column
   * only, since the port has no grouped count, and none when there are no ids.
   */
  async memberCountsOf(
    releaseIds: readonly string[]
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (releaseIds.length === 0) return counts;
    const rows = await this.db.select<{ releaseId: string }>(MEMBERS, {
      columns: ["releaseId"],
      where: membersOf(releaseIds),
    });
    for (const row of rows) {
      counts.set(row.releaseId, (counts.get(row.releaseId) ?? 0) + 1);
    }
    return counts;
  }

  async listMembersOf(releaseIds: string[]): Promise<DrainMemberRow[]> {
    if (releaseIds.length === 0) return [];
    // The drain's read, and the one read that carries the applied mark.
    return this.db.select<DrainMemberRow>(MEMBERS, {
      columns: [...MEMBER_COLUMNS, "appliedRevision"],
      where: membersOf(releaseIds),
    });
  }

  /**
   * Put a document into a release, in one transaction with a bump of the
   * release's revision, and only while the release is in one of
   * `allowedStates`.
   *
   * The states are the CALLER'S judgement of what this change may land on —
   * the assembling states alone, or the committed ones too for a caller who
   * may publish — and the fence makes that judgement hold at the write: a
   * release scheduled after it was judged refuses the member rather than
   * gaining one nobody with the authority approved. The revision bump is what
   * a schedule judged before this add then misses on.
   *
   * @throws NextlyError CONFLICT when the release is not there or not in
   *   `allowedStates`; nothing is written then. A unique violation from the
   *   insert rolls the revision back with it and propagates as the driver
   *   reported it, for the caller to say which index refused.
   */
  async addMember(
    input: NewReleaseMember,
    allowedStates: readonly ReleaseState[],
    /**
     * Asked how many members the release holds, under the release-row lock
     * and inside the insert's transaction; an error it returns refuses the
     * add with nothing written. Under the lock, concurrent adds to one
     * release are judged one after another, so a limit holds however many
     * arrive at once.
     */
    refuseWhenHolding?: (held: number) => NextlyError | null
  ): Promise<ReleaseMemberRow> {
    // Tells a fence miss from a database failure, as in `blockReleases`: the
    // flag decides, not the shape of the error.
    let fenceMissed = false;
    // Held in an object so the refusal set inside the transaction keeps its
    // type once the transaction has thrown it.
    const limit: { refused: NextlyError | null } = { refused: null };
    let row: ReleaseMemberRow;
    try {
      row = await this.db.transaction(async tx => {
        const release = await this.advanceRevision(
          tx,
          input.releaseId,
          allowedStates
        );
        if (release === null) {
          fenceMissed = true;
          throw releaseMovedConflict(input.releaseId, "add-member");
        }
        if (refuseWhenHolding !== undefined) {
          const held = await tx.select<{ memberKey: string }>(MEMBERS, {
            columns: ["memberKey"],
            where: membersOf([input.releaseId]),
          });
          // The same document again is the duplicate it is, however full the
          // release: the unique index refuses it below, as it always has.
          const key = releaseMemberKey(input.releaseId, input);
          if (!held.some(member => member.memberKey === key)) {
            limit.refused = refuseWhenHolding(held.length);
            if (limit.refused !== null) throw limit.refused;
          }
        }
        const member: ReleaseMemberRow = {
          // Time-ordered, so members added within one second — one stored
          // instant on SQLite — still list in the order they were added, which
          // `listMembers` promises by breaking creation-time ties on the id.
          id: uuidV7(),
          releaseId: input.releaseId,
          scopeKind: input.scopeKind,
          scopeSlug: input.scopeSlug,
          entryId: input.entryId,
          locale: input.locale,
          action: input.action,
          memberKey: releaseMemberKey(input.releaseId, input),
          // From the release's stored kind, read under the same lock rather
          // than taken from the caller, so no path that adds a member can
          // leave a single release's member without its slot — and so
          // unprotected.
          singleSlot: release.kind === "single" ? 1 : null,
          createdBy: input.createdBy ?? null,
          createdAt: new Date(),
        };
        // Client-side id and no RETURNING, for the reason `createRelease`
        // gives.
        await tx.insert(MEMBERS, { ...member }, { returning: [] });
        return member;
      });
    } catch (error) {
      if (fenceMissed) {
        throw releaseMovedConflict(input.releaseId, "add-member");
      }
      if (limit.refused !== null) throw limit.refused;
      throw error;
    }
    // AFTER THE COMMIT, never inside it, for the reason `blockReleases` gives.
    // Membership can change AFTER a release is scheduled, and then this
    // document's cached pages are bounded by a schedule that did not include
    // it. Flushed here for the same reason scheduling flushes: a bound computed
    // at read time cannot reach into an entry that already exists.
    await this.revalidateMembersOf(input.releaseId);
    return row;
  }

  /**
   * Take a member out of its release, in one transaction with a bump of the
   * release's revision, and only while the release is in one of
   * `allowedStates`.
   *
   * Takes the member's release as well as its id, so the release is locked
   * before anything is read: every read in the transaction then sees what the
   * lock holder committed. A member never moves between releases, so the pair
   * the caller read is still the member's.
   *
   * A member already gone is not an error: the caller's intent is satisfied.
   * The revision still moves then, which at worst sends a schedule judged
   * before it round again.
   *
   * @throws NextlyError CONFLICT when the release is not there or not in
   *   `allowedStates`; nothing is deleted then.
   */
  async removeMember(
    member: Pick<ReleaseMemberRow, "id" | "releaseId">,
    allowedStates: readonly ReleaseState[]
  ): Promise<void> {
    let fenceMissed = false;
    let removed: ReleaseMemberRow | undefined;
    try {
      removed = await this.db.transaction(async tx => {
        if (
          (await this.advanceRevision(tx, member.releaseId, allowedStates)) ===
          null
        ) {
          fenceMissed = true;
          throw releaseMovedConflict(member.releaseId, "remove-member");
        }
        const where: VersionsWhere = {
          and: [
            { column: "id", op: "=", value: member.id },
            { column: "releaseId", op: "=", value: member.releaseId },
          ],
        };
        // The row is read BEFORE the delete: afterwards there is nothing left
        // to say which document's tags to flush, and the projection that
        // release was producing would stay cached with no write to clear it.
        const [row] = await tx.select<ReleaseMemberRow>(MEMBERS, {
          columns: [...MEMBER_COLUMNS],
          where,
        });
        if (row !== undefined) await tx.delete(MEMBERS, where);
        return row;
      });
    } catch (error) {
      if (fenceMissed) {
        throw releaseMovedConflict(member.releaseId, "remove-member");
      }
      throw error;
    }

    // After the commit, as for an add.
    await this.flushMembers(removed === undefined ? [] : [removed]);
  }

  /**
   * Switch a member between going live and coming down, in one transaction
   * with a bump of the release's revision, and only while the release is in
   * one of `allowedStates` — the fence an add and a removal take, for the same
   * reason: a release committed after the caller judged it refuses the switch.
   *
   * The member is read again under the release's lock, so the answer is the
   * row as stored rather than as the caller last saw it. When it already has
   * `action`, nothing is written and the stored row is the answer: a caller
   * that read the old action, while another switch committed, is told what
   * the member now holds, and is not told a switch it asked for happened when
   * the stored row says otherwise.
   *
   * The member's key does not change, since it names the document and not
   * what happens to it.
   *
   * @throws NextlyError CONFLICT when the release is not there or not in
   *   `allowedStates`, and NOT_FOUND when the member has gone since it was
   *   read; nothing is written then.
   */
  async changeMemberAction(
    member: Pick<ReleaseMemberRow, "id" | "releaseId">,
    action: ReleaseMemberAction,
    allowedStates: readonly ReleaseState[]
  ): Promise<ReleaseMemberRow> {
    const where: VersionsWhere = {
      and: [
        { column: "id", op: "=", value: member.id },
        { column: "releaseId", op: "=", value: member.releaseId },
      ],
    };
    let fenceMissed = false;
    let outcome: { row: ReleaseMemberRow; wrote: boolean } | undefined;
    try {
      outcome = await this.db.transaction(async tx => {
        await tx.lockRow(RELEASES, member.releaseId);
        const [stored] = await tx.select<ReleaseMemberRow>(MEMBERS, {
          columns: [...MEMBER_COLUMNS],
          where,
        });
        if (stored === undefined) return undefined;
        if (stored.action === action) return { row: stored, wrote: false };
        if (
          (await this.advanceRevision(tx, member.releaseId, allowedStates)) ===
          null
        ) {
          fenceMissed = true;
          throw releaseMovedConflict(member.releaseId, "change-member-action");
        }
        await tx.updateCount(MEMBERS, { action }, where);
        return { row: { ...stored, action }, wrote: true };
      });
    } catch (error) {
      if (fenceMissed) {
        throw releaseMovedConflict(member.releaseId, "change-member-action");
      }
      throw error;
    }
    if (outcome === undefined) {
      // Removed between the caller's read and this write.
      throw NextlyError.notFound({
        logContext: {
          reason: "release-member-not-found",
          memberId: member.id,
          releaseId: member.releaseId,
        },
      });
    }
    // After the commit: the document's cached pages were bounded by the
    // action it had. Nothing to drop when nothing was written.
    if (outcome.wrote) await this.flushMembers([outcome.row]);
    return outcome.row;
  }

  /**
   * Members of releases IN `states` for each of `refs`, in a CONSTANT number of
   * queries — two, and never one per document.
   *
   * `states` decides which releases count, and it defaults to the read path's
   * {@link RELEASE_STATES_AFFECTING_CONTENT} because that is the caller which
   * must never widen by accident: admitting a blocked release here would let a
   * release that has stopped go on deciding what a visitor sees. A surface that
   * wants more — a document's banner, which must keep reporting a release that
   * stopped — asks for it explicitly and says why at the call site.
   *
   * Never call this per row. A listing read resolves its whole result set here
   * and then asks `resolveReleaseEffect` per document, so the database cost
   * does not grow with the page size. Two rather than one because a member row
   * does not carry its release's state or time, and the port this repository
   * is built on has no join: the second query is over the releases those
   * members name, which is bounded by the number of releases, not documents.
   *
   * `now` is accepted but not used as a filter: every member of a scheduled
   * release is returned, and whether its time has come is decided by the pure
   * rule. Filtering here as well would put the same judgement in two places.
   */
  async findDueMembersFor(
    refs: DocumentRef[],
    _now: Date,
    states: readonly ReleaseState[] = RELEASE_STATES_AFFECTING_CONTENT
  ): Promise<Map<string, DueMember[]>> {
    const grouped = new Map<string, DueMember[]>();
    // No refs means no question to ask. Returning early keeps an empty listing
    // from issuing a query whose IN clause would be empty.
    if (refs.length === 0) return grouped;

    const scheduled = await this.db.select<
      ReleaseMemberRow & { scheduledAt: Date | null; state: ReleaseState }
    >(MEMBERS, {
      columns: [...MEMBER_COLUMNS],
      where: {
        and: [
          { column: "entryId", op: "IN", value: refs.map(r => r.entryId) },
          {
            column: "scopeSlug",
            op: "IN",
            value: [...new Set(refs.map(r => r.scopeSlug))],
          },
        ],
      },
    });

    // The release each member belongs to decides whether it counts, and the
    // member row does not carry that. Resolved from a second lookup only
    // when there are members at all, so the common case — nothing scheduled
    // anywhere — still costs the single query above.
    if (scheduled.length === 0) return grouped;
    const releases = await this.loadReleasesInStates(
      scheduled.map(m => m.releaseId),
      states
    );

    const wanted = new Set(refs.map(documentRefKey));
    for (const member of scheduled) {
      const release = releases.get(member.releaseId);
      if (release === undefined || release.scheduledAt === null) continue;
      const key = documentRefKey(member);
      if (!wanted.has(key)) continue;
      const list = grouped.get(key) ?? [];
      list.push({
        memberId: member.id,
        releaseId: member.releaseId,
        action: member.action,
        scheduledAt: release.scheduledAt,
        createdAt: member.createdAt,
      });
      grouped.set(key, list);
    }
    return grouped;
  }

  /**
   * The documents in one scope that a due release would PUBLISH.
   *
   * ## Why this exists at all, given `findDueMembersFor`
   *
   * That one decorates documents a read is already holding, which works in one
   * direction only. A read filters `status` in SQL, so a document stored as a
   * draft is excluded by the DATABASE before any decoration runs — and a
   * post-filter cannot add back a row the query never returned. Hiding a
   * published document works; revealing an unpublished one needs the filter
   * itself to know, which is what this answers.
   *
   * ## Why it resolves the effect rather than matching `action = "publish"`
   *
   * A document can belong to several releases — "publish on the 1st",
   * "unpublish on the 20th" is the ordinary case — so from the 20th two members
   * are due at once and the later must win. Matching the action column alone
   * would name a document whose takedown has already come due, the read filter
   * would admit its row, and the per-document decoration would then hide it
   * again. That disagreement surfaces as a listing whose count does not match
   * its contents.
   *
   * Running `resolveReleaseEffect` here means the filter and the decoration
   * reach their answer through the SAME pure rule, so they cannot disagree.
   */
  async findDueDecisions(input: {
    scopeKind: VersionScopeKind;
    scopeSlug: string;
    now: Date;
  }): Promise<ReleaseDecisions> {
    // DOCUMENT-WIDE members only. Per-locale lifecycle does not live on the row
    // this answer filters: a localized document is public "through its main row
    // OR through any one of its translations", and the mutation service keeps a
    // German unpublish from taking the document down for everyone by writing
    // the companion's `_status` and leaving the main row alone. A locale member
    // applied here would contradict that write path in both directions — hiding
    // the whole document for a one-language takedown, and admitting a main row
    // whose companion filter still excludes the newly published translation.
    //
    // So this seam answers only the question the main row can answer. Per-locale
    // release visibility belongs on companion selection and is not built yet;
    // it cannot regress anything today, because releases have no write surface
    // and no locale member can exist.
    const members = await this.db.select<ReleaseMemberRow>(MEMBERS, {
      columns: [...MEMBER_COLUMNS],
      where: {
        and: [
          { column: "scopeKind", op: "=", value: input.scopeKind },
          { column: "scopeSlug", op: "=", value: input.scopeSlug },
          { column: "locale", op: "IS NULL" },
        ],
      },
    });
    if (members.length === 0) return NO_DECISIONS;

    const releases = await this.loadReleasesInStates(
      members.map(m => m.releaseId),
      // The READ path, so the narrow list: a blocked release must not decide
      // what a visitor sees.
      RELEASE_STATES_AFFECTING_CONTENT
    );
    if (releases.size === 0) return NO_DECISIONS;

    const grouped = groupMembersByDocument(members, releases);

    // The WINNER is resolved over every member, then validated. The order
    // matters and the other way round is wrong.
    //
    // Materialisation runs each action as the winning member's `createdBy`, so
    // that "schedule this" cannot become a privilege escalation with a delay on
    // it — and it chooses that winner over ALL members, judging the author
    // afterwards. Removing candidates here before the winner rule would let this
    // seam pick a DIFFERENT member: an earlier publish by an active author beats
    // a later takedown by a deactivated one, while the write path still picks
    // the takedown, fails it, and performs nothing. The release stays scheduled,
    // so reads would project that older publish indefinitely against a document
    // the write path never touches.
    //
    // Validating the winner instead makes the two seams agree by construction:
    // whatever materialisation would attempt is what this projects, and when
    // that attempt cannot be authorised, this projects nothing.
    const decisions: {
      entryId: string;
      effect: string;
      memberId: string | null;
    }[] = [];
    for (const [entryId, due] of grouped) {
      const decision = resolveReleaseEffect({ members: due, now: input.now });
      if (decision.effect === null) continue;
      decisions.push({
        entryId,
        effect: decision.effect,
        memberId: decision.memberId,
      });
    }
    if (decisions.length === 0) return NO_DECISIONS;

    const authorOf = new Map(members.map(m => [m.id, m.createdBy]));
    const live = await this.liveAuthorIds(
      decisions
        .map(d =>
          d.memberId === null ? null : (authorOf.get(d.memberId) ?? null)
        )
        .filter((id): id is string => typeof id === "string" && id !== "")
    );

    const reveal: string[] = [];
    const hide: string[] = [];
    for (const decision of decisions) {
      const author =
        decision.memberId === null
          ? null
          : (authorOf.get(decision.memberId) ?? null);
      // No recorded author, or one who can no longer act. The materialiser
      // reaches the same verdict — there is nobody to act as, and the only
      // fallback is the privileged principal it refuses — so projecting this
      // would show an effect no write could perform.
      if (author === null || !live.has(author)) continue;
      // BOTH directions. Reading only the publish half made a scheduled
      // takedown a no-op: the decision said `unpublish`, the id was simply left
      // out of the reveal set, and the ordinary `status = published` filter went
      // on returning the row it was supposed to withdraw.
      if (decision.effect === "publish") reveal.push(decision.entryId);
      else if (decision.effect === "unpublish") hide.push(decision.entryId);
    }

    // Disjoint, and now actually so: ONE group per document means one winning
    // member, so an id reaches exactly one of these. An earlier version claimed
    // this while grouping per document-AND-locale, which made it false — a
    // document-wide publish and a later locale takedown put the same id in
    // both. Two things now prevent that, and only one of them is load-bearing:
    // the locale filter above means every member of a document groups together
    // regardless of the key, so grouping by entry is what states the intent
    // rather than what enforces it.
    return { reveal, hide };
  }

  /**
   * The earliest instant any SCHEDULED release takes effect, past or future,
   * or `null` when no release is scheduled at all.
   *
   * Drives the cheap check that keeps the release lookup off the common read
   * path. Deliberately NOT filtered to the future: a release whose time has
   * passed but which nothing has materialised yet is affecting reads right
   * now, and its instant is in the past — so a future-only answer would report
   * "nothing pending" for precisely the case the lookup exists to catch.
   *
   * A release leaves `scheduled` when it materialises or is cancelled, so this
   * returns `null` again once nothing is outstanding.
   */
  /**
   * Every scheduled instant, ascending.
   *
   * The whole list rather than the earliest, because two callers ask different
   * questions of it and the earliest answers only one. "Is anything due?" wants
   * an instant at or before now; "how long may this page be cached?" wants the
   * next instant strictly AFTER now — and those differ precisely when an
   * overdue release is still `scheduled`, which is exactly what a release held
   * open by a failed member looks like. Answering the second from the earliest
   * would report tag-only forever while a later release went unbounded.
   *
   * One query either way: it already read every row and discarded all but the
   * first.
   */
  async findScheduledTransitions(): Promise<Date[]> {
    const rows = await this.db.select<{ scheduledAt: Date | null }>(RELEASES, {
      columns: ["scheduledAt"],
      where: {
        and: [
          { column: "state", op: "=", value: "scheduled" },
          { column: "scheduledAt", op: "IS NOT NULL" },
        ],
      },
      orderBy: [{ column: "scheduledAt", direction: "asc" }],
    });
    const instants: Date[] = [];
    for (const row of rows) {
      if (row.scheduledAt !== null) instants.push(row.scheduledAt);
    }
    return instants;
  }

  /**
   * Of the given author ids, those whose user still exists and is still active.
   *
   * A second `IN` query rather than a join, matching {@link loadReleasesInStates}
   * below: the adapter layer is dialect-agnostic and expresses no joins,
   * and two small keyed reads are the shape this repository already pays on a
   * read that reaches here at all.
   *
   * A member with NO recorded author is dropped without asking anybody. That is
   * the same verdict the materialiser reaches — there is nobody to act as, and
   * the only fallback is the privileged principal it refuses — so admitting it
   * here would project an effect no write could ever perform.
   *
   * A failure PROPAGATES rather than resolving to "everyone is live". Answering
   * that on a failed lookup would reinstate exactly the projection this exists to
   * prevent, and it would do so precisely when the database is unhealthy. The
   * caller treating a throw as "no release is due" would be wrong in the other
   * direction, which is why the transition memo above propagates too.
   */
  private async liveAuthorIds(ids: string[]): Promise<ReadonlySet<string>> {
    const authorIds = [...new Set(ids)];
    if (authorIds.length === 0) return new Set();

    const rows = await this.db.select<{ id: string; isActive: boolean }>(
      USERS,
      {
        columns: ["id", "isActive"],
        where: {
          and: [
            { column: "id", op: "IN", value: authorIds },
            // Asked of the database rather than filtered in memory, so a dialect
            // storing this as 0/1 (SQLite) and one storing a real boolean answer
            // the same question. A truthiness check here would read `0` as false
            // on one dialect and the string "0" as TRUE on another.
            { column: "isActive", op: "=", value: true },
          ],
        },
      }
    );
    return new Set(rows.map(r => r.id));
  }

  /**
   * Of the given releases, those in `states`, keyed by id.
   *
   * The states are the CALLER'S, and there is no default. Two callers reach
   * here wanting different answers — a content read must see only what may
   * change a page, a document's banner must also see what stopped — and a
   * shared constant baked in here would silently decide for both. It did once:
   * this filtered `scheduled` alone, so the banner's wider list sat one layer
   * above a query that had already dropped every row it named, and the widening
   * could not fire. Requiring the argument makes that a compile error rather
   * than a screen that quietly says nothing.
   */
  private async loadReleasesInStates(
    ids: string[],
    states: readonly ReleaseState[]
  ): Promise<Map<string, { scheduledAt: Date | null }>> {
    const rows = await this.db.select<{
      id: string;
      state: ReleaseState;
      scheduledAt: Date | null;
    }>(RELEASES, {
      columns: ["id", "state", "scheduledAt"],
      where: {
        and: [
          { column: "id", op: "IN", value: [...new Set(ids)] },
          // `IN` even for a single state, so widening the list is a change to
          // the argument and never to the shape of the query.
          { column: "state", op: "IN", value: [...states] },
        ],
      },
    });
    return new Map(rows.map(row => [row.id, { scheduledAt: row.scheduledAt }]));
  }
}
