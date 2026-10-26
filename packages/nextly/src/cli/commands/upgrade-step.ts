/**
 * The shape of one step of `nextly upgrade`, and what each step is handed.
 *
 * `nextly upgrade` is a list of steps (see `upgrade-steps/index.ts`), each of
 * which brings one part of an existing database up to date: it counts what it
 * would change, and changes it. The upgrade asks every step first, so it says
 * there is nothing to do only when no step has anything, asks for a backup
 * only when one does, and then runs just the steps with work.
 *
 * A step is idempotent: run again after it finished, its count is 0. It
 * reports counts and never a stored value.
 *
 * Its own module, apart from `upgrade.ts`, so a step imports these types
 * without importing the command that runs it.
 *
 * @module cli/commands/upgrade-step
 */

/** The database dialects an upgrade runs on. */
export type UpgradeDialect = "postgresql" | "mysql" | "sqlite";

/**
 * Minimal adapter slice the upgrade itself needs. The CLI hands it a
 * DrizzleAdapter, which a step that reads content through it may rely on.
 */
export interface UpgradeAdapter {
  tableExists: (tableName: string) => Promise<boolean>;
  getDrizzle: () => unknown;
  dropTable: (
    tableName: string,
    options?: { ifExists?: boolean }
  ) => Promise<void>;
  getCapabilities: () => { dialect: UpgradeDialect };
}

export interface RunUpgradeOptions {
  confirmBackedUp?: boolean;
  force?: boolean;
  /** Advanced: override the events table name on a foreign-table collision. */
  targetTableName?: string;
}

/** What a step is handed: the database, the command's options and its log. */
export interface UpgradeStepContext {
  adapter: UpgradeAdapter;
  db: unknown;
  dialect: UpgradeDialect;
  options: RunUpgradeOptions;
  log: (message: string) => void;
  warn: (message: string) => void;
}

/** One step of `nextly upgrade`. */
export interface UpgradeStep {
  /**
   * What the step does, as the operator reads it: the upgrade prints
   * `<title>: <count>` for a step that ran.
   */
  title: string;
  /**
   * How many things the step would change now, or 0 when it has nothing to
   * do. It only reads. It may throw to stop the upgrade before any step has
   * written anything.
   */
  pending: (context: UpgradeStepContext) => Promise<number>;
  /**
   * Make the change and return how many things it changed. Called only when
   * `pending` was above 0, after the backup is confirmed, and inside the
   * migrate lock the whole upgrade holds.
   */
  run: (context: UpgradeStepContext) => Promise<number>;
}
