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

/** Who the call acts as, and whether its permissions are checked. */
export interface ReleaseCallerArgs {
  /**
   * The acting identity. Required whenever `overrideAccess` is `false`, because
   * a checked call with nobody to check is a call that can only be refused.
   */
  userId?: string | null;
  /** Defaults to `true`: the Direct API is trusted. */
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

/** Split the caller identity out of an argument bag. */
function actorOf(args: ReleaseCallerArgs) {
  return {
    userId: args.userId ?? null,
    // Trusted by default, like every other Direct API operation. A caller
    // asking for checks says so explicitly.
    overrideAccess: args.overrideAccess ?? true,
  };
}

export function createReleasesNamespace(): ReleasesNamespace {
  return {
    create: ({ title, description, ...caller }) =>
      service().create({ title, description }, actorOf(caller)),

    find: (args = {}) => {
      const { userId, overrideAccess, ...query } = args;
      return service().find(query, actorOf({ userId, overrideAccess }));
    },

    findByID: ({ id, ...caller }) => service().findByID(id, actorOf(caller)),

    addMember: ({ releaseId, userId, overrideAccess, ...member }) =>
      service().addMember(
        releaseId,
        member,
        actorOf({ userId, overrideAccess })
      ),

    removeMember: ({ memberId, ...caller }) =>
      service().removeMember(memberId, actorOf(caller)),

    listMembers: ({ releaseId, ...caller }) =>
      service().listMembers(releaseId, actorOf(caller)),

    schedule: ({ id, at, timezone, ...caller }) =>
      service().schedule(id, at, timezone, actorOf(caller)),

    cancel: ({ id, ...caller }) => service().cancel(id, actorOf(caller)),
  };
}
