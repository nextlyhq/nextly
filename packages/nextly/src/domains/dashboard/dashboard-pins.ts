/**
 * The entries and Singles each reader pinned to their dashboard.
 *
 * A thin repository over `nextly_dashboard_pins`: it stores and reads pins,
 * and decides nothing about who may pin what or which pins a reader is shown;
 * the dashboard asks those of the read rules.
 *
 * Until `nextly migrate` creates the table, a reader has no pins and a pin is
 * refused with a message naming the command, so a site that has not migrated
 * yet works as before rather than failing.
 *
 * @module domains/dashboard/dashboard-pins
 * @experimental Until the dashboard's pins are built on it.
 */

import { NextlyError } from "../../errors/nextly-error";
import { DASHBOARD_PINS_TABLE } from "../../schemas/dashboard-pins/table-name";
import { uuidV7 } from "../../utils/uuid-v7";
import type { VersionsWhere, VersionsWhereCondition } from "../versions/db-api";

import {
  type DashboardLogger,
  type TableProbe,
  tablePresence,
} from "./table-presence";

/** What a pin names: an entry of a collection, or a Single. */
export type PinTarget =
  | { targetType: "collection"; targetSlug: string; entryId: string }
  | { targetType: "single"; targetSlug: string };

/** One reader's pin, as stored. */
export interface DashboardPin {
  id: string;
  userId: string;
  targetType: "collection" | "single";
  targetSlug: string;
  /** The pinned entry's id; "" for a Single. */
  entryId: string;
  pinnedAt: Date;
}

/** The database surface the repository reads and writes through. */
export interface DashboardPinsDb extends TableProbe {
  upsert<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    options: { conflictColumns: string[]; updateColumns?: string[] }
  ): Promise<T>;
  select<T = unknown>(
    table: string,
    options?: {
      where?: VersionsWhere;
      orderBy?: { column: string; direction?: "asc" | "desc" }[];
      limit?: number;
    }
  ): Promise<T[]>;
  delete(table: string, where: VersionsWhere): Promise<number>;
}

/**
 * A target's columns. A Single has no entry, so its `entryId` is "" rather
 * than NULL: the unique index over (reader, target) then holds on every
 * dialect without a partial index.
 */
function targetColumns(target: PinTarget): {
  targetType: string;
  targetSlug: string;
  entryId: string;
} {
  return {
    targetType: target.targetType,
    targetSlug: target.targetSlug,
    entryId: target.targetType === "collection" ? target.entryId : "",
  };
}

/** The conditions that name one target. */
function targetWhere(target: PinTarget): VersionsWhereCondition[] {
  const columns = targetColumns(target);
  return [
    { column: "targetType", op: "=", value: columns.targetType },
    { column: "targetSlug", op: "=", value: columns.targetSlug },
    { column: "entryId", op: "=", value: columns.entryId },
  ];
}

export class DashboardPins {
  private readonly present: () => Promise<boolean>;

  constructor(
    private readonly db: DashboardPinsDb,
    logger?: DashboardLogger
  ) {
    this.present = tablePresence(
      db,
      DASHBOARD_PINS_TABLE,
      "Dashboard pins are not being kept",
      logger
    );
  }

  /**
   * Pin `target` for `userId`. Pinning what is already pinned keeps the one
   * pin, and its time.
   */
  async pin(userId: string, target: PinTarget): Promise<void> {
    if (!(await this.present())) {
      throw NextlyError.serviceUnavailable({
        publicMessage:
          "Pins are not available yet. Run `nextly migrate` to create the table they are kept in.",
        logContext: { table: DASHBOARD_PINS_TABLE },
      });
    }
    // Insert, or keep the pin already there: an upsert that names nothing to
    // update keeps the existing row on every dialect without raising.
    await this.db.upsert(
      DASHBOARD_PINS_TABLE,
      {
        id: uuidV7(),
        userId,
        ...targetColumns(target),
        pinnedAt: new Date(),
      },
      {
        conflictColumns: ["userId", "targetType", "targetSlug", "entryId"],
        updateColumns: [],
      }
    );
  }

  /** Remove `userId`'s pin of `target`; true when there was one. */
  async unpin(userId: string, target: PinTarget): Promise<boolean> {
    if (!(await this.present())) return false;
    const removed = await this.db.delete(DASHBOARD_PINS_TABLE, {
      and: [
        { column: "userId", op: "=", value: userId },
        ...targetWhere(target),
      ],
    });
    return removed > 0;
  }

  /** `userId`'s pins, newest first; none until the table exists. */
  async list(userId: string): Promise<DashboardPin[]> {
    if (!(await this.present())) return [];
    return this.db.select<DashboardPin>(DASHBOARD_PINS_TABLE, {
      where: { and: [{ column: "userId", op: "=", value: userId }] },
      orderBy: [
        { column: "pinnedAt", direction: "desc" },
        { column: "id", direction: "desc" },
      ],
    });
  }

  /**
   * Remove every reader's pin of `target`, for an entry or Single that is
   * being deleted; how many there were.
   */
  async unpinTarget(target: PinTarget): Promise<number> {
    if (!(await this.present())) return 0;
    return this.db.delete(DASHBOARD_PINS_TABLE, { and: targetWhere(target) });
  }
}
