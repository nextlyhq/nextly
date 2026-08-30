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
  addMember(
    args: { releaseId: string } & AddMemberInput & ReleaseCallerArgs
  ): Promise<ReleaseMemberRow>;
  removeMember(args: { memberId: string } & ReleaseCallerArgs): Promise<void>;
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

  return {
    // An explicit `userId` wins; otherwise the instance's configured `user` is
    // the acting identity, which is how the rest of the Direct API reads it.
    userId: args.userId ?? access.user?.id ?? null,
    overrideAccess: access.overrideAccess ?? true,
  };
}

export function createReleasesNamespace(ctx: NextlyContext): ReleasesNamespace {
  return {
    create: ({ title, description, ...caller }) =>
      service().create({ title, description }, actorOf(ctx, caller)),

    find: (args = {}) => {
      const { userId, overrideAccess, ...query } = args;
      return service().find(query, actorOf(ctx, { userId, overrideAccess }));
    },

    findByID: ({ id, ...caller }) =>
      service().findByID(id, actorOf(ctx, caller)),

    addMember: ({ releaseId, userId, overrideAccess, ...member }) =>
      service().addMember(
        releaseId,
        member,
        actorOf(ctx, { userId, overrideAccess })
      ),

    removeMember: ({ memberId, ...caller }) =>
      service().removeMember(memberId, actorOf(ctx, caller)),

    listMembers: ({ releaseId, ...caller }) =>
      service().listMembers(releaseId, actorOf(ctx, caller)),

    schedule: ({ id, at, timezone, ...caller }) =>
      service().schedule(id, at, timezone, actorOf(ctx, caller)),

    cancel: ({ id, ...caller }) => service().cancel(id, actorOf(ctx, caller)),
  };
}
