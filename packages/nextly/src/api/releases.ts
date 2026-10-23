/**
 * `/api/releases` — the HTTP surface for content releases.
 *
 * Owns its own authorization and body parsing, like the API-key, webhook and
 * jobs handlers beside it, which is why `routeHandler` dispatches here before
 * the shared body read.
 *
 * ## Two gates, and why neither is redundant
 *
 * The route checks the SYSTEM authority — read, create, publish, update or
 * delete on `content-releases` — because that is what produces a proper 401 or 403 for an
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

import { z } from "zod";

import { apiKeyScopeFrom } from "../auth/authenticated-scope";
import type { AuthenticatedScope } from "../auth/authenticated-scope";
import { runWithCallerScope } from "../auth/caller-scope";
import { isErrorResponse, requireAnyPermission } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { getLoggerFromDI } from "../dispatcher/helpers/di";
import { isKnownTimeZone } from "../domains/releases/release-calendar";
import { isDueAt } from "../domains/releases/release-due";
import {
  isReleaseTab,
  RELEASE_ATTENTION_REASONS,
  RELEASE_TABS,
  type ReleaseAttentionReason,
  type ReleaseTab,
} from "../domains/releases/release-tabs";
import {
  RELEASE_LIST_ORDERS,
  type DocumentRef,
  type ReleaseListOrder,
  type ReleaseMemberCounts,
  type ReleaseRow,
} from "../domains/releases/releases-repository";
import {
  DEFAULT_RELEASE_PAGE_SIZE,
  MAX_RELEASE_PAGE_SIZE,
  MAX_RELEASE_TITLE_LENGTH,
  RELEASES_RESOURCE,
  type ReleaseAuthority,
  type ReleaseDayFilter,
} from "../domains/releases/services/releases-service";
import { peopleById } from "../domains/versions/author-hydration";
import { NextlyError } from "../errors";
import { getCachedNextly } from "../init";
import {
  isReleaseKind,
  isReleaseState,
  RELEASE_KINDS,
  RELEASE_STATES,
  type ReleaseCapabilities,
  type ReleaseKind,
  type ReleaseState,
} from "../schemas/releases/types";
import {
  readIsoInstant,
  type IsoInstantProblem,
} from "../shared/lib/iso-instant";

import {
  respondAction,
  respondData,
  respondDoc,
  respondList,
  respondMutation,
} from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

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
const RELEASE_AUTHORITY: Record<string, ReleaseAuthority> = {
  listReleases: "read",
  releaseCalendar: "read",
  getRelease: "read",
  listReleaseMembers: "read",
  listReleaseBlockers: "read",
  getReleaseReadiness: "read",
  listReleasesReadiness: "read",
  createRelease: "create",
  addReleaseMember: "create",
  // Removing a member un-does part of assembling a release and can only ever
  // make LESS content go live, so it is `create` rather than `publish`.
  removeReleaseMember: "create",
  // Switching a document's action re-assembles the release; the document's
  // own authority for the new action, and `publish` for a scheduled release,
  // are the service's to ask.
  changeReleaseMemberAction: "create",
  scheduleRelease: "publish",
  cancelRelease: "publish",
  publishRelease: "publish",
  // Each its own permission rather than `create` and `publish`: renaming is
  // not assembling, and deleting a release is not scheduling one.
  updateRelease: "update",
  deleteRelease: "delete",
};

/**
 * What a rename may send: a title, a description, or both, and nothing else.
 *
 * Strict, so a field this route does not change — a `state`, a `scheduledAt`
 * — is refused rather than accepted and ignored, which would answer 200 for
 * a change that never happened. The title follows create's rules: required
 * text when present, never empty, and no longer than the narrowest dialect
 * stores. The service checks the same again for the Direct API.
 */
const RELEASE_DETAILS_BODY = z
  .object({
    title: z
      .string()
      .min(1, "`title` must not be empty.")
      .max(
        MAX_RELEASE_TITLE_LENGTH,
        `\`title\` must be ${MAX_RELEASE_TITLE_LENGTH} characters or fewer.`
      )
      .optional(),
    description: z.string().nullable().optional(),
  })
  .strict()
  .refine(
    body => body.title !== undefined || body.description !== undefined,
    "Give a `title`, a `description`, or both."
  );

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
  // Read by the one strict ISO 8601 reader, which checks the shape before
  // parsing and the stated calendar day after: `new Date` alone accepts "1",
  // normalises "2026-02-30", and reads "09/01/2026" by locale, and a release
  // would publish at whatever instant that produced.
  const reading = readIsoInstant(raw);
  if (!reading.ok) {
    throw badRequest(INSTANT_PROBLEMS[reading.problem](key), { value: raw });
  }
  return reading.at;
}

/** What each way an instant can be unreadable is called, for one key. */
const INSTANT_PROBLEMS: Record<IsoInstantProblem, (key: string) => string> = {
  shape: key =>
    `\`${key}\` must be an ISO 8601 instant, for example 2026-09-01T09:00:00Z.`,
  invalid: key => `\`${key}\` is not a valid instant.`,
  "no-such-day": key => `\`${key}\` names a date that does not exist.`,
};

/**
 * A timezone the platform can actually format in.
 *
 * A length check accepts `Europe/Berln`, which is stored, shown to an author as
 * their intent, and then throws whenever anything formats with it. `Intl` is the
 * only authority on what this runtime supports, so it is asked directly.
 */
function requireTimezone(body: Record<string, unknown>): string {
  const zone = requireString(body, "timezone");
  if (!isKnownTimeZone(zone)) {
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
 * A release kind from a query string or a body, or a refusal — for the reason
 * an unknown state is refused: `kind=singles` ignored would list every release.
 */
function releaseKindParam(value: unknown): ReleaseKind | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isReleaseKind(value)) {
    throw badRequest(`\`kind\` must be one of: ${RELEASE_KINDS.join(", ")}.`);
  }
  return value;
}

/** A kind present in a body: one of the kinds, or a refusal (`null` too). */
function requireKind(value: unknown): ReleaseKind {
  if (!isReleaseKind(value)) {
    throw badRequest(`\`kind\` must be one of: ${RELEASE_KINDS.join(", ")}.`);
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
function pageSize(value: string | null): number {
  if (value === null) return DEFAULT_RELEASE_PAGE_SIZE;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw badRequest("`limit` must be a positive integer.");
  }
  if (n > MAX_RELEASE_PAGE_SIZE) {
    throw badRequest(`\`limit\` may be at most ${MAX_RELEASE_PAGE_SIZE}.`, {
      requested: n,
    });
  }
  return n;
}

/**
 * Which page, counting from 1.
 *
 * Refused rather than clamped when it is not a whole number of at least one: a
 * client asking for page 0 or page "2a" has a bug, and answering with page 1
 * would hide it behind a plausible list.
 */
function pageNumber(value: string | null): number {
  if (value === null) return 1;
  const n = Number(value);
  // A safe integer: `1e308` passes `Number.isInteger` and becomes an infinite
  // offset further in.
  if (!Number.isSafeInteger(n) || n < 1) {
    throw badRequest("`page` must be a whole number of at least 1.");
  }
  return n;
}

/**
 * One of the list's tabs, or a refusal.
 *
 * Refused rather than ignored for the reason `state` is: an unknown tab dropped
 * on the floor answers with every release, and a client paging through what it
 * believes is one tab cannot tell.
 */
function releaseTabParam(value: string | null): ReleaseTab | undefined {
  if (value === null) return undefined;
  if (!isReleaseTab(value)) {
    throw badRequest(`\`tab\` must be one of: ${RELEASE_TABS.join(", ")}.`);
  }
  return value;
}

/** One part of the attention tab, or a refusal. */
function releaseReasonParam(
  value: string | null
): ReleaseAttentionReason | undefined {
  if (value === null) return undefined;
  const known = RELEASE_ATTENTION_REASONS.find(reason => reason === value);
  if (known === undefined) {
    throw badRequest(
      `\`reason\` must be one of: ${RELEASE_ATTENTION_REASONS.join(", ")}.`
    );
  }
  return known;
}

/** Which end of the timeline comes first, or a refusal. */
function releaseOrderParam(value: string | null): ReleaseListOrder | undefined {
  if (value === null) return undefined;
  if (!(RELEASE_LIST_ORDERS as readonly string[]).includes(value)) {
    throw badRequest(
      `\`order\` must be one of: ${RELEASE_LIST_ORDERS.join(", ")}.`
    );
  }
  return value as ReleaseListOrder;
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
 * The list's day filter as a query string carries it: `day` and `timezone`,
 * both or neither.
 *
 * Only their presence is decided here. Whether the date exists and the zone is
 * known is the service's question, asked the same way of a Direct API caller.
 */
const DAY_PARAMS = z.object({
  day: z.string({
    error: "`day` is required with `timezone`: a date such as 2026-03-29.",
  }),
  timezone: z.string({
    error:
      "`timezone` is required with `day`: an IANA time zone such as Europe/Berlin.",
  }),
});

/**
 * The day to narrow the list to, or none.
 *
 * Half a filter is refused rather than dropped: a `day` without its zone has
 * no instants, and ignoring it would answer with every release.
 */
function dayParam(params: URLSearchParams): ReleaseDayFilter | undefined {
  const day = params.get("day");
  const timezone = params.get("timezone");
  if (day === null && timezone === null) return undefined;
  const parsed = DAY_PARAMS.safeParse({
    day: day ?? undefined,
    timezone: timezone ?? undefined,
  });
  if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
  return { date: parsed.data.day, timezone: parsed.data.timezone };
}

/**
 * A calendar read's window as a query string carries it. Every field is
 * required; what each must hold is the service's to check.
 */
const CALENDAR_PARAMS = z.object({
  from: z.string({
    error: "`from` is required: the first day, such as 2026-03-01.",
  }),
  to: z.string({
    error: "`to` is required: the last day, such as 2026-04-11.",
  }),
  timezone: z.string({
    error: "`timezone` is required: an IANA time zone, such as Europe/Berlin.",
  }),
});

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
    /**
     * The key's own id when this request authenticated as one, so a release's
     * history names the key rather than its owner.
     */
    apiKeyId?: string;
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
      publishNow: false,
      update: false,
      delete: false,
    },
  }));
}

/**
 * Every row of a release list, whichever filter produced it, decorated the
 * same way: what this caller may do to it, its member counts and its owner.
 *
 * ONE path for every branch of the list, a document's own releases included,
 * so a client reading `row.owner` or `row.memberCounts` never meets a list
 * that left them off. Whatever the service put on a row (a document's
 * `memberAction`, say) is kept.
 */
async function decorateListPage(
  rows: ReleaseRow[],
  caller: ReleaseContext["caller"],
  releases: ReleaseContext["releases"]
) {
  const decorated = await withCapabilities(rows, caller, releases);
  return withOwners(await withMemberCounts(decorated, caller, releases));
}

/**
 * Each listed release with how many documents it holds and what it does with
 * them, read for the whole page in one request rather than one per row.
 *
 * On the REST list only, as the capabilities are: it is what a list screen
 * shows beside each release, and a Direct API caller asks `memberCounts` for
 * it when it wants it.
 *
 * @experimental
 */
async function withMemberCounts<Row extends { id: string }>(
  rows: Row[],
  caller: ReleaseContext["caller"],
  releases: ReleaseContext["releases"]
): Promise<Array<Row & { memberCounts: ReleaseMemberCounts }>> {
  if (rows.length === 0) return [];
  const counts = await releases.memberCounts({
    ...caller,
    releaseIds: rows.map(row => row.id),
  });
  return rows.map(row => ({
    ...row,
    memberCounts: counts[row.id] ?? { total: 0, goLive: 0, comeDown: 0 },
  }));
}

/**
 * Each listed release with its owner, named by the one rule version history
 * names people by, for the whole page in one read: an id and a name, never an
 * email, image or role. An owner who cannot be named (deleted, erased, or a
 * failed lookup) is `null`, and the release keeps `createdBy`, so a client can
 * tell "not recorded" from "unavailable" as history does.
 *
 * Shown to anyone who may read the release, as a version's author is shown to
 * anyone who may read the document: naming who made a thing the reader can
 * already see discloses no more than the thing itself.
 *
 * @experimental
 */
async function withOwners<Row extends { createdBy: string | null }>(
  rows: Row[]
): Promise<Array<Row & { owner: ReleaseOwner | null }>> {
  const people = await peopleById(rows.map(row => row.createdBy));
  return rows.map(row => ({ ...row, owner: ownerOf(row.createdBy, people) }));
}

/** A release's owner, by id and name only. @experimental */
interface ReleaseOwner {
  id: string;
  name: string | null;
}

function ownerOf(
  createdBy: string | null,
  people: Awaited<ReturnType<typeof peopleById>>
): ReleaseOwner | null {
  const person = createdBy ? people.get(createdBy) : undefined;
  return person?.id ? { id: person.id, name: person.name } : null;
}

/**
 * What a Publish now answer says, by the state the run left the release in.
 *
 * One sentence per state, in a record keyed by every state, so a state added
 * later is a compile error here rather than a release told it is going out.
 *
 * A release still `scheduled` is due and is being sent out by the runner: the
 * run here ran out of time or could not write a document yet, or another run
 * of the drain already held it. The wording holds for each, since none of its
 * documents may be live yet. A `cancelled` one was called off after it was
 * moved to now, and nothing more of it goes out.
 */
const PUBLISH_NOW_MESSAGES: Record<ReleaseState, string> = {
  published: "Release published.",
  blocked:
    "Release stopped part-way. Fix the documents blocking it, then schedule it again.",
  scheduled:
    "Release is going out; any of its documents not yet live will follow shortly.",
  cancelled:
    "Release was cancelled before it went out; nothing more from it will be sent.",
  draft: "Release has not been sent; it is still a draft.",
};

/**
 * The Publish now answer for the release the run left.
 *
 * A `scheduled` release is going out only once its instant has come, by the
 * drain's own rule. One rescheduled for later while Publish now ran waits for
 * that instant, and the drain leaves it alone until then, so promising the
 * rest shortly would be untrue: the answer names the instant instead.
 */
function publishNowMessage(release: ReleaseRow, now: Date): string {
  if (
    release.state === "scheduled" &&
    release.scheduledAt instanceof Date &&
    !isDueAt(release.scheduledAt, now)
  ) {
    return `Release was rescheduled for ${release.scheduledAt.toISOString()} while it was being sent; it will go out then.`;
  }
  return PUBLISH_NOW_MESSAGES[release.state];
}

/**
 * A release with its capabilities, for an answer given AFTER a write.
 *
 * The capabilities are decoration on a write that has already committed, so
 * no failure to read them may fail the request: that would report a write
 * that happened as one that did not, and invite a retry of it. The release is
 * answered without them instead. A refusal is expected — a key scoped to
 * publish releases has no read grant — and is not reported; any other
 * failure is logged through the application logger, the way this layer
 * reports work that goes wrong without failing the request.
 */
async function decorateAfterWrite(
  release: ReleaseRow,
  caller: ReleaseContext["caller"],
  releases: ReleaseContext["releases"]
): Promise<ReleaseRow | (ReleaseRow & { can: ReleaseCapabilities })> {
  try {
    const [item] = await withCapabilities([release], caller, releases);
    return item;
  } catch (error) {
    if (!(NextlyError.is(error) && error.code === "FORBIDDEN")) {
      getLoggerFromDI()?.error(
        "A release's capabilities could not be read after a write",
        {
          releaseId: release.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
    return release;
  }
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
    // The runtime guards belong HERE, at the untyped boundary. The service
    // takes typed values so a typed caller cannot pass a typo, but a query
    // string is whatever was sent — and an unrecognised state or tab answered
    // with an empty list reads exactly like "nothing is scheduled".
    const shared = {
      ...caller,
      state: releaseStateParam(params.get("state")),
      kind: releaseKindParam(params.get("kind")),
      scheduledAfter: optionalInstant(
        params.get("scheduledAfter"),
        "scheduledAfter"
      ),
      scheduledBefore: optionalInstant(
        params.get("scheduledBefore"),
        "scheduledBefore"
      ),
      page: pageNumber(params.get("page")),
      limit: pageSize(params.get("limit")),
    };
    const listOnly = {
      tab: releaseTabParam(params.get("tab")),
      reason: releaseReasonParam(params.get("reason")),
      // Passed as sent: the service trims it, bounds its length and matches it
      // literally, so a REST and a Direct API caller searching the same text
      // get the same releases.
      search: params.get("search") ?? undefined,
      order: releaseOrderParam(params.get("order")),
      day: dayParam(params),
    };
    const { containing } = containingRef(params);
    if (containing !== undefined) {
      // One document's releases are not a tab of the list, nor searched, and
      // come in the order they will be applied to it. Refused rather than
      // dropped: a filter accepted and ignored answers a different question.
      const extra = Object.entries(listOnly).find(([, v]) => v !== undefined);
      if (extra !== undefined) {
        throw badRequest(
          `\`${extra[0]}\` is not available when filtering by document.`
        );
      }
    }
    const found = await releases.find(
      containing !== undefined
        ? { ...shared, containing }
        : { ...shared, ...listOnly }
    );
    // The service's own page and total, so `meta.total` is every release the
    // query matches, not the rows this page holds.
    return respondList(
      await decorateListPage(found.items, caller, releases),
      found.meta
    );
  },

  /**
   * What the checks say about each of a page of releases, in one request.
   *
   * The ids travel as `?ids=a,b` or repeated `?ids=`, so a client can send a
   * page's ids however it builds a query string. The service bounds how many.
   */
  listReleasesReadiness: async ({ request, caller, releases }) => {
    const releaseIds = new URL(request.url).searchParams
      .getAll("ids")
      .flatMap(value => value.split(","))
      .map(id => id.trim())
      .filter(id => id.length > 0);
    if (releaseIds.length === 0) {
      throw badRequest("`ids` must name at least one release.");
    }
    const entries = await releases.readinessOf({ ...caller, releaseIds });
    return respondList(entries, {
      total: entries.length,
      page: 1,
      limit: entries.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    });
  },

  releaseCalendar: async ({ request, caller, releases }) => {
    const params = new URL(request.url).searchParams;
    const parsed = CALENDAR_PARAMS.safeParse({
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      timezone: params.get("timezone") ?? undefined,
    });
    if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
    // A calendar is one answer about a window, not a page of rows, so it is
    // the bare read its Direct API method returns.
    return respondData(
      await releases.calendar({
        ...caller,
        ...parsed.data,
        kind: releaseKindParam(params.get("kind")),
      })
    );
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
    // Named only where the reader may read the document; blocked documents
    // they may not are counted by collection beside them.
    const blockers =
      release.state === "blocked"
        ? await releases.blockersOf({ ...caller, releaseId })
        : undefined;
    return respondDoc({
      ...item,
      ...(blockers ? { blockedBy: blockers.items } : {}),
      ...(blockers && blockers.hidden.length > 0
        ? { hiddenBlockers: blockers.hidden }
        : {}),
    });
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
        // Present means given: an explicit null is a malformed kind, not an
        // omitted one, and is refused rather than read as `release`.
        kind: "kind" in body ? requireKind(body.kind) : undefined,
      }),
      { status: 201 }
    );
  },

  listReleaseMembers: async ({ caller, releases, releaseId }) => {
    // The documents the reader may read, and the rest counted by collection,
    // so the list reads as the size the release is.
    const { items, hidden } = await releases.membersOf({
      ...caller,
      releaseId,
    });
    return respondList(items, {
      total: items.length,
      page: 1,
      limit: items.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
      ...(hidden.length > 0 ? { hidden } : {}),
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

    // The target checks — the document is there for the caller, its
    // collection has a lifecycle, a Single resolves to its own row — are the
    // service's, so the Direct API makes them too.
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

  /**
   * What stands between this release and its instant, asked before committing.
   *
   * The same derivation the drain would reach at the instant, offered at the
   * moment somebody is choosing one — so a launch that cannot run is refused
   * while the operator is still looking at it, rather than at three in the
   * morning when nobody is.
   *
   * Answers for ANY state, not only a stopped release. A draft with a departed
   * author is exactly as unrunnable as one the drain has already labelled; the
   * only difference is whether a background pass has happened yet, which is not
   * something the person scheduling can see.
   */
  listReleaseBlockers: async ({ caller, releases, releaseId }) => {
    const { items, hidden } = await releases.blockersOf({
      ...caller,
      releaseId,
    });
    // Unpaged, like the member list it derives from: the set is bounded by
    // the release's own member cap, and a blocker you cannot see is a blocker
    // you cannot fix. Those on documents the reader may not read are counted
    // by collection, so the release still reads as blocked.
    return respondList(items, {
      total: items.length,
      page: 1,
      limit: items.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
      ...(hidden.length > 0 ? { hidden } : {}),
    });
  },

  /**
   * Every problem the release's documents have now, hard ones (which stop it
   * from being scheduled or published now) apart from soft ones.
   */
  getReleaseReadiness: async ({ caller, releases, releaseId }) =>
    respondDoc(await releases.readiness({ ...caller, releaseId })),

  /**
   * Switch a document between going live and coming down. Bound to the
   * release in the path, as a removal is.
   */
  changeReleaseMemberAction: async ({
    request,
    caller,
    releases,
    releaseId,
    memberId,
  }) => {
    const body = await jsonObject(request);
    const action = body.action;
    if (action !== "publish" && action !== "unpublish") {
      throw badRequest("`action` must be `publish` or `unpublish`.");
    }
    return respondMutation(
      "Release document updated.",
      await releases.changeMemberAction({
        ...caller,
        releaseId,
        memberId,
        action,
      })
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

  updateRelease: async ({ request, caller, releases, releaseId }) => {
    const parsed = RELEASE_DETAILS_BODY.safeParse(await jsonObject(request));
    if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
    const release = await releases.update({
      ...caller,
      id: releaseId,
      ...parsed.data,
    });
    return respondMutation(
      "Release updated.",
      await decorateAfterWrite(release, caller, releases)
    );
  },

  deleteRelease: async ({ caller, releases, releaseId }) => {
    // The mutation envelope with the release as it was, as a deleted entry is
    // answered: the client can name what it just removed.
    return respondMutation(
      "Release deleted.",
      await releases.delete({ ...caller, id: releaseId })
    );
  },

  publishRelease: async ({ caller, releases, releaseId }) => {
    const release = await releases.publishNow({ ...caller, id: releaseId });
    // The release as it stands after the run, and a message that says which
    // way it went: a release still `scheduled` has documents the runner will
    // finish, and a `blocked` one stopped and will not go on until fixed.
    return respondMutation(
      publishNowMessage(release, new Date()),
      await decorateAfterWrite(release, caller, releases)
    );
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

    // Pinned for the WHOLE operation, not only handed to the one call that
    // names it. An operation resolves its target before it acts — `resolveTarget`
    // reads with `auth.userId` alone — and a read that carries no scope is
    // judged on the key OWNER's grants. The `caller.authenticatedScope` below
    // reaches the act and not the lookup that precedes it, so the two halves of
    // one request were answering to different callers.
    return runWithCallerScope(
      auth.authMethod === "api-key" ? apiKeyScopeFrom(auth) : undefined,
      () =>
        operation({
          request,
          caller: {
            userId: auth.userId,
            overrideAccess: false,
            authenticatedScope:
              auth.authMethod === "api-key" ? apiKeyScopeFrom(auth) : undefined,
            // The authenticated role set. `apiKeyWriteAllowed` evaluates
            // code-defined publish rules against it, so dropping it makes every
            // rule see `roles: []` — a role-positive rule then rejects a valid
            // key, and an absence-based one ("not a contractor") admits one it
            // should refuse.
            userRoles: auth.roles,
            apiKeyId: auth.authMethod === "api-key" ? auth.apiKeyId : undefined,
          },
          nextly,
          releases: nextly.releases,
          releaseId: routeParams.releaseId ?? "",
          memberId: routeParams.memberId ?? "",
        })
    );
  })(req);
}
