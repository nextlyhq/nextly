/**
 * Direct API `nextly.releases.*` — batching content to go live at one instant.
 *
 * The releases engine has been complete since #1323 and reachable only from
 * inside the server process: no namespace, no HTTP surface, and no product
 * caller of `addMember`. Nothing could create a release, which is why every
 * remaining correctness gap in the feature was unreachable — and why the three
 * seeded permissions were enforced nowhere.
 *
 * This is the reach. Thin on purpose, in the shape of `namespaces/jobs`: the
 * repository owns the writes and `ReleasesService` owns the authorization, and a
 * facade that re-derived either would be a second answer to a question already
 * answered.
 *
 * ## What `overrideAccess` means here
 *
 * The Direct API is a trusted in-process caller and defaults to
 * `overrideAccess: true`, exactly as the rest of this package does. A caller
 * that wants the permission checks — a route handler acting for a person — passes
 * `overrideAccess: false` with the acting `userId`. Trusted and anonymous are
 * separate fields rather than one inferred from the other, because folding them
 * together is how an unauthenticated request acquires system authority.
 *
 * @module direct-api/namespaces/releases
 */

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { container } from "../../di/container";
import { toPaginationMeta } from "../../dispatcher/helpers/service-envelope";
import type { ReleaseCalendar } from "../../domains/releases/release-calendar";
import type {
  ReleaseMemberCounts,
  ReleaseMemberRow,
  ReleaseRow,
} from "../../domains/releases/releases-repository";
import type {
  AddedReleaseMember,
  AddMemberInput,
  FindReleasesQuery,
  ReleaseBlocker,
  ReleaseBlockersView,
  ReleaseCalendarQuery,
  ReleaseCountQuery,
  ReleaseDetailsChange,
  ReleaseMembersView,
  ReleaseReadinessEntry,
  ReleaseReadinessView,
  ReleasesService,
  ReleaseWithAddedMembers,
  ScheduleDocumentInput,
} from "../../domains/releases/services/releases-service";
import { NextlyError } from "../../errors/nextly-error";
import type {
  ReleaseCapabilities,
  ReleaseKind,
  ReleaseMemberAction,
} from "../../schemas/releases/types";
import type { ListResult } from "../types/shared";

import type { NextlyContext } from "./context";
import { accessOptions, mergeConfig } from "./helpers";

/**
 * Who the call acts as, and whether its permissions are checked.
 *
 * Both fields fall back to the INSTANCE configuration, not to a constant. An
 * instance built with `getNextly({ overrideAccess: false, user })` is asking for
 * every operation on it to be checked, and a namespace that defaulted to `true`
 * on its own would bypass that silently — the one failure where a caller has
 * asked for enforcement and been given none.
 *
 * `user` is read from the same `DirectAPIConfig.user` every other namespace
 * uses, so an instance configured once acts consistently across all of them.
 */
export interface ReleaseCallerArgs {
  /**
   * The acting identity. Required whenever `overrideAccess` is `false`, because
   * a checked call with nobody to check is a call that can only be refused.
   */
  userId?: string | null;
  /** Defaults to the instance's setting, which itself defaults to `true`. */
  overrideAccess?: boolean;
  /**
   * The scoped API key's own grants, when the TRANSPORT already resolved them.
   *
   * A REST request authenticates before this layer and holds the key's stamped
   * permissions; the instance config does not. Supplied explicitly it wins,
   * because it is the scope of the request actually being served.
   */
  authenticatedScope?: AuthenticatedScope;
  /**
   * The caller's resolved roles, when the TRANSPORT already has them.
   *
   * Travels with `authenticatedScope` and for the same reason: code-defined
   * publish rules are evaluated against a role set, and an overridden identity
   * must bring its own rather than inherit the instance's.
   */
  userRoles?: string[];
  /**
   * The API key's own id, when the TRANSPORT authenticated the call as one.
   *
   * Travels with `authenticatedScope`: a release's history records a key's
   * change as the key, never as its owner, and the scope carries the key's
   * grants but not who it is.
   */
  apiKeyId?: string;
}

export interface ReleasesNamespace {
  /**
   * Make a release. `kind` is `release` (the default), or `single` for a
   * document scheduled on its own, which holds exactly one document; it is
   * fixed once the release exists. `kind` is `@experimental`.
   */
  create(
    args: {
      title: string;
      description?: string | null;
      kind?: ReleaseKind;
    } & ReleaseCallerArgs
  ): Promise<ReleaseRow>;
  /**
   * One page of releases, as `{ items, meta }` like every other Direct API
   * list, with `meta.total` counting every release that matches.
   *
   * Narrow it by `tab` (`upcoming`, `attention`, `drafts`, `done`), by `state`
   * and a window on the scheduled instant, by `kind` (`release` leaves out
   * single-document releases), by `search`, a case-insensitive
   * match on the title or description, and by `day`, a date in a named time
   * zone (`{ date: "2026-03-29", timezone: "Europe/Berlin" }`), for the
   * releases whose time falls on that day there. Page it with `page` (from 1) and
   * `limit` (50 by default, at most 200). The scheduled releases come soonest
   * first unless `order` says otherwise; other listings latest first.
   *
   * Filtering by `containing` returns one document's releases instead, SOONEST
   * first — the order they will be applied to it — and each row carries the
   * member's action, because a release can publish one document while taking
   * another down. Declared in the return type rather than left to the
   * runtime: a caller that cannot see `memberAction` cannot tell which way a
   * release moves the document it just asked about. Each row also carries
   * `memberId`, the membership `removeMember` takes the document out with.
   *
   * `tab`, `kind`, `search`, `day` and `page` are `@experimental`.
   */
  find(
    args?: FindReleasesQuery & ReleaseCallerArgs
  ): Promise<
    ListResult<
      ReleaseRow & { memberAction?: ReleaseMemberAction; memberId?: string }
    >
  >;
  /**
   * How many releases a listing holds, without reading them: the same tab,
   * state, window and search `find` takes, and the same answer as its
   * `meta.total`. What a page outside Releases asks, such as "how many need
   * attention?".
   *
   * @experimental
   */
  count(args?: ReleaseCountQuery & ReleaseCallerArgs): Promise<number>;
  /**
   * The releases in a window of days, `from` to `to` inclusive and at most six
   * weeks, grouped by the day their time falls on in `timezone`.
   *
   * Every day of the window comes back, in order, with `total` and `counts`
   * (by state) covering all of that day's releases and `releases` holding the
   * first three in time order; the rest of a day is `find({ day })`. Refused
   * for an unknown zone, a date that does not exist, a `to` before `from`, or
   * a window longer than 42 days.
   *
   * @experimental
   */
  calendar(
    args: ReleaseCalendarQuery & ReleaseCallerArgs
  ): Promise<ReleaseCalendar>;
  findByID(
    args: { id: string } & ReleaseCallerArgs
  ): Promise<ReleaseRow | null>;
  /**
   * What this caller may do to each of these releases.
   *
   * A separate call rather than a field on the rows above, because answering it
   * costs permission reads that most readers of a release do not need. Keyed by
   * release id.
   */
  capabilities(
    args: { releases: readonly ReleaseRow[] } & ReleaseCallerArgs
  ): Promise<Map<string, ReleaseCapabilities>>;
  /**
   * What stands between this release and its instant, per member.
   *
   * Derived from the members on every call rather than recorded when the drain
   * stopped, so it stops reporting a cause somebody has fixed. Names only the
   * documents the caller may read; {@link blockersOf} also counts the rest.
   */
  blockingReasons(
    args: { releaseId: string } & ReleaseCallerArgs
  ): Promise<ReleaseBlocker[]>;
  /**
   * {@link blockingReasons} with the blocked documents the caller may not
   * read counted by collection in `hidden`, so a release blocked only by
   * documents they cannot see still reads as blocked.
   *
   * @experimental
   */
  blockersOf(
    args: { releaseId: string } & ReleaseCallerArgs
  ): Promise<ReleaseBlockersView>;
  /**
   * Every problem the release's documents have now: `hard` ones, which stop
   * it from being scheduled or published now, and `soft` ones, which are
   * notes. Each is a code and the document it is about, in the order the
   * documents were added. Every document is checked, however many the release
   * holds. Findings name only documents the caller may read; the rest are
   * counted by collection in `hidden`, so the release is ready only when
   * `hard` is empty and no `hidden` entry has a hard problem. An unknown
   * release is refused as not found.
   *
   * @experimental
   */
  readiness(
    args: { releaseId: string } & ReleaseCallerArgs
  ): Promise<ReleaseReadinessView>;
  /**
   * {@link readiness} for up to fifty releases at once, in the order asked,
   * under the same authority. A release that does not exist is left out; one
   * holding more documents than a release may now hold comes back
   * `checked: false`, for the single read to check in full. More than fifty
   * ids are refused.
   *
   * @experimental
   */
  readinessOf(
    args: { releaseIds: readonly string[] } & ReleaseCallerArgs
  ): Promise<ReleaseReadinessEntry[]>;
  /**
   * How many documents each of these releases holds, and how many it puts
   * live and takes down, keyed by release id. Every id asked about is
   * answered, with zeros for a release holding none.
   *
   * @experimental
   */
  memberCounts(
    args: { releaseIds: readonly string[] } & ReleaseCallerArgs
  ): Promise<Record<string, ReleaseMemberCounts>>;
  /**
   * Put a document into a release under a lifecycle action.
   *
   * An AUTHOR is required, and it may come from either place: `userId` on the
   * call, or the `user` an instance was configured with. The drain performs
   * each member as its recorded author, so a member with none returns
   * `NO_RECORDED_AUTHOR` on every pass and the release can never publish — even
   * on a trusted call, which is the one case where "trusted" does not mean
   * "as anybody".
   *
   * Not narrowed to a required `userId` in the type, deliberately: that would
   * refuse the legitimate flow where an instance built with a `user` supplies
   * the author for every call on it. The refusal is at runtime because only
   * runtime knows whether either source produced one, and its message names the
   * field to pass.
   *
   * Answers the member with `unpublishedLinks`: for a document going live, the
   * documents it links to that will not be live at the release's moment, so
   * they can be offered too. Only documents the caller may read are named; the
   * rest are counted in `hiddenCount`.
   *
   * @experimental The `unpublishedLinks` field.
   */
  addMember(
    args: { releaseId: string } & AddMemberInput & ReleaseCallerArgs
  ): Promise<AddedReleaseMember>;
  /**
   * Put several documents into a release in one step, each with its action
   * (`publish` to go live, `unpublish` to come down): all of them, or none.
   *
   * Each document is checked as {@link addMember} checks one, and the first
   * refusal refuses the step with nothing written: a document the caller may
   * not act on or read, one in a collection with no lifecycle, a document
   * named twice, more than the release has room for (the refusal says how
   * many fit), or, for a scheduled release, a document with a hard problem,
   * named in `data.problems`. Use it for the linked documents an add
   * offered, too. Answers the release as the step left it and the new
   * members in the order given, each with its `unpublishedLinks`.
   *
   * @experimental
   */
  addMembers(
    args: {
      releaseId: string;
      members: readonly AddMemberInput[];
    } & ReleaseCallerArgs
  ): Promise<ReleaseWithAddedMembers>;
  /**
   * Schedule a document in one step, with the linked documents accepted
   * with it (`linked`, each going live). `into` says how it goes out:
   *
   * - `"own"`: on its own at `at` in `timezone`, in a single-document
   *   release named `title`; with linked documents, an ordinary release
   *   holding all of them. Needs `publish` authority on releases as well.
   * - `"existing"`: with the ordinary draft or scheduled release `releaseId`.
   * - `"new"`: in a new draft release named `title`.
   *
   * All of it lands or none of it does: a refusal, or a failure of any
   * write, leaves no release, no document and no schedule behind.
   *
   * @experimental
   */
  scheduleDocument(
    args: ScheduleDocumentInput & ReleaseCallerArgs
  ): Promise<ReleaseWithAddedMembers>;
  /**
   * Take a document back out of a release.
   *
   * Out of a single-document release that has not run (draft, scheduled or
   * stopped), it cancels that release instead, under the cancel authority
   * (`publish`), and the release is kept as cancelled. This is
   * `@experimental`.
   *
   * `releaseId` is optional but SHOULD be supplied by any caller that knows it —
   * a transport addressing `/releases/A/members/B` knows which release it meant,
   * and passing it turns a stale or crafted member id into a refusal instead of
   * a silent edit to a different release.
   */
  removeMember(
    args: { memberId: string; releaseId?: string } & ReleaseCallerArgs
  ): Promise<void>;
  /**
   * The release's documents the caller may read, in the order they were
   * added. A caller acting for a user is given only the documents that user
   * may read; {@link membersOf} also counts the rest.
   */
  listMembers(
    args: { releaseId: string } & ReleaseCallerArgs
  ): Promise<ReleaseMemberRow[]>;
  /**
   * The release's documents as the caller sees them: those they may read in
   * `items`, and the rest counted by collection in `hidden`, with no title,
   * id or field.
   *
   * @experimental
   */
  membersOf(
    args: { releaseId: string } & ReleaseCallerArgs
  ): Promise<ReleaseMembersView>;
  /**
   * Switch a document in a release between going live (`publish`) and coming
   * down (`unpublish`).
   *
   * Asks what adding the document under the new action asks, and `publish`
   * authority on releases for a scheduled one. In a scheduled release the new
   * action is checked as the document's author, who the release still acts as;
   * a switch that would leave a hard problem is refused as a `CONFLICT` naming
   * the problems in `data.problems`, and the release is left as it was.
   *
   * @experimental
   */
  changeMemberAction(
    args: {
      releaseId: string;
      memberId: string;
      action: ReleaseMemberAction;
    } & ReleaseCallerArgs
  ): Promise<ReleaseMemberRow>;
  /**
   * Commit a release to an instant.
   *
   * `timezone` is the authoring intent and travels beside the instant rather
   * than being folded into it: "9am Berlin time" survives a daylight-saving
   * boundary as a statement, where a UTC instant alone does not, and the admin
   * needs it to render what the author actually chose.
   */
  schedule(
    args: { id: string; at: Date; timezone: string } & ReleaseCallerArgs
  ): Promise<void>;
  cancel(args: { id: string } & ReleaseCallerArgs): Promise<void>;
  /**
   * Run a draft or scheduled release now, with the same checks and the same
   * all-together run as at its scheduled time, and answer the release as it
   * then stands: `published`, or still `scheduled` if some of it is left for
   * the runner to finish. Refused for a stopped release (fix it and schedule it
   * again) and for a published or cancelled one, which never runs again.
   *
   * @experimental
   */
  publishNow(args: { id: string } & ReleaseCallerArgs): Promise<ReleaseRow>;
  /**
   * Rename a release, change its description (`null` clears it), or both,
   * and answer the release as it now reads. Needs `update-content-releases`
   * on a checked call, and works in any state.
   *
   * @experimental
   */
  update(
    args: { id: string } & ReleaseDetailsChange & ReleaseCallerArgs
  ): Promise<ReleaseRow>;
  /**
   * Delete a release that never ran, with its documents: a draft, or a
   * release cancelled before it was ever scheduled. Needs
   * `delete-content-releases` on a checked call. Any other release is
   * refused with CONFLICT, the reason in the error's data: scheduled or
   * stopped (`committed`), published (`published`), or cancelled after being
   * scheduled (`was-scheduled`). A release that is not there is NOT_FOUND.
   * Answers the release as it was when deleted.
   *
   * @experimental
   */
  delete(args: { id: string } & ReleaseCallerArgs): Promise<ReleaseRow>;
}

/**
 * The service, resolved from the container rather than constructed here.
 *
 * The registration owns a single instance. Building one per call would work, but
 * it would also be a second place deciding what a service is built from, and the
 * first divergence between them would be silent.
 */
function service(): ReleasesService {
  if (!container.has("releasesService")) {
    // The public message stays the uniform internal-error sentence; the reason
    // an operator needs goes to the log, which is where this package puts
    // diagnostics rather than in a body a client reads.
    throw NextlyError.internal({
      logContext: { reason: "releases-service-unregistered" },
    });
  }
  return container.get<ReleasesService>("releasesService");
}

/**
 * Split the caller identity out of an argument bag, over the instance defaults.
 *
 * Per-call config wins over the instance default, matching `mergeConfig` and
 * every other namespace, so one call can act as someone without reconfiguring
 * the instance — and an instance that asked for enforcement keeps it when the
 * call says nothing.
 */
function actorOf(ctx: NextlyContext, args: ReleaseCallerArgs) {
  // Absent keys are DROPPED before merging, not passed as `undefined`.
  // `mergeConfig` is a spread and a present-but-undefined key wins it, so
  // forwarding `{ overrideAccess: undefined }` from a call that said nothing
  // would erase an instance's configured `false` and silently restore trust.
  // The same trap the jobs content API documents, arriving from the other side.
  const supplied: Record<string, unknown> = {};
  if (args.overrideAccess !== undefined) {
    supplied.overrideAccess = args.overrideAccess;
  }

  // Read through `accessOptions` rather than off the merged config directly.
  // The access fields travel together, and `access-options-seam.test.ts` fails
  // the build for a namespace that picks at them inline — because an operation
  // forwarding one and not another compiles, runs, and authorizes wrongly.
  const access = accessOptions(
    mergeConfig(ctx.defaultConfig, supplied as never)
  );

  // An explicit identity REPLACES the instance's, and the credentials that
  // belong to it go with it. Keeping the instance's key scope while swapping the
  // user leaves a call made as somebody else — or as nobody — still authorized
  // by a key that was never theirs: `find({ userId: null })` passes the scope
  // check before the anonymous guard is ever reached.
  const overridesIdentity = "userId" in args;

  return {
    // `"userId" in args` rather than `??`, because an explicit `null` MEANS
    // anonymous and must survive. A route that turns an absent session into
    // `userId: null` would otherwise be handed the instance's configured user
    // and receive that person's release permissions — the caller asked to be
    // refused and would be authorized instead. Omitted and present-but-null are
    // different questions.
    userId: overridesIdentity
      ? (args.userId ?? null)
      : (access.user?.id ?? null),
    overrideAccess: access.overrideAccess ?? true,
    // A scope supplied WITH the call belongs to that call and always wins: a
    // REST request resolved it for the identity it is serving. An inherited one
    // travels only while the identity does.
    authenticatedScope:
      args.authenticatedScope ??
      (overridesIdentity ? undefined : access.authenticatedScope),
    // Roles describe the instance's user, so they follow the same rule — a rule
    // evaluated against someone else's roles is worse than one evaluated
    // against none.
    userRoles:
      args.userRoles ?? (overridesIdentity ? undefined : access.user?.roles),
    // Only with the scope supplied by this call: it names the key that scope
    // belongs to, and an inherited scope arrives without one.
    apiKeyId: args.authenticatedScope === undefined ? undefined : args.apiKeyId,
  };
}

export function createReleasesNamespace(ctx: NextlyContext): ReleasesNamespace {
  // Every operation hands `actorOf` the ORIGINAL argument bag, never a
  // reconstructed one. Destructuring `{ userId }` out of a call that omitted it
  // creates the key with value `undefined`, and `"userId" in args` is then true
  // — so a rebuilt object turns "omitted" into "explicitly nobody" and loses the
  // instance identity. The same present-but-undefined trap the merge below
  // guards against, one layer up.
  return {
    create: args =>
      service().create(
        { title: args.title, description: args.description, kind: args.kind },
        actorOf(ctx, args)
      ),

    find: async (args = {}) => {
      // Caller keys are stripped from the QUERY as well as read for the actor.
      // Leaving them in sends `authenticatedScope` to the repository as a filter
      // column, which is a query nobody wrote and a credential in a place it
      // does not belong.
      const {
        userId,
        overrideAccess,
        authenticatedScope,
        userRoles,
        apiKeyId,
        ...query
      } = args;
      void userId;
      void overrideAccess;
      void authenticatedScope;
      void userRoles;
      void apiKeyId;
      const found = await service().find(query, actorOf(ctx, args));
      return {
        items: found.rows,
        meta: toPaginationMeta({
          total: found.total,
          page: found.page,
          limit: found.limit,
          totalPages: Math.ceil(found.total / found.limit),
        }),
      };
    },

    count: (args = {}) => {
      // Stripped for the reason `find` gives: caller keys are not filters.
      const {
        userId,
        overrideAccess,
        authenticatedScope,
        userRoles,
        apiKeyId,
        ...query
      } = args;
      void userId;
      void overrideAccess;
      void authenticatedScope;
      void userRoles;
      void apiKeyId;
      return service().count(query, actorOf(ctx, args));
    },

    calendar: args =>
      // The window's own fields, named, so no caller key reaches the query.
      service().calendar(
        {
          from: args.from,
          to: args.to,
          timezone: args.timezone,
          kind: args.kind,
        },
        actorOf(ctx, args)
      ),

    findByID: args => service().findByID(args.id, actorOf(ctx, args)),

    // Kept OFF `find` and `findByID` deliberately. Answering it costs permission
    // reads, and most readers of a release — a scheduled-content query, a
    // revalidation pass — never render a control and would pay for an answer
    // they discard. Payload draws the same line: it computes document
    // permissions for the edit view, not for every read.
    capabilities: args =>
      service().capabilities(args.releases, actorOf(ctx, args)),

    blockingReasons: args =>
      service().blockingReasons(args.releaseId, actorOf(ctx, args)),

    blockersOf: args =>
      service().blockersOf(args.releaseId, actorOf(ctx, args)),

    addMember: args => {
      const {
        releaseId,
        userId,
        overrideAccess,
        authenticatedScope,
        userRoles,
        apiKeyId,
        ...member
      } = args;
      void userId;
      void overrideAccess;
      void authenticatedScope;
      void userRoles;
      void apiKeyId;
      return service().addMember(releaseId, member, actorOf(ctx, args));
    },

    addMembers: args =>
      // The members named, not a spread: the caller keys are not members.
      service().addMembers(args.releaseId, args.members, actorOf(ctx, args)),

    scheduleDocument: args => {
      const {
        userId,
        overrideAccess,
        authenticatedScope,
        userRoles,
        apiKeyId,
        ...input
      } = args;
      void userId;
      void overrideAccess;
      void authenticatedScope;
      void userRoles;
      void apiKeyId;
      // Stripped for the reason `find` gives: caller keys are not input.
      return service().scheduleDocument(input, actorOf(ctx, args));
    },

    removeMember: args =>
      // `releaseId` FORWARDED, not folded into the caller bag. It was declared
      // on the interface and dropped here — a parameter the type advertised and
      // the implementation ignored, so the mismatch guard it enables never ran.
      service().removeMember(args.memberId, actorOf(ctx, args), args.releaseId),

    listMembers: args =>
      service().listMembers(args.releaseId, actorOf(ctx, args)),

    membersOf: args => service().membersOf(args.releaseId, actorOf(ctx, args)),

    readiness: args => service().readiness(args.releaseId, actorOf(ctx, args)),

    readinessOf: args =>
      service().readinessOf(args.releaseIds, actorOf(ctx, args)),

    memberCounts: args =>
      service().memberCounts(args.releaseIds, actorOf(ctx, args)),

    changeMemberAction: args =>
      service().changeMemberAction(
        args.memberId,
        args.action,
        actorOf(ctx, args),
        args.releaseId
      ),

    schedule: args =>
      service().schedule(args.id, args.at, args.timezone, actorOf(ctx, args)),

    cancel: args => service().cancel(args.id, actorOf(ctx, args)),

    publishNow: args => service().publishNow(args.id, actorOf(ctx, args)),

    update: args => {
      // Only the two fields, named rather than spread: a spread of the rest
      // would hand the service the caller keys as part of the change.
      const change: ReleaseDetailsChange = {};
      if ("title" in args) change.title = args.title;
      if ("description" in args) change.description = args.description;
      return service().update(args.id, change, actorOf(ctx, args));
    },

    delete: args => service().delete(args.id, actorOf(ctx, args)),
  };
}
