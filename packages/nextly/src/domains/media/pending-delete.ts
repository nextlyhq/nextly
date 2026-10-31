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
 * one statement deleting the mark only while it is still there AND older than
 * the window (as the retention gate claims its turn), so of an Undo, a timer
 * and any number of sweeps, exactly one takes it: an Undo inside the window
 * always wins, and every later attempt finds nothing to do.
 *
 * Two things finalise: a timer set when the mark is written, for a server
 * that is still running when the window ends, and a sweep that the library's
 * reads run, for one that is not (restarted, or a serverless instance gone).
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

const META_TABLE = "nextly_meta";

/** The mark's key for an item. */
export function pendingDeleteKey(mediaId: string): string {
  return `${PENDING_DELETE_KEY_PREFIX}${mediaId}`;
}

/** The statements the marks need, as the adapter has them. */
export type PendingDeleteDb = Pick<
  DrizzleAdapter,
  "select" | "insert" | "delete"
>;

/** What finalising and logging need. */
export interface PendingDeleteDeps {
  db: PendingDeleteDb;
  /**
   * The ordinary media delete: the row, its outbox event and its stored
   * files. Throws not-found for an item already gone.
   */
  deleteItem(mediaId: string, actor?: RequestActor): Promise<void>;
  logger?: {
    warn(message: string, context?: Record<string, unknown>): void;
  };
  now?: () => Date;
  windowMs?: number;
}

/** What a delete answers: the items marked, and when they go. */
export interface MarkedDeletion {
  ids: string[];
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
   * Mark every item for deletion. Every id must name an item, or nothing is
   * marked. An item already marked keeps its mark and its time.
   */
  async mark(
    ids: readonly string[],
    actor?: RequestActor
  ): Promise<MarkedDeletion> {
    const wanted = [...new Set(ids)];
    const found = await this.deps.db.select<Record<string, unknown>>("media", {
      columns: ["id"],
      where: { and: [{ column: "id", op: "IN", value: wanted }] },
    });
    const present = new Set(found.map(row => String(row.id)));
    const missing = wanted.filter(id => !present.has(id));
    if (missing.length > 0) {
      throw NextlyError.notFound({
        logContext: { reason: "media-delete-missing-items", missing },
      });
    }
    const now = this.now();
    for (const id of wanted) {
      try {
        await this.deps.db.insert(META_TABLE, {
          key: pendingDeleteKey(id),
          value: JSON.stringify(actor ? { actor } : {}),
          updated_at: now,
        });
      } catch (error) {
        // The key is taken only by a mark already there, which stands. Any
        // other failure is a real one.
        if (!(await this.isMarked(id))) throw error;
      }
    }
    return {
      ids: wanted,
      deleteAfter: new Date(now.getTime() + this.windowMs).toISOString(),
    };
  }

  /** Whether an item carries a mark. */
  private async isMarked(mediaId: string): Promise<boolean> {
    const rows = await this.deps.db.select(META_TABLE, {
      columns: ["key"],
      where: {
        and: [{ column: "key", op: "=", value: pendingDeleteKey(mediaId) }],
      },
    });
    return rows.length > 0;
  }

  /**
   * Bring the items back: each whose mark is still there loses it, in the one
   * statement that also decides it, so an Undo racing the finaliser either
   * takes the mark (and the item stays) or finds it taken (and the item is
   * gone).
   */
  async undo(ids: readonly string[]): Promise<UndoneDeletion> {
    const restored: string[] = [];
    const gone: string[] = [];
    for (const id of new Set(ids)) {
      const removed = await this.deps.db.delete(META_TABLE, {
        and: [{ column: "key", op: "=", value: pendingDeleteKey(id) }],
      });
      (removed > 0 ? restored : gone).push(id);
    }
    return { restored, gone };
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
      this.deps.logger?.warn(
        "A deleted media item could not be removed; it will be tried again.",
        {
          mediaId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
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
