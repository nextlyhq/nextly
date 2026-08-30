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

import { isErrorResponse, requireAnyPermission } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { RELEASES_RESOURCE } from "../domains/releases/services/releases-service";
import { getCachedNextly } from "../init";
import {
  isReleaseState,
  RELEASE_STATES,
  type ReleaseState,
} from "../schemas/releases/types";

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
    throw new ReleaseRequestError("A JSON body is required.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ReleaseRequestError("A JSON object body is required.");
  }
  return parsed as Record<string, unknown>;
}

/** A caller-fixable problem with the request itself. */
class ReleaseRequestError extends Error {}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ReleaseRequestError(`\`${key}\` is required.`);
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
    throw new ReleaseRequestError(`\`${key}\` must be an ISO 8601 string.`);
  }
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) {
    throw new ReleaseRequestError(`\`${key}\` is not a valid instant.`);
  }
  return at;
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
    throw new ReleaseRequestError(
      `\`state\` must be one of: ${RELEASE_STATES.join(", ")}.`
    );
  }
  return value;
}

function optionalCount(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ReleaseRequestError("`limit` must be a positive integer.");
  }
  return n;
}

function optionalInstant(value: string | null, key: string): Date | undefined {
  if (value === null) return undefined;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) {
    throw new ReleaseRequestError(`\`${key}\` is not a valid instant.`);
  }
  return at;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
  caller: { userId: string; overrideAccess: false };
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
    return json({
      releases: await releases.find({
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
        limit: optionalCount(params.get("limit")),
      }),
    });
  },

  getRelease: async ({ caller, releases, releaseId }) => {
    const release = await releases.findByID({ ...caller, id: releaseId });
    // A caller who may not read releases never reaches here — the authority
    // gate refused them — so answering 404 cannot leak whether a release exists.
    if (release === null) return json({ error: "Release not found." }, 404);
    return json({ release });
  },

  createRelease: async ({ request, caller, releases }) => {
    const body = await jsonObject(request);
    const description = body.description;
    return json(
      {
        release: await releases.create({
          ...caller,
          title: requireString(body, "title"),
          description: typeof description === "string" ? description : null,
        }),
      },
      201
    );
  },

  listReleaseMembers: async ({ caller, releases, releaseId }) =>
    json({ members: await releases.listMembers({ ...caller, releaseId }) }),

  addReleaseMember: async ({ request, caller, releases, releaseId }) => {
    const body = await jsonObject(request);
    const action = body.action;
    if (action !== "publish" && action !== "unpublish") {
      throw new ReleaseRequestError(
        "`action` must be `publish` or `unpublish`."
      );
    }
    const scopeKind = body.scopeKind;
    if (scopeKind !== "collection" && scopeKind !== "single") {
      throw new ReleaseRequestError(
        "`scopeKind` must be `collection` or `single`."
      );
    }
    const locale = body.locale;
    return json(
      {
        member: await releases.addMember({
          ...caller,
          releaseId,
          scopeKind,
          scopeSlug: requireString(body, "scopeSlug"),
          entryId: requireString(body, "entryId"),
          // `null` means the document itself rather than one language of it.
          locale: typeof locale === "string" ? locale : null,
          action,
        }),
      },
      201
    );
  },

  removeReleaseMember: async ({ caller, releases, memberId }) => {
    await releases.removeMember({ ...caller, memberId });
    return json({ removed: true });
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
      timezone: requireString(body, "timezone"),
    });
    return json({ scheduled: true });
  },

  cancelRelease: async ({ caller, releases, releaseId }) => {
    await releases.cancel({ ...caller, id: releaseId });
    return json({ cancelled: true });
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
      return json({ error: "Unknown release operation" }, 400);
    }

    const auth = await requireAnyPermission(request, [
      { action: authority, resource: RELEASES_RESOURCE },
    ]);
    // Thrown, not returned: `withErrorHandler` turns a NextlyError into the
    // canonical envelope every other 401/403 in this API ships, and returning
    // the raw refusal would give release routes a shape of their own.
    if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

    const nextly = await getCachedNextly();

    try {
      return await operation({
        request,
        caller: { userId: auth.userId, overrideAccess: false },
        releases: nextly.releases,
        releaseId: routeParams.releaseId ?? "",
        memberId: routeParams.memberId ?? "",
      });
    } catch (error) {
      // Caller-fixable request problems answer 400 with the sentence that names
      // the mistake. Everything else falls through to `withErrorHandler`, which
      // keeps a service refusal a 403 and an unexpected fault a 500.
      if (error instanceof ReleaseRequestError) {
        return json({ error: error.message }, 400);
      }
      throw error;
    }
  })(req);
}
