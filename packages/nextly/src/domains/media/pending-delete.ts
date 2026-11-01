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
 * Two things finalise: a timer set when the mark is written, for a server
 * that is still running when the window ends, which finishes every item its
 * delete marked, in bounded runs; and a sweep that the library's reads run,
 * for one that is not (restarted, or a serverless instance gone).
 * The sweep asks one bounded question: marks older than the window, at most
 * {@link SWEEP_LIMIT} of them, on `nextly_meta`'s `updated_at` index.
 *
 * @module domains/media/pending-delete
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { z } from "zod";

import type { RequestActor } from "../../auth/request-actor";
import { NextlyError } from "../../errors/nextly-error";

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

/** The statements the marks need, as the adapter has them. */
export type PendingDeleteDb = Pick<
  DrizzleAdapter,
  "select" | "insert" | "delete" | "transaction"
>;

/** What finalising and logging need. */
export interface PendingDeleteDeps {
  db: PendingDeleteDb;
  /**
   * The ordinary media delete: the row, its outbox event, its stored files
   * and any a Replace kept for it. Throws not-found for an item already gone.
   */
  deleteItem(mediaId: string, actor?: RequestActor): Promise<void>;
  /** Where a delete that could not finish is reported. */
  logger?: { warn(payload: object): void };
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
  /** When the window ends, as an ISO instant. */
  deleteAfter: string;
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
   * it, since an Undo after that would find the item already gone.
   */
  async mark(
    ids: readonly string[],
    actor?: RequestActor
  ): Promise<MarkedDeletion> {
    const wanted = [...new Set(ids)];
    const now = this.now();
    const fresh: string[] = [];
    const earliest = await this.deps.db.transaction(async tx => {
      // Filled afresh on each attempt, should the transaction be retried.
      fresh.length = 0;
      // Each item's row locked, in one order, so two deletes of the same
      // items take turns: the second finds the first's marks and keeps them.
      for (const id of [...wanted].sort()) await tx.lockRow("media", id);
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
      // A mark whose time cannot be read is taken as due already.
      return earliestMarkTime(
        marked,
        now,
        new Date(now.getTime() - this.windowMs)
      );
    });
    return {
      ids: wanted,
      marked: fresh,
      deleteAfter: new Date(earliest.getTime() + this.windowMs).toISOString(),
    };
  }

  /**
   * Bring the items back: each whose mark is still there and whose window
   * has not ended loses it, in the one statement that also decides it. So an
   * Undo racing the finaliser either takes the mark (and the item stays) or
   * finds it taken (and the item is gone), and one arriving after the
   * deadline is refused even before any finaliser has run: the mark stays
   * for the finaliser, which owns the item from then on.
   *
   * Every mark is taken on one transaction, so a batch is undone whole or not
   * at all: a statement that fails part way puts back the marks taken before
   * it, rather than leaving some items restored and the rest still going.
   */
  async undo(ids: readonly string[]): Promise<UndoneDeletion> {
    const due = this.cutoff();
    return this.deps.db.transaction(async tx => {
      const restored: string[] = [];
      const gone: string[] = [];
      for (const id of new Set(ids)) {
        const removed = await tx.delete(META_TABLE, {
          and: [
            { column: "key", op: "=", value: pendingDeleteKey(id) },
            { column: "updatedAt", op: ">", value: due },
          ],
        });
        (removed > 0 ? restored : gone).push(id);
      }
      return { restored, gone };
    });
  }

  /**
   * Delete an item whose mark this call took. A delete that fails puts the
   * mark back, already due, so the next sweep tries again and the item stays
   * out of every list meanwhile; one already gone is done.
   */
  private async deleteTaken(
    mediaId: string,
    actor: RequestActor | undefined,
    due: Date
  ): Promise<boolean> {
    try {
      await this.deps.deleteItem(mediaId, actor);
      return true;
    } catch (error) {
      if (NextlyError.isNotFound(error)) return true;
      this.deps.logger?.warn({
        kind: "media-delete-not-finished",
        message:
          "A deleted media item could not be removed; it will be tried again.",
        mediaId,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.deps.db
        .insert(META_TABLE, {
          key: pendingDeleteKey(mediaId),
          value: JSON.stringify(actor ? { actor } : {}),
          updated_at: due,
        })
        .catch(() => undefined);
      return false;
    }
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
    return this.finalizeRows(rows, due);
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
    }
    return deleted;
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
   * Take each of `rows`' marks that is still due at `due` and delete its
   * item; answers the items deleted.
   */
  private async finalizeRows(
    rows: ReadonlyArray<Record<string, unknown>>,
    due: Date
  ): Promise<string[]> {
    const deleted: string[] = [];
    for (const row of rows) {
      const id = idOfKey(row.key);
      if (id === null) continue;
      const taken = await this.deps.db.delete(META_TABLE, {
        and: [
          { column: "key", op: "=", value: pendingDeleteKey(id) },
          { column: "updatedAt", op: "<=", value: due },
        ],
      });
      if (taken === 0) continue;
      if (await this.deleteTaken(id, actorOfValue(row.value), due)) {
        deleted.push(id);
      }
    }
    return deleted;
  }
}
