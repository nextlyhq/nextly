/**
 * The fence a Layout's removal puts up, in the plugin's own table.
 *
 * One row per Layout (`page_builder__layout_removals`). Inserting it is the
 * fence: from then on the Layout cannot be made the site default, and its own
 * delete or unpublish is refused unless the write carries the row's token at
 * the `final` step. Every step change is a compare-and-set on the token and
 * the step it leaves, so a request that another one replaced changes nothing.
 *
 * Reached only through the plugin's `ctx.db`, never a collection, so no admin
 * screen, REST route or Direct API call can write a row that lets a plain
 * delete through.
 *
 * @module layout-removal/store
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { and, eq, inArray, isNotNull, isNull } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
} from "@nextlyhq/plugin-sdk/schema";

import { layoutRemovals } from "../schema/tables";

/**
 * How long a row may sit at a step before a later removal may take it over,
 * and the sweep may clear it: a request that stopped part-way leaves its row,
 * and nothing else would ever move it on.
 */
export const REMOVAL_LEASE_MS: number = 5 * 60_000;

/** What a removal does to the Layout once nothing stops it. */
export type RemovalAction = "delete" | "unpublish";

/**
 * Where a removal has got to. `restoring` is held only while a Layout a
 * promotion raced is put back from its copy (`restore.ts`).
 */
export type RemovalStep =
  | "marked"
  | "checked"
  | "final"
  | "removed"
  | "restoring";

/** The Layout as it stood at the final step: its live row and working draft. */
export interface LayoutCopy {
  readonly live: Record<string, unknown>;
  readonly draft: Record<string, unknown> | null;
}

/** One stored removal. */
export interface LayoutRemoval {
  readonly layoutId: string;
  readonly action: RemovalAction;
  readonly step: RemovalStep;
  readonly token: string;
  readonly startedBy: string | null;
  readonly pagesLeft: number | null;
  readonly copy: LayoutCopy | null;
  readonly copyVersion: string | null;
  readonly settledAt: Date | null;
  readonly updatedAt: Date;
}

/** What a mark answers: the fence is this request's, or another's holds it. */
export type MarkOutcome =
  | { readonly kind: "marked" }
  | { readonly kind: "busy"; readonly removal: LayoutRemoval };

/** The values a step change may set beside the step. */
export interface StepValues {
  readonly copy?: LayoutCopy | null;
  readonly copyVersion?: string | null;
  readonly pagesLeft?: number | null;
}

/** The fence's operations. Every write but the first insert is fenced by token. */
export interface LayoutRemovalStore {
  /** The row for one Layout, or `null` when it is not being removed. */
  removalOf(layoutId: string): Promise<LayoutRemoval | null>;
  /**
   * Put the fence up for `token`. A row already there answers `busy`, unless
   * it is a settled tombstone or older than the lease, which this takes over.
   */
  mark(input: {
    layoutId: string;
    action: RemovalAction;
    token: string;
    startedBy: string | null;
    now: Date;
  }): Promise<MarkOutcome>;
  /** Move `token`'s row from one step to the next. False when it is not there. */
  advance(change: {
    layoutId: string;
    token: string;
    from: RemovalStep;
    to: RemovalStep;
    set?: StepValues;
  }): Promise<boolean>;
  /**
   * Record the check after the write as passed, and drop the copy. The row
   * ends at `removed` whichever step it leaves (`removed`, or `restoring`).
   */
  settle(layoutId: string, token: string, from?: RemovalStep): Promise<boolean>;
  /** Take `token`'s fence down. */
  stop(layoutId: string, token: string): Promise<boolean>;
  /**
   * Take down a fence the sweep judged stale, only while it is still exactly
   * as the sweep read it: the same token, step and `updatedAt`. A removal
   * that moved on, or renewed its lease, after the read is left alone.
   */
  stopStale(
    observed: Pick<LayoutRemoval, "layoutId" | "token" | "step" | "updatedAt">
  ): Promise<boolean>;
  /**
   * Renew `token`'s lease at `step`, so a removal busy with a long scan never
   * looks stopped. False when the row moved on or another request holds it.
   */
  renew(layoutId: string, token: string, step: RemovalStep): Promise<boolean>;
  /**
   * Drop an unpublish removal's tombstone, so the Layout can be chosen again
   * once it is published. Rows at any other step are left alone.
   */
  releaseTombstone(layoutId: string): Promise<void>;
  /** Every row whose check after the write has not passed. */
  unsettled(): Promise<LayoutRemoval[]>;
  /** The rows of `layoutIds` that have one, as one read. */
  removalsOf(layoutIds: readonly string[]): Promise<LayoutRemoval[]>;
  /** Every settled unpublish tombstone. */
  tombstones(): Promise<LayoutRemoval[]>;
}

/** The database the plugin runs on, as `ctx.dialect` names it. */
type Dialect = Parameters<typeof isUniqueViolation>[0];

/** The table's stored row, as `ctx.db` reads it. */
type StoredRow = Awaited<
  ReturnType<ReturnType<PluginDatabase["select"]>["first"]>
>;

const ACTIONS: readonly RemovalAction[] = ["delete", "unpublish"];
const STEPS: readonly RemovalStep[] = [
  "marked",
  "checked",
  "final",
  "removed",
  "restoring",
];

/** A stored timestamp as a `Date`, whichever form the driver answered. */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** The stored copy, parsed where the dialect hands JSON back as text. */
function copyOf(value: unknown): LayoutCopy | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { live, draft } = parsed as { live?: unknown; draft?: unknown };
  if (typeof live !== "object" || live === null) return null;
  return {
    live: live as Record<string, unknown>,
    draft:
      typeof draft === "object" && draft !== null
        ? (draft as Record<string, unknown>)
        : null,
  };
}

/**
 * A stored row as a removal. A row whose action or step this code does not
 * know is read as a removal in progress rather than dropped, so an unknown
 * value keeps the fence up instead of lifting it.
 */
function toRemoval(row: NonNullable<StoredRow>): LayoutRemoval {
  const stored = row as Record<string, unknown>;
  const action = ACTIONS.find(a => a === stored.action) ?? "delete";
  const step = STEPS.find(s => s === stored.step) ?? "marked";
  const pagesLeft = stored.pagesLeft;
  const copyVersion = stored.copyVersion;
  const startedBy = stored.startedBy;
  return {
    layoutId: String(stored.layoutId),
    action,
    step,
    // PostgreSQL pads a `char(36)`; a token is exactly 36 long, so trimming
    // only guards a value written shorter by hand.
    token: String(stored.token).trim(),
    startedBy: typeof startedBy === "string" ? startedBy : null,
    pagesLeft: typeof pagesLeft === "number" ? pagesLeft : null,
    copy: copyOf(stored.copy),
    copyVersion: typeof copyVersion === "string" ? copyVersion : null,
    settledAt: toDate(stored.settledAt),
    updatedAt: toDate(stored.updatedAt) ?? new Date(0),
  };
}

/**
 * Whether a row another request left may be taken over: a tombstone whose
 * check after the write passed, or any row older than the lease.
 */
export function mayTakeOver(removal: LayoutRemoval, now: Date): boolean {
  if (removal.step === "removed" && removal.settledAt !== null) return true;
  return now.getTime() - removal.updatedAt.getTime() > REMOVAL_LEASE_MS;
}

/**
 * Whether a removal still holds its Layout: it is between its mark and its
 * write, and inside its lease. A settled one, one past its write, and one a
 * stopped request left past the lease hold nothing.
 */
export function holdsTheLayout(removal: LayoutRemoval, now: Date): boolean {
  const running =
    removal.step === "marked" ||
    removal.step === "checked" ||
    removal.step === "final";
  return (
    running && now.getTime() - removal.updatedAt.getTime() <= REMOVAL_LEASE_MS
  );
}

/** Both conditions, as one. `and` is typed as possibly empty; two never are. */
function both(
  first: NonNullable<ReturnType<typeof and>>,
  ...rest: NonNullable<ReturnType<typeof and>>[]
): NonNullable<ReturnType<typeof and>> {
  return and(first, ...rest) ?? first;
}

/** The fence over the plugin's own database surface. */
export function layoutRemovalStore(
  db: Pick<PluginDatabase, "select" | "insert" | "update" | "delete" | "table">,
  /** Which database, so a lost race to insert the fence is recognised. */
  dialect: Dialect
): LayoutRemovalStore {
  const t = () => db.table(layoutRemovals);

  const removalOf = async (layoutId: string) => {
    const row = await db
      .select(layoutRemovals)
      .where(eq(t().layoutId, layoutId))
      .first();
    return row === null ? null : toRemoval(row);
  };

  /** Hand a row another request left to `input`, if it is still as read. */
  const takeOver = async (
    held: LayoutRemoval,
    input: Parameters<LayoutRemovalStore["mark"]>[0]
  ): Promise<boolean> => {
    const changed = await db
      .update(layoutRemovals, {
        action: input.action,
        step: "marked",
        token: input.token,
        startedBy: input.startedBy,
        pagesLeft: null,
        copy: null,
        copyVersion: null,
        settledAt: null,
      })
      .where(
        both(
          eq(t().layoutId, input.layoutId),
          eq(t().token, held.token),
          eq(t().step, held.step)
        )
      );
    return changed === 1;
  };

  const mark: LayoutRemovalStore["mark"] = async input => {
    // Twice at most: a row that was there at the insert may be gone by the
    // read that follows, and then the insert is tried once more.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await db.insert(layoutRemovals, {
          layoutId: input.layoutId,
          action: input.action,
          step: "marked",
          token: input.token,
          startedBy: input.startedBy,
        });
        return { kind: "marked" };
      } catch (error) {
        if (!isUniqueViolation(dialect, error)) throw error;
      }
      const held = await removalOf(input.layoutId);
      if (held === null) continue;
      if (mayTakeOver(held, input.now) && (await takeOver(held, input))) {
        return { kind: "marked" };
      }
      return {
        kind: "busy",
        removal: (await removalOf(input.layoutId)) ?? held,
      };
    }
    throw NextlyError.conflict({
      reason: "state",
      message: "This Layout is already being removed.",
      logContext: { reason: "layout-removal-mark-contended" },
    });
  };

  return {
    removalOf,
    mark,

    advance: async ({ layoutId, token, from, to, set = {} }) => {
      const changed = await db
        .update(layoutRemovals, { step: to, ...set })
        .where(
          both(
            eq(t().layoutId, layoutId),
            eq(t().token, token),
            eq(t().step, from)
          )
        );
      return changed === 1;
    },

    settle: async (layoutId, token, from = "removed") => {
      const changed = await db
        .update(layoutRemovals, {
          step: "removed",
          settledAt: new Date(),
          copy: null,
        })
        .where(
          both(
            eq(t().layoutId, layoutId),
            eq(t().token, token),
            eq(t().step, from)
          )
        );
      return changed === 1;
    },

    stop: async (layoutId, token) => {
      const changed = await db
        .delete(layoutRemovals)
        .where(both(eq(t().layoutId, layoutId), eq(t().token, token)));
      return changed === 1;
    },

    stopStale: async observed => {
      const changed = await db
        .delete(layoutRemovals)
        .where(
          both(
            eq(t().layoutId, observed.layoutId),
            eq(t().token, observed.token),
            eq(t().step, observed.step),
            eq(t().updatedAt, observed.updatedAt)
          )
        );
      return changed === 1;
    },

    renew: async (layoutId, token, step) => {
      // Setting the step it already holds is the write; the table refreshes
      // `updatedAt` on every update.
      const changed = await db
        .update(layoutRemovals, { step })
        .where(
          both(
            eq(t().layoutId, layoutId),
            eq(t().token, token),
            eq(t().step, step)
          )
        );
      return changed === 1;
    },

    releaseTombstone: async layoutId => {
      await db
        .delete(layoutRemovals)
        .where(
          both(
            eq(t().layoutId, layoutId),
            eq(t().step, "removed"),
            eq(t().action, "unpublish")
          )
        );
    },

    removalsOf: async layoutIds => {
      if (layoutIds.length === 0) return [];
      const rows = await db
        .select(layoutRemovals)
        .where(inArray(t().layoutId, [...layoutIds]))
        .all();
      return rows.map(toRemoval);
    },

    tombstones: async () => {
      const rows = await db
        .select(layoutRemovals)
        .where(
          both(
            eq(t().step, "removed"),
            eq(t().action, "unpublish"),
            isNotNull(t().settledAt)
          )
        )
        .all();
      return rows.map(toRemoval);
    },

    unsettled: async () => {
      const rows = await db
        .select(layoutRemovals)
        .where(isNull(t().settledAt))
        .all();
      return rows.map(toRemoval);
    },
  };
}

/** The parts of a Drizzle executor the fence reads use. */
interface DrizzleExecutor {
  select(): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(count: number): PromiseLike<unknown[]>;
      };
    };
  };
  delete(table: unknown): { where(condition: unknown): PromiseLike<unknown> };
}

/** Whether a hook's executor answers the Drizzle calls the fence reads make. */
function isDrizzleExecutor(value: unknown): value is DrizzleExecutor {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { select?: unknown }).select === "function" &&
    typeof (value as { delete?: unknown }).delete === "function"
  );
}

/**
 * The fence's reads and its tombstone release, run through a caller's
 * transaction: the Drizzle executor core hands a hook inside one. The read
 * then runs on the transaction's own connection, rather than taking a second
 * one the open transaction can starve, and the release commits or rolls back
 * with the write that caused it. `null` for an executor of another shape.
 */
export function fenceOnExecutor(
  db: Pick<PluginDatabase, "table">,
  executor: unknown
): Pick<LayoutRemovalStore, "removalOf" | "releaseTombstone"> | null {
  if (!isDrizzleExecutor(executor)) return null;
  const table = db.table(layoutRemovals);
  return {
    removalOf: async layoutId => {
      const rows = await executor
        .select()
        .from(table)
        .where(eq(table.layoutId, layoutId))
        .limit(1);
      const row = rows[0];
      return row === undefined
        ? null
        : toRemoval(row as NonNullable<StoredRow>);
    },
    releaseTombstone: async layoutId => {
      await executor
        .delete(table)
        .where(
          both(
            eq(table.layoutId, layoutId),
            eq(table.step, "removed"),
            eq(table.action, "unpublish")
          )
        );
    },
  };
}
