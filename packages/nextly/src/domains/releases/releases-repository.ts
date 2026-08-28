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
import type {
  ReleaseMemberAction,
  ReleaseState,
} from "../../schemas/releases/types";
import type { VersionScopeKind } from "../../schemas/versions/types";
import type { VersionsDbApi } from "../versions/db-api";

import { releaseMemberKey } from "./release-member-key";
import { NO_DECISIONS } from "./release-scope";
import type { ReleaseDecisions } from "./release-scope";
import type { DueMember } from "./resolve-release-effect";
import { resolveReleaseEffect } from "./resolve-release-effect";

/**
 * The database surface this repository needs.
 *
 * Aliased rather than restated: it is the same narrow port — insert, select,
 * update, delete — and a second declaration of the same shape would drift from
 * this one silently, which is the divergence this codebase has a rule about.
 */
export type ReleasesDbApi = VersionsDbApi;

const RELEASES = "nextly_releases";
const MEMBERS = "nextly_release_members";

/** The document a member points at. */
export interface DocumentRef {
  scopeKind: VersionScopeKind;
  scopeSlug: string;
  entryId: string;
  /** `null` is the unlocalized document. */
  locale: string | null;
}

export interface ReleaseRow {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: Date | null;
  timezone: string | null;
  state: ReleaseState;
  publishedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  revision: number;
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
  createdBy: string | null;
  createdAt: Date;
}

export interface NewRelease {
  title: string;
  description?: string | null;
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
export function documentRefKey(ref: DocumentRef): string {
  return [ref.scopeKind, ref.scopeSlug, ref.entryId, ref.locale ?? ""]
    .map(encodeURIComponent)
    .join(":");
}

export class ReleasesRepository {
  constructor(private readonly db: ReleasesDbApi) {}

  async createRelease(input: NewRelease): Promise<ReleaseRow> {
    const now = new Date();
    const row: ReleaseRow = {
      id: crypto.randomUUID(),
      title: input.title,
      description: input.description ?? null,
      scheduledAt: null,
      timezone: null,
      // A new release is always assembled before it is scheduled, so it
      // starts in the one state the read rule never consults.
      state: "draft",
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

  /** Move a release to `scheduled`, which is what makes reads consult it. */
  async scheduleRelease(id: string, at: Date, timezone: string): Promise<void> {
    await this.db.update(
      RELEASES,
      {
        scheduledAt: at,
        timezone,
        state: "scheduled" satisfies ReleaseState,
        updatedAt: new Date(),
      },
      { and: [{ column: "id", op: "=", value: id }] }
    );
  }

  /**
   * Call a release off.
   *
   * Nothing is undone and nothing is written to any document: the read rule
   * consults only `scheduled` releases, so a cancelled one simply stops being
   * consulted. That is what makes cancelling a due-but-unmaterialised release
   * free, and it is why there is no restore path here.
   */
  async cancelRelease(id: string): Promise<void> {
    await this.db.update(
      RELEASES,
      {
        state: "cancelled" satisfies ReleaseState,
        updatedAt: new Date(),
      },
      { and: [{ column: "id", op: "=", value: id }] }
    );
  }

  async addMember(input: NewReleaseMember): Promise<ReleaseMemberRow> {
    const row: ReleaseMemberRow = {
      id: crypto.randomUUID(),
      releaseId: input.releaseId,
      scopeKind: input.scopeKind,
      scopeSlug: input.scopeSlug,
      entryId: input.entryId,
      locale: input.locale,
      action: input.action,
      memberKey: releaseMemberKey(input.releaseId, input),
      createdBy: input.createdBy ?? null,
      createdAt: new Date(),
    };
    // Client-side id and no RETURNING, for the reason `createRelease` gives.
    await this.db.insert(MEMBERS, { ...row }, { returning: [] });
    return row;
  }

  async removeMember(memberId: string): Promise<void> {
    await this.db.delete(MEMBERS, {
      and: [{ column: "id", op: "=", value: memberId }],
    });
  }

  /**
   * Members of SCHEDULED releases for each of `refs`, in a CONSTANT number of
   * queries — two, and never one per document.
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
    _now: Date
  ): Promise<Map<string, DueMember[]>> {
    const grouped = new Map<string, DueMember[]>();
    // No refs means no question to ask. Returning early keeps an empty listing
    // from issuing a query whose IN clause would be empty.
    if (refs.length === 0) return grouped;

    const scheduled = await this.db.select<
      ReleaseMemberRow & { scheduledAt: Date | null; state: ReleaseState }
    >(MEMBERS, {
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
    const releases = await this.loadScheduledReleases(
      scheduled.map(m => m.releaseId)
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
      where: {
        and: [
          { column: "scopeKind", op: "=", value: input.scopeKind },
          { column: "scopeSlug", op: "=", value: input.scopeSlug },
          { column: "locale", op: "IS NULL" },
        ],
      },
    });
    if (members.length === 0) return NO_DECISIONS;

    const releases = await this.loadScheduledReleases(
      members.map(m => m.releaseId)
    );
    if (releases.size === 0) return NO_DECISIONS;

    const grouped = new Map<string, DueMember[]>();
    for (const member of members) {
      const release = releases.get(member.releaseId);
      if (release === undefined || release.scheduledAt === null) continue;
      // Grouped by ENTRY, which is the whole document. Grouping by a key that
      // also carried the locale produced two groups for one document, each
      // resolving its own winner — so an older document-wide publish and a
      // newer takedown could put the SAME id in both sets, and the two read
      // paths then disagreed about it.
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

    const reveal: string[] = [];
    const hide: string[] = [];
    for (const [entryId, due] of grouped) {
      const decision = resolveReleaseEffect({ members: due, now: input.now });
      // BOTH directions. Reading only the publish half made a scheduled
      // takedown a no-op: the decision said `unpublish`, the id was simply left
      // out of the reveal set, and the ordinary `status = published` filter went
      // on returning the row it was supposed to withdraw.
      if (decision.effect === "publish") reveal.push(entryId);
      else if (decision.effect === "unpublish") hide.push(entryId);
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
  async findEarliestScheduledTransition(): Promise<Date | null> {
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
    for (const row of rows) {
      if (row.scheduledAt !== null) return row.scheduledAt;
    }
    return null;
  }

  private async loadScheduledReleases(
    ids: string[]
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
          { column: "state", op: "=", value: "scheduled" },
        ],
      },
    });
    return new Map(rows.map(row => [row.id, { scheduledAt: row.scheduledAt }]));
  }
}
