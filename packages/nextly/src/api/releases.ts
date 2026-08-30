/**
 * `/api/releases` — the HTTP surface for content releases.
 *
 * Owns its own authorization and body parsing, like the API-key, webhook and
 * jobs handlers beside it, which is why `routeHandler` dispatches here before
 * the shared body read.
 *
 * ## Two gates, and why neither is redundant
 *
 * The route checks the SYSTEM authority — read, create or publish on
 * `content-releases` — because that is what produces a proper 401 or 403 for an
 * unauthenticated or unauthorized caller, and it stops a request before any
 * service work happens.
 *
 * The service is then called with `overrideAccess: false` and the authenticated
 * user, so its own checks still run. That is not the same question asked twice:
 * the route can only express the system authority, while the service also asks
 * whether this caller may publish the DOCUMENT they are putting into a release.
 * A route gate cannot know that, because the document is in the body.
 *
 * @module api/releases
 */

import type { AuthenticatedScope } from "../auth/authenticated-scope";
import { isErrorResponse, requireAnyPermission } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { RELEASES_RESOURCE } from "../domains/releases/services/releases-service";
import { NextlyError } from "../errors";
import { getCachedNextly } from "../init";
import {
  isReleaseState,
  RELEASE_STATES,
  type ReleaseState,
} from "../schemas/releases/types";

import {
  respondAction,
  respondDoc,
  respondList,
  respondMutation,
} from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

/**
 * The release authority each method needs, declared once.
 *
 * Kept here rather than on the parsed route because `OperationType` is the
 * dispatcher's shared vocabulary — list, single, create, update, delete — and
 * `publish` is not a member of it. Widening a type every service shares to
 * describe one of them would be the wrong trade; this table is the same
 * information in the place that enforces it.
 *
 * The split that matters: scheduling and cancelling need `publish`, NOT the
 * `create` that assembling a release needs. Committing a release to an instant
 * is the act that puts content live, and the seed keeps the two apart —
 * "publish-content-releases" is defined as "schedule or cancel".
 */
const RELEASE_AUTHORITY: Record<string, "read" | "create" | "publish"> = {
  listReleases: "read",
  getRelease: "read",
  listReleaseMembers: "read",
  createRelease: "create",
  addReleaseMember: "create",
  // Removing a member un-does part of assembling a release and can only ever
  // make LESS content go live, so it is `create` rather than `publish`.
  removeReleaseMember: "create",
  scheduleRelease: "publish",
  cancelRelease: "publish",
};

/**
 * Reject a body that is not a JSON object.
 *
 * Returned as a refusal rather than coerced: `null` and `[]` are both valid JSON
 * and neither carries the fields these routes read, so accepting them would turn
 * a caller's mistake into a confusing failure further in.
 */
async function jsonObject(req: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw badRequest("A JSON body is required.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("A JSON object body is required.");
  }
  return parsed as Record<string, unknown>;
}

/**
 * A caller-fixable problem with the request.
 *
 * `NextlyError.invalidInput` rather than a bare `Error` rendered by hand:
 * `withErrorHandler` turns it into the canonical envelope every other 400 in
 * this API ships, with its code and request id. A hand-rolled `{ error }` body
 * is a second response shape for one class of failure, and the client tooling
 * that reads the canonical one cannot see it.
 */
function badRequest(message: string, logContext: Record<string, unknown> = {}) {
  return NextlyError.invalidInput({ message, logContext });
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest(`\`${key}\` is required.`);
  }
  return value;
}

/**
 * An instant supplied by a caller.
 *
 * Refused rather than defaulted when unparseable. A release whose scheduled
 * instant silently became "now" would publish immediately, which is the one
 * outcome an author scheduling something for later cannot recover from.
 */
function requireInstant(body: Record<string, unknown>, key: string): Date {
  const raw = body[key];
  if (typeof raw !== "string") {
    throw badRequest(`\`${key}\` must be an ISO 8601 string.`);
  }
  // Parseability is NOT the contract. `new Date` accepts "1" as 2001-01-01,
  // normalises "2026-02-30" to March 2, and reads "09/01/2026" differently by
  // locale — each of which yields a perfectly valid Date at an instant the
  // author never chose, and a release publishes at it. The shape is checked
  // first so only genuine ISO 8601 reaches the parser.
  if (!ISO_INSTANT.test(raw)) {
    throw badRequest(
      `\`${key}\` must be an ISO 8601 instant, for example 2026-09-01T09:00:00Z.`,
      { value: raw }
    );
  }
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) {
    throw badRequest(`\`${key}\` is not a valid instant.`, { value: raw });
  }
  // A well-formed but impossible date — 2026-02-30 — parses and normalises
  // silently. Round-tripping the calendar fields is what catches it.
  if (!raw.startsWith(at.toISOString().slice(0, 10))) {
    throw badRequest(`\`${key}\` names a date that does not exist.`, {
      value: raw,
    });
  }
  return at;
}

/**
 * ISO 8601 with an explicit offset or `Z`.
 *
 * A local-time string carries no zone, so the server would resolve it in its
 * own — the same request scheduling different instants on two deployments.
 * `timezone` states the author's intent separately and does not make the
 * instant ambiguous.
 */
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * A timezone the platform can actually format in.
 *
 * A length check accepts `Europe/Berln`, which is stored, shown to an author as
 * their intent, and then throws whenever anything formats with it. `Intl` is the
 * only authority on what this runtime supports, so it is asked directly.
 */
function requireTimezone(body: Record<string, unknown>): string {
  const zone = requireString(body, "timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    throw badRequest(
      "`timezone` must be an IANA time zone, such as Europe/Berlin.",
      {
        value: zone,
      }
    );
  }
  return zone;
}

/** Optional positive integer from a query string. */
/**
 * A lifecycle state from a query string, or a refusal.
 *
 * Refused rather than ignored. Dropping an unrecognised filter widens the query
 * — the caller asked for one state and receives every release — and a client
 * paging through what it believes is a filtered list has no way to notice.
 */
function releaseStateParam(value: string | null): ReleaseState | undefined {
  if (value === null) return undefined;
  if (!isReleaseState(value)) {
    throw badRequest(`\`state\` must be one of: ${RELEASE_STATES.join(", ")}.`);
  }
  return value;
}

function optionalCount(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw badRequest("`limit` must be a positive integer.");
  }
  return n;
}

function optionalInstant(value: string | null, key: string): Date | undefined {
  if (value === null) return undefined;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) {
    throw badRequest(`\`${key}\` is not a valid instant.`);
  }
  return at;
}

/**
 * Refuse a member whose target document is not there.
 *
 * A typo or a stale id is accepted happily by the write path — nothing joins a
 * member to a document — and then fails at the scheduled instant with
 * not-found, holding the release open and reporting a failure nobody is
 * watching for. Resolved as the CALLER, so a document they may not read is
 * indistinguishable from one that does not exist and this cannot be used to
 * probe for ids.
 *
 * Placed at this boundary because it is where a content reader is available.
 * When the add-time document-rule check lands in the wiring it will carry the
 * reader into the service, and this moves there so the Direct API path gets it
 * too.
 */
async function requireTargetExists(
  ctx: ReleaseContext,
  scopeKind: "collection" | "single",
  scopeSlug: string,
  entryId: string
): Promise<void> {
  const found =
    scopeKind === "single"
      ? await ctx.nextly.findSingle({
          slug: scopeSlug as never,
          overrideAccess: false,
          user: { id: ctx.caller.userId },
        })
      : await ctx.nextly.findByID({
          collection: scopeSlug as never,
          id: entryId,
          overrideAccess: false,
          user: { id: ctx.caller.userId },
        });

  if (found === null || found === undefined) {
    throw NextlyError.notFound({
      logContext: {
        reason: "release-member-target-missing",
        scopeKind,
        scopeSlug,
        entryId,
      },
    });
  }
}

/**
 * What every release operation is handed.
 *
 * `caller` carries `overrideAccess: false`, which is what turns the service's
 * own checks ON. The route can only ask the SYSTEM question — may this person
 * touch releases at all — while the service also asks whether they may publish
 * the DOCUMENT they are putting into one, which is in the body and therefore
 * invisible to any route gate.
 */
interface ReleaseContext {
  request: Request;
  caller: {
    userId: string;
    overrideAccess: false;
    /**
     * The KEY's own grants when this request authenticated as one.
     *
     * Reducing an API-key request to its owner's `userId` makes the service
     * resolve release authority from the OWNER's database permissions, and both
     * directions are wrong: a key scoped narrowly inherits authority it was
     * never granted, and a key granted release authority is denied when its
     * owner lacks it. `auth.permissions` is the stamped scope; it travels.
     */
    authenticatedScope?: AuthenticatedScope;
  };
  nextly: Awaited<ReturnType<typeof getCachedNextly>>;
  releases: Awaited<ReturnType<typeof getCachedNextly>>["releases"];
  releaseId: string;
  memberId: string;
}

/**
 * One function per operation, keyed by the method the route table named.
 *
 * A map rather than a switch: eight cases in one function is twenty-three paths
 * through it, and each case is independent of the others — nothing falls
 * through, nothing shares a local. Splitting them means each reads as the small
 * thing it is, and the authority table above stays the single place that says
 * what each one needs.
 */
const RELEASE_OPERATIONS: Record<
  string,
  (ctx: ReleaseContext) => Promise<Response>
> = {
  listReleases: async ({ request, caller, releases }) => {
    const params = new URL(request.url).searchParams;
    const limit = optionalCount(params.get("limit"));
    const found = await releases.find({
      ...caller,
      // The runtime guard belongs HERE, at the untyped boundary. The service
      // takes `ReleaseState` so a typed caller cannot pass a typo, but a query
      // string is whatever was sent — and an unrecognised state answered with
      // an empty list reads exactly like "nothing is scheduled".
      state: releaseStateParam(params.get("state")),
      scheduledAfter: optionalInstant(
        params.get("scheduledAfter"),
        "scheduledAfter"
      ),
      scheduledBefore: optionalInstant(
        params.get("scheduledBefore"),
        "scheduledBefore"
      ),
      limit,
    });
    // The canonical list envelope, so shared client tooling reads this like
    // every other list. The meta is synthetic because the query is windowed
    // rather than paged — `total` is what this page holds, and a second query
    // to count the whole table would be a read nobody asked for.
    return respondList(found, {
      total: found.length,
      page: 1,
      limit: limit ?? found.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
  },

  getRelease: async ({ caller, releases, releaseId }) => {
    const release = await releases.findByID({ ...caller, id: releaseId });
    // A caller who may not read releases never reaches here — the authority
    // gate refused them — so answering 404 cannot leak whether a release exists.
    if (release === null) {
      throw NextlyError.notFound({
        logContext: { reason: "release-not-found", releaseId },
      });
    }
    return respondDoc(release);
  },

  createRelease: async ({ request, caller, releases }) => {
    const body = await jsonObject(request);
    const description = body.description;
    return respondMutation(
      "Release created.",
      await releases.create({
        ...caller,
        title: requireString(body, "title"),
        description: typeof description === "string" ? description : null,
      }),
      { status: 201 }
    );
  },

  listReleaseMembers: async ({ caller, releases, releaseId }) => {
    const members = await releases.listMembers({ ...caller, releaseId });
    return respondList(members, {
      total: members.length,
      page: 1,
      limit: members.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
  },

  addReleaseMember: async ctx => {
    const { request, caller, releases, releaseId } = ctx;
    const body = await jsonObject(request);
    const action = body.action;
    if (action !== "publish" && action !== "unpublish") {
      throw badRequest("`action` must be `publish` or `unpublish`.");
    }
    const scopeKind = body.scopeKind;
    if (scopeKind !== "collection" && scopeKind !== "single") {
      throw badRequest("`scopeKind` must be `collection` or `single`.");
    }
    const scopeSlug = requireString(body, "scopeSlug");
    const entryId = requireString(body, "entryId");
    // Neither a string nor null is REFUSED, never coerced. Coercing a numeric
    // locale id from a mismatched client schema to `null` silently WIDENS the
    // member from one language to the whole document — the opposite of what the
    // caller asked for, and the service cannot tell the difference because by
    // then it is a legitimate document-wide member.
    const locale = "locale" in body ? body.locale : null;
    if (locale !== null && typeof locale !== "string") {
      throw badRequest("`locale` must be a string or null.", {
        received: typeof locale,
      });
    }

    await requireTargetExists(ctx, scopeKind, scopeSlug, entryId);

    return respondMutation(
      "Added to release.",
      await releases.addMember({
        ...caller,
        releaseId,
        scopeKind,
        scopeSlug,
        entryId,
        locale,
        action,
      }),
      { status: 201 }
    );
  },

  removeReleaseMember: async ({ caller, releases, releaseId, memberId }) => {
    // Bound to the release in the PATH. Deleting by member id alone means
    // `/api/releases/A/members/B` removes B even when B belongs to release C —
    // a stale client URL then quietly edits a release the caller never named,
    // and the response says it worked.
    await releases.removeMember({ ...caller, memberId, releaseId });
    return respondAction("Removed from release.", { memberId, releaseId });
  },

  scheduleRelease: async ({ request, caller, releases, releaseId }) => {
    const body = await jsonObject(request);
    await releases.schedule({
      ...caller,
      id: releaseId,
      at: requireInstant(body, "at"),
      // Required, never defaulted to UTC. The timezone is the author's INTENT —
      // "9am Berlin" survives a daylight-saving boundary as a statement where a
      // UTC instant alone does not — and guessing it puts content live an hour
      // early twice a year.
      timezone: requireTimezone(body),
    });
    return respondAction("Release scheduled.", { releaseId });
  },

  cancelRelease: async ({ caller, releases, releaseId }) => {
    await releases.cancel({ ...caller, id: releaseId });
    // Not `{ cancelled: true }`: the response-shape contract refuses
    // boolean-only bodies, because a caller cannot grow against them.
    return respondAction("Release cancelled.", { releaseId });
  },
};

/**
 * Route a parsed release operation to the Direct API namespace.
 *
 * The authority is looked up BEFORE authenticating, so a route added without an
 * entry in {@link RELEASE_AUTHORITY} is refused rather than running unguarded.
 */
export async function handleReleaseRequest(
  req: Request,
  method: string,
  routeParams: Record<string, string> = {}
): Promise<Response> {
  return withErrorHandler(async (request: Request): Promise<Response> => {
    const authority = RELEASE_AUTHORITY[method];
    const operation = RELEASE_OPERATIONS[method];
    if (authority === undefined || operation === undefined) {
      throw badRequest("Unknown release operation.", { method });
    }

    const auth = await requireAnyPermission(request, [
      { action: authority, resource: RELEASES_RESOURCE },
    ]);
    // Thrown, not returned: `withErrorHandler` turns a NextlyError into the
    // canonical envelope every other 401/403 in this API ships, and returning
    // the raw refusal would give release routes a shape of their own.
    if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

    const nextly = await getCachedNextly();

    return operation({
      request,
      caller: {
        userId: auth.userId,
        overrideAccess: false,
        authenticatedScope:
          auth.authMethod === "api-key"
            ? { actorType: "apiKey", permissions: auth.permissions }
            : undefined,
      },
      nextly,
      releases: nextly.releases,
      releaseId: routeParams.releaseId ?? "",
      memberId: routeParams.memberId ?? "",
    });
  })(req);
}
