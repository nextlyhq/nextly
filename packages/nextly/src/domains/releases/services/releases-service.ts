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

import { NextlyError } from "../../../errors";
import type { ReleaseMemberAction } from "../../../schemas/releases/types";
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
  canActOnDocument: (
    userId: string,
    scopeSlug: string,
    action: ReleaseMemberAction
  ) => Promise<boolean>;
}

export interface FindReleasesQuery {
  /** Restrict to one lifecycle state. */
  state?: string;
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
   * How many rows at most.
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

/** What a member add asks for, minus the release it joins. */
export interface AddMemberInput extends DocumentRef {
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

  async find(
    query: FindReleasesQuery,
    actor: ReleaseActor
  ): Promise<ReleaseRow[]> {
    await this.authorize(actor, "read");
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
    return this.deps.repository.addMember({
      ...input,
      releaseId,
      createdBy: actor.userId,
    });
  }

  async removeMember(memberId: string, actor: ReleaseActor): Promise<void> {
    // `create`, not `publish`: taking a document out of a release un-does part
    // of assembling it, and it can only ever make less content go live.
    await this.authorize(actor, "create");
    await this.deps.repository.removeMember(memberId);
  }

  async schedule(
    id: string,
    at: Date,
    timezone: string,
    actor: ReleaseActor
  ): Promise<void> {
    await this.authorize(actor, "publish");
    await this.deps.repository.scheduleRelease(id, at, timezone);
  }

  async cancel(id: string, actor: ReleaseActor): Promise<void> {
    // Cancelling needs the same authority as scheduling, and the seed says so
    // outright: `publish-content-releases` is "schedule or cancel". Someone who
    // could cancel but not schedule could still silently stop a launch.
    await this.authorize(actor, "publish");
    await this.deps.repository.cancelRelease(id);
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
    if (await this.deps.canActOnDocument(actor.userId, scopeSlug, action)) {
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
