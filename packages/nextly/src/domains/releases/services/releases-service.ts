/**
 * The authorization boundary for content releases.
 *
 * The releases engine — repository, materialisation, the periodic drain — was
 * complete and reachable only from inside the server process. Its three
 * permissions were seeded and enforced NOWHERE, because there was no service in
 * which to enforce them. This is that service, and it is the layer that makes
 * the feature safe to expose.
 *
 * ## Five authorities, each its own power
 *
 * `permission-seed-service` states the split and this honours it rather than
 * restating it: assembling a release changes nothing a reader can see, while
 * scheduling it is the act that puts content live later.
 *
 *     read     → view releases and their members
 *     create   → create a release and choose what goes in it
 *     publish  → schedule or cancel, which is what makes content go live
 *     update   → rename a release and change its description
 *     delete   → delete a draft or cancelled release
 *
 * `update` and `delete` arrived after the other three, and the seed grants
 * them on an upgrade to the roles that held the power each splits off:
 * `update` to holders of `create`, `delete` to holders of `publish`.
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
import type { RequestActor } from "../../../auth/request-actor";
import { NextlyError } from "../../../errors";
import type { ReleaseNotDeletablePublicData } from "../../../errors/public-data";
import {
  RELEASE_ASSEMBLABLE_FROM,
  RELEASE_ASSEMBLABLE_WITH_PUBLISH_FROM,
  RELEASE_MEMBER_LIMIT,
  RELEASE_CANCELLABLE_FROM,
  RELEASE_DELETABLE_FROM,
  RELEASE_FINAL_STATES,
  RELEASE_PUBLISHABLE_NOW_FROM,
  RELEASE_SCHEDULABLE_FROM,
  RELEASE_SCHEDULABLE_FROM_BLOCKED,
  RELEASE_SCHEDULABLE_FROM_UNBLOCKED,
  RELEASE_KINDS,
  RELEASE_STATES,
  RELEASE_STATES_SHOWN_ON_A_DOCUMENT,
  isReleaseMemberAction,
  type ReleaseBlockerReason,
  type ReleaseKind,
  type ReleaseMemberAction,
  type ReleaseState,
  type ReleaseCapabilities,
} from "../../../schemas/releases/types";
import type { VersionScopeKind } from "../../../schemas/versions/types";
import type { Logger } from "../../../services/shared";
import { isUniqueViolation } from "../../../shared/lib/unique-violation";
import {
  releaseCheckSources,
  type ReleaseCheckReads,
  type ReleaseCheckSource,
} from "../readiness/check-sources";
import {
  CORE_AUTHOR_SOURCE,
  registeredReleaseCheckSources,
} from "../readiness/core-sources";
import {
  evaluateReadiness,
  type ReadinessFinding,
  type ReleaseReadiness,
} from "../readiness/evaluate-readiness";
import {
  linkTargetOf,
  narrowLinkFindings,
  UNPUBLISHED_LINKS_SOURCE_KEY,
  unpublishedLinksReport,
  type UnpublishedLinksReport,
} from "../readiness/unpublished-links";
import type { ReleaseActivityEntry } from "../release-activity";
import {
  RELEASE_CALENDAR_RELEASES_PER_DAY,
  zonedDay,
  zonedDays,
  type ReleaseCalendar,
} from "../release-calendar";
import { isDueAt } from "../release-due";
import { releaseMemberKey } from "../release-member-key";
import {
  RELEASE_ATTENTION_REASONS,
  RELEASE_TABS,
  type ReleaseAttentionReason,
  type ReleaseTab,
} from "../release-tabs";
import {
  resolveReleaseTarget,
  type ReleaseTargetReader,
} from "../release-targets";
import { documentRefKey, RELEASE_LIST_ORDERS } from "../releases-repository";
import type {
  DocumentRef,
  NewRelease,
  ReleaseListOrder,
  ReleaseMemberCounts,
  ReleaseMemberRow,
  ReleasePageQuery,
  ReleaseRow,
  ReleasesRepository,
} from "../releases-repository";
import { RELEASES_RESOURCE } from "../releases-resource";

/** The system-resource authorities a release operation can require. */
export type ReleaseAuthority =
  | "read"
  | "create"
  | "publish"
  | "update"
  | "delete";

/**
 * The system resource the release permissions are seeded under. Declared in
 * `releases-resource` and exported here as well, where every caller of the
 * service has always found it.
 */
export { RELEASES_RESOURCE };

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
 * The reads a readiness check needs from outside the releases domain; the
 * rest of {@link ReleaseCheckReads} the service answers from its repository.
 *
 * @experimental
 */
export type ReleaseDocumentChecks = Omit<
  ReleaseCheckReads,
  "liveAuthors" | "scheduledMemberships" | "declaresLifecycle"
>;

export interface ReleasesServiceDeps {
  repository: ReleasesRepository;
  /**
   * What a document must be to join a release: there for the caller, in a
   * collection or Single with a draft/published lifecycle. Injected because
   * the content API and the schema registries are the wiring's to hold.
   */
  targets: ReleaseTargetReader;
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
  /**
   * Run the releases drain job now, through the jobs runner, if no runner
   * already holds it.
   *
   * The runner's own job, claimed under its lease exactly as a scheduled pass
   * claims it, so a run started here can never overlap the scheduled drain or
   * another one started here: every run of the release engine goes through
   * that one claim. When another runner holds it, nothing runs and this
   * resolves anyway; that runner, or the next pass, sends out what is due.
   * `maxDurationMs` is the pass's budget, as for any pass.
   *
   * Injected because the runner, its registry and the identity reads the drain
   * writes with are wiring the domain does not hold.
   */
  runDrainNow: (options: { maxDurationMs: number }) => Promise<unknown>;
  /**
   * What the readiness checks ask about a member's document and author, as
   * the release's run would answer it. Injected because the access gate, the
   * content validation and the identity reads are the wiring's to hold.
   */
  checks: ReleaseDocumentChecks;
  /**
   * Where Publish now reports a drain it could not start, and a rename or
   * delete reports an activity entry it could not record. Optional: without
   * one the failure goes unreported, and the operation still answers as it
   * stands.
   */
  logger?: Pick<Logger, "warn">;
  /**
   * Record a rename or a deletion in the activity log (`release-activity`),
   * after the write has committed.
   *
   * Injected, as the permission questions are, because the log is reached
   * through the container the wiring holds. Optional: a service built without
   * one records nothing, which is what a test that is not about the log
   * wants.
   */
  recordActivity?: (entry: ReleaseActivityEntry) => Promise<void>;
  /**
   * Which of these documents the actor may read, answered as their `id`s.
   *
   * The same visibility question a release's members are put through for a
   * reader, asked here of the documents a member LINKS to, so a link finding
   * never names a target its reader could not open. Wired to the one
   * implementation of it (`services/lib/document-visibility`), batched and
   * failing closed: a document whose readability cannot be decided counts as
   * unreadable. Optional: a service built without it tells an untrusted
   * reader about no linked document at all, only how many there are.
   *
   * @experimental
   */
  readableDocuments?: (
    documents: readonly (DocumentRef & { id: string })[],
    actor: ReleaseActor
  ) => Promise<ReadonlySet<string>>;
}

/**
 * A member as an add answers it: the stored member, and the documents it
 * links to that will not be live at its release's moment, so a client can
 * offer to add them too.
 *
 * @experimental
 */
export type AddedReleaseMember = ReleaseMemberRow & {
  /** @experimental */
  unpublishedLinks: UnpublishedLinksReport;
};

/**
 * The report for a member with nothing to report: a new one each time, since
 * it is handed to the caller, who may change it.
 */
function noUnpublishedLinks(): UnpublishedLinksReport {
  return { links: [], hiddenCount: 0 };
}

/**
 * How long Publish now may spend running the drain before it answers.
 *
 * A request has a time limit the runner's pass does not, and a release past
 * this budget is not lost: it is already due, so the runner finishes it on its
 * next pass, and the answer says it is still going out.
 */
const PUBLISH_NOW_BUDGET_MS = 15_000;

/**
 * The refusal for a change to a release that has finished, saying what to do
 * instead.
 *
 * A published or cancelled release is the record of a launch, and it takes no
 * further change. The person meant to do something real, so the message names
 * the way to do it: a new release.
 */
function finishedReleaseRefusal(
  release: { id: string; state: ReleaseState },
  attempted: string
): NextlyError {
  // Each state named, rather than "not published means cancelled": a caller
  // reaching here with a state that is not final would otherwise be told a
  // release it can still fix is cancelled.
  const message =
    release.state === "published"
      ? "This release has already been published, so it cannot be changed or run again. Create a new release to schedule these documents again."
      : release.state === "cancelled"
        ? "This release is cancelled; create a new release to schedule these documents again."
        : "This release cannot be changed in its current state.";
  return NextlyError.conflict({
    message,
    logContext: {
      reason: "release-is-final",
      releaseId: release.id,
      state: release.state,
      attempted,
    },
  });
}

/**
 * The engine's total order over two members, ascending.
 *
 * The same three keys `resolveReleaseEffect` decides a winner with — instant,
 * then the member's creation time, then its id — because a document's releases
 * are read as a SEQUENCE and the last of them is its final state. Two releases
 * naming one instant is not an edge case, and any comparator that stops at the
 * instant leaves those in the order the driver happened to return, which
 * differs by dialect.
 */
function byEngineOrder(
  a: { scheduledAt: Date; createdAt: Date; memberId: string },
  b: { scheduledAt: Date; createdAt: Date; memberId: string }
): number {
  const byScheduled = a.scheduledAt.getTime() - b.scheduledAt.getTime();
  if (byScheduled !== 0) return byScheduled;
  const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  return a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0;
}

/**
 * Refuse a schedule the driver could not store, before it reaches the driver.
 *
 * A NaN date reaches timestamp encoding and fails differently per dialect, so
 * the caller's mistake would arrive as an opaque database error instead of the
 * sentence naming it. The timezone limit is the narrowest dialect's, for the
 * same reason the title has one: otherwise the call succeeds on two engines
 * and truncates on the third.
 */
function assertUsableSchedule(id: string, at: Date, timezone: string): void {
  if (Number.isNaN(at.getTime())) {
    throw NextlyError.invalidInput({
      message: "`at` is not a valid instant.",
      logContext: { reason: "invalid-schedule-instant", releaseId: id },
    });
  }
  if (timezone.length === 0 || timezone.length > MAX_RELEASE_TIMEZONE_LENGTH) {
    throw NextlyError.invalidInput({
      message: `\`timezone\` must be between 1 and ${MAX_RELEASE_TIMEZONE_LENGTH} characters.`,
      logContext: { reason: "invalid-timezone", length: timezone.length },
    });
  }
}

/** The authorities `capabilities` answers from, each asked once a page. */
interface HeldAuthorities {
  mayPublish: boolean;
  mayCreate: boolean;
  mayUpdate: boolean;
  mayDelete: boolean;
}

/**
 * Whether the release may be scheduled, cancelled or run now, by the same
 * fences those writes take. `held` is how many documents it holds.
 */
function runCapabilities(
  release: ReleaseRow,
  held: number,
  may: HeldAuthorities
): Pick<ReleaseCapabilities, "schedule" | "cancel" | "publishNow"> {
  const { mayRun } = oneDocumentRule(release.kind, held);
  return {
    schedule:
      may.mayPublish &&
      RELEASE_SCHEDULABLE_FROM.includes(release.state) &&
      mayRun,
    cancel: may.mayPublish && RELEASE_CANCELLABLE_FROM.includes(release.state),
    publishNow:
      may.mayPublish &&
      RELEASE_PUBLISHABLE_NOW_FROM.includes(release.state) &&
      mayRun,
  };
}

/**
 * Whether the release's documents, title or the release itself may be
 * changed, by the same rules those writes take.
 */
function editCapabilities(
  release: ReleaseRow,
  held: number,
  may: HeldAuthorities
): Pick<
  ReleaseCapabilities,
  "addMember" | "removeMember" | "update" | "delete"
> {
  // Membership is editable freely in some states and only by a publisher in
  // others, because the drain reads membership AT the instant — so editing a
  // scheduled release changes what a publisher committed to.
  const mayChange = (change: MembershipChange): boolean =>
    may.mayCreate &&
    membershipFence(release.kind, change, may.mayPublish).includes(
      release.state
    );
  return {
    addMember: mayChange("add") && takesAnother(release.kind, held),
    removeMember: mayChange("remove"),
    // Any state, as `update` writes it: the title is a label.
    update: may.mayUpdate,
    delete: may.mayDelete && whyNotDeletable(release) === null,
  };
}

/**
 * Refuse a title the narrowest dialect could not store.
 *
 * ONE limit, applied before the write, because the column is not one shape:
 * `nextly_releases.title` is `varchar(255)` on MySQL and unbounded `text` on
 * PostgreSQL and SQLite. Left to the database, the same call succeeds on two
 * engines and either errors or silently TRUNCATES on the third — and a
 * truncating write returns a row that disagrees with what is stored. Creating
 * and renaming ask this one question.
 */
function assertTitleFits(title: string): void {
  if (title.length > MAX_RELEASE_TITLE_LENGTH) {
    throw NextlyError.invalidInput({
      message: `\`title\` must be ${MAX_RELEASE_TITLE_LENGTH} characters or fewer.`,
      logContext: { reason: "title-too-long", length: title.length },
    });
  }
}

/**
 * What a rename may change: the title, the description, or both.
 *
 * @experimental
 */
export interface ReleaseDetailsChange {
  /** A new title: not empty, and at most {@link MAX_RELEASE_TITLE_LENGTH}. */
  title?: string;
  /** A new description, or `null` to clear it. */
  description?: string | null;
}

/**
 * Refuse a change that is not one, before anything is read.
 *
 * Checked here and not only at the HTTP boundary, because the Direct API is
 * reachable from JavaScript: `title: 42` would otherwise reach the database,
 * and `{}` would be a rename that renames nothing and still moves the release.
 * An empty title is refused as REST's create refuses it, since a release with
 * no name cannot be told from another in any list.
 */
function assertDetailsChange(change: ReleaseDetailsChange): void {
  if (change.title === undefined && change.description === undefined) {
    throw NextlyError.invalidInput({
      message: "Give a `title`, a `description`, or both.",
      logContext: { reason: "empty-release-details-change" },
    });
  }
  if (change.title !== undefined) {
    if (typeof change.title !== "string" || change.title.length === 0) {
      throw NextlyError.invalidInput({
        message: "`title` must be a non-empty string.",
        logContext: { reason: "invalid-title", type: typeof change.title },
      });
    }
    assertTitleFits(change.title);
  }
  if (
    change.description !== undefined &&
    change.description !== null &&
    typeof change.description !== "string"
  ) {
    throw NextlyError.invalidInput({
      message: "`description` must be a string or null.",
      logContext: {
        reason: "invalid-description",
        type: typeof change.description,
      },
    });
  }
}

/**
 * Why this release may not be deleted, or `null` when it may.
 *
 * Only a release that never ran: a draft, or a release cancelled before it
 * was ever scheduled. A cancelled release that WAS scheduled is kept, because
 * nothing stored says whether it began to run: one that stopped part-way and
 * was then cancelled has put content live, and reads like any other cancelled
 * release. `scheduledAt` is the evidence that survives a cancel, so a release
 * that ever had one is kept as the record. A release goes from draft only to
 * scheduled or cancelled, so a draft never carries one.
 *
 * The one answer for the write and for the `delete` capability; the
 * repository's fence states the same rule in its transaction.
 */
function whyNotDeletable(
  release: Pick<ReleaseRow, "state" | "scheduledAt">
): ReleaseNotDeletablePublicData["reason"] | null {
  if (release.state === "published") return "published";
  if (!RELEASE_DELETABLE_FROM.includes(release.state)) return "committed";
  if (release.scheduledAt !== null && release.scheduledAt !== undefined) {
    return "was-scheduled";
  }
  return null;
}

/** What each refusal tells the person, by reason. */
const NOT_DELETABLE_MESSAGES: Record<
  ReleaseNotDeletablePublicData["reason"],
  string
> = {
  published:
    "This release has been published. It stays as the record of what went live, and cannot be deleted.",
  committed:
    "This release is scheduled or stopped, so it can't be deleted. Cancelling it calls it off, and it's then kept as a record.",
  "was-scheduled":
    "This release was scheduled, so it's kept as a record. Cancelled releases that were never scheduled can be deleted.",
};

/**
 * The refusal for deleting a release that may not be deleted: a CONFLICT
 * saying why, with the reason in its data for a client to name.
 */
function notDeletableRefusal(
  release: ReleaseRow,
  reason: ReleaseNotDeletablePublicData["reason"]
): NextlyError {
  return NextlyError.conflict({
    message: NOT_DELETABLE_MESSAGES[reason],
    data: { reason },
    logContext: {
      reason: "release-not-deletable",
      why: reason,
      releaseId: release.id,
      state: release.state,
    },
  });
}

/**
 * Who a rename or deletion is recorded as.
 *
 * An API key is named as a key and never as the person who owns it: the
 * release actor carries the owner's id so the key can be authorized, and a
 * person's name against a change they did not make is a worse record than
 * none. The key's own id is not on the actor, so the entry names the kind
 * alone, which the trail records nothing for (`recordableActor`) — the same
 * answer the Direct API gives a key's content write (`directApiActor`).
 */
function activityActor(actor: ReleaseActor): RequestActor | null {
  if (actor.authenticatedScope?.actorType === "apiKey") {
    return { type: "apiKey" };
  }
  return actor.userId === null ? null : { type: "user", id: actor.userId };
}

/** Whether a row satisfies the qualifiers a list query carries beside `containing`. */
function matchesListQuery(
  row: ReleaseRow,
  query: FindReleasesFilters
): boolean {
  if (query.state !== undefined && row.state !== query.state) return false;
  if (query.kind !== undefined && row.kind !== query.kind) return false;
  return isWithinWindow(row.scheduledAt, query);
}

/** Whether a scheduled instant falls inside a listing's window, if it has one. */
function isWithinWindow(
  scheduledAt: Date | null,
  window: Pick<FindReleasesFilters, "scheduledAfter" | "scheduledBefore">
): boolean {
  const at = scheduledAt?.getTime();
  if (window.scheduledAfter !== undefined) {
    if (at === undefined || at < window.scheduledAfter.getTime()) return false;
  }
  if (window.scheduledBefore !== undefined) {
    if (at === undefined || at > window.scheduledBefore.getTime()) return false;
  }
  return true;
}

/**
 * One member standing between a release and its instant.
 *
 * Named per MEMBER rather than per release, because the fix is per member —
 * remove that document, or restore that user — and a release-level "something
 * is wrong" leaves an operator opening every row to find which.
 */
export interface ReleaseBlocker {
  memberId: string;
  reason: ReleaseBlockerReason;
  /**
   * What this member was going to DO, carried so a reader is not left to guess.
   *
   * A blocked takedown is not a failed publish, and a notice that says "could
   * not be published" about one states the opposite of the truth.
   */
  action: ReleaseMemberAction;
  /**
   * Which document, so the fix names a row rather than an opaque id.
   *
   * `VersionScopeKind` rather than the two values releases accept today: it is
   * the type the member row actually carries, and narrowing it here would be a
   * second, quietly smaller vocabulary for the same field.
   */
  scopeKind: VersionScopeKind;
  scopeSlug: string;
  entryId: string;
}

/** The filters every release listing accepts, whichever ordering it uses. */
interface FindReleasesFilters {
  /**
   * Restrict to one lifecycle state.
   *
   * Typed as the exhaustive union rather than `string`: a typo like
   * `"schedule"` would otherwise be accepted and answered with an empty list and
   * no diagnostic, which reads exactly like "nothing is scheduled".
   */
  state?: ReleaseState;
  /**
   * Restrict to one kind of release: `release` leaves out single-document
   * releases, `single` lists only them. Filtered on the stored kind, never on
   * how many documents a release holds.
   *
   * @experimental
   */
  kind?: ReleaseKind;
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
   * Rows per page: {@link DEFAULT_RELEASE_PAGE_SIZE} when not given, and at
   * most {@link MAX_RELEASE_PAGE_SIZE}.
   */
  limit?: number;
  /**
   * Which page, counting from 1.
   *
   * @experimental
   */
  page?: number;
}

/**
 * The page size a listing gets when it asks for none, and the most it may ask
 * for. Declared once here so the REST route and the Direct API page alike.
 *
 * @experimental
 */
export const DEFAULT_RELEASE_PAGE_SIZE = 50;
/** @experimental */
export const MAX_RELEASE_PAGE_SIZE = 200;

/**
 * The most releases one batch readiness read answers for: the admin list's
 * largest page. Each release's documents are all checked, so the bound is on
 * the work one request can ask for, not only on its length.
 *
 * @experimental
 */
export const MAX_RELEASE_READINESS_BATCH = 50;

/**
 * One release's readiness, as a batch read answers it.
 *
 * `checked: false` for a release holding more documents than a release may
 * now hold, one made before the limit: checking it would be that whole
 * release's worth of reads inside a read of a page, so the batch leaves it to
 * the single read, which checks it in full.
 *
 * @experimental
 */
export type ReleaseReadinessEntry =
  | (ReleaseReadiness & { checked: true })
  | { releaseId: string; checked: false; reason: "over-member-limit" };

/**
 * The release ids a batch read was asked about: each a string, at most `max`
 * of them, duplicates read once. Refused rather than trimmed, because a
 * caller asking for more than it is answered would read the missing ones as
 * having nothing to report.
 */
function releaseIdBatch(
  releaseIds: readonly unknown[],
  max: number,
  name: string
): string[] {
  if (
    !Array.isArray(releaseIds) ||
    releaseIds.some(id => typeof id !== "string")
  ) {
    throw NextlyError.invalidInput({
      message: `\`releaseIds\` must be a list of release ids.`,
      logContext: { reason: `${name}-ids-not-strings` },
    });
  }
  const ids = [...new Set(releaseIds as string[])];
  if (ids.length > max) {
    throw NextlyError.invalidInput({
      message: `At most ${max} releases can be read at once; ${ids.length} were asked for.`,
      logContext: { reason: `${name}-too-many`, asked: ids.length, max },
    });
  }
  return ids;
}

/**
 * The longest search accepted. Well above any title a person types, and a
 * bound on the pattern a caller can hand the database to match against every
 * release.
 *
 * @experimental
 */
export const MAX_RELEASE_SEARCH_LENGTH = 200;

/**
 * One day in a named time zone, as the list's day filter takes it.
 *
 * @experimental
 */
export interface ReleaseDayFilter {
  /** The day, written `YYYY-MM-DD`. */
  date: string;
  /** The IANA zone the day is in, such as `Europe/Berlin`. */
  timezone: string;
}

/**
 * What a calendar read asks for: a window of days in a zone.
 *
 * @experimental
 */
export interface ReleaseCalendarQuery {
  /** The first day, written `YYYY-MM-DD`. */
  from: string;
  /** The last day, included. At most six weeks after `from`. */
  to: string;
  /** The IANA zone the days are in, such as `Europe/Berlin`. */
  timezone: string;
  /** Only releases of this kind: `release` leaves out single-document ones. */
  kind?: ReleaseKind;
}

/**
 * What {@link ReleasesService.count} narrows by: the list's filters, without
 * a page or an order.
 *
 * @experimental
 */
export interface ReleaseCountQuery {
  /**
   * Only the releases placed on this day in this zone, whatever their state:
   * the releases a calendar shows on that day. A published release is placed
   * where it went out, any other where it is scheduled.
   *
   * @experimental
   */
  day?: ReleaseDayFilter;
  tab?: ReleaseTab;
  /** With `tab: "attention"`: only its stopped, or only its overdue, releases. */
  reason?: ReleaseAttentionReason;
  state?: ReleaseState;
  kind?: ReleaseKind;
  scheduledAfter?: Date;
  scheduledBefore?: Date;
  search?: string;
}

/**
 * One page of a release listing, and the size of the whole of it.
 *
 * @experimental
 */
export interface ReleaseListPage {
  /** Carries `memberAction` when the listing was filtered by `containing`. */
  rows: Array<ReleaseRow & { memberAction?: ReleaseMemberAction }>;
  /** Every release the query matches, across all pages. */
  total: number;
  page: number;
  limit: number;
}

/**
 * The order a listing takes when the caller chose none.
 *
 * Soonest first for the scheduled releases — the Upcoming tab, or a plain
 * listing filtered to `scheduled` — because the question asked of them is
 * "what ships next", and latest first answers it with the release furthest
 * out. Latest first otherwise, the order every other listing has always had.
 * One rule, so a REST caller and a Direct API caller cannot disagree.
 */
function defaultOrderFor(query: {
  tab?: ReleaseTab;
  state?: ReleaseState;
  day?: ReleaseDayFilter;
  order?: ReleaseListOrder;
}): ReleaseListOrder {
  if (query.order !== undefined) return query.order;
  // A day's releases read in the order of that day, as the calendar shows
  // them, so the ones it shows on the day are the first of this list.
  return query.tab === "upcoming" ||
    query.state === "scheduled" ||
    query.day !== undefined
    ? "soonest"
    : "latest";
}

/**
 * Refuse a value outside its vocabulary, naming the ones that are inside it.
 *
 * Each would otherwise answer with rows that look right: an unknown tab or
 * state matches nothing and reads as "no releases", and an unknown order falls
 * through to the default end of the timeline.
 */
function assertKnown(
  name: string,
  value: string | undefined,
  allowed: readonly string[]
): void {
  if (value === undefined || allowed.includes(value)) return;
  throw NextlyError.invalidInput({
    message: `\`${name}\` must be one of: ${allowed.join(", ")}.`,
    logContext: { reason: `invalid-${name}`, [name]: value },
  });
}

/**
 * Refuse a window bound that is not a real instant.
 *
 * The Direct API is reachable from JavaScript, where `scheduledAfter:
 * "tomorrow"` or an invalid `Date` would otherwise reach the timestamp
 * comparison and fail there as a database error, or compare differently per
 * dialect.
 */
function assertInstant(name: string, value: unknown): void {
  if (value === undefined) return;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw NextlyError.invalidInput({
      message: `\`${name}\` must be a valid Date.`,
      logContext: { reason: `invalid-${name}` },
    });
  }
}

/**
 * Refuse filters that are each valid but ask two questions at once.
 *
 * A tab is already a set of states, so a tab with a state is a second way of
 * saying which releases to show; and only Upcoming has two meaningful orders,
 * so an `order` on another tab would be silently ignored.
 */
function assertListCombination(query: {
  tab?: ReleaseTab;
  reason?: ReleaseAttentionReason;
  state?: ReleaseState;
  order?: ReleaseListOrder;
}): void {
  if (query.reason !== undefined && query.tab !== "attention") {
    throw NextlyError.invalidInput({
      message:
        '`reason` needs `tab: "attention"`: it names one part of that tab.',
      logContext: { reason: "reason-without-attention-tab", tab: query.tab },
    });
  }
  if (query.tab !== undefined && query.state !== undefined) {
    throw NextlyError.invalidInput({
      message:
        "`tab` and `state` cannot be combined: a tab is already a set of states.",
      logContext: { reason: "tab-with-state", tab: query.tab },
    });
  }
  if (
    query.order !== undefined &&
    query.tab !== undefined &&
    query.tab !== "upcoming"
  ) {
    throw NextlyError.invalidInput({
      message: `\`order\` is only available with the upcoming tab; ${query.tab} has an order of its own.`,
      logContext: { reason: "order-with-tab", tab: query.tab },
    });
  }
}

/**
 * The instants a day filter covers, or `undefined` for none.
 *
 * Checked to be an object first: the Direct API is reachable from JavaScript,
 * where `day: "2026-03-29"` would otherwise read as a day with no date.
 */
function dayWindow(day: unknown): { start: Date; end: Date } | undefined {
  if (day === undefined) return undefined;
  if (day === null || typeof day !== "object") {
    throw NextlyError.invalidInput({
      message:
        "`day` must be an object with a `date` (YYYY-MM-DD) and a `timezone`.",
      logContext: { reason: "invalid-day" },
    });
  }
  const { start, end } = zonedDay({
    date: Reflect.get(day, "date"),
    timezone: Reflect.get(day, "timezone"),
  });
  return { start, end };
}

/**
 * The search as the database should see it, or `undefined` for none.
 *
 * Trimmed, so a stray space typed into the box does not narrow the list to
 * releases containing a space; empty after trimming is no search at all.
 */
function searchText(search: unknown): string | undefined {
  if (search === undefined) return undefined;
  // Checked before it is used as a string: the Direct API is reachable from
  // JavaScript, where `search: 42` would otherwise fail on `.trim()` as a raw
  // TypeError rather than as the refusal every other field gets.
  if (typeof search !== "string") {
    throw NextlyError.invalidInput({
      message: "`search` must be a string.",
      logContext: { reason: "invalid-search", type: typeof search },
    });
  }
  const text = search.trim();
  if (text === undefined || text === "") return undefined;
  if (text.length > MAX_RELEASE_SEARCH_LENGTH) {
    throw NextlyError.invalidInput({
      message: `\`search\` must be ${MAX_RELEASE_SEARCH_LENGTH} characters or fewer.`,
      logContext: { reason: "search-too-long", length: text.length },
    });
  }
  return text;
}

/**
 * A whole number at least `min`, or a refusal naming the field.
 *
 * Checked here and not only at the HTTP boundary, because the Direct API is
 * reachable from JavaScript and a cast: on SQLite `LIMIT -1` means no limit,
 * so an unchecked negative turns a bounded read into a full table scan.
 */
/**
 * A single-document release refusing a second document, saying what to do
 * instead: a single release is one document scheduled on its own, and several
 * documents going out together are an ordinary release.
 */
function singleReleaseHoldsOne(releaseId: string): NextlyError {
  return NextlyError.conflict({
    message:
      'A single-document release holds one document. To release several documents together, put them in an ordinary release (kind "release").',
    logContext: { reason: "single-release-holds-one", releaseId },
  });
}

/**
 * The id a member is checked under before it is written, and named by in a
 * refusal as `null`: it has no id of its own until the write gives it one.
 */
const UNWRITTEN_MEMBER_ID = "";

/** A hard finding as a refusal names it: its code and the member it is about. */
function problemOf(finding: ReadinessFinding): {
  memberId: string | null;
  code: string;
} {
  return {
    memberId:
      finding.memberId === UNWRITTEN_MEMBER_ID ? null : finding.memberId,
    code: finding.code,
  };
}

/**
 * Which way a membership change moves a release's contents: a document in, a
 * document out, or a document's action switched between going live and
 * coming down.
 */
type MembershipChange = "add" | "remove" | "switch";

/**
 * The release states a membership change may land on.
 *
 * The ONE answer, for the write and for the control that offers it: the write
 * hands this list to the repository as its fence, and `capabilities` asks
 * whether the release's state is in it.
 *
 * The assembling states for anyone who may assemble. The committed ones as
 * well only for a caller who may publish, because the drain reads membership
 * at the instant and editing a committed release changes what a publisher
 * committed to. And never for taking the document out of a single release:
 * it holds at most one, so removing from a committed one leaves a launch that
 * runs with nothing and reads as published.
 */
function membershipFence(
  kind: ReleaseKind,
  change: MembershipChange,
  mayChangeCommitted: boolean
): readonly ReleaseState[] {
  if (!mayChangeCommitted) return RELEASE_ASSEMBLABLE_FROM;
  if (kind === "single" && change === "remove") return RELEASE_ASSEMBLABLE_FROM;
  return [
    ...RELEASE_ASSEMBLABLE_FROM,
    ...RELEASE_ASSEMBLABLE_WITH_PUBLISH_FROM,
  ];
}

/**
 * What the one-document rule allows a release holding `held` documents.
 *
 * Every kind but `single` is unconstrained. A single release runs only with
 * its document — with none it would publish nothing and read as done — and
 * takes another only while it holds none. The write paths and `capabilities`
 * both ask this, so a control cannot offer what the write refuses.
 */
function oneDocumentRule(
  kind: ReleaseKind,
  held: number
): { mayRun: boolean; mayTakeAnother: boolean } {
  if (kind !== "single") return { mayRun: true, mayTakeAnother: true };
  return { mayRun: held > 0, mayTakeAnother: held === 0 };
}

/**
 * How many more documents a release holding `held` may take: none once it
 * holds the limit, or more than the limit (a release made before it). The
 * write asks this under the release-row lock, in the insert's transaction, so
 * adds racing for the last place are judged one after another and the limit
 * holds however many arrive at once. The add refusal and `capabilities` both
 * ask this.
 */
function roomFor(held: number): number {
  return Math.max(0, RELEASE_MEMBER_LIMIT - held);
}

/**
 * The refusal for adding to a release holding `held` documents, or null when
 * one more fits. It says how many fit, which is none here; a release made
 * before the limit and over it is told it can still shrink and still runs.
 */
function memberLimitRefusal(
  releaseId: string,
  held: number
): NextlyError | null {
  if (roomFor(held) > 0) return null;
  return NextlyError.conflict({
    message:
      held > RELEASE_MEMBER_LIMIT
        ? `This release holds ${held} documents, more than the ${RELEASE_MEMBER_LIMIT} a release can hold now, so no more fit. Documents can still be removed, and it still runs as scheduled.`
        : `This release holds ${RELEASE_MEMBER_LIMIT} documents, the most a release can hold, so no more fit. Remove one, or start another release.`,
    logContext: {
      reason: "release-member-limit",
      releaseId,
      held,
      limit: RELEASE_MEMBER_LIMIT,
    },
  });
}

/**
 * Whether a release holding `held` documents may take one more: the
 * one-document rule for a single release, and the limit for every release.
 */
function takesAnother(kind: ReleaseKind, held: number): boolean {
  return oneDocumentRule(kind, held).mayTakeAnother && roomFor(held) > 0;
}

function assertWholeNumber(name: string, value: number, min: number): void {
  // A SAFE integer, not merely an integer: `1e308` is an integer to
  // `Number.isInteger`, and the offset worked out from it is `Infinity`, which
  // reaches the database as a driver error rather than a refusal.
  if (!Number.isSafeInteger(value) || value < min) {
    throw NextlyError.invalidInput({
      message: `\`${name}\` must be a whole number of at least ${min}.`,
      logContext: { reason: `invalid-${name}`, [name]: value },
    });
  }
}

/**
 * What a release listing asks for.
 *
 * 🔴 A union on `containing` rather than one flat shape, because the two
 * listings do not offer the same thing. `containing` routes to a different
 * query whose order is part of its CONTRACT -- soonest first, the order the
 * releases will actually be applied to that document -- and `resolveReleaseEffect`
 * reads the last row as the final state. Honouring a caller's `order` there
 * would reverse that and hand the winner's place to the loser.
 *
 * So the combination is unrepresentable rather than merely refused: an author
 * writing `{ containing, order }` learns at compile time, which is where the
 * public docblock on `ReleasesNamespace.find` has always said this. `find`
 * refuses it at runtime too, because a type binds neither JavaScript nor a cast.
 */
export type FindReleasesQuery = FindReleasesFilters &
  (
    | {
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
        /** Always soonest-first; see above. */
        order?: never;
        /** The document's own releases are not a tab of the list. */
        tab?: never;
        reason?: never;
        /** Nor are they searched: a document is in a handful at most. */
        search?: never;
        /** Nor narrowed to a day: they are read in the order they apply. */
        day?: never;
      }
    | {
        containing?: undefined;
        /**
         * One of the list's four views (`release-tabs`). Not combined with
         * `state`: a tab is already a set of states, and the two together
         * would be a second way of saying which releases to show.
         *
         * @experimental
         */
        tab?: ReleaseTab;
        /**
         * With `tab: "attention"`, only its `"stopped"` or only its
         * `"overdue"` releases — for example, to count overdue releases alone.
         *
         * @experimental
         */
        reason?: ReleaseAttentionReason;
        /**
         * Text in the title or the description, without regard to case, matched
         * as written. Applied in the database, before the page and the total.
         *
         * @experimental
         */
        search?: string;
        /**
         * Only the releases placed on this day in this zone, in every state,
         * soonest first unless `order` says otherwise: the day a calendar in
         * that zone shows, read in full and paged. A published release is
         * placed where it went out, any other where it is scheduled.
         *
         * @experimental
         */
        day?: ReleaseDayFilter;
        /**
         * Which end of the timeline comes first.
         *
         * When not given: soonest first for the scheduled releases — the
         * upcoming tab, or `state: "scheduled"` — and latest first otherwise.
         * Asking for the next five releases latest first returns the five
         * FURTHEST OUT, with real rows in a plausible order, so nothing about the
         * result says it is wrong. The other tabs have an order of their own and
         * refuse this.
         */
        order?: ReleaseListOrder;
      }
  );

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
    assertTitleFits(input.title);
    // Checked here as well as typed: the Direct API is reachable from
    // JavaScript, and an unknown kind stored would be a release no filter and
    // no rule recognises.
    assertKnown("kind", input.kind, RELEASE_KINDS);
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
   *
   * A single-document release answers from what it holds as well, by the same
   * rules its writes enforce: no schedule while it is empty, no second
   * document, and no removal once committed. Its members are read in ONE query
   * for every single release on the page, and not at all for a page with none.
   */
  async capabilities(
    releases: readonly ReleaseRow[],
    actor: ReleaseActor
  ): Promise<Map<string, ReleaseCapabilities>> {
    await this.authorize(actor, "read");
    if (releases.length === 0) return new Map();

    const mayPublish = await this.holds(actor, "publish");
    const mayCreate = await this.holds(actor, "create");
    const mayUpdate = await this.holds(actor, "update");
    const mayDelete = await this.holds(actor, "delete");
    const held = await this.heldBy(releases, mayCreate, mayPublish);

    const may = { mayPublish, mayCreate, mayUpdate, mayDelete };
    return new Map(
      releases.map(release => {
        const count = held.get(release.id) ?? 0;
        return [
          release.id,
          {
            ...runCapabilities(release, count, may),
            ...editCapabilities(release, count, may),
          },
        ];
      })
    );
  }

  /**
   * How many documents each release among these holds, keyed by release id,
   * for the ones whose controls depend on it: a single-document release, and
   * any release this caller could still add a document to, which the limit
   * may have filled. One query for all of them, and none when there are none:
   * a release that ran is final and takes nothing whatever it holds.
   */
  private async heldBy(
    releases: readonly ReleaseRow[],
    mayCreate: boolean,
    mayPublish: boolean
  ): Promise<Map<string, number>> {
    // Only where the count can change an answer: a single release's run and
    // add controls, and an ordinary release this caller could add to. A
    // caller who may not add learns `addMember: false` without reading what
    // any release holds.
    const counted = releases
      .filter(
        release =>
          release.kind === "single" ||
          (mayCreate &&
            membershipFence(release.kind, "add", mayPublish).includes(
              release.state
            ))
      )
      .map(release => release.id);
    return this.deps.repository.memberCountsOf(counted);
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
    query: FindReleasesFilters & { containing: DocumentRef },
    now: Date
  ): Promise<Array<ReleaseRow & { memberAction: ReleaseMemberAction }>> {
    const ref = query.containing;
    // ASKED FOR, rather than filtered out of the answer afterwards. The
    // repository's default is the read path's narrow list, so a banner that
    // did not name its states here would receive scheduled releases only and
    // its `blocked` case below could never run — which is exactly what this
    // code did before: the widening sat one layer above the query that had
    // already dropped the rows.
    const grouped = await this.deps.repository.findDueMembersFor(
      [ref],
      now,
      RELEASE_STATES_SHOWN_ON_A_DOCUMENT
    );
    const members = grouped.get(documentRefKey(ref)) ?? [];
    if (members.length === 0) return [];

    const releases = await this.deps.repository.findReleases({
      ids: [...new Set(members.map(member => member.releaseId))],
    });
    const byId = new Map(releases.map(release => [release.id, release]));

    const rows = members
      .flatMap(member => {
        const release = byId.get(member.releaseId);
        // A member whose release vanished between the two reads is dropped
        // rather than rendered without its instant: a row saying a document is
        // scheduled, without saying when, is worse than not mentioning it.
        if (release === undefined) return [];
        // RE-CHECKED against the SECOND read, and that is all this now does:
        // the query above already asked for these states, so this is not the
        // filter but a guard on the window between the two reads. The drain
        // runs in that window; by the time the second read fetches these
        // releases one may already have been published, and emitting it would report an action that has
        // ALREADY HAPPENED as still coming. A reader polling until nothing is
        // pending would then stop on that row and keep the claim forever.
        //
        // `blocked` is kept for the OPPOSITE reason. A release that stopped
        // still holds this document and is still going nowhere, so dropping it
        // makes the document's banner vanish — and a banner disappearing reads
        // as resolved. The editor concludes the release already ran or was
        // called off, when in truth the launch has failed and needs somebody to
        // fix a member. Silence would be worse here than never having shown
        // anything.
        if (!RELEASE_STATES_SHOWN_ON_A_DOCUMENT.includes(release.state))
          return [];
        return [{ ...release, memberAction: member.action, member }];
      })
      // THE ENGINE'S OWN ORDER, not a simpler one that agrees with it most of
      // the time. `resolveReleaseEffect` breaks a tied instant on the member's
      // creation time and then on its id, precisely because two releases can
      // name the same moment and the driver's row order differs by dialect.
      // Sorting on the instant alone leaves those ties in whatever order the
      // database returned, so a reader taking the last row as the final state —
      // which is exactly what this ordering invites — could read the loser.
      //
      // The instant comes from the RE-READ row, not from the member. These are
      // two reads: a release moved between them carries its new time on the row
      // that is displayed, and sorting by the old one renders dates out of
      // order — and, under a limit, keeps rows that are no longer the earliest.
      // The tie-breakers stay the member's, because that is what the engine
      // breaks ties on.
      .sort((a, b) =>
        byEngineOrder(
          { ...a.member, scheduledAt: a.scheduledAt ?? a.member.scheduledAt },
          { ...b.member, scheduledAt: b.scheduledAt ?? b.member.scheduledAt }
        )
      );

    // The document filter NARROWS the list; it does not replace it. A caller
    // combining it with a window or a limit asked for both, and answering with
    // releases outside the window is answering a question nobody put.
    return rows
      .map(({ member, ...row }) => {
        void member;
        return row;
      })
      .filter(row => matchesListQuery(row, query));
  }

  /**
   * One page of releases, and how many match in all.
   *
   * A tab or the plain filters, a search and a page, all applied in the
   * database, so the total and every page cover every release that matches —
   * not only the ones one page happened to hold. Filtered by `containing`, the
   * document's own releases instead, in the order they will be applied to it.
   */
  async find(
    query: FindReleasesQuery,
    actor: ReleaseActor
  ): Promise<ReleaseListPage> {
    await this.authorize(actor, "read");
    // Defaulted only when ABSENT. `??` would also turn a JavaScript caller's
    // `null` into page 1 or the default size, answering a malformed call with
    // a plausible page; given here, null is checked and refused like any other
    // value that is not a whole number.
    const page = query.page === undefined ? 1 : query.page;
    const limit =
      query.limit === undefined ? DEFAULT_RELEASE_PAGE_SIZE : query.limit;
    assertWholeNumber("page", page, 1);
    assertWholeNumber("limit", limit, 1);
    // The offset too: a page that is a safe integer on its own can still put
    // the offset past the range the database is handed exactly.
    assertWholeNumber("page", (page - 1) * limit, 0);
    if (limit > MAX_RELEASE_PAGE_SIZE) {
      throw NextlyError.invalidInput({
        message: `\`limit\` may be at most ${MAX_RELEASE_PAGE_SIZE}.`,
        logContext: { reason: "limit-too-large", limit },
      });
    }
    // Read through a widened view, deliberately: the type above makes these
    // combinations unrepresentable, and a type binds neither a JavaScript caller
    // nor a cast. Refused rather than honoured, because `findContaining`'s
    // soonest-first order is its contract -- `resolveReleaseEffect` takes the
    // LAST row as the final state -- so applying a caller's order there would
    // hand the winner's place to the loser. Refused rather than ignored,
    // because accepting a filter and not applying it answers a different
    // question than the one asked, with rows that look right.
    const asked: FindReleasesFilters & {
      containing?: DocumentRef;
      order?: ReleaseListOrder;
      tab?: ReleaseTab;
      reason?: ReleaseAttentionReason;
      search?: string;
      day?: ReleaseDayFilter;
    } = query;
    if (asked.containing !== undefined) {
      for (const key of ["order", "tab", "reason", "search", "day"] as const) {
        if (asked[key] !== undefined) {
          throw NextlyError.invalidInput({
            message:
              `\`${key}\` is not available with \`containing\`: that listing is a ` +
              "document's own releases, soonest first, the order they will be applied to it.",
            logContext: { reason: `${key}-with-containing` },
          });
        }
      }
      // Validated as the list's are — the state and the window bounds — so a
      // typo or a bound that is not a Date is refused here too, rather than
      // failing or silently not filtering in the in-memory pass below.
      this.listFilters({
        state: asked.state,
        kind: asked.kind,
        scheduledAfter: asked.scheduledAfter,
        scheduledBefore: asked.scheduledBefore,
      });
      // Every release holding one document, which is a handful, so paged in
      // memory after the engine's order is applied rather than in the query.
      const all = await this.findContaining(
        {
          state: asked.state,
          kind: asked.kind,
          scheduledAfter: asked.scheduledAfter,
          scheduledBefore: asked.scheduledBefore,
          containing: asked.containing,
        },
        new Date()
      );
      const offset = (page - 1) * limit;
      return {
        rows: all.slice(offset, offset + limit),
        total: all.length,
        page,
        limit,
      };
    }
    const found = await this.deps.repository.findReleasePage({
      ...this.listFilters(asked),
      order: defaultOrderFor(asked),
      offset: (page - 1) * limit,
      limit,
    });
    return { rows: found.rows, total: found.total, page, limit };
  }

  /**
   * How many releases a listing holds, without reading them.
   *
   * What a page outside Releases asks — "how many need attention?" — answered
   * by the list's own rules, so a count shown elsewhere is always the count the
   * list would show.
   *
   * @experimental
   */
  async count(query: ReleaseCountQuery, actor: ReleaseActor): Promise<number> {
    await this.authorize(actor, "read");
    return this.deps.repository.countReleases(this.listFilters(query));
  }

  /**
   * The list's filters, checked, as the repository takes them.
   *
   * Each refusal is one a caller can act on, and each guards against an answer
   * that would look right while being wrong: an unknown tab or state would
   * otherwise match nothing and read as "no releases", and an `order` on a tab
   * that has its own would be silently ignored.
   */
  private listFilters(
    query: ReleaseCountQuery & { order?: ReleaseListOrder }
  ): Omit<ReleasePageQuery, "offset" | "limit"> {
    assertKnown("tab", query.tab, RELEASE_TABS);
    assertKnown("state", query.state, RELEASE_STATES);
    assertKnown("kind", query.kind, RELEASE_KINDS);
    assertKnown("order", query.order, RELEASE_LIST_ORDERS);
    assertKnown("reason", query.reason, RELEASE_ATTENTION_REASONS);
    assertInstant("scheduledAfter", query.scheduledAfter);
    assertInstant("scheduledBefore", query.scheduledBefore);
    assertListCombination(query);
    return {
      tab: query.tab,
      reason: query.reason,
      state: query.state,
      kind: query.kind,
      scheduledAfter: query.scheduledAfter,
      scheduledBefore: query.scheduledBefore,
      placedWithin: dayWindow(query.day),
      search: searchText(query.search),
      // One clock reading per request, so a release cannot be judged overdue
      // for the count and not for the page it is on.
      now: new Date(),
    };
  }

  /**
   * A calendar of the releases in a window of days in a zone.
   *
   * Every day of the window, in order, empty ones included, each with its
   * complete count of releases by state and its first releases in time order.
   * A release is on the day, in `timezone`, of the instant that says when it
   * happens: a published release on the day it went out (`publishedAt`), so
   * one the runner reached late is on the day it really went live; every
   * other state on the day of its scheduled instant, so a stopped one is on
   * the day it was due and a cancelled one that had been scheduled on the day
   * it would have run. A draft has no instant and is on no day.
   *
   * The days and their instants are worked out before the read, so a window
   * that is inverted, longer than six weeks, or in an unknown zone is refused
   * without touching the database.
   *
   * @experimental
   */
  async calendar(
    query: ReleaseCalendarQuery,
    actor: ReleaseActor
  ): Promise<ReleaseCalendar> {
    await this.authorize(actor, "read");
    assertKnown("kind", query.kind, RELEASE_KINDS);
    const days = zonedDays(query);
    return {
      timezone: query.timezone,
      from: query.from,
      to: query.to,
      days: await this.deps.repository.findReleaseCalendar({
        days,
        kind: query.kind,
        perDay: RELEASE_CALENDAR_RELEASES_PER_DAY,
      }),
    };
  }

  /**
   * Why this release cannot proceed, worked out from its members right now.
   *
   * DERIVED rather than stored, and that is the whole design. Every reason a
   * release blocks is a fact about a member that is still true when the row is
   * read — no author recorded, an author who is gone, a locale-scoped member —
   * so recording the reason at block time would create a second copy that goes
   * stale the moment somebody fixes the cause. An operator who restores the
   * deleted user would still be told the author is missing, and the only way
   * out would be to reschedule and watch it block again.
   *
   * A narrower view of {@link readiness}: the findings of its `core.author`
   * source, which are exactly these three reasons, so the two cannot disagree
   * about them.
   */
  async blockingReasons(
    releaseId: string,
    actor: ReleaseActor
  ): Promise<ReleaseBlocker[]> {
    await this.authorize(actor, "read");
    const release = await this.requireRelease(releaseId);
    const members = await this.deps.repository.listMembers(release.id);
    const { hard } = await this.checkMembers(release, members, [
      CORE_AUTHOR_SOURCE,
    ]);
    return hard.map(finding => ({
      memberId: finding.memberId,
      reason: finding.code,
      // Carried so a reader is not left with an opaque id and a sentence
      // that assumes a publish: a blocked takedown is not a failed publish.
      action: finding.action,
      scopeKind: finding.scopeKind,
      scopeSlug: finding.scopeSlug,
      entryId: finding.entryId,
    }));
  }

  /**
   * Every problem the release's documents have now, hard ones (which stop it
   * from being scheduled or published now) apart from soft ones (notes), each
   * in the order its documents were added.
   *
   * Every member is checked, however many the release holds, and the answer is
   * given only once all of them are: a problem in the last document of a large
   * release is reported like one in the first. Worked out on each call, so a
   * problem somebody fixed reads as fixed on the next one.
   *
   * @experimental
   */
  async readiness(
    releaseId: string,
    actor: ReleaseActor
  ): Promise<ReleaseReadiness> {
    await this.authorize(actor, "read");
    const release = await this.requireRelease(releaseId);
    const members = await this.deps.repository.listMembers(release.id);
    const found = await this.checkMembers(
      release,
      members,
      registeredReleaseCheckSources()
    );
    // A linked document the reader may not read is counted, not named.
    [found.soft] = await this.narrowLinksFor([found.soft], actor);
    return { releaseId: release.id, ...found };
  }

  /**
   * How many documents each of these releases holds, and how many it puts
   * live and takes down, for a page of the list in one read.
   *
   * Every release asked about is answered, one holding nothing (or not
   * there) with zeros, so a missing entry never has to be read as "none".
   * Under the same authority as the list it summarises.
   *
   * @experimental
   */
  async memberCounts(
    releaseIds: readonly string[],
    actor: ReleaseActor
  ): Promise<Record<string, ReleaseMemberCounts>> {
    await this.authorize(actor, "read");
    const ids = releaseIdBatch(
      releaseIds,
      MAX_RELEASE_PAGE_SIZE,
      "member-counts"
    );
    const counts = await this.deps.repository.memberActionCountsOf(ids);
    return Object.fromEntries(
      ids.map(id => [
        id,
        counts.get(id) ?? { total: 0, goLive: 0, comeDown: 0 },
      ])
    );
  }

  /**
   * {@link readiness} for a page of releases at once, in the order asked.
   *
   * The single read's own path: the same authorization, the same sources,
   * the same per-release evaluation over the release's members in the order
   * the single read takes them, so each entry is exactly what reading that
   * release alone would answer. Only the reads are shared: the releases,
   * their member counts and their members come in one query each instead of
   * one per release, and members are read only for releases within the
   * limit.
   *
   * A release that does not exist is left out, as the single read would have
   * answered not found for it. One holding more documents than the limit is
   * returned unchecked (see {@link ReleaseReadinessEntry}).
   *
   * @experimental
   */
  async readinessOf(
    releaseIds: readonly string[],
    actor: ReleaseActor
  ): Promise<ReleaseReadinessEntry[]> {
    await this.authorize(actor, "read");
    const ids = releaseIdBatch(
      releaseIds,
      MAX_RELEASE_READINESS_BATCH,
      "readiness"
    );
    if (ids.length === 0) return [];
    const releases = await this.deps.repository.findReleases({ ids });
    // Counted before anything is loaded, so a release holding more than the
    // limit has none of its documents read: the batch is bounded by the
    // limit, not by what a release made before it happens to hold.
    const held = await this.deps.repository.memberCountsOf(ids);
    const checkable = ids.filter(
      id => (held.get(id) ?? 0) <= RELEASE_MEMBER_LIMIT
    );
    const membersByRelease = new Map<string, ReleaseMemberRow[]>();
    for (const member of await this.deps.repository.listMembersInOrderOf(
      checkable
    )) {
      const held = membersByRelease.get(member.releaseId) ?? [];
      held.push(member);
      membersByRelease.set(member.releaseId, held);
    }
    const byId = new Map(releases.map(release => [release.id, release]));
    const entries: ReleaseReadinessEntry[] = [];
    for (const id of ids) {
      const release = byId.get(id);
      if (release === undefined) continue;
      if ((held.get(id) ?? 0) > RELEASE_MEMBER_LIMIT) {
        entries.push({
          releaseId: id,
          checked: false,
          reason: "over-member-limit",
        });
        continue;
      }
      const found = await this.checkMembers(
        release,
        membersByRelease.get(id) ?? [],
        registeredReleaseCheckSources()
      );
      // As the single read narrows it.
      [found.soft] = await this.narrowLinksFor([found.soft], actor);
      entries.push({ releaseId: id, ...found, checked: true });
    }
    return entries;
  }

  /**
   * Each of these lists of soft findings as `actor` may be told them: a link
   * whose target the actor may not read is counted, not named
   * ({@link narrowLinkFindings}). One readability question for every list,
   * and none for a trusted actor, who may read everything.
   */
  private async narrowLinksFor(
    lists: readonly ReadinessFinding[][],
    actor: ReleaseActor
  ): Promise<ReadinessFinding[][]> {
    if (actor.overrideAccess === true) return [...lists];
    // Each linked document asked about once, its document key as its id.
    const refs = new Map<string, DocumentRef & { id: string }>();
    for (const finding of lists.flat()) {
      const target = linkTargetOf(finding);
      if (target === null) continue;
      const ref: DocumentRef = {
        scopeKind: "collection",
        scopeSlug: target.collection,
        entryId: target.entryId,
        locale: null,
      };
      refs.set(documentRefKey(ref), { ...ref, id: documentRefKey(ref) });
    }
    if (refs.size === 0) return [...lists];
    const readable =
      this.deps.readableDocuments === undefined
        ? new Set<string>()
        : await this.deps.readableDocuments([...refs.values()], actor);
    return lists.map(findings =>
      narrowLinkFindings(findings, target =>
        readable.has(
          documentRefKey({
            scopeKind: "collection",
            scopeSlug: target.collection,
            entryId: target.entryId,
            locale: null,
          })
        )
      )
    );
  }

  /**
   * The documents `member` links to that will not be live at `release`'s
   * moment, as `actor` may be told them: the link check's findings for that
   * one member, narrowed as a readiness read narrows them. Nothing for a
   * document coming down, or where the check is not registered.
   */
  private async unpublishedLinksOf(
    release: ReleaseRow,
    member: ReleaseMemberRow,
    actor: ReleaseActor
  ): Promise<UnpublishedLinksReport> {
    const sources = releaseCheckSources().filter(
      source => source.key === UNPUBLISHED_LINKS_SOURCE_KEY
    );
    if (sources.length === 0 || member.action !== "publish") {
      return noUnpublishedLinks();
    }
    const { soft } = await this.checkMembers(release, [member], sources);
    const [narrowed] = await this.narrowLinksFor([soft], actor);
    return unpublishedLinksReport(narrowed);
  }

  /**
   * Run these sources over these members of this release.
   *
   * Private, and reachable only after an authorization: the caller has to have
   * decided already, because nothing here checks. Scheduling authorizes
   * `publish` and then needs this answer; demanding `read` as well would refuse
   * an API key scoped to `publish-content-releases` alone.
   */
  private checkMembers<Code extends string>(
    release: ReleaseRow,
    members: readonly ReleaseMemberRow[],
    sources: readonly ReleaseCheckSource<Code>[]
  ): Promise<Omit<ReleaseReadiness<Code>, "releaseId">> {
    const now = new Date();
    const repository = this.deps.repository;
    return evaluateReadiness({
      release,
      members,
      sources,
      now,
      reads: {
        ...this.deps.checks,
        liveAuthors: ids => repository.liveAuthors([...ids]),
        // The condition a document met to join (`resolveReleaseTarget`),
        // asked of the same reader.
        declaresLifecycle: scope =>
          this.deps.targets.declaresLifecycle(
            scope.scopeKind === "single" ? "single" : "collection",
            scope.scopeSlug
          ),
        scheduledMemberships: refs =>
          repository.findDueMembersFor([...refs], now),
      },
    });
  }

  /**
   * Refuse while any of these members has a hard problem, naming each as a
   * code and the member it is about. One refusal for every door — scheduling,
   * Publish now, adding to a scheduled release and switching an action — so
   * REST and the Direct API answer alike.
   */
  private async assertNoHardProblems(
    release: ReleaseRow,
    members: readonly ReleaseMemberRow[],
    refusal: { message: string; reason: string }
  ): Promise<void> {
    const hardSources = registeredReleaseCheckSources().filter(
      source => source.severity === "hard"
    );
    const { hard } = await this.checkMembers(release, members, hardSources);
    if (hard.length === 0) return;
    throw NextlyError.conflict({
      message: refusal.message,
      data: { problems: hard.map(problemOf) },
      logContext: {
        reason: refusal.reason,
        releaseId: release.id,
        problems: hard.length,
        state: release.state,
      },
    });
  }

  /**
   * The release this id names, or a refusal.
   *
   * Its members and its problems are both empty lists when it does not exist,
   * and an empty list is also the honest answer for a release with no members —
   * so without this a typo or a deleted release reads as "nothing in it, nothing
   * wrong". Asked after authorization, so a caller who may not read releases
   * learns nothing about which ids exist.
   */
  private async requireRelease(releaseId: string): Promise<ReleaseRow> {
    const [release] = await this.deps.repository.findReleases({
      ids: [releaseId],
    });
    if (release === undefined) {
      throw NextlyError.notFound({
        logContext: { reason: "release-not-found", releaseId },
      });
    }
    return release;
  }

  async listMembers(
    releaseId: string,
    actor: ReleaseActor
  ): Promise<ReleaseMemberRow[]> {
    await this.authorize(actor, "read");
    await this.requireRelease(releaseId);
    return this.deps.repository.listMembers(releaseId);
  }

  /**
   * Put a document into a release, under a lifecycle action.
   *
   * Two authorities, for the reason in the module docblock: `create` to assemble
   * the release, and the document's own `publish`/`unpublish` so that scheduling
   * cannot become a way to perform a write the caller could not perform now.
   *
   * Answers the stored member with `unpublishedLinks`: for a document going
   * live, what it links to that will not be live at the release's moment,
   * naming only documents the caller may read and counting the rest. Empty
   * for a document coming down.
   *
   * @experimental The `unpublishedLinks` field.
   */
  async addMember(
    releaseId: string,
    input: AddMemberInput,
    actor: ReleaseActor
  ): Promise<AddedReleaseMember> {
    await this.authorize(actor, "create");
    await this.authorizeDocumentAction(actor, input.scopeSlug, input.action);
    requireRunnableMember(input, actor);
    // The target checks, for every caller: REST, the Direct API and the admin
    // alike. A precondition, so before anything is written; for a Single it
    // also replaces the id the caller sent with the row's own.
    const entryId = await resolveReleaseTarget(
      this.deps.targets,
      {
        scopeKind: input.scopeKind,
        scopeSlug: input.scopeSlug,
        entryId: input.entryId,
      },
      {
        userId: actor.userId,
        trusted: actor.overrideAccess === true,
        authenticatedScope: actor.authenticatedScope,
        userRoles: actor.userRoles,
      }
    );

    // Every refusal below is answered BEFORE the write, which is the only
    // statement that changes the release. Keyed by the RESOLVED id: for a
    // Single that is the row's own, whatever the caller sent, so the same
    // Single again is the duplicate it is.
    const memberKey = releaseMemberKey(releaseId, { ...input, entryId });
    const [release] = await this.deps.repository.findReleases({
      ids: [releaseId],
    });
    // A committed release is a publisher's to change. Asked before anything
    // about its contents is answered, so a caller without that authority
    // learns nothing of what the release holds.
    if (
      release !== undefined &&
      RELEASE_ASSEMBLABLE_WITH_PUBLISH_FROM.includes(release.state)
    ) {
      await this.authorize(actor, "publish");
    }
    // The early answer for the common case. The guarantee is the database's:
    // two adds racing past this both reach the insert, and the single-slot
    // index refuses the second (translated below).
    if (await this.singleReleaseHoldsAnother(release, memberKey)) {
      throw singleReleaseHoldsOne(releaseId);
    }

    // The states this add may land on, judged from the read above, and the
    // author checked, before the member is written.
    const allowedStates = await this.judgeMembershipChange(
      release,
      releaseId,
      "add",
      actor
    );
    await this.requireLiveAuthor(actor.userId);
    const unwritten: ReleaseMemberRow = {
      id: UNWRITTEN_MEMBER_ID,
      releaseId,
      scopeKind: input.scopeKind,
      scopeSlug: input.scopeSlug,
      entryId,
      locale: input.locale ?? null,
      action: input.action,
      memberKey,
      singleSlot: null,
      createdBy: actor.userId,
      createdAt: new Date(),
    };
    // A document joining a release already committed to an instant is checked
    // first, as scheduling checked the rest: otherwise one with a hard problem
    // joins and stops the release at its instant. Refused, the release stays
    // scheduled as it was. A release judged still assembling is not checked
    // here, and the fence below keeps this add off one scheduled since.
    await this.assertCommittedChangeReady(release, unwritten);
    // What the document links to that will not be live at the moment, so the
    // answer can offer those too. Worked out before the write, so a read that
    // fails refuses the add with nothing written rather than failing an add
    // that has already landed.
    const unpublishedLinks =
      release === undefined
        ? noUnpublishedLinks()
        : await this.unpublishedLinksOf(release, unwritten, actor);

    try {
      // FENCED on the judgement: the member and a bump of the release's
      // revision are one transaction that lands only while the release is in
      // `allowedStates`. A publisher scheduling between the judgement and this
      // write makes it refuse rather than add to a committed launch without
      // the publish gate, and a schedule judged before it misses on the
      // revision instead. Refused as a CONFLICT, with nothing written.
      const added = await this.deps.repository.addMember(
        {
          ...input,
          entryId,
          releaseId,
          // Never a caller-supplied author. Materialisation performs each
          // member as its recorded author, so an author a caller could name
          // would be an identity they could borrow at a future instant.
          createdBy: actor.userId,
        },
        allowedStates,
        // The member limit, judged under the release lock and after every
        // other refusal: a final release says it is final, not how much it
        // holds, and adds racing for the last place are judged one by one.
        held => memberLimitRefusal(releaseId, held)
      );
      return { ...added, unpublishedLinks };
    } catch (error) {
      // The `memberKey` unique index is what stops one document being scheduled
      // twice in one release; its refusal rolls the revision bump back with
      // the insert, so nothing is written. Translated here so callers meet
      // this package's stable error contract rather than the adapter's
      // DatabaseError — and narrowly, so an unexpected database failure still
      // propagates. A fence miss is a CONFLICT already, and passes through.
      if (isUniqueViolation(error)) {
        // Two unique indexes can refuse this insert: the single-slot one, when
        // a single release already holds another document, and the member key,
        // when this document is already in the release. Told apart by what the
        // release holds now, not by the error, whose wording is the driver's.
        if (await this.singleReleaseHoldsAnother(release, memberKey)) {
          throw singleReleaseHoldsOne(releaseId);
        }
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

    const [release] = await this.deps.repository.findReleases({
      ids: [member.releaseId],
    });
    await this.assertNotEmptyingCommittedSingle(release, actor);
    const allowedStates = await this.judgeMembershipChange(
      release,
      member.releaseId,
      "remove",
      actor
    );
    // FENCED on the judgement, as the add is, and it matters more here:
    // removing an `unpublish` member cancels a committed takedown, so a
    // publisher scheduling between the judgement and the delete would have
    // their decision undone by a caller who never passed the publish gate.
    // The delete and a bump of the release's revision are one transaction
    // that lands only while the release is in `allowedStates`; otherwise it is
    // refused as a CONFLICT and the member stays.
    await this.deps.repository.removeMember(member, allowedStates);
  }

  /**
   * Switch a document in a release between going live and coming down.
   *
   * Asked as adding it under the new action is: `create` to assemble the
   * release, the caller's own authority for the new action, and `publish` for
   * a release committed to an instant. The member's author does not change —
   * the run still acts as whoever added it — so in a committed release the new
   * action is checked as that author, and a switch that would leave a hard
   * problem, such as an author who may publish the document but not unpublish
   * it, is refused with the release left as it was.
   *
   * @experimental
   */
  async changeMemberAction(
    memberId: string,
    action: ReleaseMemberAction,
    actor: ReleaseActor,
    /** The release the caller believes this member belongs to, when it knows. */
    expectedReleaseId?: string
  ): Promise<ReleaseMemberRow> {
    await this.authorize(actor, "create");
    assertKnownAction(action);
    const member = await this.deps.repository.findMember(memberId);
    // A member that is not there, or that belongs to a release the caller did
    // not name, is not followed: there is nothing to switch, and a stale
    // client URL would otherwise edit a release it never addressed.
    if (
      member === undefined ||
      (expectedReleaseId !== undefined &&
        member.releaseId !== expectedReleaseId)
    ) {
      throw NextlyError.notFound({
        logContext: {
          reason: "release-member-not-found",
          memberId,
          expectedReleaseId,
        },
      });
    }
    await this.authorizeDocumentAction(actor, member.scopeSlug, action);
    const [release] = await this.deps.repository.findReleases({
      ids: [member.releaseId],
    });
    const allowedStates = await this.judgeMembershipChange(
      release,
      member.releaseId,
      "switch",
      actor
    );
    // Checked for the action asked, whatever the member held when it was read:
    // another switch may commit before this one, and what this one leaves is
    // the member under the action asked.
    await this.assertCommittedChangeReady(release, { ...member, action });
    // FENCED on the judgement, as an add and a removal are: a release
    // committed after it was judged refuses the switch rather than take one
    // its publisher never approved, and nothing is written then. A member
    // already under the action, as stored, is answered without a write.
    return this.deps.repository.changeMemberAction(
      member,
      action,
      allowedStates
    );
  }

  /**
   * The release states a membership change may land on, judged from a read of
   * the release — or the refusal, when it may not happen at all.
   *
   * A judgement, not a guarantee: the release can move after it is read, so
   * the answer is handed to the repository write as its fence, and a release
   * that moved makes the write refuse. Asked after every other precondition
   * the caller has, and before the write.
   */
  private async judgeMembershipChange(
    release: ReleaseRow | undefined,
    releaseId: string,
    change: MembershipChange,
    actor: ReleaseActor
  ): Promise<readonly ReleaseState[]> {
    // No dialect declares a foreign key from a member to its release, so a
    // mistyped id would otherwise insert a row no drain will ever find.
    if (release === undefined) {
      throw NextlyError.notFound({
        logContext: { reason: "release-not-found", releaseId },
      });
    }
    if (RELEASE_ASSEMBLABLE_FROM.includes(release.state)) {
      // The assembling states only, whatever else the caller may do: they
      // were not asked for the publish authority, so a release committed
      // since must refuse this change rather than take it.
      return membershipFence(release.kind, change, false);
    }
    if (RELEASE_ASSEMBLABLE_WITH_PUBLISH_FROM.includes(release.state)) {
      // Changing what is in a scheduled release changes what goes live at an
      // instant a publisher committed to. The drain reads membership at the
      // instant, not at scheduling time.
      //
      // Read from the declaration rather than compared to a literal, so this
      // and the `can.addMember` the client renders from cannot come apart: a
      // state added to that list must authorize the same way here, or the UI
      // offers an edit the write refuses.
      await this.authorize(actor, "publish");
      return membershipFence(release.kind, change, true);
    }
    // Published or cancelled: final, so this is work that cannot happen
    // rather than work someone is not allowed to do — and the refusal says
    // what to do instead.
    throw finishedReleaseRefusal(release, "change-members");
  }

  /**
   * Refuse a membership change to a committed release that would leave this
   * member with a hard problem. A release still being assembled is not
   * checked: scheduling it checks every member.
   */
  private async assertCommittedChangeReady(
    release: ReleaseRow | undefined,
    member: ReleaseMemberRow
  ): Promise<void> {
    if (
      release === undefined ||
      !RELEASE_ASSEMBLABLE_WITH_PUBLISH_FROM.includes(release.state)
    ) {
      return;
    }
    await this.assertNoHardProblems(release, [member], {
      message:
        "This document cannot go into the scheduled release until its problems are fixed. The release is still scheduled.",
      reason: "release-member-not-ready",
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
  /**
   * Refuse a release that has reached its size bound.
   *
   * Counted from the members themselves rather than a stored total, for the
   * reason the blocker reasons are derived: a cached count drifts the moment a
   * member is removed by another route, and a cap enforced from a stale number
   * refuses a release that has room.
   */
  /**
   * Whether this is a single-document release already holding a document
   * other than the one named by `memberKey`. The same document again is not
   * this refusal but the duplicate one.
   */
  private async singleReleaseHoldsAnother(
    release: ReleaseRow | undefined,
    memberKey: string
  ): Promise<boolean> {
    if (release?.kind !== "single") return false;
    const held = await this.deps.repository.listMembers(release.id);
    // Counted WITHOUT this document, so the same document again is left for
    // the duplicate refusal to name.
    const others = held.filter(member => member.memberKey !== memberKey);
    return !oneDocumentRule(release.kind, others.length).mayTakeAnother;
  }

  /**
   * Refuse taking the only document out of a committed single-document
   * release: it would run with nothing and read as published. Cancelling is
   * the way to call it off.
   *
   * The early answer, with the sentence that says so. The guarantee is the
   * removal's fence, which for a single release never admits a committed
   * state (`membershipFence`) — this asks that same rule, so the two cannot
   * disagree about which releases it covers.
   */
  private async assertNotEmptyingCommittedSingle(
    release: ReleaseRow | undefined,
    actor: ReleaseActor
  ): Promise<void> {
    if (
      release === undefined ||
      !RELEASE_ASSEMBLABLE_WITH_PUBLISH_FROM.includes(release.state)
    ) {
      return;
    }
    // A committed release is a publisher's to change, and that is asked
    // first, so a caller without the authority learns nothing of its kind.
    await this.authorize(actor, "publish");
    if (membershipFence(release.kind, "remove", true).includes(release.state)) {
      return;
    }
    throw NextlyError.conflict({
      message:
        "This single-document release is scheduled with this one document. Cancel the release instead of removing it.",
      logContext: {
        reason: "single-release-would-empty",
        releaseId: release.id,
      },
    });
  }

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
    assertUsableSchedule(id, at, timezone);
    // A release is refused while anything that would stop it is still true,
    // WHATEVER state it is scheduled from. Scheduling it would reach the
    // instant, hit the same member and stop — and the operator would learn
    // that only by waiting for a launch that does not happen.
    //
    // For EVERY schedulable state, not only `blocked`, and the symmetry is the
    // point. A release whose author was deleted while it sat `scheduled` is the
    // same broken release as one the drain has already labelled, and it becomes
    // the labelled one at its instant; refusing the first while accepting the
    // second makes the rule depend on whether a background pass happened to
    // have run yet, which is not something the person scheduling can see. The
    // ordinary postponement after a colleague leaves is exactly this case.
    //
    // The cost is bounded and falls on a human action rather than a read path:
    // one query for the members, and a second for their authors only when
    // there are any. Scheduling is not a hot path, and the alternative is
    // spending it at the instant instead, when nobody is watching.
    //
    // Read FIRST, before the membership is: the revision it carries is what
    // the write below is fenced on, so a membership change landing after this
    // read — even one between the membership check and the write — makes the
    // write miss.
    const [current] = await this.deps.repository.findReleases({ ids: [id] });
    if (current !== undefined && RELEASE_FINAL_STATES.includes(current.state)) {
      throw finishedReleaseRefusal(current, "schedule");
    }
    const wasBlocked = current?.state === "blocked";
    await this.assertReadyToRun(id, current);

    // FENCED ON THE STATE THE VERDICT ABOVE WAS FORMED AGAINST, which is what
    // makes the check and the write one decision rather than two.
    //
    // The read and this write are separated by the blocker derivation, and the
    // drain runs in that window. Both interleavings are refused rather than
    // silently accepted:
    //
    //   - Read `scheduled`, so no blockers were examined; the drain then blocks
    //     the release. Fencing on the full schedulable list would accept
    //     `blocked` here and reschedule a release whose permanent blockers
    //     nobody looked at — it would reach the new instant and stop again.
    //     Excluding `blocked` makes that update match nothing.
    //   - Read `blocked` and found it clean; something reschedules or cancels
    //     it first. Fencing on `blocked` alone refuses, rather than overwriting
    //     a decision made after the verdict.
    //
    // Either way the caller is told, and a retry re-derives against what is
    // now true.
    //
    // AND FENCED ON THE REVISION THE READ CARRIED, for what the state cannot
    // show. A member removed after the checks above leaves a draft a draft,
    // and a state-only fence would then schedule a single release with
    // nothing in it. Every membership change bumps the revision in the same
    // transaction as its write, so this update matches nothing once one has
    // landed since the read.
    //
    // A compare-and-set rather than a transaction, and that is now a choice
    // rather than a constraint — the port gained one for the drain's blocking
    // pass. It is the right choice here: a transaction would have to span the
    // read, an identity lookup for the blockers and the write, holding row
    // locks across a query that touches another table entirely, to buy a
    // guarantee this single fenced UPDATE already provides. The blocking pass
    // needs a transaction because it writes to SEVERAL rows that must move
    // together; this writes to one.
    const from = wasBlocked
      ? RELEASE_SCHEDULABLE_FROM_BLOCKED
      : RELEASE_SCHEDULABLE_FROM_UNBLOCKED;

    // The fence answers `false` for a release whose current state forbids the
    // move — a published one, most importantly, because re-scheduling it makes
    // the drain re-apply members against documents that have changed since —
    // and for one that changed since the read. A release that is not there has
    // no revision to fence on, and gets the same answer without a write.
    // Reported as a CONFLICT rather than swallowed: a caller told nothing would
    // read a no-op as a schedule that took.
    if (
      current === undefined ||
      !(await this.deps.repository.scheduleRelease(
        id,
        at,
        timezone,
        from,
        current.revision
      ))
    ) {
      throw NextlyError.conflict({
        logContext: { reason: "release-not-schedulable", releaseId: id },
      });
    }
  }

  /**
   * Refuse a release that could not run as it stands: one whose documents have
   * a hard problem, or a single-document release with no document.
   *
   * The one precondition scheduling and Publish now both make before they
   * write, so a release either may run at its instant or may run now, never
   * one and not the other.
   */
  private async assertReadyToRun(
    id: string,
    current: ReleaseRow | undefined
  ): Promise<void> {
    await this.assertNothingBlocks(current);
    // A single-document release is one document scheduled on its own: with
    // none it would run and publish nothing, and read as done. The rule is the
    // one capabilities answer from, and its members are read only for that
    // kind, so an ordinary release pays nothing for it.
    if (
      current?.kind === "single" &&
      !oneDocumentRule(
        current.kind,
        (await this.deps.repository.listMembers(id)).length
      ).mayRun
    ) {
      throw NextlyError.conflict({
        message:
          "A single-document release needs its document before it can be scheduled. Add it, then schedule.",
        logContext: { reason: "single-release-empty", releaseId: id },
      });
    }
  }

  /**
   * Refuse a release whose documents have a hard problem.
   *
   * Only for a state the fence could actually accept. A terminal state —
   * `published` above all — is refused by the fence whatever its members look
   * like, and checking them first would answer with the wrong sentence:
   * "fix or remove the documents blocking it" describes a recovery that does
   * not exist there, because `RELEASE_ASSEMBLABLE_FROM` excludes `published`
   * and `removeMember` refuses. An operator would be sent to do something the
   * product will not let them do, instead of being told the release has
   * already happened.
   *
   * A release that is not there at all takes the same path: there is nothing
   * to check, and the fence reports it as unschedulable.
   */
  private async assertNothingBlocks(
    current: ReleaseRow | undefined
  ): Promise<void> {
    if (
      current === undefined ||
      !RELEASE_SCHEDULABLE_FROM.includes(current.state)
    ) {
      return;
    }
    await this.assertNoHardProblems(
      current,
      await this.deps.repository.listMembers(current.id),
      {
        message:
          "This release cannot be scheduled until the documents blocking it are fixed or removed.",
        reason: "release-still-blocked",
      }
    );
  }

  /**
   * Run a release now, with the same checks and the same all-together run as
   * at a scheduled time.
   *
   * Publish now is a scheduled run that does not wait, not a second way of
   * publishing: the release is scheduled for this moment, and then the
   * runner's own releases drain job is run at once, under the same claim a
   * scheduled pass takes. Like any pass, it sends out every release that is
   * due, this one among them, and settles releases sharing a document
   * together. A release already scheduled at or before now is due as it
   * stands, so it is not moved: the drain's claim is what keeps two runs
   * apart, and moving a due release again would make a drain already running
   * it leave it unfinished for the next pass.
   *
   * Answers the release as it stands afterwards: `published`; `blocked` when
   * a document stopped it part-way; or still `scheduled` when the budget ran
   * out, a document could not be written yet, another runner was already
   * running the drain (or it is waiting to retry), or the drain could not be
   * started. A `scheduled` release is due, so that runner or the next pass
   * finishes it.
   *
   * @experimental
   */
  async publishNow(id: string, actor: ReleaseActor): Promise<ReleaseRow> {
    await this.authorize(actor, "publish");
    const current = await this.publishableNow(id);
    // The same refusal scheduling makes, before anything is written, so a
    // release that would stop part-way, or a single-document release with no
    // document, sends nothing out and is not marked published.
    await this.assertReadyToRun(id, current);
    await this.moveToNowUnlessDue(current);
    await this.runDrainForPublishNow(id);
    const [after] = await this.deps.repository.findReleases({ ids: [id] });
    return after ?? current;
  }

  /**
   * The release Publish now may run, read once, or the refusal saying why
   * not: absent, final, or stopped.
   */
  private async publishableNow(id: string): Promise<ReleaseRow> {
    const [current] = await this.deps.repository.findReleases({ ids: [id] });
    if (current === undefined) {
      throw NextlyError.notFound({
        logContext: { reason: "release-not-found", releaseId: id },
      });
    }
    if (RELEASE_FINAL_STATES.includes(current.state)) {
      throw finishedReleaseRefusal(current, "publish-now");
    }
    if (!RELEASE_PUBLISHABLE_NOW_FROM.includes(current.state)) {
      // Stopped. It is fixed and scheduled again, so the fix is checked before
      // it goes out, rather than run as it is.
      throw NextlyError.conflict({
        message:
          "This release is stopped. Fix or remove the documents blocking it, then schedule it again.",
        logContext: {
          reason: "release-stopped",
          releaseId: id,
          state: current.state,
        },
      });
    }
    return current;
  }

  /**
   * Make the release due for Publish now: move it to this moment, unless its
   * instant has already come.
   *
   * A scheduled release whose instant has come is already due, and is not
   * moved. Moving it would change the instant a drain that is running it
   * checks before marking it published, and that drain would then leave it
   * for the next pass; the drain's claim, not the move, keeps two runs apart.
   * Due by the same rule the drain selects releases with (`isDueAt`), so a
   * release left unmoved here is one the drain will pick up.
   */
  private async moveToNowUnlessDue(current: ReleaseRow): Promise<void> {
    const now = new Date();
    const alreadyDue =
      current.state === "scheduled" &&
      current.scheduledAt instanceof Date &&
      isDueAt(current.scheduledAt, now);
    if (alreadyDue) return;
    // Fenced on the state the checks were made against, so a release
    // cancelled or stopped in between is not run — and on its revision, so of
    // two overlapping requests (a double click, a retry) only one moves it;
    // the other is refused before anything is written.
    const moved = await this.deps.repository.scheduleRelease(
      current.id,
      now,
      // The zone the author chose stays part of the record.
      current.timezone ?? "UTC",
      [current.state],
      current.revision
    );
    if (!moved) {
      throw NextlyError.conflict({
        logContext: {
          reason: "release-moved-during-publish-now",
          releaseId: current.id,
        },
      });
    }
  }

  /**
   * Run the releases drain for Publish now, never failing the request.
   *
   * The drain is the one runner of releases; running it here rather than a
   * pass of our own is what keeps this from overlapping the scheduled drain
   * or another Publish now on a shared document. The release is due by now,
   * so the runner sends it whether or not this run started: a drain that
   * could not be started is logged, and the release is answered as it
   * stands, as when another runner holds the drain.
   */
  private async runDrainForPublishNow(releaseId: string): Promise<void> {
    try {
      await this.deps.runDrainNow({ maxDurationMs: PUBLISH_NOW_BUDGET_MS });
    } catch (error) {
      this.deps.logger?.warn("Publish now could not run the releases drain", {
        releaseId,
        error: error instanceof Error ? error.message : String(error),
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

  /**
   * Rename a release, change its description, or both, and answer it as it
   * now reads.
   *
   * Under `update-content-releases`, in any state. A change that alters
   * nothing writes nothing and records nothing, and answers the release as it
   * is: a form that submits both fields after one edit must not move the
   * release, since every move sends a schedule judged before it round again.
   *
   * @experimental
   */
  async update(
    id: string,
    change: ReleaseDetailsChange,
    actor: ReleaseActor
  ): Promise<ReleaseRow> {
    await this.authorize(actor, "update");
    assertDetailsChange(change);
    // Whether anything changes is decided in the repository's transaction,
    // under the release's lock, and the row it answers is the one that
    // transaction wrote: see `updateReleaseDetails`.
    const written = await this.deps.repository.updateReleaseDetails(id, {
      ...(change.title === undefined ? {} : { title: change.title }),
      ...(change.description === undefined
        ? {}
        : { description: change.description }),
    });
    if (written === null) {
      throw NextlyError.notFound({
        logContext: { reason: "release-not-found", releaseId: id },
      });
    }
    if (written.changed.length > 0) {
      await this.recordActivity(
        {
          action: "update",
          release: written.row,
          changedFields: written.changed,
        },
        actor
      );
    }
    return written.row;
  }

  /**
   * Delete a release that never ran, and its documents with it: a draft, or
   * a release cancelled before it was ever scheduled.
   *
   * Under `delete-content-releases`. Every other release is kept, and each
   * refusal is a CONFLICT whose data names why (`whyNotDeletable`): a
   * scheduled or stopped one is committed to a launch (cancelling calls it
   * off and keeps it), a published one is the record of what went live, and
   * a cancelled one that was ever scheduled may have begun to run. A release
   * that is not there is NOT_FOUND. Answers the release as the delete found
   * it under its lock.
   *
   * @experimental
   */
  async delete(id: string, actor: ReleaseActor): Promise<ReleaseRow> {
    await this.authorize(actor, "delete");
    const current = await this.requireRelease(id);
    const refused = whyNotDeletable(current);
    if (refused !== null) throw notDeletableRefusal(current, refused);
    // FENCED on the same rule, so a release scheduled since the read above is
    // not deleted, and neither are its documents. A retry judges it as it now
    // is, and is told why.
    // The row the delete found under its lock, recorded and answered: one
    // renamed since the read above is the release that was deleted.
    const deleted = await this.deps.repository.deleteRelease(id);
    if (deleted === null) {
      throw NextlyError.conflict({
        logContext: { reason: "release-moved-before-delete", releaseId: id },
      });
    }
    await this.recordActivity({ action: "delete", release: deleted }, actor);
    return deleted;
  }

  /**
   * Record a rename or deletion, never failing the operation it describes:
   * the write has committed, and a failure here is reported to the logger
   * instead of to the caller.
   */
  private async recordActivity(
    entry: Omit<ReleaseActivityEntry, "actor">,
    actor: ReleaseActor
  ): Promise<void> {
    if (this.deps.recordActivity === undefined) return;
    try {
      await this.deps.recordActivity({ ...entry, actor: activityActor(actor) });
    } catch (error) {
      this.deps.logger?.warn("A release change could not be recorded", {
        releaseId: entry.release.id,
        action: entry.action,
        error: error instanceof Error ? error.message : String(error),
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
  assertKnownAction(input.action);

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

/**
 * Refuse an action outside the union.
 *
 * DANGEROUS, not merely invalid. The Drizzle `$type` annotation is compile-time
 * only, and the applier treats every effect that is not exactly `"publish"` as
 * an unpublish — so `"publsih"` from an untyped caller WITHDRAWS the document
 * at the scheduled instant.
 */
function assertKnownAction(action: unknown): void {
  if (isReleaseMemberAction(action)) return;
  throw NextlyError.invalidInput({
    message: "`action` must be `publish` or `unpublish`.",
    logContext: { reason: "unknown-member-action", action },
  });
}
