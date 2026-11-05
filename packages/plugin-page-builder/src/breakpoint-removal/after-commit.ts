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
 * After commit, because only then is the stored value the one a later read
 * sees. A failure here is logged, never thrown: the write has committed, and
 * the final walk reads every document again regardless.
 *
 * @module breakpoint-removal/after-commit
 */
import type { DocumentLimits } from "@nextlyhq/blocks-engine";

import {
  committedWrite,
  type FencedWriteReportContext,
} from "../host-rewrite/after-commit";
import { documentKeyOf } from "../host-rewrite/contract";

import type { RemovalRunStore } from "./run-store";
import { breakpointUsesIn } from "./usage";

/** What the report is wired with. */
export interface RemovalWriteReportArgs {
  readonly ctx: FencedWriteReportContext;
  readonly runs: () => Pick<RemovalRunStore, "openRun" | "requeue">;
  readonly limits: () => DocumentLimits;
}

/** Register the report on every committed create and update. */
export function registerRemovalWriteReport(args: RemovalWriteReportArgs): void {
  for (const phase of ["afterCreate", "afterUpdate"] as const) {
    args.ctx.hooks.on(phase, "*", context => reportWrite(args, context));
  }
}

/** Re-queue the written document when it holds an open removal's values. */
async function reportWrite(
  args: RemovalWriteReportArgs,
  context: unknown
): Promise<void> {
  const written = committedWrite(context);
  if (written === undefined || written.at === undefined) return;
  try {
    const run = await args.runs().openRun();
    if (run === null) return;
    const ids = new Set(run.removedIds);
    // A value that cannot be read to the end may hold one: re-queued too.
    const holds = written.documents.some(document => {
      const read = breakpointUsesIn(document, ids, args.limits());
      return !read.complete || read.uses.size > 0;
    });
    if (!holds) return;
    await args.runs().requeue(run.id, documentKeyOf(written.at));
  } catch (error) {
    args.ctx.logger.error(
      `[page-builder] a write to "${written.collection}" holding styles under ` +
        "a breakpoint being removed was not re-queued; the removal's final " +
        "check reads it again.",
      { collection: written.collection, error }
    );
  }
}
