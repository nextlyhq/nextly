/**
 * Whether a dashboard table exists yet, asked once and remembered.
 *
 * The dashboard's own tables reach an installation through `nextly migrate`,
 * so a site that has not run it yet has none. Each repository asks this
 * before it reads or writes, outside any transaction, rather than catching a
 * "no such table" error, which would abort a transaction on PostgreSQL. A
 * table found present is not asked about again; one found missing is warned
 * about once and asked about again next time, so running `nextly migrate`
 * takes effect without a restart.
 *
 * @module domains/dashboard/table-presence
 */

/** The database surface the presence check asks. */
export interface TableProbe {
  tableExists(table: string): Promise<boolean>;
}

/** Where the once-only warning goes. */
export interface DashboardLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

/** A remembered presence check for one table. */
export function tablePresence(
  db: TableProbe,
  table: string,
  missing: string,
  logger?: DashboardLogger
): () => Promise<boolean> {
  let knownPresent = false;
  let warned = false;
  return async () => {
    if (knownPresent) return true;
    let present: boolean;
    try {
      present = await db.tableExists(table);
    } catch {
      // An unanswerable probe is treated as present: the statement that
      // follows then reports the real problem rather than this hiding it.
      present = true;
    }
    if (present) {
      knownPresent = true;
      return true;
    }
    if (!warned) {
      warned = true;
      logger?.warn(
        `${missing}: the "${table}" table does not exist yet. Run \`nextly migrate\` to create it.`,
        { table }
      );
    }
    return false;
  };
}
