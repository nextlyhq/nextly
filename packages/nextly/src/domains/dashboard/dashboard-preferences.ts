/**
 * What each reader's dashboard remembers for them beyond its layout: one short
 * text value per reader per key, such as the New type they last chose or
 * whether Get started is collapsed.
 *
 * A thin repository over `nextly_dashboard_preferences`. Kept apart from the
 * layout on purpose: a layout row means "this reader arranged the dashboard",
 * so a preference written there would stop the reader following the default.
 *
 * Until `nextly migrate` creates the table, every key reads as unset, so each
 * caller uses its own default, and a write is skipped with one warning.
 *
 * @module domains/dashboard/dashboard-preferences
 * @experimental Until the dashboard's preferences are built on it.
 */

import { NextlyError } from "../../errors/nextly-error";
import {
  DASHBOARD_PREFERENCE_VALUE_MAX,
  DASHBOARD_PREFERENCES_TABLE,
} from "../../schemas/dashboard-preferences/table-name";
import { uuidV7 } from "../../utils/uuid-v7";
import type { VersionsWhere } from "../versions/db-api";
import type { SkippableSetupStepKind } from "../widgets/setup-steps";

import {
  type DashboardLogger,
  type TableProbe,
  tablePresence,
} from "./table-presence";

/**
 * The keys a dashboard remembers, each owned by the feature that reads it:
 * the New type, and the setup card's (`domains/widgets/setup-reader`):
 * collapsed, dismissed, when it said "You're all set", and one key per
 * skippable step, so two skips never share a row.
 */
export type DashboardPreferenceKey =
  | "new-type"
  | "setup-collapsed"
  | "setup-dismissed"
  | `setup-skipped-${SkippableSetupStepKind}`
  | "setup-retired";

/** The database surface the repository reads and writes through. */
export interface DashboardPreferencesDb extends TableProbe {
  upsert<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    options: { conflictColumns: string[]; updateColumns?: string[] }
  ): Promise<T>;
  select<T = unknown>(
    table: string,
    options?: { where?: VersionsWhere; columns?: string[] }
  ): Promise<T[]>;
}

export class DashboardPreferences {
  private readonly present: () => Promise<boolean>;

  constructor(
    private readonly db: DashboardPreferencesDb,
    logger?: DashboardLogger
  ) {
    this.present = tablePresence(
      db,
      DASHBOARD_PREFERENCES_TABLE,
      "Dashboard preferences are not being remembered",
      logger
    );
  }

  /** `userId`'s value for `key`, or `undefined` when unset or not kept yet. */
  async get(
    userId: string,
    key: DashboardPreferenceKey
  ): Promise<string | undefined> {
    return (await this.getMany(userId, [key])).get(key);
  }

  /**
   * `userId`'s values for `keys`, in ONE query: each key that is set, and none where it is unset
   * or the table is not kept yet. A feature that remembers several keys (the setup card's) reads
   * them together, rather than one select and one presence check per key.
   */
  async getMany<K extends DashboardPreferenceKey>(
    userId: string,
    keys: readonly K[]
  ): Promise<Map<K, string>> {
    const values = new Map<K, string>();
    if (keys.length === 0 || !(await this.present())) return values;
    const rows = await this.db.select<{ key: string; value: string }>(
      DASHBOARD_PREFERENCES_TABLE,
      {
        where: {
          and: [
            { column: "userId", op: "=", value: userId },
            { column: "key", op: "IN", value: [...keys] },
          ],
        },
        columns: ["key", "value"],
      }
    );
    // Only the keys asked for, whatever the database answers.
    const asked = new Set<string>(keys);
    for (const row of rows) {
      if (asked.has(row.key)) values.set(row.key as K, row.value);
    }
    return values;
  }

  /**
   * Set `userId`'s `key` to `value`, replacing any earlier value. Skipped,
   * with one warning, until the table exists; refused when the value is
   * longer than a preference may hold.
   */
  async set(
    userId: string,
    key: DashboardPreferenceKey,
    value: string
  ): Promise<void> {
    if (value.length > DASHBOARD_PREFERENCE_VALUE_MAX) {
      throw NextlyError.invalidInput({
        message: `A dashboard preference holds at most ${DASHBOARD_PREFERENCE_VALUE_MAX} characters.`,
      });
    }
    if (!(await this.present())) return;
    await this.db.upsert(
      DASHBOARD_PREFERENCES_TABLE,
      { id: uuidV7(), userId, key, value, updatedAt: new Date() },
      {
        conflictColumns: ["userId", "key"],
        updateColumns: ["value", "updatedAt"],
      }
    );
  }
}
