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
import type { DueMember } from "./resolve-release-effect";

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
