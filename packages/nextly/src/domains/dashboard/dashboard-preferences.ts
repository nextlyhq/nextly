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

import {
  type DashboardLogger,
  type TableProbe,
  tablePresence,
} from "./table-presence";

/** The keys a dashboard remembers, each owned by the feature that reads it. */
export type DashboardPreferenceKey = "new-type" | "setup-collapsed";

/** The reads and writes a preference takes, on the pool or in a transaction. */
interface PreferenceStatements {
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

/** A transaction a change of one preference runs in. */
interface PreferenceTransaction extends PreferenceStatements {
  lockRow(table: string, id: string): Promise<void>;
}

/** The database surface the repository reads and writes through. */
export interface DashboardPreferencesDb
  extends TableProbe,
    PreferenceStatements {
  transaction<T>(work: (tx: PreferenceTransaction) => Promise<T>): Promise<T>;
}

/**
 * The table a preference's reader is a row of, which `user_id` references: a
 * change locks the reader's row there.
 */
const READERS_TABLE = "users";

/** `userId`'s stored value for `key`, through `db`. */
async function storedValue(
  db: PreferenceStatements,
  userId: string,
  key: DashboardPreferenceKey
): Promise<string | undefined> {
  const [row] = await db.select<{ value: string }>(
    DASHBOARD_PREFERENCES_TABLE,
    {
      where: {
        and: [
          { column: "userId", op: "=", value: userId },
          { column: "key", op: "=", value: key },
        ],
      },
      columns: ["value"],
    }
  );
  return row?.value;
}

/** `value`, refused when it is longer than a preference may hold. */
function heldValue(value: string): string {
  if (value.length > DASHBOARD_PREFERENCE_VALUE_MAX) {
    throw NextlyError.invalidInput({
      message: `A dashboard preference holds at most ${DASHBOARD_PREFERENCE_VALUE_MAX} characters.`,
    });
  }
  return value;
}

/** Stores `value` as `userId`'s `key` through `db`, replacing any earlier one. */
async function storeValue(
  db: PreferenceStatements,
  userId: string,
  key: DashboardPreferenceKey,
  value: string
): Promise<void> {
  await db.upsert(
    DASHBOARD_PREFERENCES_TABLE,
    { id: uuidV7(), userId, key, value, updatedAt: new Date() },
    {
      conflictColumns: ["userId", "key"],
      updateColumns: ["value", "updatedAt"],
    }
  );
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
    if (!(await this.present())) return undefined;
    return storedValue(this.db, userId, key);
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
    heldValue(value);
    if (!(await this.present())) return;
    await storeValue(this.db, userId, key, value);
  }

  /**
   * Set `userId`'s `key` to what `change` makes of its stored value, and
   * answer the value set. One reader's changes run one at a time: the read
   * and the write share a transaction that holds the reader's own row locked,
   * so two changes at once, from two tabs or two devices, each build on the
   * other rather than the later overwriting the earlier.
   *
   * The reader's row, not the preference's, is the lock, because the
   * preference may not exist yet: a lock on a missing row holds nothing on
   * PostgreSQL, and only a gap on MySQL, which two first writes can deadlock
   * on. The lock is the transaction's first statement, so the read after it
   * sees what an earlier change committed on every dialect. SQLite needs no
   * lock (`lockRow` does nothing there): its transactions already run one at a
   * time.
   *
   * Until the table exists, the change is made of no value and set nowhere,
   * as {@link set} skips; a value longer than a preference may hold is
   * refused, and nothing is set.
   */
  async update(
    userId: string,
    key: DashboardPreferenceKey,
    change: (stored: string | undefined) => string
  ): Promise<string> {
    if (!(await this.present())) return heldValue(change(undefined));
    return this.db.transaction(async tx => {
      await tx.lockRow(READERS_TABLE, userId);
      const value = heldValue(change(await storedValue(tx, userId, key)));
      await storeValue(tx, userId, key, value);
      return value;
    });
  }
}
