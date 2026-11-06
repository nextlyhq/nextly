/**
 * The usage indexes' bookkeeping, in the plugin's own tables.
 *
 * Three facts decide whether an index count is exact, and each used to be
 * kept somewhere it could be wrong without anybody noticing:
 *
 * - WHICH RUN is current. A backfill pass that started under one derivation
 *   and finished after the bounds moved used to write its rows over the newer
 *   run's. Every pass now carries its run's token, and every write it makes
 *   checks, in its own transaction, that the token is still the current one.
 *   A replaced pass is refused before it writes anything.
 * - HOW FAR each scope has been walked. A scope larger than one job's budget
 *   used to start again on every tick and never finish. The cursor is now a
 *   row, so the next tick resumes after the last document finished.
 * - WHETHER A MAINTENANCE WRITE FAILED. A failed save left the index stale
 *   while health still said it was whole. A failure now marks the bookkeeping
 *   dirty and starts a new run, and only that run, once it has walked every
 *   scope, clears the mark. A later successful save does not: it repairs its
 *   own document and says nothing about the one that failed.
 *
 * The rows live in tables only this plugin's `ctx.db` reaches, so no admin
 * screen, REST route or Direct API call can forge progress. A plugin that
 * declares a dependency on this one can still reach them through its own
 * `ctx.db`, as it can any table of a dependency; that is a reviewed,
 * declared edge rather than a person's edit.
 *
 * @module usage-bookkeeping
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { and, eq, ne } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
  type PluginTransaction,
} from "@nextlyhq/plugin-sdk/schema";

import { usageProgress, usageRuns } from "./schema/tables";

/** The one run row's name. */
const RUN = "usage";

/** Why a pass's write was refused: a newer run replaced the one it belongs to. */
const SUPERSEDED = "usage-run-superseded";

/** What a pass starts from: its run, and how far that run has got. */
export interface UsageRun {
  /** The token every write of the pass is fenced by. */
  token: string;
  /** Whether a maintenance write failed since the last run that finished. */
  dirty: boolean;
  /** The scope keys this run has walked whole. */
  done: ReadonlySet<string>;
  /** Where this run's walk of each unfinished scope stopped. */
  cursors: ReadonlyMap<string, string>;
}

/** The bookkeeping as health reads it, from one snapshot. */
export interface UsageBookkeepingSnapshot<TProbe> {
  /** The derivation the current run walks under, or `null` when none started. */
  generation: string | null;
  dirty: boolean;
  /** The scope keys the current run has walked whole. */
  done: ReadonlySet<string>;
  /** What the caller's own read found, in the same snapshot. */
  probed: TProbe;
}

/** The bookkeeping's operations. Every write that belongs to a pass is fenced. */
export interface UsageBookkeeping {
  /**
   * Resume the current run, or start a new one when the derivation moved.
   * Starting one discards every other run's progress in the same transaction.
   */
  begin(generation: string): Promise<UsageRun>;
  /** Record where a scope's walk got to. Fenced. */
  checkpoint(token: string, scopeKey: string, cursor: string): Promise<void>;
  /** Record a scope as walked whole. Fenced. */
  complete(token: string, scopeKey: string): Promise<void>;
  /** Clear the dirty mark, once the run has walked every scope. Fenced. */
  finish(token: string): Promise<void>;
  /**
   * Run an index write only while `token` is current, in the transaction that
   * checks it, holding the run row for its length so a newer run cannot start
   * until it has landed. The write goes through `tx`, so it commits with the
   * check or not at all.
   */
  fenced<T>(
    token: string,
    write: (tx: PluginTransaction) => Promise<T>
  ): Promise<T>;
  /** A maintenance write failed: mark the index dirty and start a new run. */
  markDirty(): Promise<void>;
  /**
   * The bookkeeping health reads, and `probe`'s own read of the index rows,
   * all from one snapshot, so the rows are the ones the recorded run left.
   */
  snapshot<TProbe>(
    probe: (tx: PluginTransaction) => Promise<TProbe>
  ): Promise<UsageBookkeepingSnapshot<TProbe>>;
}

/** The refusal a replaced pass's write meets. */
function supersededRun(): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message:
      "A newer usage index run has started, so this pass's work is discarded.",
    logContext: { usage: SUPERSEDED },
  });
}

/**
 * Whether `error` is the fence refusing a replaced pass.
 *
 * A pass that meets it has nothing left to do: the newer run walks every scope
 * again, so the pass ends quietly instead of failing the job.
 */
export function isSupersededRun(error: unknown): boolean {
  return (
    NextlyError.isCode(error, "CONFLICT") &&
    error.logContext?.usage === SUPERSEDED
  );
}

/** The run row, or `null` before any run has started. */
async function readRun(
  tx: PluginTransaction
): Promise<{ generation: string; token: string; dirty: boolean } | null> {
  const r = tx.table(usageRuns);
  const row = await tx.select(usageRuns).where(eq(r.name, RUN)).first();
  return row === null
    ? null
    : { generation: row.generation, token: row.token, dirty: row.dirty };
}

/**
 * Refuse unless `token` is the current run's, and hold the run row.
 *
 * An UPDATE rather than a read, because an update locks the row it matches
 * until the transaction ends on PostgreSQL and MySQL, so a newer run's start,
 * which updates the same row, waits for this transaction to finish. A read
 * would let the run be replaced between the check and the write it guards.
 * SQLite runs one transaction at a time, so there the check alone suffices.
 * It sets the token to the value it already has, which every dialect counts
 * as the one row matched.
 */
async function assertCurrent(
  tx: PluginTransaction,
  token: string
): Promise<void> {
  const r = tx.table(usageRuns);
  const held = await tx
    .update(usageRuns, { token })
    .where(onlyWhen(eq(r.name, RUN), eq(r.token, token)));
  if (held === 1) return;
  if (held === 0) throw supersededRun();
  // The driver could not say how many rows matched, so a current run and a
  // replaced one look alike. Refused, because writing on a guess is the
  // failure the fence exists to prevent.
  throw NextlyError.internal({
    logContext: { usage: "usage-run-fence-unreadable", matched: held },
  });
}

/** Both conditions, as one. `and` is typed as possibly empty; two never are. */
function onlyWhen(
  first: NonNullable<ReturnType<typeof and>>,
  second: NonNullable<ReturnType<typeof and>>
): NonNullable<ReturnType<typeof and>> {
  return and(first, second) ?? first;
}

/** Remove every run's progress but `token`'s. */
async function dropOtherRuns(
  tx: PluginTransaction,
  token: string
): Promise<void> {
  const p = tx.table(usageProgress);
  await tx.delete(usageProgress).where(ne(p.token, token));
}

/**
 * Forget every run's progress on one scope, through the transaction it is
 * handed: for a scope that no longer exists, so one that comes back under the
 * same key is walked again rather than read as walked.
 */
export async function forgetScopeProgress(
  tx: Pick<PluginTransaction, "delete" | "table">,
  scopeKey: string
): Promise<void> {
  const p = tx.table(usageProgress);
  await tx.delete(usageProgress).where(eq(p.scopeKey, scopeKey));
}

/** One scope's progress row, written whether or not it exists yet. */
async function writeProgress(
  tx: PluginTransaction,
  token: string,
  scopeKey: string,
  set: { cursor?: string; done?: boolean }
): Promise<void> {
  const p = tx.table(usageProgress);
  const changed = await tx
    .update(usageProgress, set)
    .where(onlyWhen(eq(p.token, token), eq(p.scopeKey, scopeKey)));
  if (changed > 0) return;
  await tx.insert(usageProgress, { token, scopeKey, ...set });
}

/**
 * Run `work` once more when its first attempt lost the race to insert the run
 * row. Two instances starting the first run at once both read no row; the
 * unique name lets one insert, and the other then finds that row.
 */
async function retryOnFirstInsert<T>(
  dialect: Dialect,
  work: () => Promise<T>
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!isUniqueViolation(dialect, error)) throw error;
    return work();
  }
}

/** The database the plugin runs on, as `ctx.dialect` names it. */
type Dialect = Parameters<typeof isUniqueViolation>[0];

/** Build the bookkeeping over the plugin's own database surface. */
export function usageBookkeeping(
  db: Pick<PluginDatabase, "transaction">,
  /** Which database, so a lost race to insert the run row is recognised. */
  dialect: Dialect,
  /** Makes a run's token; injected so a test can name the runs it starts. */
  newToken: () => string = () => globalThis.crypto.randomUUID()
): UsageBookkeeping {
  const fencedWrite = <T>(
    token: string,
    write: (tx: PluginTransaction) => Promise<T>
  ): Promise<T> =>
    db.transaction(async tx => {
      await assertCurrent(tx, token);
      return write(tx);
    });

  return {
    begin: generation =>
      retryOnFirstInsert(dialect, () =>
        db.transaction(async tx => {
          const row = await readRun(tx);
          let token: string;
          let dirty: boolean;
          if (row === null) {
            token = newToken();
            dirty = false;
            await tx.insert(usageRuns, { name: RUN, generation, token });
            await dropOtherRuns(tx, token);
          } else if (row.generation !== generation) {
            // Another derivation's progress is no progress towards this one,
            // and is removed rather than kept for a return to its bounds: the
            // run in between changed the index it described. The dirty mark
            // is kept; only a run that walks everything clears it.
            token = newToken();
            dirty = row.dirty;
            const r = tx.table(usageRuns);
            await tx
              .update(usageRuns, { generation, token })
              .where(eq(r.name, RUN));
            await dropOtherRuns(tx, token);
          } else {
            token = row.token;
            dirty = row.dirty;
          }

          const p = tx.table(usageProgress);
          const rows = await tx
            .select(usageProgress)
            .where(eq(p.token, token))
            .all();
          const done = new Set<string>();
          const cursors = new Map<string, string>();
          for (const progress of rows) {
            if (progress.done) done.add(progress.scopeKey);
            else if (progress.cursor !== null) {
              cursors.set(progress.scopeKey, progress.cursor);
            }
          }
          return { token, dirty, done, cursors };
        })
      ),

    checkpoint: (token, scopeKey, cursor) =>
      fencedWrite(token, tx => writeProgress(tx, token, scopeKey, { cursor })),

    complete: (token, scopeKey) =>
      fencedWrite(token, tx =>
        writeProgress(tx, token, scopeKey, { done: true })
      ),

    finish: token =>
      fencedWrite(token, async tx => {
        const r = tx.table(usageRuns);
        await tx
          .update(usageRuns, { dirty: false })
          .where(onlyWhen(eq(r.name, RUN), eq(r.token, token)));
      }),

    fenced: (token, write) => fencedWrite(token, write),

    markDirty: () =>
      retryOnFirstInsert(dialect, () =>
        db.transaction(async tx => {
          // A new token as well as the mark. The run that was walking when
          // the write failed may already have passed the document it failed
          // on, so finishing it would clear the mark over a stale row; the new
          // run walks every scope again, from after this moment.
          const token = newToken();
          const row = await readRun(tx);
          if (row === null) {
            // No run yet: the empty generation matches none, so the first
            // pass starts a run under the real one and keeps the mark.
            await tx.insert(usageRuns, {
              name: RUN,
              generation: "",
              token,
              dirty: true,
            });
          } else {
            const r = tx.table(usageRuns);
            await tx
              .update(usageRuns, { token, dirty: true })
              .where(eq(r.name, RUN));
          }
          await dropOtherRuns(tx, token);
        })
      ),

    snapshot: probe =>
      db.transaction(
        async tx => {
          const row = await readRun(tx);
          if (row === null) {
            return {
              generation: null,
              dirty: false,
              done: new Set<string>(),
              probed: await probe(tx),
            };
          }
          const p = tx.table(usageProgress);
          const rows = await tx
            .select(usageProgress)
            .where(onlyWhen(eq(p.token, row.token), eq(p.done, true)))
            .all();
          return {
            generation: row.generation,
            dirty: row.dirty,
            done: new Set(rows.map(progress => progress.scopeKey)),
            probed: await probe(tx),
          };
        },
        // Every read above from one moment. At READ COMMITTED a run started
        // between reading the run row and its progress would pair one run's
        // row with another's progress, and the index rows probed after them
        // could be a later run's.
        { isolation: "snapshot" }
      ),
  };
}
