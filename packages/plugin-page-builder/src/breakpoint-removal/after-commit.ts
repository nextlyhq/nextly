/**
 * Re-queueing a document written with a removed breakpoint's values while
 * the removal is open.
 *
 * A save is judged against the site's breakpoints when it is validated, and
 * commits a moment later. One validated before a removal stored the new set,
 * and committed after the removal's walk stripped that document, puts the
 * removed values back. Refusing it would lose the author's edit, so the walk
 * does not fight it: after every committed write, a document still holding a
 * value under the open removal's breakpoints is marked pending and the run
 * goes back to its converting walk, which strips it again from what the
 * author saved. The run's final walk reads every document again besides, so a
 * write whose hooks did not run (one inside a caller's transaction) is caught
 * there.
 *
 * The same write can commit after the removal is done. A document holding a
 * value under a breakpoint a done run removed, which the site does not define
 * now, opens that run again for it: pending, on its converting walk, which the
 * removal route then carries on. Where another removal holds the one open
 * slot, the document is recorded as left on the done run instead, which keeps
 * the breakpoint from being defined again until that run is carried on. The
 * hook writes no document itself.
 *
 * After commit, because only then is the stored value the one a later read
 * sees. A failure here is logged, never thrown: the write has committed, and
 * the final walk reads every document again regardless.
 *
 * @module breakpoint-removal/after-commit
 */
import {
  committedWrite,
  type FencedWriteReportContext,
} from "../host-rewrite/after-commit";
import { documentKeyOf } from "../host-rewrite/contract";

import type { BreakpointRun, RemovalRunStore } from "./run-store";
import { removedIdsIn } from "./strip";

/** What the report is wired with. */
export interface RemovalWriteReportArgs {
  readonly ctx: FencedWriteReportContext;
  readonly runs: () => Pick<RemovalRunStore, "runs" | "requeue" | "reopenFor">;
  /** The breakpoint ids the site's stylesheet is emitted under now. */
  readonly definedBreakpoints: () => Promise<ReadonlySet<string>>;
}

/** Register the report on every committed create and update. */
export function registerRemovalWriteReport(args: RemovalWriteReportArgs): void {
  for (const phase of ["afterCreate", "afterUpdate"] as const) {
    args.ctx.hooks.on(phase, "*", context => reportWrite(args, context));
  }
}

/** Re-queue the written document when it holds a removal's values. */
async function reportWrite(
  args: RemovalWriteReportArgs,
  context: unknown
): Promise<void> {
  const written = committedWrite(context);
  if (written === undefined || written.at === undefined) return;
  try {
    // The runs first: a short table, and with no removal recorded, or none
    // whose ids the write holds, nothing else is read.
    const runs = await args.runs().runs();
    if (runs.length === 0) return;
    const key = documentKeyOf(written.at);
    const held = heldIds(written.documents, runs);
    await requeueOnOpenRun(args, runs, held, key);
    await reopenDoneRuns(args, runs, held, key);
  } catch (error) {
    args.ctx.logger.error(
      `[page-builder] a write to "${written.collection}" holding styles under ` +
        "a removed breakpoint was not sent back to be stripped; the removal's " +
        "final check, or carrying it on, reads it again.",
      { collection: written.collection, error }
    );
  }
}

/** Re-queue the written document on the open run, when it holds that run's ids. */
async function requeueOnOpenRun(
  args: RemovalWriteReportArgs,
  runs: readonly BreakpointRun[],
  held: ReadonlySet<string>,
  documentKey: string
): Promise<void> {
  const open = runs.find(run => run.open);
  if (open !== undefined && holdsAny(open, held)) {
    await args.runs().requeue(open.id, documentKey);
  }
}

/**
 * Open each done run whose removed ids the write holds again, for the
 * written document. Only for a breakpoint the site does not define now: one
 * defined again is the site's own, and its values stay.
 */
async function reopenDoneRuns(
  args: RemovalWriteReportArgs,
  runs: readonly BreakpointRun[],
  held: ReadonlySet<string>,
  documentKey: string
): Promise<void> {
  const done = runs.filter(run => !run.open && holdsAny(run, held));
  if (done.length === 0) return;
  const defined = await args.definedBreakpoints();
  for (const run of done) {
    if (run.removedIds.some(id => held.has(id) && !defined.has(id))) {
      await args.runs().reopenFor(run.id, documentKey);
    }
  }
}

/** The removed ids these documents keep anything under, read structurally. */
function heldIds(
  documents: readonly unknown[],
  runs: readonly BreakpointRun[]
): ReadonlySet<string> {
  const asked = new Set(runs.flatMap(run => run.removedIds));
  const ids = new Set<string>();
  for (const document of documents) {
    for (const id of removedIdsIn(document, asked)) ids.add(id);
  }
  return ids;
}

/** Whether a run's removed ids are among those held. */
function holdsAny(run: BreakpointRun, held: ReadonlySet<string>): boolean {
  return run.removedIds.some(id => held.has(id));
}
