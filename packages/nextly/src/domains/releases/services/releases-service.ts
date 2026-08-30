/**
 * The authorization boundary for content releases.
 *
 * The releases engine — repository, materialisation, the periodic drain — was
 * complete and reachable only from inside the server process. Its three
 * permissions were seeded and enforced NOWHERE, because there was no service in
 * which to enforce them. This is that service, and it is the layer that makes
 * the feature safe to expose.
 *
 * ## Three authorities, not a CRUD set
 *
 * `permission-seed-service` states the split and this honours it rather than
 * restating it: assembling a release changes nothing a reader can see, while
 * scheduling it is the act that puts content live later.
 *
 *     read     → view releases and their members
 *     create   → create a release and choose what goes in it
 *     publish  → schedule or cancel, which is what makes content go live
 *
 * `update` and `delete` are deliberately NOT seeded, and so are deliberately
 * absent here. Renaming is filed under `create` because it is part of assembling
 * a release; destroying one is a different power and waits for its own
 * permission to arrive with the surface that checks it. Inventing either here
 * would teach the admin a vocabulary the server ignores.
 *
 * ## Why adding a member asks TWO questions
 *
 * Holding `create-content-releases` says you may assemble a release. It does not
 * say you may publish the document you are putting into one — and a release is a
 * deferred publish, so allowing that would be a privilege escalation with a delay
 * on it.
 *
 * Materialisation is already safe without this check: `createJobContentApi`
 * forces `overrideAccess: false`, binds the member's own author, and strips a
 * caller-supplied override, so a member whose author may not publish simply
 * fails when the release fires. This check exists because failing THEN is a bad
 * product: the editor learns at the scheduled instant, with nobody watching,
 * that their release did not go out. Refusing at add time is the same verdict
 * delivered while it can still be acted on.
 *
 * The check can still go stale — access revoked between adding and firing — which
 * is exactly why the materialisation-time authorization is not removed. Two
 * checks, because they answer the question at two different instants.
 *
 * @module domains/releases/services/releases-service
 */

import {
  apiKeyScopeAllows,
  type AuthenticatedScope,
} from "../../../auth/authenticated-scope";
import { NextlyError } from "../../../errors";
import {
  RELEASE_ASSEMBLABLE_FROM,
  RELEASE_ASSEMBLABLE_WITH_PUBLISH_FROM,
  RELEASE_CANCELLABLE_FROM,
  RELEASE_SCHEDULABLE_FROM,
  isReleaseMemberAction,
  type ReleaseMemberAction,
  type ReleaseState,
} from "../../../schemas/releases/types";
import { isUniqueViolation } from "../../../shared/lib/unique-violation";
import { documentRefKey } from "../releases-repository";
import type {
  DocumentRef,
  NewRelease,
  ReleaseMemberRow,
  ReleaseRow,
  ReleasesRepository,
} from "../releases-repository";

/** The system-resource authorities a release operation can require. */
export type ReleaseAuthority = "read" | "create" | "publish";

/** The system resource the three permissions are seeded under. */
export const RELEASES_RESOURCE = "content-releases";

/**
 * The longest title every supported dialect can store.
 *
 * MySQL holds it in `varchar(255)`; PostgreSQL and SQLite use unbounded `text`.
 * Stated once and enforced above the database so the narrowest engine defines
 * the contract, rather than the contract depending on which engine is running.
 */
export const MAX_RELEASE_TITLE_LENGTH = 255;

/**
 * The longest timezone every supported dialect can store.
 *
 * `nextly_releases.timezone` is `varchar(64)` on MySQL and unbounded `text` on
 * PostgreSQL and SQLite. Comfortably above every IANA zone name — the longest in
 * the database is around 32 characters — so the limit refuses nonsense rather
 * than constraining a real caller.
 */
export const MAX_RELEASE_TIMEZONE_LENGTH = 64;

/**
 * Who is asking, and whether to ask at all.
 *
 * `overrideAccess` matches every other service in this package: the Direct API
 * is a trusted in-process caller and the HTTP layer is not. It is a separate
 * field from `userId` rather than inferred from its absence — an anonymous
 * caller and a trusted one are different things, and folding them together is
 * how an unauthenticated request acquires system authority.
 */
export interface ReleaseActor {
  userId: string | null;
  overrideAccess?: boolean;
  /**
   * The scoped API key's OWN grants, when the caller is one.
   *
   * Authoritative in BOTH directions and checked before the owner's database
   * permissions: a key without the grant is denied however privileged its owner,
   * and a key with it is allowed however unprivileged. Resolving release
   * authority from the owner instead is how a key scoped to read content ends
   * up able to schedule a publish.
   */
  authenticatedScope?: AuthenticatedScope;
  /**
   * The caller's role set, forwarded so code-defined access rules evaluate
   * against the real user rather than against an empty list.
   */
  userRoles?: string[];
}

/**
 * What a caller may do to one release, as the server sees it.
 *
 * Sent WITH the release rather than derived by the reader. Payload computes the
 * same thing per document for its edit view, and Sanity gates each release
 * action by its own permission id so scheduling can be granted without
 * publishing — in both, the answer depends on authority the client does not
 * hold, so a client that computed it would be guessing.
 */
export interface ReleaseCapabilities {
  /** Set or move this release's instant. */
  schedule: boolean;
  /** Call it off — which is also how an unwanted draft is abandoned. */
  cancel: boolean;
  /** Put a document in it. Necessary, not sufficient: see `capabilities`. */
  addMember: boolean;
  /** Take a document out of it. Necessary, not sufficient. */
  removeMember: boolean;
}

export interface ReleasesServiceDeps {
  repository: ReleasesRepository;
  /**
   * Whether this user holds one of the three release authorities.
   *
   * Injected rather than imported so the boundary is testable without a database
   * and without a permission store — the cases worth exercising exhaustively are
   * the refusals, and a test that needs RBAC seeded to assert one tends not to
   * be written.
   */
  canManageReleases: (
    userId: string,
    authority: ReleaseAuthority
  ) => Promise<boolean>;
  /**
   * Whether this user may perform this lifecycle action on this scope.
   *
   * The same question the ordinary write path asks (`publish-<slug>` /
   * `unpublish-<slug>`), asked here at add time. Injected for the same reason.
   */
  canActOnDocument: (params: {
    userId: string;
    scopeSlug: string;
    action: ReleaseMemberAction;
    /**
     * The scoped API key's own grants, when the caller is one.
     *
     * Passed through rather than resolved here. The document verdict is the
     * permission slug AND the code-defined access rule, and only the wiring
     * holds both — checking the slug alone in the domain would be a partial
     * answer that reads like a complete one.
     */
    authenticatedScope?: AuthenticatedScope;
    userRoles?: string[];
  }) => Promise<boolean>;
}

export interface FindReleasesQuery {
  /**
   * Restrict to one lifecycle state.
   *
   * Typed as the exhaustive union rather than `string`: a typo like
   * `"schedule"` would otherwise be accepted and answered with an empty list and
   * no diagnostic, which reads exactly like "nothing is scheduled".
   */
  state?: ReleaseState;
  /**
   * Window on the scheduled instant, both bounds optional and independent.
   *
   * A caller supplies the window rather than receiving a fixed one: an index
   * page wants a page of everything, while a dashboard widget wants "the next
   * seven days". Fixing it here forces the second caller to grow its own query.
   */
  scheduledAfter?: Date;
  scheduledBefore?: Date;
  /**
   * Only releases that CONTAIN this document.
   *
   * The inverse of `listMembers`, and the question a document editor asks: what
   * is going to happen to the thing I am looking at. Expressed as a filter on
   * the release list rather than a route of its own, because that is what it is
   * — the same resource, narrowed — and because a literal path segment under
   * `/api/releases` would be read as a release id.
   *
   * Answers about SCHEDULED releases only. A draft membership changes nothing on
   * its own, and the question this serves is whether the document will change
   * without anyone touching it again.
   */
  containing?: DocumentRef;
  /**
   * How many rows at most. Must be a non-negative integer when given.
   *
   * There is no `offset`: the select port this reads through exposes `where`,
   * `orderBy` and `limit` and nothing else, so offset paging would mean widening
   * it for a caller that does not exist yet. The index page brings its own
   * paging question when it is built, and keyset paging over `scheduledAt` is
   * the shape that will suit it — an offset would drift under a list whose rows
   * move as releases publish.
   */
  limit?: number;
}

/**
 * The document scopes a release can actually materialise.
 *
 * `VersionScopeKind` also admits `"page"`, and this input deliberately does NOT.
 * `release-mutations` routes every non-single scope through the collection API,
 * so a page member either fails every drain and holds the release scheduled
 * forever, or targets an unrelated collection that happens to share the slug.
 * Narrowing the public input is how a scope that cannot be performed stops being
 * expressible.
 */
export type ReleaseScopeKind = "collection" | "single";

/** What a member add asks for, minus the release it joins. */
export interface AddMemberInput extends Omit<DocumentRef, "scopeKind"> {
  scopeKind: ReleaseScopeKind;
  action: ReleaseMemberAction;
}

export class ReleasesService {
  constructor(private readonly deps: ReleasesServiceDeps) {}

  /**
   * Refuse unless the caller holds `authority` on `content-releases`.
   *
   * Called BEFORE every write, never after. A write that authorizes afterwards
   * has already happened, and no refusal can un-happen it — which is the one
   * ordering a partial-failure path cannot repair.
   */
  private async authorize(
    actor: ReleaseActor,
    authority: ReleaseAuthority
  ): Promise<void> {
    if (actor.overrideAccess === true) return;

    // The KEY's stamped scope wins over the owner's grants, in both directions.
    // `null` means the caller is not a scoped key, so the ordinary resolution
    // below applies.
    const byKey = apiKeyScopeAllows(
      actor.authenticatedScope,
      authority,
      RELEASES_RESOURCE
    );
    if (byKey === true) return;
    if (byKey === false) {
      throw NextlyError.forbidden({
        logContext: {
          reason: "api-key-scope-lacks-release-authority",
          authority,
          resource: RELEASES_RESOURCE,
        },
      });
    }

    // An anonymous caller holds no permissions, and asking the store about a
    // null user would be a lookup whose only possible answer is "no".
    if (actor.userId === null) {
      throw NextlyError.forbidden({
        logContext: {
          reason: "anonymous",
          authority,
          resource: RELEASES_RESOURCE,
        },
      });
    }
    if (await this.deps.canManageReleases(actor.userId, authority)) return;
    // Assembling or scheduling a release IMPLIES being able to read one.
    //
    // The three grants are seeded independently, and without this a role given
    // only `create` can create a release through the API and then see nothing —
    // not the list, not the release it just made, not the picker that would put
    // a document in it. That is a grant promising something the product cannot
    // deliver, and an administrator has no way to discover the second grant is
    // needed. Implication rather than a seeder change, because it has to hold
    // for roles that already exist.
    //
    // One direction only: reading does not imply writing.
    if (
      authority === "read" &&
      (await this.holdsEither(actor.userId, ["create", "publish"]))
    ) {
      return;
    }
    // The public message is FIXED by `forbidden`, and deliberately so: a
    // response that named the missing permission would tell an unauthorized
    // caller the shape of the authority model. The detail an operator needs goes
    // to the log instead. The admin surface does not depend on reading it back —
    // it knows the caller's capabilities already, and the better product is to
    // not offer an action the person cannot take rather than to explain the
    // refusal afterwards.
    throw NextlyError.forbidden({
      logContext: {
        reason: "missing-release-authority",
        authority,
        resource: RELEASES_RESOURCE,
        userId: actor.userId,
      },
    });
  }

  async create(
    input: Omit<NewRelease, "createdBy">,
    actor: ReleaseActor
  ): Promise<ReleaseRow> {
    await this.authorize(actor, "create");
    // ONE limit, applied before the write, because the column is not one shape:
    // `nextly_releases.title` is `varchar(255)` on MySQL and unbounded `text` on
    // PostgreSQL and SQLite. Left to the database, the same call succeeds on two
    // engines and either errors or silently TRUNCATES on the third — and a
    // truncating write returns a row that disagrees with what is stored.
    if (input.title.length > MAX_RELEASE_TITLE_LENGTH) {
      throw NextlyError.invalidInput({
        message: `\`title\` must be ${MAX_RELEASE_TITLE_LENGTH} characters or fewer.`,
        logContext: { reason: "title-too-long", length: input.title.length },
      });
    }
    // `createdBy` comes from the ACTOR, never from the input. Materialisation
    // performs each member as its recorded author, so an author a caller could
    // name would be an identity they could borrow at a future instant.
    return this.deps.repository.createRelease({
      ...input,
      createdBy: actor.userId,
    });
  }

  async findByID(id: string, actor: ReleaseActor): Promise<ReleaseRow | null> {
    await this.authorize(actor, "read");
    const releases = await this.deps.repository.findReleases({ ids: [id] });
    return releases[0] ?? null;
  }

  /**
   * What this caller may do to each of these releases, right now.
   *
   * Computed HERE because it is the only place both halves are known. Whether a
   * move is possible depends on the release's state, which the client has, AND
   * on the caller's authority, which it does not — a scoped API key is judged by
   * its own grants, and the refusal a client would otherwise discover is one
   * fixed sentence that cannot say which half failed. A client that reasoned
   * about this locally would need the transition rules and the grant model, and
   * would be a second implementation of both.
   *
   * Asked once per AUTHORITY rather than once per release. `holds` consults the
   * permission store, so a per-row loop would turn a page of fifty releases into
   * a hundred permission reads; the state is then combined in memory, which is
   * free.
   *
   * `addMember` and `removeMember` are NECESSARY, not sufficient: putting a
   * particular document into a release also needs that document's own
   * publish/unpublish authority, which depends on which document it is and is
   * therefore checked at the write. A client uses these to decide what to OFFER;
   * the write is still the boundary.
   */
  async capabilities(
    releases: readonly ReleaseRow[],
    actor: ReleaseActor
  ): Promise<Map<string, ReleaseCapabilities>> {
    await this.authorize(actor, "read");
    if (releases.length === 0) return new Map();

    const mayPublish = await this.holds(actor, "publish");
    const mayCreate = await this.holds(actor, "create");

    return new Map(
      releases.map(release => {
        // Membership is editable freely in some states and only by a publisher
        // in others, because the drain reads membership AT the instant — so
        // editing a scheduled release changes what a publisher committed to.
        const editable =
          (mayCreate && RELEASE_ASSEMBLABLE_FROM.includes(release.state)) ||
          (mayCreate &&
            mayPublish &&
            RELEASE_ASSEMBLABLE_WITH_PUBLISH_FROM.includes(release.state));

        return [
          release.id,
          {
            schedule:
              mayPublish && RELEASE_SCHEDULABLE_FROM.includes(release.state),
            cancel:
              mayPublish && RELEASE_CANCELLABLE_FROM.includes(release.state),
            addMember: editable,
            removeMember: editable,
          },
        ];
      })
    );
  }

  /**
   * The scheduled releases holding this document, soonest first.
   *
   * Reuses `findDueMembersFor`, which returns every member of a scheduled
   * release and leaves the dueness judgement to the pure rule — so the same
   * query serves the read path's "what is live now" and this surface's "what is
   * still coming", without a second implementation of either.
   *
   * The member's ACTION travels with each release, because it is the thing an
   * editor needs and it belongs to the membership rather than to the release: a
   * release can publish one document while unpublishing another.
   *
   * Ordered by instant ascending — the order the changes will actually happen —
   * so a document in several releases reads as a sequence. The final state is
   * then the last row, which is what `resolveReleaseEffect` will conclude, and
   * saying it that way avoids a second implementation of that ordering.
   */
  private async findContaining(
    ref: DocumentRef,
    now: Date
  ): Promise<Array<ReleaseRow & { memberAction: ReleaseMemberAction }>> {
    const grouped = await this.deps.repository.findDueMembersFor([ref], now);
    const members = grouped.get(documentRefKey(ref)) ?? [];
    if (members.length === 0) return [];

    const releases = await this.deps.repository.findReleases({
      ids: [...new Set(members.map(member => member.releaseId))],
    });
    const byId = new Map(releases.map(release => [release.id, release]));

    return members
      .flatMap(member => {
        const release = byId.get(member.releaseId);
        // A member whose release vanished between the two reads is dropped
        // rather than rendered without its instant: a row saying a document is
        // scheduled, without saying when, is worse than not mentioning it.
        return release === undefined
          ? []
          : [{ ...release, memberAction: member.action }];
      })
      .sort(
        (a, b) =>
          (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0)
      );
  }

  async find(
    query: FindReleasesQuery,
    actor: ReleaseActor
  ): Promise<ReleaseRow[]> {
    await this.authorize(actor, "read");
    // A negative limit is not a smaller page — on SQLite `LIMIT -1` means NO
    // limit, so a query documented as returning "at most" N would return every
    // release and turn a bounded dashboard read into a full table scan.
    if (
      query.limit !== undefined &&
      (!Number.isInteger(query.limit) || query.limit < 0)
    ) {
      throw NextlyError.invalidInput({
        message: "`limit` must be a non-negative integer.",
        logContext: { reason: "invalid-limit", limit: query.limit },
      });
    }
    if (query.containing !== undefined) {
      return this.findContaining(query.containing, new Date());
    }
    return this.deps.repository.findReleases(query);
  }

  async listMembers(
    releaseId: string,
    actor: ReleaseActor
  ): Promise<ReleaseMemberRow[]> {
    await this.authorize(actor, "read");
    return this.deps.repository.listMembers(releaseId);
  }

  /**
   * Put a document into a release, under a lifecycle action.
   *
   * Two authorities, for the reason in the module docblock: `create` to assemble
   * the release, and the document's own `publish`/`unpublish` so that scheduling
   * cannot become a way to perform a write the caller could not perform now.
   */
  async addMember(
    releaseId: string,
    input: AddMemberInput,
    actor: ReleaseActor
  ): Promise<ReleaseMemberRow> {
    await this.authorize(actor, "create");
    await this.authorizeDocumentAction(actor, input.scopeSlug, input.action);
    requireRunnableMember(input, actor);

    // Claimed ATOMICALLY, and the author checked, before anything is written.
    await this.claimAssemblable(releaseId, actor);
    await this.requireLiveAuthor(actor.userId);

    try {
      const member = await this.deps.repository.addMember({
        ...input,
        releaseId,
        // Never a caller-supplied author. Materialisation performs each member
        // as its recorded author, so an author a caller could name would be an
        // identity they could borrow at a future instant.
        createdBy: actor.userId,
      });

      // The window the claim above cannot cover on its own: a publisher may
      // schedule the release between the claim and this insert, and the drain
      // reads membership at the instant, so the member would join a committed
      // launch. Re-checked after the write and COMPENSATED, because a member
      // that should not be there is removable while a publish that already
      // happened is not.
      //
      // Skipped for a caller who holds `publish`: for them, adding to a
      // scheduled release is allowed, so there is nothing to undo.
      if (!(await this.holds(actor, "publish"))) {
        if (!(await this.deps.repository.touchIfAssemblable(releaseId))) {
          await this.deps.repository.removeMember(member.id);
          throw NextlyError.conflict({
            logContext: {
              reason: "release-scheduled-during-add",
              releaseId,
              memberId: member.id,
            },
          });
        }
      }
      return member;
    } catch (error) {
      // The `memberKey` unique index is what stops one document being scheduled
      // twice in one release. Translated here so callers meet this package's
      // stable error contract rather than the adapter's DatabaseError — and
      // narrowly, so an unexpected database failure still propagates.
      if (isUniqueViolation(error)) {
        throw NextlyError.duplicate({
          logContext: {
            reason: "member-already-in-release",
            releaseId,
            scopeSlug: input.scopeSlug,
            entryId: input.entryId,
          },
        });
      }
      throw error;
    }
  }

  async removeMember(
    memberId: string,
    actor: ReleaseActor,
    /** The release the caller believes this member belongs to, when it knows. */
    expectedReleaseId?: string
  ): Promise<void> {
    await this.authorize(actor, "create");

    // An earlier version of this method reasoned that removing a member "can
    // only ever make less content go live" and needed no publish authority.
    // That is FALSE for an `unpublish` member: removing one cancels a committed
    // takedown and leaves content live. So a create-only caller could undo a
    // publisher's decision in the direction that keeps content up, which is the
    // direction that matters.
    const member = await this.deps.repository.findMember(memberId);
    // Already gone. Idempotent rather than a 404: the caller's intent is
    // satisfied, and answering not-found for a member somebody else removed
    // makes a retry look like a failure.
    if (member === undefined) return;

    // A member id that belongs to a DIFFERENT release than the caller named is
    // refused, not followed. Nothing joins the two in the path, so a stale
    // client URL would otherwise edit a release the caller never addressed and
    // be told it worked.
    if (
      expectedReleaseId !== undefined &&
      member.releaseId !== expectedReleaseId
    ) {
      throw NextlyError.notFound({
        logContext: {
          reason: "member-belongs-to-another-release",
          memberId,
          expectedReleaseId,
          actualReleaseId: member.releaseId,
        },
      });
    }

    await this.claimAssemblable(member.releaseId, actor);
    await this.deps.repository.removeMember(memberId);

    // The same window the member ADD closes, and it matters more here: removing
    // an `unpublish` member cancels a committed takedown, so a publisher
    // scheduling between the claim and the delete would have their decision
    // undone by a caller who never passed the publish gate.
    //
    // Compensated by restoring the ORIGINAL row — same id, same author, same
    // timestamp — so the undo is invisible to anything holding that id.
    if (!(await this.holds(actor, "publish"))) {
      if (!(await this.deps.repository.touchIfAssemblable(member.releaseId))) {
        await this.deps.repository.restoreMember(member);
        throw NextlyError.conflict({
          logContext: {
            reason: "release-scheduled-during-remove",
            releaseId: member.releaseId,
            memberId,
          },
        });
      }
    }
  }

  /**
   * Take the release as assemblable, or require the authority to change a
   * committed one.
   *
   * The claim is a single conditional statement, so it cannot be overtaken
   * between deciding and acting the way a read-then-write can. Only when it
   * fails is the row read, and only to say WHY: a release that does not exist,
   * one that will never run again, or one a publisher has already committed.
   */
  private async claimAssemblable(
    releaseId: string,
    actor: ReleaseActor
  ): Promise<void> {
    if (await this.deps.repository.touchIfAssemblable(releaseId)) return;

    const [parent] = await this.deps.repository.findReleases({
      ids: [releaseId],
    });
    // No dialect declares a foreign key from a member to its release, so a
    // mistyped id would otherwise insert a row no drain will ever find.
    if (parent === undefined) {
      throw NextlyError.notFound({
        logContext: { reason: "release-not-found", releaseId },
      });
    }
    if (RELEASE_ASSEMBLABLE_WITH_PUBLISH_FROM.includes(parent.state)) {
      // Changing what is in a scheduled release changes what goes live at an
      // instant a publisher committed to. The drain reads membership at the
      // instant, not at scheduling time.
      //
      // Read from the declaration rather than compared to a literal, so this
      // and the `can.addMember` the client renders from cannot come apart: a
      // state added to that list must authorize the same way here, or the UI
      // offers an edit the write refuses.
      await this.authorize(actor, "publish");
      return;
    }
    // Published or cancelled: never materialised again, so this is work that
    // cannot happen rather than work someone is not allowed to do.
    throw NextlyError.conflict({
      logContext: {
        reason: "release-not-mutable",
        releaseId,
        state: parent.state,
      },
    });
  }

  /** Whether this user holds ANY of these authorities. */
  private async holdsEither(
    userId: string,
    authorities: readonly ReleaseAuthority[]
  ): Promise<boolean> {
    for (const authority of authorities) {
      if (await this.deps.canManageReleases(userId, authority)) return true;
    }
    return false;
  }

  /** Whether the actor holds an authority, without throwing. */
  private async holds(
    actor: ReleaseActor,
    authority: ReleaseAuthority
  ): Promise<boolean> {
    if (actor.overrideAccess === true) return true;
    const byKey = apiKeyScopeAllows(
      actor.authenticatedScope,
      authority,
      RELEASES_RESOURCE
    );
    if (byKey !== null) return byKey;
    if (actor.userId === null) return false;
    return this.deps.canManageReleases(actor.userId, authority);
  }

  /**
   * Refuse an author the drain will not be able to act as.
   *
   * Non-null is not enough. A trusted call naming a deleted or deactivated user
   * persists that id, and `resolveActionAuthor` then returns
   * `AUTHOR_UNAVAILABLE` on every pass — the release stays scheduled forever and
   * the only symptom is content that never appeared.
   */
  private async requireLiveAuthor(userId: string | null): Promise<void> {
    if (userId === null) return;
    const live = await this.deps.repository.liveAuthors([userId]);
    if (live.has(userId)) return;
    throw NextlyError.invalidInput({
      message:
        "The author for this release member cannot act: the user is missing or deactivated.",
      logContext: { reason: "author-not-runnable", userId },
    });
  }

  async schedule(
    id: string,
    at: Date,
    timezone: string,
    actor: ReleaseActor
  ): Promise<void> {
    await this.authorize(actor, "publish");
    // An unusable instant is refused HERE rather than at the driver. A NaN date
    // reaches timestamp encoding and fails differently per dialect, so the
    // caller's mistake arrives as an opaque database error instead of the
    // sentence naming it.
    if (Number.isNaN(at.getTime())) {
      throw NextlyError.invalidInput({
        message: "`at` is not a valid instant.",
        logContext: { reason: "invalid-schedule-instant", releaseId: id },
      });
    }
    // Same reason the title has a limit: the narrowest dialect defines the
    // contract, or the call succeeds on two engines and truncates on the third.
    if (
      timezone.length === 0 ||
      timezone.length > MAX_RELEASE_TIMEZONE_LENGTH
    ) {
      throw NextlyError.invalidInput({
        message: `\`timezone\` must be between 1 and ${MAX_RELEASE_TIMEZONE_LENGTH} characters.`,
        logContext: { reason: "invalid-timezone", length: timezone.length },
      });
    }
    // The fence answers `false` for a release whose current state forbids the
    // move — a published one, most importantly, because re-scheduling it makes
    // the drain re-apply members against documents that have changed since.
    // Reported as a CONFLICT rather than swallowed: a caller told nothing would
    // read a no-op as a schedule that took.
    if (!(await this.deps.repository.scheduleRelease(id, at, timezone))) {
      throw NextlyError.conflict({
        logContext: { reason: "release-not-schedulable", releaseId: id },
      });
    }
  }

  async cancel(id: string, actor: ReleaseActor): Promise<void> {
    // Cancelling needs the same authority as scheduling, and the seed says so
    // outright: `publish-content-releases` is "schedule or cancel". Someone who
    // could cancel but not schedule could still silently stop a launch.
    await this.authorize(actor, "publish");
    if (!(await this.deps.repository.cancelRelease(id))) {
      throw NextlyError.conflict({
        logContext: { reason: "release-not-cancellable", releaseId: id },
      });
    }
  }

  private async authorizeDocumentAction(
    actor: ReleaseActor,
    scopeSlug: string,
    action: ReleaseMemberAction
  ): Promise<void> {
    if (actor.overrideAccess === true) return;
    if (actor.userId === null) {
      throw NextlyError.forbidden({
        logContext: { reason: "anonymous", action, scopeSlug },
      });
    }
    if (
      await this.deps.canActOnDocument({
        userId: actor.userId,
        scopeSlug,
        action,
        authenticatedScope: actor.authenticatedScope,
        userRoles: actor.userRoles,
      })
    ) {
      return;
    }
    // Logged as the DOCUMENT authority, not the release one. The two refusals
    // are indistinguishable in the response by design, so the log is the only
    // place that can tell an operator whether the caller was short of
    // `create-content-releases` or of `publish-<slug>` — and sending them to
    // grant the wrong one is the failure this field prevents.
    throw NextlyError.forbidden({
      logContext: {
        reason: "missing-document-authority",
        action,
        scopeSlug,
        userId: actor.userId,
      },
    });
  }
}

/**
 * Refuse a member the drain could never perform.
 *
 * Both refusals are `invalidInput` rather than `forbidden`: nothing is being
 * denied to this caller, the member simply cannot be materialised, and the
 * sentence naming why is the whole value of the error. They are stated HERE
 * rather than left to the drain because a member that fails at the scheduled
 * instant fails silently — the release stays `scheduled`, the failure is one
 * recorded outcome, and the editor finds out by noticing content that never
 * went live.
 */
function requireRunnableMember(
  input: AddMemberInput,
  actor: ReleaseActor
): void {
  // An authorless member is UNRUNNABLE, not merely unattributed.
  // `resolveActionAuthor` returns `NO_RECORDED_AUTHOR` for `createdBy: null`
  // and the pass refuses to fall back to a privileged principal — correctly, or
  // scheduling would become a way to act as the system. So a member added by a
  // trusted call that named nobody produces a release that can never publish,
  // and the default Direct API path is exactly that call.
  // An action outside the union is DANGEROUS, not merely invalid. The Drizzle
  // `$type` annotation is compile-time only, and the applier treats every effect
  // that is not exactly `"publish"` as an unpublish — so `"publsih"` from an
  // untyped caller WITHDRAWS the document at the scheduled instant.
  if (!isReleaseMemberAction(input.action)) {
    throw NextlyError.invalidInput({
      message: "`action` must be `publish` or `unpublish`.",
      logContext: { reason: "unknown-member-action", action: input.action },
    });
  }

  if (actor.userId === null) {
    throw NextlyError.invalidInput({
      message:
        "A release member needs an author: pass `userId` for the person this publish acts as.",
      logContext: {
        reason: "member-without-author",
        scopeSlug: input.scopeSlug,
      },
    });
  }

  // Per-locale release visibility is not built. `applyOne` refuses any member
  // carrying a locale and its comment names schedule time as where that refusal
  // belongs once a write surface exists — this is that surface, so this is that
  // refusal. Accepting one here would persist a member guaranteed to fail.
  if (input.locale !== null && input.locale !== undefined) {
    throw NextlyError.invalidInput({
      message:
        "Per-locale releases are not supported: omit `locale` to schedule the whole document.",
      logContext: {
        reason: "locale-scoped-member",
        scopeSlug: input.scopeSlug,
        locale: input.locale,
      },
    });
  }
}
