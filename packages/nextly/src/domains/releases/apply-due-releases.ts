/**
 * Turning the releases whose instant has arrived into real published content.
 *
 * The read path can only make a due release LOOK applied. This is what actually
 * applies it, and the two are deliberately built on the same pure rule so a
 * read taken either side of this pass gives the same answer.
 *
 * ## Every write runs as the member's author
 *
 * A release is somebody's decision to publish something later, and the write
 * that carries it out is theirs. Running it as a trusted system principal would
 * let a release publish content its author could not have published by hand,
 * turning "schedule this" into a privilege escalation with a delay on it.
 *
 * So each action is applied as the winning member's `createdBy`, resolved
 * through the same fail-closed rule background jobs use. Three refusals follow
 * from that, and none of them is a skip:
 *
 * - **No recorded author.** There is nobody to act as, and the only available
 *   fallback is the principal this module refuses. Recorded as a failure.
 * - **Author deleted or deactivated.** Authority that was withdrawn stays
 *   withdrawn; a release does not resurrect it.
 * - **The identity lookup itself failed.** A transient database error is not
 *   evidence that anybody is gone, so this is recorded and retried next pass
 *   rather than treated as a verdict.
 *
 * ## Why a failed member holds its release open
 *
 * A release is marked `published` only when every action attributed to it
 * succeeded. Marking it otherwise would discharge a release that did not fully
 * happen: the read path stops consulting a non-scheduled release, so the
 * unapplied members would vanish from both the content and the schedule at
 * once, and the only trace would be a log line. Leaving it `scheduled` keeps it
 * visible and lets the next pass retry.
 *
 * ## Why one bad member does not abort the pass
 *
 * Every action is attempted. Aborting on the first failure would let one
 * unresolvable author stop every other release on the site, which is the
 * failure mode a scheduled publish can least afford — nobody is watching at
 * 03:00, and "nothing was published" reads exactly like "nothing was due".
 *
 * It is a real guarantee only while EVERY fallible step in {@link applyOne} is
 * wrapped. One was not: the per-action schedule check — an ordinary database
 * read, on the ordinary path — took the whole pass down with it whenever the
 * connection blipped, skipping every later action and every unrelated due
 * release. One blip then looked exactly like a quiet night.
 *
 * @module domains/releases/apply-due-releases
 */

import { resolveRunAs, type RunAsDeps } from "../../shared/lib/resolve-run-as";
import type { UserContext } from "../collections/services/collection-types";

import { planReleaseMaterialisation } from "./plan-release-materialisation";
import type { MaterialisationAction } from "./plan-release-materialisation";
import type {
  DocumentRef,
  ReleaseMemberRow,
  ReleaseRow,
} from "./releases-repository";

/**
 * The ordinary content mutations, as this pass needs them.
 *
 * Injected rather than reached for, so the decisions here are testable without
 * booting a runtime — and so it stays impossible for this module to acquire a
 * cheaper write path than the one an editor uses.
 */
export interface ReleaseMutations {
  /**
   * Publish the document, promoting its pending working draft if it has one.
   *
   * The promotion is the whole point for a draft-split document: the pending
   * edit lives in a snapshot and the live row is untouched, so publishing
   * without it would set a status the reader already saw and change nothing.
   */
  publish(input: { ref: DocumentRef; user: UserContext }): Promise<void>;
  /** Withdraw the document from published reads. */
  unpublish(input: { ref: DocumentRef; user: UserContext }): Promise<void>;
  /**
   * Whether the document ALREADY has the effect an action intended.
   *
   * Asked only after a write rejected, and it is what stops a committed write
   * from being retried forever. `updateEntry` commits the row and its outbox
   * event before running `afterUpdate` hooks, so a hook that throws rejects the
   * promise for a write that already persisted. Recording that as a failure
   * leaves the release scheduled, and every later sweep repeats the update,
   * appends another event and reruns the hooks — indefinitely.
   *
   * Reading the document back is the instrument that can tell the two apart,
   * because the thrown error cannot: `createErrorFromResult` carries the
   * service's failure, not whether its transaction committed.
   */
  applied(input: {
    ref: DocumentRef;
    effect: "publish" | "unpublish";
    user: UserContext;
  }): Promise<boolean>;
}

export interface ApplyDueReleasesDeps {
  repository: {
    findDueReleases(now: Date): Promise<ReleaseRow[]>;
    /**
     * Members of EVERY due release, in one query.
     *
     * Batched rather than asked per release because this is the last thing that
     * happens before the first content mutation: one round trip per due release
     * made the drain's time-to-first-write — and the job lease it holds — grow
     * directly with the size of the due set, which is largest exactly when a
     * deployment or an imported schedule has left many releases due at once.
     *
     * Safe to flatten because the winner rule is a TOTAL order (instant, then
     * creation time, then member id), so no answer depends on the order rows
     * come back in.
     */
    listMembersOf(releaseIds: string[]): Promise<ReleaseMemberRow[]>;
    isStillDueAt(releaseId: string, scheduledAt: Date): Promise<boolean>;
    markReleasePublished(id: string, at: Date): Promise<boolean>;
  };
  mutations: ReleaseMutations;
  /** The identity reads, so a member's author can be resolved. */
  runAs: RunAsDeps;
  now?: () => Date;
  /**
   * When this pass must stop starting new actions.
   *
   * A drain runs behind a serverless cron tick as often as on a long-lived
   * process, and a platform kills a tick at a fixed limit. The jobs runner
   * cannot bound this for us and says so: `maxDurationMs` is checked before
   * each CLAIM, so it bounds how many JOBS a pass starts, not how long one
   * already-running handler takes. It names the handler being written to fit a
   * tick as what bounds this instead. This is that.
   *
   * Absent means unbounded, which is right for a CLI or a test and wrong for a
   * tick.
   */
  deadline?: Date;
}

/** Why one action did not happen. Recorded, never swallowed. */
export type MaterialisationFailure =
  /** The member carries no author, so there is nobody to act as. */
  | "NO_RECORDED_AUTHOR"
  /** The author no longer exists, or has been deactivated. */
  | "AUTHOR_UNAVAILABLE"
  /** The identity lookup failed; not evidence that anybody is gone. */
  | "IDENTITY_LOOKUP_FAILED"
  /** The content mutation itself was refused or errored. */
  | "WRITE_FAILED"
  /**
   * The "is this release still scheduled?" read failed.
   *
   * Distinct from {@link MaterialisationFailure} `RELEASE_NO_LONGER_SCHEDULED`
   * on purpose: a read that ERRORED is not evidence the release was cancelled,
   * so this is recorded as a failure, holds the release open, and is retried on
   * the next pass — where cancellation is a verdict that discharges nothing but
   * is final for this action.
   */
  | "SCHEDULE_CHECK_FAILED"
  /**
   * The member names a single locale. Per-locale release visibility is not
   * built: see the refusal in `applyOne` for why performing it would be worse
   * than declining it.
   */
  | "LOCALE_SCOPE_UNSUPPORTED"
  /**
   * The release was cancelled OR RESCHEDULED between this pass reading it and
   * acting on it, so the plan describes a schedule that no longer exists.
   */
  | "RELEASE_NO_LONGER_SCHEDULED";

export interface MaterialisationOutcome {
  ref: DocumentRef;
  memberId: string;
  releaseId: string;
  effect: "publish" | "unpublish";
  failure: MaterialisationFailure | null;
  /** The underlying message, when there was one. */
  detail?: string;
}

export interface ApplyDueReleasesResult {
  /** Releases whose instant had arrived when this pass looked. */
  due: number;
  /** Releases moved to `published` by THIS pass. */
  published: number;
  applied: number;
  failed: number;
  /**
   * Actions this pass did not start, because it ran out of time.
   *
   * Reported rather than implied. A pass that stopped early and one that had
   * less to do return the same counts otherwise, so a caller could not tell a
   * completed drain from a truncated one — and "success" on a partial pass is
   * the reading that turns a backlog into a silent stall.
   */
  deferred: number;
  outcomes: MaterialisationOutcome[];
}

export async function applyDueReleases(
  deps: ApplyDueReleasesDeps
): Promise<ApplyDueReleasesResult> {
  const now = deps.now ?? (() => new Date());
  const at = now();

  const releases = await deps.repository.findDueReleases(at);
  if (releases.length === 0) {
    return {
      due: 0,
      published: 0,
      applied: 0,
      failed: 0,
      deferred: 0,
      outcomes: [],
    };
  }

  const members = await deps.repository.listMembersOf(releases.map(r => r.id));

  const plan = planReleaseMaterialisation({
    releases: releases.map(r => ({
      id: r.id,
      // `findDueReleases` returns only releases with an instant, so this is
      // never the epoch in practice; narrowing here rather than asserting keeps
      // a repository that ever changed its mind from publishing 1970.
      scheduledAt: r.scheduledAt ?? at,
    })),
    members,
    now: at,
  });

  const outcomes: MaterialisationOutcome[] = [];
  // Releases this pass could not finish. Kept separately from the failures
  // below because an unattempted action leaves NO outcome, and the discharge
  // test reads outcomes — so a release whose remaining members were never
  // started would otherwise look like one whose members all succeeded, be
  // marked published, lose its read-time projection, and lose those members
  // permanently. That is the same discharge-what-did-not-happen failure this
  // module already refuses for a failed member.
  const unfinished = new Set<string>();
  // The budget's unit is an OVERLAP COMPONENT, and every other unit is wrong.
  //
  // Not the action: `applyOne` cannot be interrupted, and stopping between two
  // actions of one release leaves it started and unfinished, so the next tick
  // rebuilds the same plan and repeats the same prefix forever.
  //
  // Not the release either, for two reasons that only appear together. The
  // planner groups by DOCUMENT and emits in first-seen document order, so an
  // interleaved backlog yields `[r1, r2, r3, r1, r2, r3]` — starting each
  // release costs one action, every release is started within the first pass
  // over the documents, and a release-level guard then never fires again. And
  // the discharge rule treats an overlap component as inseparable: deferring one
  // member of a component holds the whole component open, so nothing in it is
  // finalized and every tick repeats the members it did reach.
  //
  // A component is what can be started and finished as a unit. `plan.overlapping
  // Releases` is a complete partition — a release touching nothing else appears
  // in a set of one — so this bounds ordinary backlogs by release and joined
  // ones by the set that must settle together.
  const componentOf = new Map<string, number>();
  plan.overlappingReleases.forEach((group, index) => {
    for (const id of group) componentOf.set(id, index);
  });
  // Ordered so a component's actions are contiguous. The planner's own order is
  // by document and provides no such grouping; without this the guard has
  // nothing left to defer by the time it first fires.
  const ordered = [...plan.actions].sort(
    (a, b) =>
      (componentOf.get(a.releaseId) ?? 0) - (componentOf.get(b.releaseId) ?? 0)
  );
  const startedComponents = new Set<number>();
  for (const action of ordered) {
    const component = componentOf.get(action.releaseId) ?? -1;
    // Checked only when entering a NEW component, and never mid-component:
    // nothing here can interrupt a content mutation, and a half-applied
    // component is the reversal this module already refuses. At least one
    // component always runs, or a budget too small for one stalls a backlog
    // forever while every pass reports success.
    if (
      deps.deadline !== undefined &&
      !startedComponents.has(component) &&
      startedComponents.size > 0 &&
      now().getTime() >= deps.deadline.getTime()
    ) {
      unfinished.add(action.releaseId);
      continue;
    }
    startedComponents.add(component);
    outcomes.push(await applyOne(deps, action));
  }
  const deferred = plan.actions.length - outcomes.length;

  // A release is discharged only when nothing attributed to it failed — AND
  // nothing failed in any release it shares a document with.
  //
  // The second half is what stops a partial pass from reversing itself.
  // Discharging the winner of an overlapping pair while the loser stays
  // scheduled removes the winner from the next pass entirely, so the loser
  // becomes the winner for their shared document and undoes it. Holding the
  // whole overlapping set open keeps every member of that argument present
  // until all of them can be settled together.
  const brokenReleases = new Set([
    ...outcomes.filter(o => o.failure !== null).map(o => o.releaseId),
    // Not started is not succeeded. Folded in here rather than checked
    // separately so the overlapping-set expansion below covers it too: a
    // release sharing a document with an unfinished one must stay open for the
    // same reason a failed one does, or the pair reverses itself.
    ...unfinished,
  ]);
  const heldOpen = new Set<string>();
  for (const group of plan.overlappingReleases) {
    if (group.some(id => brokenReleases.has(id))) {
      for (const id of group) heldOpen.add(id);
    }
  }

  let published = 0;
  // Discharged by COMPONENT, for the reason the planner states: splitting one
  // reverses work. If the deadline fell between two members of a component, the
  // later winner could be marked published while the earlier stayed scheduled —
  // and the next tick, seeing only the earlier, would make it the winner and
  // republish what was correctly withdrawn.
  //
  // Counted by ATTEMPT, not by success: `markReleasePublished` answers `false`
  // for a release an overlapping drain already settled, so gating on successes
  // leaves the counter at zero and every row gets a serial write with the budget
  // long gone.
  let finalizedComponents = 0;
  for (const group of plan.overlappingReleases) {
    const settleable = group.filter(
      id => !heldOpen.has(id) && plan.releaseIds.includes(id)
    );
    if (settleable.length === 0) continue;
    if (
      deps.deadline !== undefined &&
      finalizedComponents > 0 &&
      now().getTime() >= deps.deadline.getTime()
    ) {
      break;
    }
    finalizedComponents += 1;
    for (const id of settleable) {
      // A FRESH clock, not the pass's start. `publishedAt` is defined as the
      // moment materialisation completed, and `at` was captured before members
      // were loaded, identities resolved and every content mutation run — on a
      // slow pass or a large due set that difference is substantial.
      if (await deps.repository.markReleasePublished(id, now())) published += 1;
    }
  }

  const failed = outcomes.filter(o => o.failure !== null).length;
  return {
    due: releases.length,
    published,
    applied: outcomes.length - failed,
    failed,
    deferred,
    outcomes,
  };
}

/**
 * One action's outcome — and never a rejection.
 *
 * That is an INVARIANT, not an observation: the pass's "every action is
 * attempted" promise is only as good as it. Every fallible step below is
 * wrapped individually, which is why there is no catch-all here — a boundary
 * `try` would be a branch no test could reach, and an unreachable guard is a
 * worse record of the rule than this sentence. **A bare `await` added to this
 * function breaks the guarantee**, silently, for every release due that minute.
 */
async function applyOne(
  deps: ApplyDueReleasesDeps,
  action: MaterialisationAction
): Promise<MaterialisationOutcome> {
  const base = {
    ref: action.ref,
    memberId: action.memberId,
    releaseId: action.releaseId,
    effect: action.effect,
  };

  // The read seam answers DOCUMENT-WIDE members only. `findDueDecisions`
  // filters `locale IS NULL` because per-locale lifecycle lives on the
  // companion's `_status`, which the main row it filters cannot express — so
  // per-locale release visibility is not built yet.
  //
  // Writing one locale here would therefore apply an effect the read path
  // refuses to project, and the success check below cannot see it either:
  // `findByID(locale)` returns the MAIN row's status, so a per-locale unpublish
  // that COMMITTED reads back as unchanged, reports WRITE_FAILED, and replays
  // its hooks and outbox events on every drain forever.
  //
  // Declined rather than half-performed. Nothing can reach this today — there
  // is no write surface, so no locale member can exist — and when one is built
  // the schedule-time gate is where a locale member should be refused, with
  // this as the backstop that keeps the two seams from ever disagreeing.
  if (action.ref.locale !== null && action.ref.locale !== undefined) {
    return { ...base, failure: "LOCALE_SCOPE_UNSUPPORTED" };
  }

  const identity = await resolveActionAuthor(deps, action.createdBy);
  if ("failure" in identity) {
    return { ...base, failure: identity.failure, ...identity.detail };
  }

  // Cancelling is the one thing a person does to a release between a drain
  // reading it and the drain acting on it, and the fence on
  // `markReleasePublished` comes too late: it stops the row being marked
  // published and cannot un-publish the documents. Checked per ACTION rather
  // than once per pass, so a cancel is honoured for every document not yet
  // written rather than only for releases the pass had not started.
  //
  // Wrapped because it is a database read on the ordinary path, and an
  // unwrapped one here aborted the entire pass: a transient connection failure
  // on the FIRST action skipped every later action and every unrelated due
  // release, so one blip looked exactly like a quiet night.
  let stillDue: boolean;
  try {
    stillDue = await deps.repository.isStillDueAt(
      action.releaseId,
      action.scheduledAt
    );
  } catch (error) {
    return {
      ...base,
      failure: "SCHEDULE_CHECK_FAILED",
      detail: messageOf(error),
    };
  }
  if (!stillDue) {
    return { ...base, failure: "RELEASE_NO_LONGER_SCHEDULED" };
  }

  return writeAndConfirm(deps, action, identity.user, base);
}

/**
 * The write, and the read-back that decides whether it counted.
 *
 * Extracted from {@link applyOne} because it is a different question: that one
 * decides whether this action may be attempted at all, this one decides what
 * actually happened when it was. Keeping them together also put the access
 * refusals, the cancel fence and two rounds of confirmation in one function of
 * a dozen branches, which no reader can hold at once.
 */
async function writeAndConfirm(
  deps: ApplyDueReleasesDeps,
  action: MaterialisationAction,
  user: UserContext,
  base: Omit<MaterialisationOutcome, "failure">
): Promise<MaterialisationOutcome> {
  try {
    // Called ON the object rather than through an extracted reference: a
    // mutations implementation that is a class method would lose `this` and
    // fail at a point that looks like the write being refused.
    const input = { ref: action.ref, user };
    await (action.effect === "publish"
      ? deps.mutations.publish(input)
      : deps.mutations.unpublish(input));
  } catch (error) {
    // A rejection is not proof the write did not land. Ask the document — and
    // if THAT cannot be answered, report the failure, which is the safe
    // direction: a retry of an applied action is a no-op, while treating an
    // unapplied one as done loses it silently.
    const landed = await confirmApplied(deps, action, user, false);
    if (landed) return { ...base, failure: null, detail: messageOf(error) };
    return { ...base, failure: "WRITE_FAILED", detail: messageOf(error) };
  }

  // A resolved promise is not proof the action was APPLIED. A
  // `beforeUpdate`/`beforeChange` hook may remove or rewrite `status`, and the
  // ordinary mutation then succeeds without performing the publish or the
  // withdrawal. Reporting that as complete discharges the release, removes its
  // read-time projection, and loses the scheduled action permanently — the one
  // failure here that leaves no trace at all.
  //
  // So success is confirmed the same way a rejection is. An unanswerable
  // read-back is treated as applied here, because the write did resolve;
  // inventing a failure for it would be the direction that loses nothing but
  // replays the hooks and outbox events of a write that already happened.
  if (!(await confirmApplied(deps, action, user, true))) {
    return {
      ...base,
      failure: "WRITE_FAILED",
      detail: "the mutation resolved without applying the intended status",
    };
  }

  return { ...base, failure: null };
}

/**
 * Whether the document now carries the effect the action intended.
 *
 * @param whenUnverifiable what to answer when the read-back ITSELF fails, which
 *   says nothing either way. Both callers need that answer and they need
 *   opposite ones — a caller whose write rejected must not assume it landed, and
 *   a caller whose write resolved must not invent a failure for it — so it is a
 *   parameter rather than a policy this function picks.
 */
async function confirmApplied(
  deps: ApplyDueReleasesDeps,
  action: MaterialisationAction,
  user: UserContext,
  whenUnverifiable: boolean
): Promise<boolean> {
  try {
    return await deps.mutations.applied({
      ref: action.ref,
      effect: action.effect,
      user,
    });
  } catch {
    return whenUnverifiable;
  }
}

/**
 * The person a release action runs as, or why there is nobody to run it as.
 *
 * Separated from the action itself because it is the ACCESS decision, and it
 * has three distinct refusals that a reader should be able to take in without
 * also holding the write, the cancel check and the read-back in mind.
 */
async function resolveActionAuthor(
  deps: ApplyDueReleasesDeps,
  createdBy: string | null
): Promise<
  | { user: UserContext }
  | { failure: MaterialisationFailure; detail?: { detail: string } }
> {
  // Nobody to act as, and the only fallback available is the privileged
  // principal this module refuses.
  if (createdBy === null) return { failure: "NO_RECORDED_AUTHOR" };

  let resolved: Awaited<ReturnType<typeof resolveRunAs>>;
  try {
    resolved = await resolveRunAs(deps.runAs, createdBy);
  } catch (error) {
    // A transient database error is not evidence that anybody is gone.
    return {
      failure: "IDENTITY_LOOKUP_FAILED",
      detail: { detail: messageOf(error) },
    };
  }

  // `resolveRunAs` reports an ANONYMOUS caller as `{ ok: true, user: null }`.
  // That is a legitimate answer for a background job queued by nobody; it is
  // not one here, because a member always names an author and a null user
  // would apply no field rules at all.
  if (!resolved.ok || resolved.user === null) {
    return { failure: "AUTHOR_UNAVAILABLE" };
  }
  return { user: resolved.user };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
