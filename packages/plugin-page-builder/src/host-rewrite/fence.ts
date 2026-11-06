/**
 * The fence: while a component's copies are being turned into plain blocks, no
 * write may add a new reference to it.
 *
 * Opening a run inserts its row, and that insert IS the fence: the row's
 * `componentId` is unique, so two people starting one delete at once start one
 * run, and every write from then on reads the row. A write is judged by
 * comparing what it would store with what is stored now, read afresh on the
 * write's own connection: a reference the stored form already holds may stay
 * (the rewrite converts it), and a reference it does not hold is new and is
 * refused. Judged in the blocks field's validation, which every write path
 * runs, so it holds for the editor, the API, a batch and an import alike.
 *
 * Where the judgement cannot be made it refuses: a stored form that cannot be
 * read, a document too large to survey to the end, a fence that cannot be read
 * at all. Doubt counts as a new reference, because a reference let in by
 * mistake is one the rewrite may already have passed.
 *
 * @module host-rewrite/fence
 */
import {
  componentReferencesIn,
  stillReferences,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { PluginFieldWrite } from "@nextlyhq/plugin-sdk";
import { and, eq } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
} from "@nextlyhq/plugin-sdk/schema";

import { readStoredForms } from "../fields/lock-baselines";
import { componentDeletionHosts, componentDeletions } from "../schema/tables";

import { formsAWriteChanges } from "./lifecycle";

/** The issue code a write adding a reference to a fenced component carries. */
export const COMPONENT_BEING_DELETED = "COMPONENT_BEING_DELETED";

/** Which walk a run is on. */
export type RunPhase = "converting" | "final" | "done";

/**
 * What a run is for. Only a `delete` run fences new references: the component
 * is about to go, so a copy added now would be one nobody converts. A
 * `strip-retired` run removes values of fields the component no longer
 * exposes, and a new copy of the component is no obstacle to that.
 */
export type RunPurpose = "delete" | "strip-retired";

/** One run, as its row stores it. */
export interface DeletionRun {
  readonly id: string;
  readonly componentId: string;
  readonly purpose: RunPurpose;
  /**
   * Who started it, and so who every write is made as: `user:<id>` or
   * `api-key:<id>`.
   */
  readonly startedBy: string;
  readonly phase: RunPhase;
  /** Where the final walk stopped, or `null` before it started. */
  readonly cursor: string | null;
}

/** The fenced components, or the fact that they could not be read. */
export type FencedComponents =
  | { readonly kind: "read"; readonly ids: ReadonlySet<string> }
  | { readonly kind: "unreadable" };

/** The runs' own table, through the plugin's database surface. */
export interface FenceStore {
  /**
   * Open the run for a component and purpose; a `delete` run fences the
   * component. `opened` is false when that run already exists (started by
   * anybody), and that run is answered.
   */
  open(
    componentId: string,
    purpose: RunPurpose,
    startedBy: string
  ): Promise<{ readonly opened: boolean; readonly run: DeletionRun }>;
  /** The run for a component and purpose, or `null` when none is open. */
  runFor(componentId: string, purpose: RunPurpose): Promise<DeletionRun | null>;
  /** One run by its id, or `null` once it is closed. */
  runById(runId: string): Promise<DeletionRun | null>;
  /**
   * Move a run from one phase to another, with where its final walk stopped.
   * Answers false, changing nothing, when the run is no longer in `from`: a
   * write re-queued a document and sent it back to its converting walk.
   */
  advance(
    runId: string,
    from: RunPhase,
    to: RunPhase,
    cursor: string | null
  ): Promise<boolean>;
  /** Every component a `delete` run is open for. */
  fenced(): Promise<ReadonlySet<string>>;
  /** Close a run, which lifts a `delete` run's fence, and drop its progress. */
  close(componentId: string, purpose: RunPurpose): Promise<void>;
}

/** The dialect, as `ctx.dialect` names it. */
type Dialect = Parameters<typeof isUniqueViolation>[0];

/** A stored phase, read strictly: anything else is the converting walk. */
function phaseOf(value: string): RunPhase {
  return value === "final" || value === "done" ? value : "converting";
}

/**
 * A stored purpose, read strictly. Anything else reads as `delete`, the one
 * that fences: a row nobody can classify keeps refusing new references rather
 * than letting them through.
 */
function purposeOf(value: string): RunPurpose {
  return value === "strip-retired" ? value : "delete";
}

/** A run row as this module hands it out. */
function runOf(row: {
  id: string;
  componentId: string;
  purpose: string;
  startedBy: string;
  phase: string;
  cursor: string | null;
}): DeletionRun {
  return {
    id: row.id,
    componentId: row.componentId,
    purpose: purposeOf(row.purpose),
    startedBy: row.startedBy,
    phase: phaseOf(row.phase),
    cursor: row.cursor,
  };
}

/** Both conditions, as one. `and` is typed as possibly empty; two never are. */
function both(
  first: NonNullable<ReturnType<typeof and>>,
  second: NonNullable<ReturnType<typeof and>>
): NonNullable<ReturnType<typeof and>> {
  return and(first, second) ?? first;
}

/** The fence store over the plugin's own `ctx.db`. */
export function fenceStore(
  db: Pick<PluginDatabase, "transaction" | "select" | "table" | "update">,
  dialect: Dialect
): FenceStore {
  // Resolved per call: reading the fence needs no column handle at all.
  const columns = () => db.table(componentDeletions);
  const runFor = async (
    componentId: string,
    purpose: RunPurpose
  ): Promise<DeletionRun | null> => {
    const r = columns();
    const row = await db
      .select(componentDeletions)
      .where(both(eq(r.componentId, componentId), eq(r.purpose, purpose)))
      .first();
    return row === null ? null : runOf(row);
  };

  return {
    runFor,
    runById: async runId => {
      const row = await db
        .select(componentDeletions)
        .where(eq(columns().id, runId))
        .first();
      return row === null ? null : runOf(row);
    },
    open: async (componentId, purpose, startedBy) => {
      try {
        const run = await db.transaction(tx =>
          tx.insertReturning(componentDeletions, {
            componentId,
            purpose,
            startedBy,
            phase: "converting",
          })
        );
        return { opened: true, run: runOf(run) };
      } catch (error) {
        // The unique key refused a second run: the one that won is the run.
        if (!isUniqueViolation(dialect, error)) throw error;
        const held = await runFor(componentId, purpose);
        if (held === null) throw error;
        return { opened: false, run: held };
      }
    },
    advance: async (runId, from, to, cursor) => {
      // Every move writes a phase or a cursor it did not hold before, so the
      // count is the rows matched on MySQL too, which counts changed rows.
      const r = columns();
      const moved = await db
        .update(componentDeletions, { phase: to, cursor })
        .where(both(eq(r.id, runId), eq(r.phase, from)));
      return moved > 0;
    },
    fenced: async () => {
      // Every open run, filtered here: the table holds one row per run in
      // flight, and a purpose read strictly fences when it cannot be told.
      const rows = await db.select(componentDeletions).all();
      return new Set(
        rows
          .filter(row => purposeOf(row.purpose) === "delete")
          .map(row => row.componentId)
      );
    },
    close: async (componentId, purpose) =>
      db.transaction(async tx => {
        const t = tx.table(componentDeletions);
        const run = await tx
          .select(componentDeletions)
          .where(both(eq(t.componentId, componentId), eq(t.purpose, purpose)))
          .first();
        if (run === null) return;
        const h = tx.table(componentDeletionHosts);
        await tx.delete(componentDeletionHosts).where(eq(h.deletionId, run.id));
        await tx.delete(componentDeletions).where(eq(t.id, run.id));
      }),
  };
}

/** The issue the blocks field raises for a write the fence refuses. */
export interface FenceIssue {
  readonly path: string;
  readonly code: typeof COMPONENT_BEING_DELETED;
  readonly message: string;
}

/** What judging one write against the fence needs. */
export interface FenceJudgement {
  /** The document the write would store. */
  readonly document: BlockDocument;
  readonly write: PluginFieldWrite;
  /** The field's path in the write. */
  readonly path: string;
  /** The lifecycle status the write moves to, when it names one. */
  readonly nextStatus: string | undefined;
  /** Whether the field stores per language. */
  readonly localized: boolean;
  /** How many nodes to read before a document counts as unreadable. */
  readonly maxNodes: number;
  /** The fenced components, read when the write places any component. */
  readonly fenced: () => Promise<FencedComponents>;
}

/**
 * The refusals for a write that adds a reference to a fenced component.
 *
 * Asks nothing of the database for a write that places no component, which is
 * most of them: such a write can add no reference, and the document is
 * surveyed before the fence is read.
 */
export async function fenceIssues(
  judged: FenceJudgement
): Promise<FenceIssue[]> {
  const placed = componentReferencesIn(judged.document, judged.maxNodes);
  if (placed.complete && placed.ids.length === 0) return [];
  const fenced = await judged.fenced();
  // Neither side read to the end: the components the document places beyond
  // its surveyed prefix are unknown, and so is which ones are fenced. An empty
  // prefix proves nothing, so the write is refused as it stands.
  if (fenced.kind === "unreadable" && !placed.complete) {
    return [
      {
        path: judged.path,
        code: COMPONENT_BEING_DELETED,
        message: UNCHECKABLE,
      },
    ];
  }
  const candidates = fencedAmong(placed, fenced);
  if (candidates.length === 0) return [];
  // A write inside a transaction may run with its hooks skipped (a bulk
  // import does), and then nothing re-queues the document after it commits.
  // Validation cannot tell which, so such a write may not hold a fenced
  // reference at all, even one already stored: it is refused, and saving the
  // document on its own, which does run its hooks, still works.
  if (judged.write.inTransaction) {
    return candidates.map(id => ({
      path: judged.path,
      code: COMPONENT_BEING_DELETED,
      message: inBatchMessage(id),
    }));
  }

  const stored = await storedFormsOrNothing(judged);
  return candidates
    .filter(
      id =>
        stored === null ||
        stored.some(form => !holds(form, id, judged.maxNodes))
    )
    .map(id => ({
      path: judged.path,
      code: COMPONENT_BEING_DELETED,
      message: fencedMessage(id, fenced.kind === "unreadable"),
    }));
}

/**
 * The fenced components this write may add. Every one it places, when the
 * fence could not be read; every fenced one, when the document could not be
 * surveyed to the end.
 */
function fencedAmong(
  placed: { readonly ids: readonly string[]; readonly complete: boolean },
  fenced: FencedComponents
): string[] {
  if (fenced.kind === "unreadable") return [...placed.ids];
  if (!placed.complete) return [...fenced.ids];
  return placed.ids.filter(id => fenced.ids.has(id));
}

/**
 * The stored forms this write changes, read afresh; `null` when they cannot be
 * read, which counts every candidate as new. A create stores nothing yet, so
 * it reads as no forms, and every candidate is new to it as well.
 */
async function storedFormsOrNothing(
  judged: FenceJudgement
): Promise<readonly unknown[] | null> {
  // Only top-level fields can be read stored; a field inside a group or a
  // repeater cannot be told apart from new.
  if (/[.[]/.test(judged.path)) return null;
  try {
    const read = await readStoredForms(
      judged.write,
      judged.path,
      formsAWriteChanges(judged.nextStatus),
      judged.localized
    );
    if (!read.readable) return null;
    // A create, or a form with nothing stored: every reference is new to it.
    return read.forms.length === 0 ? [undefined] : read.forms;
  } catch {
    return null;
  }
}

/** Whether a stored form already references a component, beyond doubt. */
function holds(form: unknown, componentId: string, maxNodes: number): boolean {
  return (
    form !== undefined && stillReferences(form, componentId, maxNodes) === "yes"
  );
}

/** The refusal's words. */
/** The refusal for a write inside a transaction holding a fenced reference. */
function inBatchMessage(componentId: string): string {
  return `Component "${componentId}" is being deleted, so content holding it cannot be saved as part of a batch or import. Save it on its own, or remove the component first.`;
}

/** The refusal when neither the fence nor the whole document could be read. */
const UNCHECKABLE =
  "Whether this content adds a component that is being deleted could not be checked, so it cannot be saved right now. Try again in a moment.";

function fencedMessage(componentId: string, unread: boolean): string {
  return unread
    ? `Whether component "${componentId}" is being deleted could not be checked, so it cannot be added here right now. Try again in a moment.`
    : `Component "${componentId}" is being deleted, so it cannot be added here. Remove it and save again; its existing copies are being turned into plain blocks.`;
}

/**
 * The fence as the blocks field reads it: the open runs, or `unreadable` when
 * the table could not be read. Never throws, so a database hiccup refuses only
 * the writes that add a component rather than every write.
 */
export function fencedComponentsReader(
  store: () => Pick<FenceStore, "fenced">,
  onUnreadable: (error: unknown) => void
): () => Promise<FencedComponents> {
  return async () => {
    try {
      return { kind: "read", ids: await store().fenced() };
    } catch (error) {
      onUnreadable(error);
      return { kind: "unreadable" };
    }
  };
}
