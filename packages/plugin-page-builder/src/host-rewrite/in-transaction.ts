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
 * (`ctx.hooks.onInTransaction`), against the open `delete` runs of the
 * components it holds, read through that transaction:
 *
 * - a run judging its hosts (`preflight`) has written nothing, and its
 *   converting walk reads every document, so nothing is owed;
 * - a run walking (`converting`, `final`, `done`) is sent back to its
 *   converting walk, and the document marked pending, in the write's own
 *   transaction. The run row's update takes its lock, so it is ordered
 *   against the delete's move from `done` to `deleting`: whichever commits
 *   second finds the other's phase, so the delete never passes a save that
 *   keeps a copy, and the copy is converted again from what was saved;
 * - a run deleting the component (`deleting`, `settling`) refuses the write:
 *   its final walk found no copy left, so a save holding one now was made
 *   from a stale copy (spec: refused, saying the component was turned into
 *   plain blocks).
 *
 * Throwing aborts the write and everything it did, a batch included. A write
 * holding no component costs nothing here: its documents are surveyed before
 * any table is read.
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
  /** A value never stored before, stamped on a run sent back to converting. */
  readonly stamp?: () => string;
}

/** Register the fence on every write, whatever it writes to. */
export function registerInTransactionFence(args: InTransactionFenceArgs): void {
  const stamp = args.stamp ?? (() => globalThis.crypto.randomUUID());
  args.ctx.hooks.onInTransaction("*", write =>
    judgeInTransaction(write, args.limits().maxNodes, stamp)
  );
}

/** The phases in which a run walks its hosts, and is sent back to converting. */
const WALKING: readonly StoredPhase[] = ["converting", "final", "done"];

/** The phases in which the component is being deleted, or has been. */
const DELETING: ReadonlySet<StoredPhase> = new Set(["deleting", "settling"]);

/** How many values of a written row are looked through for blocks documents. */
const MAX_VALUES = 10_000;

/** The write, as far as the fence reads it. */
export type FencedWrite = Pick<
  InTransactionContext,
  "collection" | "operation" | "id" | "data"
> & {
  readonly db: Pick<InTransactionContext["db"], "select" | "table" | "update">;
};

/**
 * Judge one write inside its transaction, as the module docblock says.
 * Throws the refusal; anything else it answers is nothing.
 */
export async function judgeInTransaction(
  write: FencedWrite,
  maxNodes: number,
  stamp: () => string
): Promise<void> {
  // A delete stores nothing, so it can hold no copy.
  if (write.operation === "delete") return;
  const held = heldComponents(write.data, maxNodes);
  if (held.complete && held.ids.size === 0) return;
  const runs = (await write.db.select(componentDeletions).all()).filter(
    run =>
      run.purpose !== "strip-retired" &&
      (!held.complete || held.ids.has(run.componentId))
  );
  if (runs.length === 0) return;
  const at = hookDocumentOf(write.collection, { id: write.id });
  for (const run of runs) {
    const phase = run.phase as StoredPhase;
    if (DELETING.has(phase)) {
      throw refusal(held.field, deletedMessage(run.componentId));
    }
    if (phase === "preflight" || at === undefined) continue;
    const t = write.db.table(componentDeletions);
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
      throw refusal(held.field, movedOnMessage(run.componentId));
    }
    // An update only: a row is inserted by the walk alone, so this write
    // never meets the walk's own insert of the same row. A document with no
    // row yet is visited by the converting walk anyway.
    const h = write.db.table(componentDeletionHosts);
    const row = and(eq(h.deletionId, run.id), eq(h.hostKey, documentKeyOf(at)));
    if (row !== undefined) {
      await write.db
        .update(componentDeletionHosts, { state: "pending", reason: null })
        .where(row);
    }
  }
}

/** The components a written row's blocks documents hold. */
interface Held {
  readonly ids: ReadonlySet<string>;
  /** Whether every document was read to the end, and the row looked through. */
  readonly complete: boolean;
  /** The top-level field holding the first document, for the refusal's path. */
  readonly field: string;
}

/**
 * Every component the row's blocks documents reference, wherever in the row
 * they sit: top level, in a named group, in a repeater's rows. A document read
 * only in part, or a row too large to look through, is not complete, and the
 * write is then judged against every open run.
 */
export function heldComponents(data: unknown, maxNodes: number): Held {
  const ids = new Set<string>();
  let complete = true;
  let field = "";
  let budget = MAX_VALUES;
  const visit = (value: unknown, top: string): void => {
    if (budget <= 0) {
      complete = false;
      return;
    }
    budget -= 1;
    const document = asDocument(value);
    if (document !== null) {
      if (field === "") field = top;
      const placed = componentReferencesIn(document, maxNodes);
      for (const id of placed.ids) ids.add(id);
      if (!placed.complete) complete = false;
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, top);
    } else if (isPlainRecord(value)) {
      for (const item of Object.values(value)) visit(item, top);
    }
  };
  if (isPlainRecord(data)) {
    for (const [key, value] of Object.entries(data)) visit(value, key);
  }
  return { ids, complete, field };
}

/** The refusal, as the reference fence words its own: on the field. */
function refusal(path: string, message: string): NextlyError {
  return NextlyError.validation({
    errors: [{ path, code: COMPONENT_BEING_DELETED, message }],
  });
}

function deletedMessage(componentId: string): string {
  return `Component "${componentId}" has been turned into plain blocks and deleted, so content still holding it cannot be saved. Reload to get the converted content, then make your changes again.`;
}

function movedOnMessage(componentId: string): string {
  return `Component "${componentId}" is being deleted, and its copies were being turned into plain blocks while this was saved, so it was not saved. Try again.`;
}
