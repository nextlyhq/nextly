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
import { container } from "../di";
import type {
  DocumentRef,
  ReleaseRow,
} from "../domains/releases/releases-repository";
import {
  RELEASES_RESOURCE,
  type ReleaseCapabilities,
} from "../domains/releases/services/releases-service";
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
  // silently. Caught by re-reading the calendar fields IN THE STATED OFFSET,
  // never against the UTC rendering: `2026-09-01T00:30:00+02:00` is August 31
  // in UTC and perfectly valid, so comparing to `toISOString()` would refuse a
  // legitimate instant for every caller east of Greenwich.
  if (!statesTheSameDay(raw, at)) {
    throw badRequest(`\`${key}\` names a date that does not exist.`, {
      value: raw,
    });
  }
  return at;
}

/**
 * Whether the parsed instant still names the calendar day the caller wrote.
 *
 * Compared in the offset the STRING states, by shifting the instant by that
 * offset before reading its date parts. An impossible date normalises to a
 * different day and is caught; a real one at an offset boundary is not, because
 * its UTC rendering is irrelevant to what the author wrote.
 */
function statesTheSameDay(raw: string, at: Date): boolean {
  // FOUND FROM THE END, never at a fixed index. Seconds and milliseconds are
  // both optional in the accepted shape, so the offset begins anywhere from
  // index 16 (`...T09:00Z`) to index 23 (`...T09:00:00.000+02:00`). Reading
  // from a fixed 19 broke in two different ways at once on the commonest input
  // there is — `Date.prototype.toISOString()`, which ALWAYS emits milliseconds:
  //
  //   "…T09:00:00.000Z"      -> offset ".000Z":      Number("Z")  is NaN, so the
  //                             shifted date was Invalid and `toISOString` threw
  //                             a RangeError out of the route as a 500.
  //   "…T09:00:00.000+02:00" -> offset ".000+02:00": Number("+0") is 0, so a real
  //                             offset was silently read as UTC and this check
  //                             then compared against the wrong calendar day.
  //
  // The second is the one worth naming: it did not throw. It quietly stopped
  // validating the thing this function exists to validate.
  const offset = /(?:Z|[+-]\d{2}:\d{2})$/.exec(raw)?.[0] ?? "Z";
  const minutes =
    offset === "Z"
      ? 0
      : (offset.startsWith("-") ? -1 : 1) *
        (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const local = new Date(at.getTime() + minutes * 60_000);
  return raw.startsWith(local.toISOString().slice(0, 10));
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

/**
 * The page size, always bounded.
 *
 * An omitted limit used to mean "no limit", so `GET /api/releases` selected and
 * serialised the entire table — an ordinary authenticated request turned into an
 * unbounded read on any installation with a real release history. A supplied one
 * was accepted at any size, which is the same read asked for explicitly.
 */
const DEFAULT_RELEASE_PAGE = 50;
const MAX_RELEASE_PAGE = 200;

function pageSize(value: string | null): number {
  if (value === null) return DEFAULT_RELEASE_PAGE;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw badRequest("`limit` must be a positive integer.");
  }
  if (n > MAX_RELEASE_PAGE) {
    throw badRequest(`\`limit\` may be at most ${MAX_RELEASE_PAGE}.`, {
      requested: n,
    });
  }
  return n;
}

/**
 * A window bound, held to the SAME contract as a scheduling instant.
 *
 * Two parsers for one concept is how they drift: this one accepted `1`,
 * `2026-02-30` and locale-dependent forms and normalised them into query bounds
 * nobody asked for, silently returning the wrong page of releases.
 */
function optionalInstant(value: string | null, key: string): Date | undefined {
  if (value === null) return undefined;
  return requireInstant({ [key]: value }, key);
}

/**
 * Whether this scope declares a Draft/Published lifecycle.
 *
 * Asked of the registry, which holds what the schema declared. Answering `false`
 * when the registry cannot be reached is deliberate: a member whose lifecycle
 * support is unknown is one the drain may not be able to perform, and admitting
 * it on an unavailable answer trades a clear refusal now for a release that
 * silently never publishes.
 */
async function declaresLifecycle(
  scopeKind: "collection" | "single",
  scopeSlug: string
): Promise<boolean> {
  const key =
    scopeKind === "single"
      ? "singleRegistryService"
      : "collectionRegistryService";
  if (!container.has(key)) return false;
  const registry = container.get<{
    getCollectionBySlug?: (
      slug: string
    ) => Promise<{ status?: boolean } | null>;
    getSingleBySlug?: (slug: string) => Promise<{ status?: boolean } | null>;
  }>(key);
  const record = await (scopeKind === "single"
    ? registry.getSingleBySlug?.(scopeSlug)
    : registry.getCollectionBySlug?.(scopeSlug));
  return record?.status === true;
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
async function resolveTarget(
  ctx: ReleaseContext,
  scopeKind: "collection" | "single",
  scopeSlug: string,
  entryId: string
): Promise<string> {
  // `status: "all"` is REQUIRED, not incidental. An untrusted read defaults to
  // `published`, and the document a release most often exists to publish is a
  // DRAFT — so the ordinary draft-to-launch flow would 404 at the moment it is
  // assembled, which is the one case this check must not break.
  const found = (await (scopeKind === "single"
    ? ctx.nextly.findSingle({
        slug: scopeSlug as never,
        overrideAccess: false,
        user: { id: ctx.caller.userId } as never,
        status: "all",
      } as never)
    : ctx.nextly.findByID({
        collection: scopeSlug as never,
        id: entryId,
        overrideAccess: false,
        user: { id: ctx.caller.userId } as never,
        status: "all",
      } as never))) as { id?: string; status?: unknown } | null | undefined;

  if (found === null || found === undefined) {
    // Read AS the caller, so a document they may not see and one that is not
    // there are the same answer and this cannot be used to probe for ids.
    throw NextlyError.notFound({
      logContext: {
        reason: "release-member-target-missing",
        scopeKind,
        scopeSlug,
        entryId,
      },
    });
  }

  // A target with no publish lifecycle can never satisfy the member.
  // Materialisation works by writing the status field, so with the lifecycle
  // disabled the write produces no observable published or draft state, the
  // drain records a failed action, and the release stays scheduled forever.
  //
  // Read from the SCHEMA, not probed on the row. An earlier version checked
  // whether the row carried a `status` property, which is wrong in the
  // dangerous direction: the name is reserved only when the lifecycle is
  // enabled, so a collection with it DISABLED may legally define an ordinary
  // field called `status` — and materialisation would then overwrite that
  // author's field with "published" and report the release complete.
  if (!(await declaresLifecycle(scopeKind, scopeSlug))) {
    throw badRequest(
      `\`${scopeSlug}\` has no draft/published lifecycle, so it cannot be scheduled in a release.`,
      { reason: "target-without-lifecycle", scopeKind, scopeSlug }
    );
  }

  // The SINGLE's own id, not the one the caller sent. A Single is addressed by
  // slug, so any id is accepted here — but release visibility compares stored
  // decisions against the row's real id, and a member carrying a stale one is
  // invisible to reads until a background drain happens to run.
  if (scopeKind === "single") {
    if (typeof found.id !== "string") {
      throw NextlyError.internal({
        logContext: { reason: "single-without-id", scopeSlug },
      });
    }
    return found.id;
  }
  return entryId;
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
    /** The authenticated roles, which code-defined access rules are evaluated against. */
    userRoles?: string[];
  };
  nextly: Awaited<ReturnType<typeof getCachedNextly>>;
  releases: Awaited<ReturnType<typeof getCachedNextly>>["releases"];
  releaseId: string;
  memberId: string;
}

/**
 * The document a caller is asking about, when they are asking about one.
 *
 * All three parts or none. A partial reference is REFUSED rather than ignored:
 * dropping it would answer with every release instead of the ones holding the
 * document, and a document editor rendering that would tell an author their
 * post is in eleven launches.
 *
 * `locale` is deliberately absent. A member is whole-document — the service
 * refuses a locale-scoped one — so accepting a locale here would offer a
 * narrowing the engine does not have.
 */
function containingRef(
  params: URLSearchParams
): { containing: DocumentRef } | Record<string, never> {
  const scopeKind = params.get("containingScopeKind");
  const scopeSlug = params.get("containingScopeSlug");
  const entryId = params.get("containingEntryId");
  if (scopeKind === null && scopeSlug === null && entryId === null) return {};

  if (scopeKind !== "collection" && scopeKind !== "single") {
    throw badRequest(
      "`containingScopeKind` must be `collection` or `single`.",
      { received: scopeKind }
    );
  }
  if (!scopeSlug || !entryId) {
    throw badRequest(
      "`containingScopeSlug` and `containingEntryId` are both required when filtering by document."
    );
  }
  return { containing: { scopeKind, scopeSlug, entryId, locale: null } };
}

/**
 * Each release, with what THIS caller may do to it.
 *
 * Attached at the HTTP surface rather than inside the read, because a control
 * is a property of the reader and not of the release: two callers asking for the
 * same release get the same row and different verdicts. Sending it spares every
 * client from holding the transition rules and the grant model, which is the
 * only way a client could otherwise decide what to offer — and it would be
 * guessing at the half it cannot see, since a scoped API key is judged by its
 * own grants rather than its owner's.
 *
 * One batched call for the whole page, so a window of fifty releases does not
 * become fifty permission reads.
 */
async function withCapabilities(
  rows: ReleaseRow[],
  caller: ReleaseContext["caller"],
  releases: ReleaseContext["releases"]
): Promise<Array<ReleaseRow & { can: ReleaseCapabilities }>> {
  const can = await releases.capabilities({ ...caller, releases: rows });
  return rows.map(row => ({
    ...row,
    // A release missing from the map would be a bug in the batch rather than a
    // caller with no rights, and defaulting to `true` would offer controls the
    // write then refuses. Absent means "not permitted", which fails closed.
    can: can.get(row.id) ?? {
      schedule: false,
      cancel: false,
      addMember: false,
      removeMember: false,
    },
  }));
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
    const limit = pageSize(params.get("limit"));
    // ONE row past the limit, so truncation is observable. Without it a page of
    // five is reported as `total: 5, hasNext: false` whether five releases exist
    // or five hundred do, and a client renders an incomplete schedule as the
    // whole one.
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
      ...containingRef(params),
      limit: limit + 1,
    });
    const page = found.slice(0, limit);
    const hasNext = found.length > limit;
    const items = await withCapabilities(page, caller, releases);
    // The canonical list envelope, so shared client tooling reads this like
    // every other list. The meta is synthetic because the query is windowed
    // rather than paged — `total` is what this page holds, and a second query
    // to count the whole table would be a read nobody asked for.
    return respondList(items, {
      // `total` is what this window holds, not a count of the table: the query
      // is windowed rather than paged, and a second COUNT would be a read
      // nobody asked for. `hasNext` is the honest part — it says whether more
      // matched than were returned.
      total: page.length,
      page: 1,
      limit,
      totalPages: hasNext ? 2 : 1,
      hasNext,
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
    // The detail read is exactly where the controls are rendered, so this is
    // the one place the extra permission reads are certainly wanted.
    const [item] = await withCapabilities([release], caller, releases);
    // Only for a release that is actually stopped. Asking otherwise would put
    // an identity lookup on every detail read to answer "nothing is wrong",
    // which the state already said.
    const blockedBy =
      release.state === "blocked"
        ? await releases.blockingReasons({ ...caller, releaseId })
        : undefined;
    return respondDoc({ ...item, ...(blockedBy ? { blockedBy } : {}) });
  },

  createRelease: async ({ request, caller, releases }) => {
    const body = await jsonObject(request);
    // Present-but-wrong is REFUSED, not nulled. Coercing a client's numeric or
    // object description to `null` turns a malformed request into silent data
    // loss, where every other bad field here answers 400.
    const description = "description" in body ? body.description : null;
    if (description !== null && typeof description !== "string") {
      throw badRequest("`description` must be a string or null.", {
        received: typeof description,
      });
    }
    return respondMutation(
      "Release created.",
      await releases.create({
        ...caller,
        title: requireString(body, "title"),
        description,
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

    // Returns the id the member must carry, which for a Single is the row's
    // own rather than whatever the caller sent.
    const targetId = await resolveTarget(ctx, scopeKind, scopeSlug, entryId);

    return respondMutation(
      "Added to release.",
      await releases.addMember({
        ...caller,
        releaseId,
        scopeKind,
        scopeSlug,
        entryId: targetId,
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
        // The authenticated role set. `apiKeyWriteAllowed` evaluates
        // code-defined publish rules against it, so dropping it makes every
        // rule see `roles: []` — a role-positive rule then rejects a valid key,
        // and an absence-based one ("not a contractor") admits one it should
        // refuse.
        userRoles: auth.roles,
      },
      nextly,
      releases: nextly.releases,
      releaseId: routeParams.releaseId ?? "",
      memberId: routeParams.memberId ?? "",
    });
  })(req);
}
