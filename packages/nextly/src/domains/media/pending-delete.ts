/**
 * A media delete that can be undone for a few seconds.
 *
 * Deleting marks each item: one `nextly_meta` row per item, keyed
 * `media.deleting:<id>` and stamped with when it was written. Every library
 * read leaves a marked item out at once (`notPendingDelete` in
 * `media-library-query`), while its row, its files, its folder and its usage
 * stay as they are, so a page using it keeps showing it. Undo removes the
 * mark, which brings it back unchanged.
 *
 * Once the window has passed, the item is finalised: the ordinary media
 * delete removes its row and its stored files. Taking the mark is the guard,
 * one statement deleting the mark only while it is still there AND on its
 * side of the deadline: the finaliser's only once the window has ended (as
 * the retention gate claims its turn), an Undo's only before it has. So of an
 * Undo, a timer and any number of sweeps, exactly one takes it: an Undo
 * inside the window always wins, an Undo after it never does, even when no
 * timer or sweep has run yet, and every later attempt finds nothing to do.
 *
 * The finaliser takes the mark inside the media delete's own transaction,
 * under the item's row lock, and records there what files are left to remove
 * (`media.removing:<id>`, the row's files as they were): the mark, the row
 * and its usage go together or not at all, so a worker stopped part way
 * leaves either the mark, for the next attempt, or the record, from which
 * the files are removed once more. A file already gone counts as removed,
 * and the record goes once its files have.
 *
 * Three things finalise: a timer set when the mark is written, for a server
 * that is still running when the window ends, which finishes every item its
 * delete marked, in bounded runs; a job queued with the marks, in their
 * transaction, to run at the window's end (`finalize-deletes-job`), which the
 * jobs queue runs whatever became of the server that took the delete; and a
 * sweep that the library's reads run, the last backstop, for a mark the job
 * gave up on. The sweep asks one bounded question: marks older than the
 * window, at most {@link SWEEP_LIMIT} of them, on `nextly_meta`'s
 * `updated_at` index.
 *
 * @module domains/media/pending-delete
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  TransactionContext,
  WhereClause,
} from "@nextlyhq/adapter-drizzle/types";
import { z } from "zod";

import type { RequestActor } from "../../auth/request-actor";
import { NextlyError } from "../../errors/nextly-error";

import { lockMediaItems } from "./lock-media-items";
import type { MediaFilesRecord } from "./stored-files";

/** How long a deleted item can be brought back: ten seconds. */
export const PENDING_DELETE_WINDOW_MS = 10_000;

/** The `nextly_meta` key prefix every mark carries; the item's id follows. */
export const PENDING_DELETE_KEY_PREFIX = "media.deleting:";

/** The most marks one sweep finalises; the rest wait for the next. */
const SWEEP_LIMIT = 25;

/** The most ids one statement of a mark reads by. */
const READ_RUN = 200;

const META_TABLE = "nextly_meta";

/** The mark's key for an item. */
export function pendingDeleteKey(mediaId: string): string {
  return `${PENDING_DELETE_KEY_PREFIX}${mediaId}`;
}

/** The key prefix of a finished delete's files still to remove. */
const REMOVING_KEY_PREFIX = "media.removing:";

/** The key of an item's files still to remove, once its row is gone. */
export function removingKey(mediaId: string): string {
  return `${REMOVING_KEY_PREFIX}${mediaId}`;
}

/**
 * Work the media delete runs in its own transaction, once the item's row is
 * locked and read and before it is removed, handed that transaction and the
 * row. `false` refuses the delete, which then changes nothing.
 */
export type DeleteClaim = (
  tx: TransactionContext,
  row: MediaFilesRecord
) => Promise<boolean>;

/** The statements the marks need, as the adapter has them. */
export type PendingDeleteDb = Pick<
  DrizzleAdapter,
  "select" | "insert" | "delete" | "transaction"
>;

/** What finalising and logging need. */
export interface PendingDeleteDeps {
  db: PendingDeleteDb;
  /**
   * The ordinary media delete of the row and its outbox event, running
   * `claim` in its transaction and leaving the stored files to it. Throws
   * not-found for an item already gone, and refuses when `claim` does.
   */
  deleteItem(
    mediaId: string,
    actor: RequestActor | undefined,
    claim: DeleteClaim
  ): Promise<void>;
  /**
   * Remove a deleted item's stored files and any a Replace kept for it, from
   * its row as it was; answers whether it could finish. Removing a file
   * already gone is no failure.
   */
  removeFiles(mediaId: string, files: MediaFilesRecord): Promise<boolean>;
  /** Where a delete that could not finish is reported. */
  logger?: { warn(payload: object): void };
  /**
   * Queue the durable finish of `ids` at `runAt`, on `tx`, the transaction
   * writing their marks, so it exists exactly when they do: what finishes a
   * delete when no timer and no library read is left to.
   */
  schedule?: (
    tx: TransactionContext,
    job: { ids: readonly string[]; runAt: Date; now: Date }
  ) => Promise<void>;
  now?: () => Date;
  windowMs?: number;
}

/** What a delete answers: the items marked, and when they go. */
export interface MarkedDeletion {
  ids: string[];
  /**
   * The items this delete marked itself, the rest of `ids` having been
   * marked already by an earlier one: what undoing only this delete takes
   * back.
   */
  marked: string[];
  /**
   * When the window ends for the first of `ids` to go, as an ISO instant: an
   * item an earlier delete marked goes at that delete's deadline.
   */
  deleteAfter: string;
  /**
   * When the window ends for the items this delete marked itself (`marked`),
   * all written at one instant: what an Undo of only this delete has until.
   * `null` when it marked none.
   */
  markedDeleteAfter: string | null;
}

/** What an Undo answers: what came back, and what had already gone. */
export interface UndoneDeletion {
  restored: string[];
  /** Items whose window had already ended: they are deleted. */
  gone: string[];
}

/** The item a mark's key names. */
function idOfKey(key: unknown): string | null {
  return typeof key === "string" && key.startsWith(PENDING_DELETE_KEY_PREFIX)
    ? key.slice(PENDING_DELETE_KEY_PREFIX.length)
    : null;
}

/** What a mark's value holds: who deleted the item, when known. */
const markValueSchema = z.object({
  actor: z
    .object({
      type: z.enum(["user", "apiKey", "system", "principal"]),
      id: z.string().optional(),
    })
    .optional(),
});

/** Who deleted the item, as the mark recorded it. */
function actorOfValue(value: unknown): RequestActor | undefined {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  const read = markValueSchema.safeParse(parsed);
  return read.success ? read.data.actor : undefined;
}

/** What a finished delete's record of files left to remove holds. */
const removingValueSchema = z.object({
  files: z.object({
    filename: z.string(),
    url: z.string(),
    thumbnailUrl: z.string().nullable().optional(),
    sizes: z.unknown().optional(),
  }),
});

/** The files a removal record names, or `null` when it cannot be read. */
function removingFilesOf(value: unknown): MediaFilesRecord | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const read = removingValueSchema.safeParse(parsed);
  return read.success ? read.data.files : null;
}

/**
 * A mark's time as the dialect returned it: a Date, or the string or number
 * a driver gives for it. `null` when it cannot be read.
 */
function markTime(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  const read = new Date(value);
  return Number.isNaN(read.getTime()) ? null : read;
}

/**
 * The earliest of the standing marks' times and `now`, the time a new mark
 * is written with. A standing mark whose time cannot be read counts as
 * `unreadable`, the caller's earliest possible time, so the deadline
 * answered is never later than the real one.
 */
function earliestMarkTime(
  standing: ReadonlyArray<Record<string, unknown>>,
  now: Date,
  unreadable: Date
): Date {
  let earliest = now;
  for (const row of standing) {
    const time = markTime(row.updatedAt ?? row.updated_at) ?? unreadable;
    if (time.getTime() < earliest.getTime()) earliest = time;
  }
  return earliest;
}

/** The marks, the Undo and the finalising, over one database. */
export class PendingMediaDeletes {
  private readonly windowMs: number;
  private readonly now: () => Date;

  constructor(private readonly deps: PendingDeleteDeps) {
    this.windowMs = deps.windowMs ?? PENDING_DELETE_WINDOW_MS;
    this.now = deps.now ?? (() => new Date());
  }

  /** The instant a mark written before it is due. */
  private cutoff(): Date {
    return new Date(this.now().getTime() - this.windowMs);
  }

  /**
   * Mark every item for deletion, all or none: the check that every id names
   * an item and every mark written are one transaction, so a failure on any
   * item leaves every one of them unmarked and in the library. An item
   * already marked keeps its mark and its time, and the deadline answered is
   * the earliest of the batch's real ones: a standing mark's own, read from
   * it, since an Undo after that would find the item already gone. Every
   * deadline is taken from the time as stored, never the instant written.
   */
  async mark(
    ids: readonly string[],
    actor?: RequestActor
  ): Promise<MarkedDeletion> {
    const wanted = [...new Set(ids)];
    const now = this.now();
    const fresh: string[] = [];
    const times = await this.deps.db.transaction(async tx => {
      // Filled afresh on each attempt, should the transaction be retried.
      fresh.length = 0;
      // Each item's row locked, in the one order, so two deletes of the same
      // items take turns: the second finds the first's marks and keeps them.
      await lockMediaItems(tx, wanted);
      const found: Array<Record<string, unknown>> = [];
      const marked: Array<Record<string, unknown>> = [];
      // In runs, so no statement binds more values than any dialect takes.
      for (let start = 0; start < wanted.length; start += READ_RUN) {
        const run = wanted.slice(start, start + READ_RUN);
        found.push(
          ...(await tx.select<Record<string, unknown>>("media", {
            columns: ["id"],
            where: { and: [{ column: "id", op: "IN", value: run }] },
          }))
        );
        marked.push(
          ...(await tx.select<Record<string, unknown>>(META_TABLE, {
            columns: ["key", "updatedAt"],
            where: {
              and: [
                { column: "key", op: "IN", value: run.map(pendingDeleteKey) },
              ],
            },
          }))
        );
      }
      const present = new Set(found.map(row => String(row.id)));
      const missing = wanted.filter(id => !present.has(id));
      if (missing.length > 0) {
        throw NextlyError.notFound({
          logContext: { reason: "media-delete-missing-items", missing },
        });
      }
      const standing = new Set(marked.map(row => idOfKey(row.key)));
      for (const id of wanted) {
        if (standing.has(id)) continue;
        await tx.insert(META_TABLE, {
          key: pendingDeleteKey(id),
          value: JSON.stringify(actor ? { actor } : {}),
          updated_at: now,
        });
        fresh.push(id);
      }
      const stored = await this.storedTime(tx, fresh, now);
      if (fresh.length > 0) {
        await this.deps.schedule?.(tx, {
          ids: fresh,
          runAt: new Date(stored.getTime() + this.windowMs),
          now,
        });
      }
      // A mark whose time cannot be read is taken as due already.
      return {
        earliest: earliestMarkTime(
          marked,
          stored,
          new Date(now.getTime() - this.windowMs)
        ),
        stored,
      };
    });
    return {
      ids: wanted,
      marked: fresh,
      deleteAfter: new Date(
        times.earliest.getTime() + this.windowMs
      ).toISOString(),
      // Every fresh mark was written at one instant, so they share one
      // deadline, never shortened by an earlier delete's standing mark.
      markedDeleteAfter:
        fresh.length > 0
          ? new Date(times.stored.getTime() + this.windowMs).toISOString()
          : null,
    };
  }

  /**
   * The time the fresh marks were stored with, as the database holds it:
   * MySQL and SQLite keep it to the second, so it can differ from the
   * instant written by up to a second either way, and every later judgement
   * of the mark (Undo, the finaliser) compares against the stored value. All
   * were written at `written`, so one is read. Unreadable, it is taken a
   * second earlier than written, so the deadline answered is never later
   * than the real one.
   */
  private async storedTime(
    tx: Pick<PendingDeleteDb, "select">,
    fresh: readonly string[],
    written: Date
  ): Promise<Date> {
    if (fresh.length === 0) return written;
    const [row] = await tx.select<Record<string, unknown>>(META_TABLE, {
      columns: ["key", "updatedAt"],
      where: {
        and: [{ column: "key", op: "=", value: pendingDeleteKey(fresh[0]) }],
      },
    });
    return (
      markTime(row?.updatedAt ?? row?.updated_at) ??
      new Date(written.getTime() - 1_000)
    );
  }

  /**
   * Bring the items back: each whose row is still there, and whose mark is
   * still there and whose window has not ended, loses its mark, in the one
   * statement that also decides it. So an Undo racing the finaliser either
   * takes the mark (and the item stays) or finds it taken (and the item is
   * gone), and one arriving after the deadline is refused even before any
   * finaliser has run: the mark stays for the finaliser, which owns the item
   * from then on.
   *
   * The row is read under its lock, the one every delete of it takes, so an
   * item an immediate delete removed inside the window is answered as
   * `gone`, never as restored, and what is left of its mark is taken.
   *
   * Each item is judged against its own deadline, so a batch whose marks
   * have different deadlines comes back in part: every item still inside its
   * window is restored and the rest are answered as `gone`. Every mark is
   * taken on one transaction, so only a statement that fails part way undoes
   * the whole Undo: it puts back the marks taken before it, rather than
   * leaving some items restored and the rest still going.
   */
  async undo(ids: readonly string[]): Promise<UndoneDeletion> {
    const due = this.cutoff();
    const wanted = [...new Set(ids)];
    return await this.deps.db.transaction(async tx => {
      // In the one order a delete locks them in, so the two take turns.
      await lockMediaItems(tx, wanted);
      const present = new Set<string>();
      for (let start = 0; start < wanted.length; start += READ_RUN) {
        const found = await tx.select<Record<string, unknown>>("media", {
          columns: ["id"],
          where: {
            and: [
              {
                column: "id",
                op: "IN",
                value: wanted.slice(start, start + READ_RUN),
              },
            ],
          },
        });
        for (const row of found) present.add(String(row.id));
      }
      const restored: string[] = [];
      const gone: string[] = [];
      for (const id of wanted) {
        const mark = {
          column: "key",
          op: "=" as const,
          value: pendingDeleteKey(id),
        };
        if (!present.has(id)) {
          await tx.delete(META_TABLE, { and: [mark] });
          gone.push(id);
          continue;
        }
        const removed = await tx.delete(META_TABLE, {
          and: [mark, { column: "updatedAt", op: ">", value: due }],
        });
        (removed > 0 ? restored : gone).push(id);
      }
      return { restored, gone };
    });
  }

  /**
   * Delete an item whose mark is due: the mark is taken in the delete's own
   * transaction ({@link claim}), so it goes exactly when the row does. A
   * delete that fails leaves the mark as it was, already due, so the next
   * attempt tries again and the item stays out of every list meanwhile. One
   * whose mark has gone meanwhile (an Undo, another finaliser) is passed
   * over. An item gone another way has nothing left but its mark, which is
   * taken. Answers whether this call deleted the item.
   */
  private async deleteTaken(
    mediaId: string,
    actor: RequestActor | undefined,
    due: Date
  ): Promise<boolean> {
    let asked = false;
    let claimed = false;
    try {
      await this.deps.deleteItem(mediaId, actor, async (tx, row) => {
        asked = true;
        claimed = await this.claim(tx, mediaId, row, due);
        return claimed;
      });
    } catch (error) {
      if (NextlyError.isNotFound(error)) {
        await this.deps.db.delete(META_TABLE, this.dueMark(mediaId, due));
        return false;
      }
      // Refused because the mark was no longer there to take.
      if (asked && !claimed) return false;
      this.deps.logger?.warn({
        kind: "media-delete-not-finished",
        message:
          "A deleted media item could not be removed; it will be tried again.",
        mediaId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
    await this.finishRemovals([mediaId]);
    return true;
  }

  /** The mark of `mediaId`, while it is due at `due`. */
  private dueMark(mediaId: string, due: Date): WhereClause {
    return {
      and: [
        { column: "key", op: "=", value: pendingDeleteKey(mediaId) },
        { column: "updatedAt", op: "<=", value: due },
      ],
    };
  }

  /**
   * In the delete's transaction, under the item's row lock: take the mark
   * while it is still due, and record the row's files as left to remove, in
   * the transaction that removes the row. `false` when the mark is gone.
   */
  private async claim(
    tx: TransactionContext,
    mediaId: string,
    row: MediaFilesRecord,
    due: Date
  ): Promise<boolean> {
    const taken = await tx.delete(META_TABLE, this.dueMark(mediaId, due));
    if (taken === 0) return false;
    const files: MediaFilesRecord = {
      filename: row.filename,
      url: row.url,
      thumbnailUrl: row.thumbnailUrl ?? null,
      sizes: row.sizes ?? null,
    };
    await tx.delete(META_TABLE, {
      and: [{ column: "key", op: "=", value: removingKey(mediaId) }],
    });
    await tx.insert(META_TABLE, {
      key: removingKey(mediaId),
      value: JSON.stringify({ files }),
      updated_at: this.now(),
    });
    return true;
  }

  /**
   * Remove the files recorded as left by deletes of `ids` that have
   * finished, and each record once its files are gone; a record recorded
   * after `before`, when given, is left to the delete still at work on it.
   * Read in runs, each one bounded query. Answers the items finished.
   */
  async finishRemovals(
    ids: readonly string[],
    before?: Date
  ): Promise<string[]> {
    const finished: string[] = [];
    for (let start = 0; start < ids.length; start += READ_RUN) {
      const run = ids.slice(start, start + READ_RUN);
      const rows = await this.deps.db.select<Record<string, unknown>>(
        META_TABLE,
        {
          columns: ["key", "value"],
          where: {
            and: [
              { column: "key", op: "IN", value: run.map(removingKey) },
              ...(before
                ? [{ column: "updatedAt", op: "<=" as const, value: before }]
                : []),
            ],
          },
        }
      );
      finished.push(...(await this.removeRecorded(rows)));
    }
    return finished;
  }

  /** Each record's files removed, and the record with them; the items done. */
  private async removeRecorded(
    rows: ReadonlyArray<Record<string, unknown>>
  ): Promise<string[]> {
    const finished: string[] = [];
    for (const row of rows) {
      const key = typeof row.key === "string" ? row.key : "";
      if (!key.startsWith(REMOVING_KEY_PREFIX)) continue;
      const mediaId = key.slice(REMOVING_KEY_PREFIX.length);
      const files = removingFilesOf(row.value);
      // A record that cannot be read names nothing to remove.
      if (files && !(await this.deps.removeFiles(mediaId, files))) continue;
      await this.deps.db.delete(META_TABLE, {
        and: [{ column: "key", op: "=", value: key }],
      });
      finished.push(mediaId);
    }
    return finished;
  }

  /**
   * Finalise the marks whose window has ended, at most {@link SWEEP_LIMIT}:
   * one query on `updated_at` finds them, and each is taken by the guarded
   * statement before its item is deleted. Answers the items deleted.
   */
  async finalizeDue(): Promise<string[]> {
    const due = this.cutoff();
    const rows = await this.deps.db.select<Record<string, unknown>>(
      META_TABLE,
      {
        columns: ["key", "value"],
        where: {
          and: [
            { column: "updatedAt", op: "<=", value: due },
            {
              column: "key",
              op: "LIKE",
              value: `${PENDING_DELETE_KEY_PREFIX}%`,
            },
          ],
        },
        limit: SWEEP_LIMIT,
      }
    );
    const deleted = await this.finalizeRows(rows, due);
    // Removals a stopped worker left: older than the window, so not one a
    // delete is still at work on.
    const left = await this.deps.db.select<Record<string, unknown>>(
      META_TABLE,
      {
        columns: ["key", "value"],
        where: {
          and: [
            { column: "updatedAt", op: "<=", value: due },
            { column: "key", op: "LIKE", value: `${REMOVING_KEY_PREFIX}%` },
          ],
        },
        limit: SWEEP_LIMIT,
      }
    );
    await this.removeRecorded(left);
    return deleted;
  }

  /**
   * Finalise every one of `ids` whose mark is due, however many: the marks
   * are read and taken in runs of {@link SWEEP_LIMIT}, each run one bounded
   * query on the marks' keys, until every id has been asked once. For the
   * timer a delete sets, which owns exactly the items that delete marked, so
   * a batch larger than one sweep is finished whole rather than left to
   * library reads. A delete that fails is marked again for the sweep, as
   * {@link finalizeDue} leaves it. Answers the items deleted.
   */
  async finalizeMarked(ids: readonly string[]): Promise<string[]> {
    const wanted = [...new Set(ids)];
    const deleted: string[] = [];
    for (let start = 0; start < wanted.length; start += SWEEP_LIMIT) {
      const run = wanted.slice(start, start + SWEEP_LIMIT);
      const due = this.cutoff();
      const rows = await this.deps.db.select<Record<string, unknown>>(
        META_TABLE,
        {
          columns: ["key", "value"],
          where: {
            and: [
              { column: "key", op: "IN", value: run.map(pendingDeleteKey) },
              { column: "updatedAt", op: "<=", value: due },
            ],
          },
        }
      );
      deleted.push(...(await this.finalizeRows(rows, due)));
      // Removals of these items a stopped worker left part way.
      await this.finishRemovals(run);
    }
    return deleted;
  }

  /**
   * Which of `ids` are not finished: a mark still due (a delete that failed),
   * or files still recorded as left to remove, for the job that finishes them
   * to try once more.
   */
  async dueAmong(ids: readonly string[]): Promise<string[]> {
    const wanted = [...new Set(ids)];
    const due = this.cutoff();
    const left: string[] = [];
    for (let start = 0; start < wanted.length; start += READ_RUN) {
      const run = wanted.slice(start, start + READ_RUN);
      const rows = await this.deps.db.select<Record<string, unknown>>(
        META_TABLE,
        {
          columns: ["key"],
          where: {
            and: [
              { column: "key", op: "IN", value: run.map(pendingDeleteKey) },
              { column: "updatedAt", op: "<=", value: due },
            ],
          },
        }
      );
      for (const row of rows) {
        const id = idOfKey(row.key);
        if (id !== null) left.push(id);
      }
      const removing = await this.deps.db.select<Record<string, unknown>>(
        META_TABLE,
        {
          columns: ["key"],
          where: {
            and: [{ column: "key", op: "IN", value: run.map(removingKey) }],
          },
        }
      );
      for (const row of removing) {
        const key = typeof row.key === "string" ? row.key : "";
        left.push(key.slice(REMOVING_KEY_PREFIX.length));
      }
    }
    return [...new Set(left)];
  }

  /**
   * When the earliest of `ids`' marks that are not yet due will be, or `null`
   * when none waits: for a delete's timer, which finishes what is due and
   * then waits again for the rest, so no mark is left without one. A mark put
   * back after a failed delete is already due, and is left to the sweep.
   */
  async nextDeadline(ids: readonly string[]): Promise<Date | null> {
    const wanted = [...new Set(ids)];
    const due = this.cutoff();
    let earliest: Date | null = null;
    for (let start = 0; start < wanted.length; start += SWEEP_LIMIT) {
      const run = wanted.slice(start, start + SWEEP_LIMIT);
      const rows = await this.deps.db.select<Record<string, unknown>>(
        META_TABLE,
        {
          columns: ["key", "updatedAt"],
          where: {
            and: [
              { column: "key", op: "IN", value: run.map(pendingDeleteKey) },
              { column: "updatedAt", op: ">", value: due },
            ],
          },
        }
      );
      for (const row of rows) {
        const time = markTime(row.updatedAt ?? row.updated_at);
        if (time && (earliest === null || time < earliest)) earliest = time;
      }
    }
    return earliest === null
      ? null
      : new Date(earliest.getTime() + this.windowMs);
  }

  /**
   * Delete the item of each of `rows`' marks that is still due at `due`, the
   * mark taken with it; answers the items deleted.
   */
  private async finalizeRows(
    rows: ReadonlyArray<Record<string, unknown>>,
    due: Date
  ): Promise<string[]> {
    const deleted: string[] = [];
    for (const row of rows) {
      const id = idOfKey(row.key);
      if (id === null) continue;
      if (await this.deleteTaken(id, actorOfValue(row.value), due)) {
        deleted.push(id);
      }
    }
    return deleted;
  }
}
