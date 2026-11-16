/**
 * The fence against saves already in flight when a component is deleted.
 *
 * The reference fence (`fence.ts`) is judged in a write's field validation,
 * before its transaction opens. Two kinds of save get past it and commit
 * later: one validated before the run opened, adding a copy, and one validated
 * while the run was open, keeping a copy the store held then. Either can
 * commit after the walk converted that document; and the delete itself must
 * never go ahead past one of them.
 *
 * So every write is judged once more, LAST INSIDE ITS OWN TRANSACTION
 * (`ctx.hooks.onInTransaction`), against the `delete` runs of the components
 * it holds, read through that transaction:
 *
 * - a run judging its hosts (`preflight`) restarts its check: the save may
 *   have made a copy one the check already passed can no longer convert, and
 *   the delete must stop before anything changes. The run's cursor is reset
 *   in the save's own transaction, under the run row's lock, so the check's
 *   own move on (a compare-and-set on the cursor it read) misses;
 * - a run walking (`converting`, `final`, `done`) is sent back to its
 *   converting walk, and the document marked pending, in the write's own
 *   transaction. The run row's update takes its lock, so it is ordered
 *   against the delete's move from `done` to `deleting`: whichever commits
 *   second finds the other's phase, so the delete never passes a save that
 *   keeps a copy, and the copy is converted again from what was saved;
 * - a run deleting the component (`deleting`), or the row it leaves for good
 *   once the component is gone (`deleted`), refuses the write: its final walk
 *   found no copy left, so a save holding one now was made from a stale copy
 *   (spec: refused, saying the component was turned into plain blocks). The
 *   tombstone never expires, so a save held for any length of time is
 *   refused all the same.
 *
 * And a write to the component ITSELF is judged too: an update or a publish
 * is refused from the moment its run opens (`preflight`) until it is gone, so
 * the hosts are judged and converted from one definition; and creating a
 * component under the id of one a run deleted is refused, since that id's
 * tombstone would treat the new component as deleted.
 *
 * Throwing aborts the write and everything it did, a batch included. A write
 * holding no component costs nothing here: its documents are surveyed before
 * any table is read, and the runs are then read by the index on the
 * component's id, for the components the write holds.
 *
 * @module host-rewrite/in-transaction
 */
import {
  componentReferencesIn,
  isPlainRecord,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import { NextlyError, type InTransactionContext } from "@nextlyhq/plugin-sdk";
import { and, eq, inArray } from "@nextlyhq/plugin-sdk/db";

import { asDocument } from "../component-store-source";
import { componentDeletionHosts, componentDeletions } from "../schema/tables";

import { hookDocumentOf } from "./after-commit";
import { documentKeyOf } from "./contract";
import { COMPONENT_BEING_DELETED, type StoredPhase } from "./fence";

/** The plugin capabilities the fence needs, named structurally. */
export interface InTransactionFenceContext {
  hooks: {
    onInTransaction(
      collection: string,
      handler: (write: InTransactionContext) => Promise<void>
    ): void;
  };
}

/** What the fence is wired with. */
export interface InTransactionFenceArgs {
  readonly ctx: InTransactionFenceContext;
  readonly limits: () => DocumentLimits;
  /** The RESOLVED collection components are stored in. */
  readonly components: string;
  /** A value never stored before, stamped on a run sent back or restarted. */
  readonly stamp?: () => string;
}

/** Register the fence on every write, whatever it writes to. */
export function registerInTransactionFence(args: InTransactionFenceArgs): void {
  const stamp = args.stamp ?? (() => globalThis.crypto.randomUUID());
  args.ctx.hooks.onInTransaction("*", write =>
    judgeInTransaction(write, {
      maxNodes: args.limits().maxNodes,
      components: args.components,
      stamp,
    })
  );
}

/** The phases in which a run walks its hosts, and is sent back to converting. */
const WALKING: readonly StoredPhase[] = ["converting", "final", "done"];

/** The phases in which the component is being deleted, or has been. */
const DELETING: ReadonlySet<StoredPhase> = new Set(["deleting", "deleted"]);

/**
 * The phases in which the component itself may not change: from the run's
 * opening until it is gone, so its hosts are judged and converted from one
 * definition.
 */
const DEFINITION_HELD: ReadonlySet<StoredPhase> = new Set([
  "preflight",
  "converting",
  "final",
  "done",
  "deleting",
]);

/** The prefix of a preflight cursor a save reset: the check starts over. */
export const PREFLIGHT_RESTART = "restart:";

/** How many values of a written row are looked through for blocks documents. */
const MAX_VALUES = 10_000;

/** How many component ids one indexed read of the runs names. */
const IDS_PER_READ = 200;

/** The write, as far as the fence reads it. */
export type FencedWrite = Pick<
  InTransactionContext,
  "collection" | "operation" | "id" | "data"
> & {
  readonly db: Pick<InTransactionContext["db"], "select" | "table" | "update">;
};

/** How the fence judges. */
export interface FenceSettings {
  readonly maxNodes: number;
  /** The RESOLVED collection components are stored in. */
  readonly components: string;
  readonly stamp: () => string;
}

/** A run as the fence reads it. */
interface FencedRun {
  readonly id: string;
  readonly componentId: string;
  readonly purpose: string;
  readonly phase: string;
}

/**
 * Judge one write inside its transaction, as the module docblock says.
 * Throws the refusal; anything else it answers is nothing.
 */
export async function judgeInTransaction(
  write: FencedWrite,
  settings: FenceSettings
): Promise<void> {
  // A delete stores nothing, so it can hold no copy.
  if (write.operation === "delete") return;
  if (write.collection === settings.components) {
    await refuseWhileDefinitionHeld(write);
  }
  const held = heldComponents(write.data, settings.maxNodes);
  if (held.complete && held.ids.size === 0) return;
  const runs = await runsHolding(write, held);
  const at = hookDocumentOf(write.collection, { id: write.id });
  for (const run of runs) {
    await judgeAgainst(write, run, held.field, at, settings.stamp);
  }
}

/**
 * Refuse an update or publish of a component being deleted, and a create
 * under the id of one a run deleted.
 */
async function refuseWhileDefinitionHeld(write: FencedWrite): Promise<void> {
  const t = write.db.table(componentDeletions);
  const where = and(eq(t.componentId, write.id), eq(t.purpose, "delete"));
  if (where === undefined) return;
  const run = await write.db.select(componentDeletions).where(where).first();
  if (run === null) return;
  const phase = run.phase as StoredPhase;
  if (write.operation === "create" && DELETING.has(phase)) {
    throw NextlyError.conflict({
      reason: "state",
      message: ID_REUSED_MESSAGE,
      logContext: { reason: "component-id-deleted", componentId: write.id },
    });
  }
  if (write.operation === "update" && DEFINITION_HELD.has(phase)) {
    throw NextlyError.conflict({
      reason: "state",
      message: DEFINITION_HELD_MESSAGE,
      logContext: { reason: "component-being-deleted", componentId: write.id },
    });
  }
}

/** One run the write holds a component of: refuse, restart or re-queue. */
async function judgeAgainst(
  write: FencedWrite,
  run: FencedRun,
  field: string,
  at: ReturnType<typeof hookDocumentOf>,
  stamp: () => string
): Promise<void> {
  const phase = run.phase as StoredPhase;
  if (DELETING.has(phase)) {
    throw refusal(field, deletedMessage(run.componentId, phase));
  }
  const t = write.db.table(componentDeletions);
  if (phase === "preflight") {
    // The check starts again from the first document; a restart cursor is a
    // value never stored before, so the check's own move from the cursor it
    // read misses.
    const atPreflight = and(eq(t.id, run.id), eq(t.phase, "preflight"));
    if (atPreflight !== undefined) {
      await write.db
        .update(componentDeletions, { cursor: PREFLIGHT_RESTART + stamp() })
        .where(atPreflight);
    }
    return;
  }
  if (at === undefined) return;
  const walking = and(eq(t.id, run.id), inArray(t.phase, [...WALKING]));
  // Always a new cursor, so the row changes and every dialect counts it,
  // MySQL included. No walk reads the cursor while converting.
  const moved =
    walking === undefined
      ? 0
      : await write.db
          .update(componentDeletions, {
            phase: "converting",
            cursor: `requeued:${stamp()}`,
          })
          .where(walking);
  if (moved === 0) {
    // The run moved on (to deleting) or closed after it was read: whether
    // this save may keep its copy can no longer be told here.
    throw refusal(field, movedOnMessage(run.componentId));
  }
  await markPendingInWrite(write, run.id, documentKeyOf(at));
}

/**
 * Mark the document pending, by an update only: a row is inserted by the walk
 * alone, so this write never meets the walk's own insert of the same row. A
 * document with no row yet is visited by the converting walk anyway.
 */
async function markPendingInWrite(
  write: FencedWrite,
  runId: string,
  documentKey: string
): Promise<void> {
  const h = write.db.table(componentDeletionHosts);
  const row = and(eq(h.deletionId, runId), eq(h.hostKey, documentKey));
  if (row === undefined) return;
  await write.db
    .update(componentDeletionHosts, { state: "pending", reason: null })
    .where(row);
}

/**
 * The `delete` runs of the components the row holds, by the index on the
 * component's id; every one, for a row read only in part. The read names the
 * components already; matched again here, over the rows in hand, so a read
 * answering more fences nothing extra.
 */
async function runsHolding(
  write: FencedWrite,
  held: Held
): Promise<FencedRun[]> {
  const all = () => write.db.select(componentDeletions).all();
  const rows: Awaited<ReturnType<typeof all>> = [];
  if (!held.complete) {
    rows.push(...(await all()));
  } else {
    const ids = [...held.ids];
    const t = write.db.table(componentDeletions);
    for (let at = 0; at < ids.length; at += IDS_PER_READ) {
      const chunk = ids.slice(at, at + IDS_PER_READ);
      rows.push(
        ...(await write.db
          .select(componentDeletions)
          .where(inArray(t.componentId, chunk))
          .all())
      );
    }
  }
  return rows.filter(
    run =>
      run.purpose !== "strip-retired" &&
      (!held.complete || held.ids.has(run.componentId))
  );
}

/** The components a written row's blocks documents hold. */
interface Held {
  readonly ids: ReadonlySet<string>;
  /** Whether every document was read to the end, and the row looked through. */
  readonly complete: boolean;
  /** The top-level field holding the first document, for the refusal's path. */
  readonly field: string;
}

/** What a look through a row has found so far. */
interface Survey {
  readonly ids: Set<string>;
  complete: boolean;
  field: string;
  budget: number;
  readonly maxNodes: number;
}

/**
 * Every component the row's blocks documents reference, wherever in the row
 * they sit: top level, in a named group, in a repeater's rows. A document read
 * only in part, or a row too large to look through, is not complete, and the
 * write is then judged against every open run.
 */
export function heldComponents(data: unknown, maxNodes: number): Held {
  const survey: Survey = {
    ids: new Set(),
    complete: true,
    field: "",
    budget: MAX_VALUES,
    maxNodes,
  };
  if (isPlainRecord(data)) {
    for (const [key, value] of Object.entries(data)) {
      surveyValue(survey, value, key);
    }
  }
  return { ids: survey.ids, complete: survey.complete, field: survey.field };
}

/** One value of the row, and what it holds, into the survey. */
function surveyValue(survey: Survey, value: unknown, top: string): void {
  if (survey.budget <= 0) {
    survey.complete = false;
    return;
  }
  survey.budget -= 1;
  const document = asDocument(value);
  if (document !== null) {
    surveyDocument(survey, document, top);
    return;
  }
  const children = Array.isArray(value)
    ? value
    : isPlainRecord(value)
      ? Object.values(value)
      : [];
  for (const child of children) surveyValue(survey, child, top);
}

/** A blocks document's components, into the survey. */
function surveyDocument(
  survey: Survey,
  document: NonNullable<ReturnType<typeof asDocument>>,
  top: string
): void {
  if (survey.field === "") survey.field = top;
  const placed = componentReferencesIn(document, survey.maxNodes);
  for (const id of placed.ids) survey.ids.add(id);
  if (!placed.complete) survey.complete = false;
}

/** The refusal, as the reference fence words its own: on the field. */
function refusal(path: string, message: string): NextlyError {
  return NextlyError.validation({
    errors: [{ path, code: COMPONENT_BEING_DELETED, message }],
  });
}

function deletedMessage(componentId: string, phase: StoredPhase): string {
  const done = phase === "deleted" ? "has been" : "is being";
  return `Component "${componentId}" ${done} turned into plain blocks and deleted, so content still holding it cannot be saved. Reload to get the converted content, then make your changes again.`;
}

function movedOnMessage(componentId: string): string {
  return `Component "${componentId}" is being deleted, and its copies were being turned into plain blocks while this was saved, so it was not saved. Try again.`;
}

const ID_REUSED_MESSAGE =
  "A component with this id was deleted; choose a new id.";

const DEFINITION_HELD_MESSAGE =
  "This component is being deleted, so it can't be changed until the delete finishes. Its copies are being turned into plain blocks from it as it is now.";
