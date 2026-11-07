/**
 * Delete component: turn every copy of a component into plain blocks, then
 * delete it. The one way a component is deleted (`guards.ts`).
 *
 * ## The steps, as the run's row records them
 *
 * 1. **Open** (`preflight`). Inserting the run's row is the fence: from now on
 *    no write may add a copy (`host-rewrite/fence.ts`). Opened by a person core's
 *    own delete gate lets delete THIS component (`mayDeleteEntry`), asked
 *    again before every step.
 * 2. **Check before converting** (`preflight`, a slice per step, its cursor on
 *    the row; `judge.ts`). Anything that would stop the delete part way stops
 *    it here, with no host changed, the person's rights over each document
 *    included. Stopped, the fence comes down and the answer lists why. A save
 *    holding the component meanwhile resets the cursor, so the check starts
 *    over, and each move on is a compare-and-set on the cursor it read.
 * 3. **Convert** (`converting`, `final`, `done`): the host rewrite, a bounded
 *    tick per request, as the person. Its two walks end with every host read
 *    again under the fence. The component itself may not change meanwhile, so
 *    every copy converts from one definition (`host-rewrite/in-transaction.ts`).
 * 4. **Finished with documents left** (a pending draft, a host that kept
 *    changing, one the person may not change after all): the fence comes down
 *    and the component is kept. Starting again picks up there: what was
 *    converted reads as unchanged.
 * 5. **Delete** (`deleting`): moved from `done` by compare-and-set, so a save
 *    re-queueing a document since sends the run back instead
 *    (`host-rewrite/in-transaction.ts`). The component is deleted as the
 *    person, the run's id in the hook context, which the delete guard
 *    requires.
 * 6. **Deleted** (`deleted`): the row stays for good, as the tombstone that
 *    refuses any save still holding the component, however long it was held,
 *    and its progress is dropped with the move. A run at `deleting` whose
 *    component is still there is a delete stopped part way, reported as
 *    running, and carried on by its starter's next step.
 *
 * ## Who it runs as, and when it runs
 *
 * Every write is the person's who started it, made in their own requests:
 * nothing in core lets a background job act as a stored person. So each call
 * of the delete route by that person carries the delete on by one step, and
 * the dialog calls it until it is finished. Closing the dialog pauses the
 * delete; calling again resumes it. Anyone else is refused while it runs.
 * The sweep (`sweep.ts`) only finishes a delete that stopped after its write;
 * it never writes a host or deletes a component.
 *
 * @module component-delete/job
 */
import { NextlyError, type PluginWriteCheck } from "@nextlyhq/plugin-sdk";
import type { Nextly } from "nextly";

import {
  CLOSABLE_PHASES,
  type DeletionRun,
  type FenceStore,
  type StoredPhase,
} from "../host-rewrite/fence";
import { PREFLIGHT_RESTART } from "../host-rewrite/in-transaction";
import type { ProgressCounts } from "../host-rewrite/progress";
import {
  runStarterOf,
  type ComponentDeleteRewriteService,
  type RewriteCaller,
} from "../host-rewrite/service";

import type { ComponentDeleteResult, DeleteProgress } from "./contract";
import { MOST_NAMED, type NamingDeps } from "./hosts";
import {
  judge,
  leftDocuments,
  STEP_DOCUMENTS,
  STEP_MS,
  type Judged,
} from "./judge";
import { MESSAGES, SOMEONE_ELSE_IS_DELETING } from "./words";

/** The hook-context key the delete's own write carries the run's id under. */
export const COMPONENT_DELETE_CONTEXT_KEY = "pageBuilder.componentDelete";

/** What the delete needs, injected so a test can drive it. */
export interface ComponentDeleteDeps extends NamingDeps {
  readonly componentId: string;
  /** The component store: its collection. */
  readonly components: string;
  /** The caller, as the rewrite takes them. */
  readonly caller: RewriteCaller;
  readonly rewrite: ComponentDeleteRewriteService;
  readonly runs: Pick<
    FenceStore,
    "runFor" | "advance" | "advanceFrom" | "closeRun" | "markDeleted"
  >;
  readonly nextly: Pick<Nextly, "find" | "findByID" | "delete">;
  /** Whether core's delete gate lets the caller delete THIS component. */
  readonly mayDeleteIt: () => Promise<boolean>;
  /** Whether core's gates let the caller make this write. */
  readonly mayWrite: (check: PluginWriteCheck) => Promise<boolean>;
  readonly now: () => Date;
}

/** What one call answers: the envelope's message and item. */
export interface ComponentDeleteAnswer {
  readonly message: string;
  readonly item: ComponentDeleteResult;
}

/**
 * A dry run: what deleting would do over one slice of the documents, changing
 * nothing, and the delete already open, if any.
 */
export async function planComponentDelete(
  deps: ComponentDeleteDeps,
  after: string | null
): Promise<ComponentDeleteAnswer> {
  await requireReadable(deps);
  const [mayDelete, run] = await Promise.all([
    deps.mayDeleteIt(),
    deps.runs.runFor(deps.componentId, "delete"),
  ]);
  const judged = await judge(deps, after);
  return answer(deps, planStatus(judged), {
    mayDelete,
    run: runInfo(deps, run),
    plan: judged.plan,
    ...stoppedBy(judged),
  });
}

/** What a dry run's slice comes to. */
function planStatus(judged: Judged): ComponentDeleteResult["status"] {
  if (judged.blocked) return "refused";
  const { convert, drafts } = judged.plan;
  const found =
    convert.named.length + convert.unreadable + convert.more > 0 ||
    drafts.named.length + drafts.unreadable + drafts.more > 0;
  if (found) return "used";
  return judged.plan.complete ? "none" : "counting";
}

/** What stops a delete, as an answer carries it. */
function stoppedBy(
  judged: Judged
): Pick<ComponentDeleteResult, "layouts" | "left" | "leftMore"> {
  return {
    ...(judged.layouts === undefined ? {} : { layouts: judged.layouts }),
    ...(judged.left.length === 0 ? {} : { left: judged.left }),
    ...(judged.leftMore === 0 ? {} : { leftMore: judged.leftMore }),
  };
}

/** Start the delete, or carry the caller's own on by one step. */
export async function stepComponentDelete(
  deps: ComponentDeleteDeps
): Promise<ComponentDeleteAnswer> {
  const held = await deps.runs.runFor(deps.componentId, "delete");
  // Once the component is being deleted, its run answers for it, and its
  // starter carries it on.
  if (held !== null && isMine(deps, held) && afterTheDelete(held)) {
    return carryOn(deps, held);
  }
  try {
    await requireReadable(deps);
  } catch (error) {
    // A second request of the same person may have deleted it since the run
    // was read: the run as it stands now answers.
    const now = await deps.runs.runFor(deps.componentId, "delete");
    if (now !== null && isMine(deps, now) && afterTheDelete(now)) {
      return carryOn(deps, now);
    }
    throw error;
  }
  if (held !== null && !isMine(deps, held)) throw someoneElse(deps);
  // A precondition of every step, judged for THIS component by core's own
  // gate: a rule that lets the caller delete some components does not let
  // them convert the copies of one it refuses. A delete they had open stops,
  // with nothing further converted.
  if (!(await deps.mayDeleteIt())) return refuseNotGranted(deps, held);
  const run =
    held ??
    (
      await deps.rewrite.open(
        deps.componentId,
        deps.caller,
        "delete",
        "preflight"
      )
    ).run;
  if (!isMine(deps, run)) throw someoneElse(deps);
  return carryOn(deps, run);
}

/**
 * Refuse a caller core's gate no longer lets delete the component, closing a
 * run of theirs that has not reached the delete. Moved on since it was read
 * (deleted by a second request of theirs), the tombstone answers, and is never
 * closed.
 */
async function refuseNotGranted(
  deps: ComponentDeleteDeps,
  held: DeletionRun | null
): Promise<ComponentDeleteAnswer> {
  if (held !== null && !(await closeAt(deps, held, CLOSABLE_PHASES))) {
    const now = await deps.runs.runFor(deps.componentId, "delete");
    if (now !== null && isMine(deps, now) && now.phase === "deleted") {
      return carryOn(deps, now);
    }
  }
  throw NextlyError.forbidden({
    logContext: {
      reason: "component-delete-not-granted",
      componentId: deps.componentId,
    },
  });
}

/** The open delete's progress, changing nothing. */
export async function componentDeleteProgress(
  deps: ComponentDeleteDeps
): Promise<ComponentDeleteAnswer> {
  const run = await deps.runs.runFor(deps.componentId, "delete");
  // Done only once the delete committed: a tombstone, or a run at its delete
  // whose component is gone.
  if (run !== null && isMine(deps, run) && (await isDone(deps, run))) {
    return answer(deps, "done", { mayDelete: true, run: runInfo(deps, run) });
  }
  await requireReadable(deps);
  const mayDelete = await deps.mayDeleteIt();
  if (run === null) return answer(deps, "idle", { mayDelete, run: null });
  return answer(deps, run.phase === "preflight" ? "preflight" : "running", {
    mayDelete,
    run: runInfo(deps, run),
    progress: progressOf(await deps.rewrite.counts(deps.componentId)),
  });
}

/** Whether the run's delete has committed. */
async function isDone(
  deps: ComponentDeleteDeps,
  run: DeletionRun
): Promise<boolean> {
  if (run.phase === "deleted") return true;
  return run.phase === "deleting" && !(await componentExists(deps));
}

/** One step of the caller's own run, by the phase it is at. */
async function carryOn(
  deps: ComponentDeleteDeps,
  run: DeletionRun
): Promise<ComponentDeleteAnswer> {
  switch (run.phase) {
    case "preflight":
      return preflight(deps, run);
    case "deleting":
      return deleteIt(deps, run);
    case "deleted":
      return answer(deps, "done", { mayDelete: true, run: runInfo(deps, run) });
    default:
      return convert(deps, run);
  }
}

/** Where a preflight slice starts: the first document after a restart. */
function preflightStart(cursor: string | null): string | null {
  return cursor === null || cursor.startsWith(PREFLIGHT_RESTART)
    ? null
    : cursor;
}

/**
 * Step 2, one slice: stop with nothing changed, go on to the next slice, or,
 * once the last is judged, go on to convert. Each move on is from the cursor
 * the slice started at, so a save that reset it meanwhile (the check starts
 * over) makes the move miss, and the next step judges from the first
 * document again.
 */
async function preflight(
  deps: ComponentDeleteDeps,
  run: DeletionRun
): Promise<ComponentDeleteAnswer> {
  const judged = await judge(deps, preflightStart(run.cursor));
  if (judged.blocked) {
    if (!(await closeAt(deps, run, ["preflight"]))) {
      const moved = await fromNow(deps);
      if (moved !== null) return moved;
    }
    return answer(deps, "refused", {
      mayDelete: true,
      run: null,
      plan: judged.plan,
      ...stoppedBy(judged),
    });
  }
  const at = { phase: "preflight" as const, cursor: run.cursor };
  const to = judged.plan.complete
    ? { phase: "converting" as const, cursor: null }
    : { phase: "preflight" as const, cursor: judged.plan.next };
  await deps.runs.advanceFrom(run.id, at, to);
  const now = await deps.runs.runFor(deps.componentId, "delete");
  const step = now?.phase === "converting" ? "converting" : "preflight";
  return answer(deps, step === "converting" ? "running" : "preflight", {
    mayDelete: true,
    run: { yours: true, step },
    progress: progressOf(NO_COUNTS),
  });
}

/** Steps 3 and 4: one bounded tick of the conversion, and what follows it. */
async function convert(
  deps: ComponentDeleteDeps,
  run: DeletionRun
): Promise<ComponentDeleteAnswer> {
  const report = await deps.rewrite.rewrite({
    componentId: deps.componentId,
    caller: deps.caller,
    maxDocuments: STEP_DOCUMENTS,
    deadline: new Date(deps.now().getTime() + STEP_MS),
  });
  const counts = await deps.rewrite.counts(deps.componentId);
  if (!report.finished) return running(deps, run, counts);
  if (counts.left > 0) {
    const rows = await deps.rewrite.leftPage(deps.componentId, MOST_NAMED);
    // Closed only while still done: a save re-queueing a document since sent
    // it back to converting, and a second request may have moved it on.
    if (!(await closeAt(deps, run, ["done"]))) {
      const moved = await fromNow(deps);
      if (moved !== null) return moved;
    }
    return answer(deps, "partly-done", {
      mayDelete: true,
      run: null,
      left: await leftDocuments(deps, rows, report),
      ...(counts.left > rows.length
        ? { leftMore: counts.left - rows.length }
        : {}),
      progress: progressOf(counts),
    });
  }
  if (!(await deps.runs.advance(run.id, "done", "deleting", null))) {
    // A save re-queued a document after the final walk: convert it first.
    return running(deps, run, counts);
  }
  return deleteIt(deps, { ...run, phase: "deleting" });
}

/** The answer of a delete still converting. */
function running(
  deps: ComponentDeleteDeps,
  run: DeletionRun,
  counts: ProgressCounts
): ComponentDeleteAnswer {
  return answer(deps, "running", {
    mayDelete: true,
    run: runInfo(deps, run),
    progress: progressOf(counts),
  });
}

/**
 * Step 5: delete the component as the person, then leave the tombstone. A
 * delete that failed leaves the component and takes the fence down, unless
 * it committed before failing, which a read tells.
 */
async function deleteIt(
  deps: ComponentDeleteDeps,
  run: DeletionRun
): Promise<ComponentDeleteAnswer> {
  if (await componentExists(deps)) {
    try {
      await deps.nextly.delete({
        collection: deps.components,
        id: deps.componentId,
        ...deps.asPerson,
        context: { [COMPONENT_DELETE_CONTEXT_KEY]: run.id },
      });
    } catch (error) {
      if (await componentExists(deps)) {
        // The delete was refused and the component is there: the run goes
        // back to `done`, by compare-and-set from `deleting`, and is closed
        // from there, so no request ever closes a run at `deleting` or
        // `deleted`. Lost to a second request that moved it, it is left.
        if (await deps.runs.advance(run.id, "deleting", "done", null)) {
          await closeAt(deps, run, ["done"]);
        }
        throw error;
      }
    }
  }
  // The tombstone, its progress dropped in the same transaction.
  await deps.runs.markDeleted(run.id, deps.now().toISOString());
  return answer(deps, "done", {
    mayDelete: true,
    run: { yours: true, step: "deleted" },
  });
}

/** Close the run read as `run`, only while it is still at one of `at`. */
function closeAt(
  deps: ComponentDeleteDeps,
  run: DeletionRun,
  at: readonly StoredPhase[]
): Promise<boolean> {
  return deps.runs.closeRun(run.id, at);
}

/**
 * The answer from the run as it stands now, for a request whose close missed:
 * the caller's own delete carried on from where it is, or `null` when there is
 * no run of theirs to answer from.
 */
async function fromNow(
  deps: ComponentDeleteDeps
): Promise<ComponentDeleteAnswer | null> {
  const now = await deps.runs.runFor(deps.componentId, "delete");
  if (now === null || !isMine(deps, now)) return null;
  if (afterTheDelete(now)) return carryOn(deps, now);
  return answer(deps, now.phase === "preflight" ? "preflight" : "running", {
    mayDelete: true,
    run: runInfo(deps, now),
    progress: progressOf(await deps.rewrite.counts(deps.componentId)),
  });
}

/** The counts of a run with no progress yet. */
const NO_COUNTS: ProgressCounts = {
  rewritten: 0,
  unchanged: 0,
  left: 0,
  pending: 0,
};

/** The progress counts, as an answer reports them. */
function progressOf(counts: ProgressCounts): DeleteProgress {
  return {
    converted: counts.rewritten,
    unchanged: counts.unchanged,
    left: counts.left,
    pending: counts.pending,
  };
}

/** Whether the run is at or past its delete. */
function afterTheDelete(run: DeletionRun): boolean {
  return run.phase === "deleting" || run.phase === "deleted";
}

/** Whether the caller started this run. */
function isMine(deps: ComponentDeleteDeps, run: DeletionRun): boolean {
  return run.startedBy === runStarterOf(deps.caller);
}

/** The run as an answer reports it. */
function runInfo(
  deps: ComponentDeleteDeps,
  run: DeletionRun | null
): ComponentDeleteResult["run"] {
  return run === null ? null : { yours: isMine(deps, run), step: run.phase };
}

/** The refusal for a second person. */
function someoneElse(deps: ComponentDeleteDeps): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: SOMEONE_ELSE_IS_DELETING,
    logContext: {
      reason: "component-delete-busy",
      componentId: deps.componentId,
    },
  });
}

/** An answer of `status`, with its message. */
function answer(
  deps: ComponentDeleteDeps,
  status: ComponentDeleteResult["status"],
  rest: Omit<ComponentDeleteResult, "componentId" | "status">
): ComponentDeleteAnswer {
  return {
    message: messageOf(status),
    item: { componentId: deps.componentId, status, ...rest },
  };
}

function messageOf(status: ComponentDeleteResult["status"]): string {
  switch (status) {
    case "partly-done":
      return MESSAGES.partlyDone;
    case "preflight":
      return MESSAGES.running;
    default:
      return MESSAGES[status];
  }
}

/**
 * Refuse a component the caller may not read, or that does not exist: read
 * as them, so a hidden one answers as missing before anything is read past
 * their access.
 */
async function requireReadable(deps: ComponentDeleteDeps): Promise<void> {
  const found = await deps.nextly.find({
    collection: deps.components,
    where: { id: { equals: deps.componentId } },
    status: "all",
    limit: 1,
    depth: 0,
    ...deps.asPerson,
  });
  if (found.items.length === 0) throw NextlyError.notFound();
}

/** Whether the component still exists, read as the system. */
async function componentExists(deps: ComponentDeleteDeps): Promise<boolean> {
  const found = await deps.nextly.find({
    collection: deps.components,
    where: { id: { equals: deps.componentId } },
    status: "all",
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });
  return found.items.length > 0;
}
