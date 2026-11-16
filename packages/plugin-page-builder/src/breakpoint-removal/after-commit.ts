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
 * value under a breakpoint a done run removed opens that run again for it:
 * pending, on its converting walk, which the removal job carries on. Where
 * another removal holds the one open slot, the document is recorded as left on
 * the done run instead, which keeps the breakpoint from being defined again
 * until that run is carried on. Whether the run is open or done is decided by
 * the run store at the moment it acts (`requeueDocument`), never from an
 * earlier read, so a run that closes in between is opened again rather than
 * missed. The hook writes no document itself.
 *
 * Only values under a breakpoint the site does not define now count: one
 * defined again is the site's own, and the walk strips only the ids still
 * removed (`service`).
 *
 * A write to a document a done run left goes back to that run as well, holding
 * anything or not: a published page left because its pending draft could not
 * be stripped under is resolved by publishing the stripped draft, a write that
 * holds nothing removed, and the run walks it again to find it clean.
 *
 * After commit, because only then is the stored value the one a later read
 * sees. A failure here is logged, never thrown: the write has committed, and
 * the final walk reads every document again regardless.
 *
 * @module breakpoint-removal/after-commit
 */
import { isPlainRecord } from "@nextlyhq/blocks-engine";
import type { HookContext } from "@nextlyhq/plugin-sdk";

import { asDocument } from "../component-store-source";
import {
  hookDocumentOf,
  type FencedWriteReportContext,
} from "../host-rewrite/after-commit";
import { documentKeyOf } from "../host-rewrite/contract";

import type { BreakpointRun, RemovalRunStore } from "./run-store";
import { removedIdsIn } from "./strip";

/** What the report is wired with. */
export interface RemovalWriteReportArgs {
  readonly ctx: FencedWriteReportContext;
  readonly runs: () => Pick<
    RemovalRunStore,
    "runs" | "requeueDocument" | "leftWith"
  >;
  /** The breakpoint ids the site's stylesheet is emitted under now. */
  readonly definedBreakpoints: () => Promise<ReadonlySet<string>>;
  /**
   * Whether a document of `collection` may hold blocks at all, known without
   * a read. A run walks only documents that may, so it can have left none of
   * a collection that may not, and a write to one is not asked about.
   */
  readonly mayHoldBlocks: (collection: string) => boolean;
}

/** Register the report on every committed create and update. */
export function registerRemovalWriteReport(args: RemovalWriteReportArgs): void {
  for (const phase of ["afterCreate", "afterUpdate"] as const) {
    args.ctx.hooks.on(phase, "*", context => reportWrite(args, context));
  }
}

/**
 * Re-queue the written document on each run whose removed values it holds,
 * once the write has committed. A write inside a caller's transaction runs
 * its after-hooks before that transaction commits, so the report is handed to
 * the hook context's `afterCommit`, which holds it until the outermost
 * transaction commits (and drops it on a rollback): read there, the runs take
 * a pooled connection the save no longer holds, rather than one a save
 * holding the pool's last connection would wait for until the pool's wait
 * runs out. Outside a transaction it runs at once.
 */
async function reportWrite(
  args: RemovalWriteReportArgs,
  context: unknown
): Promise<void> {
  const written = writtenDocument(context);
  if (written === undefined || !args.mayHoldBlocks(written.collection)) {
    return;
  }
  const report = () => requeueWritten(args, written);
  const { afterCommit } = context as Pick<HookContext, "afterCommit">;
  await (afterCommit ? afterCommit(report) : report());
}

/** {@link reportWrite}'s work, for the document `written`. Never throws. */
async function requeueWritten(
  args: RemovalWriteReportArgs,
  written: NonNullable<ReturnType<typeof writtenDocument>>
): Promise<void> {
  try {
    // The runs first: a short table, and with no removal recorded, or none
    // whose ids the write holds, nothing else is read. A run's removed ids
    // never change, so this read only picks the runs to ask; each one's state
    // is the store's to read when it acts.
    const runs = await args.runs().runs();
    if (runs.length === 0) return;
    const key = documentKeyOf(written.at);
    // Every write naming a document is asked about, holding blocks at its
    // top level or not: a run may have left a document whose blocks sit in
    // a group or a repeater, or one the write has just cleared.
    const held = heldIds(written.documents, runs);
    const defined =
      held.size === 0 ? new Set<string>() : await args.definedBreakpoints();
    // A document a done run left (a published page whose pending draft it
    // could not strip under, say) goes back too, holding anything or not:
    // this write may be what resolved it (the stripped draft published), and
    // the run keeps its ids from being defined again until it walks the
    // document and finds it clean.
    const left = await args.runs().leftWith(
      key,
      runs.filter(run => !run.open).map(run => run.id)
    );
    for (const run of runs) {
      const holds = run.removedIds.some(id => held.has(id) && !defined.has(id));
      if (holds || left.has(run.id)) {
        await args.runs().requeueDocument(run.id, key);
      }
    }
  } catch (error) {
    args.ctx.logger.error(
      `[page-builder] a write to "${written.collection}" holding styles under ` +
        "a removed breakpoint was not sent back to be stripped; the removal's " +
        "final check, or carrying it on, reads it again.",
      { collection: written.collection, error }
    );
  }
}

/** How many values one write's row is searched through for documents. */
const MOST_VALUES_SEARCHED = 20_000;

/**
 * A committed create or update as this report reads it: the document written,
 * and every blocks document its row holds wherever it sits, at the top level
 * or inside groups and repeaters, as the walk finds them. `undefined` for a
 * write that names no document.
 */
function writtenDocument(context: unknown):
  | {
      readonly collection: string;
      readonly at: NonNullable<ReturnType<typeof hookDocumentOf>>;
      readonly documents: readonly unknown[];
    }
  | undefined {
  const fields = context as { collection?: unknown; data?: unknown };
  const data = fields.data;
  if (typeof fields.collection !== "string" || !isPlainRecord(data)) {
    return undefined;
  }
  const at = hookDocumentOf(fields.collection, data);
  if (at === undefined) return undefined;
  return { collection: fields.collection, at, documents: documentsIn(data) };
}

/**
 * Every blocks document in a row, searched through its records and lists,
 * a document's own nodes not searched again. The search is bounded; what it
 * does not reach, the removal's final walk reads.
 */
function documentsIn(row: Record<string, unknown>): unknown[] {
  const found: unknown[] = [];
  const stack: unknown[] = Object.values(row);
  for (
    let seen = 0;
    stack.length > 0 && seen < MOST_VALUES_SEARCHED;
    seen += 1
  ) {
    const value = stack.pop();
    const document = asDocument(value);
    if (document !== null) {
      found.push(document);
    } else if (Array.isArray(value)) {
      stack.push(...value);
    } else if (isPlainRecord(value)) {
      stack.push(...Object.values(value));
    }
  }
  return found;
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
