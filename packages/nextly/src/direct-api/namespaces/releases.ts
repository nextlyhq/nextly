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
import type {
  ReleaseMemberRow,
  ReleaseRow,
} from "../../domains/releases/releases-repository";
import type {
  AddMemberInput,
  FindReleasesQuery,
  ReleasesService,
} from "../../domains/releases/services/releases-service";
import { NextlyError } from "../../errors/nextly-error";

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
}

export interface ReleasesNamespace {
  create(
    args: { title: string; description?: string | null } & ReleaseCallerArgs
  ): Promise<ReleaseRow>;
  /** Releases in a window, newest scheduled instant first. */
  find(args?: FindReleasesQuery & ReleaseCallerArgs): Promise<ReleaseRow[]>;
  findByID(
    args: { id: string } & ReleaseCallerArgs
  ): Promise<ReleaseRow | null>;
  /** Put a document into a release under a lifecycle action. */
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
   */
  addMember(
    args: { releaseId: string } & AddMemberInput & ReleaseCallerArgs
  ): Promise<ReleaseMemberRow>;
  /**
   * Take a document back out of a release.
   *
   * `releaseId` is optional but SHOULD be supplied by any caller that knows it —
   * a transport addressing `/releases/A/members/B` knows which release it meant,
   * and passing it turns a stale or crafted member id into a refusal instead of
   * a silent edit to a different release.
   */
  removeMember(
    args: { memberId: string; releaseId?: string } & ReleaseCallerArgs
  ): Promise<void>;
  listMembers(
    args: { releaseId: string } & ReleaseCallerArgs
  ): Promise<ReleaseMemberRow[]>;
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
        { title: args.title, description: args.description },
        actorOf(ctx, args)
      ),

    find: (args = {}) => {
      // Caller keys are stripped from the QUERY as well as read for the actor.
      // Leaving them in sends `authenticatedScope` to the repository as a filter
      // column, which is a query nobody wrote and a credential in a place it
      // does not belong.
      const {
        userId,
        overrideAccess,
        authenticatedScope,
        userRoles,
        ...query
      } = args;
      void userId;
      void overrideAccess;
      void authenticatedScope;
      void userRoles;
      return service().find(query, actorOf(ctx, args));
    },

    findByID: args => service().findByID(args.id, actorOf(ctx, args)),

    addMember: args => {
      const {
        releaseId,
        userId,
        overrideAccess,
        authenticatedScope,
        userRoles,
        ...member
      } = args;
      void userId;
      void overrideAccess;
      void authenticatedScope;
      void userRoles;
      return service().addMember(releaseId, member, actorOf(ctx, args));
    },

    removeMember: args =>
      // `releaseId` FORWARDED, not folded into the caller bag. It was declared
      // on the interface and dropped here — a parameter the type advertised and
      // the implementation ignored, so the mismatch guard it enables never ran.
      service().removeMember(args.memberId, actorOf(ctx, args), args.releaseId),

    listMembers: args =>
      service().listMembers(args.releaseId, actorOf(ctx, args)),

    schedule: args =>
      service().schedule(args.id, args.at, args.timezone, actorOf(ctx, args)),

    cancel: args => service().cancel(args.id, actorOf(ctx, args)),
  };
}
