/**
 * The shape of one step of `nextly upgrade`, and what each step is handed.
 *
 * `nextly upgrade` is a list of steps (see `upgrade-steps/index.ts`), each of
 * which brings one part of an existing database up to date: it counts what it
 * would change, and changes it. The steps run in order, each counted and run
 * before the next is counted, so a step may read what an earlier one repairs.
 * The upgrade asks for a backup before the first step with work, and says
 * there is nothing to do only when no step had anything.
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

/**
 * The site an upgrade brings its database in step with, as its configuration declares it: its
 * languages and the collections, Singles and components it declares. The Schema Builder's own
 * entities are read from the database's registries by the steps that need them.
 */
export interface UpgradeSite {
  /** The site's languages and its default, as `localization` declares them; absent, none. */
  localization?: {
    locales: readonly (string | { code: string })[];
    defaultLocale: string;
  };
  collections?: readonly { slug: string; fields?: unknown }[];
  singles?: readonly { slug: string; fields?: unknown }[];
  fieldGroups?: readonly { slug: string; fields?: unknown }[];
}

/**
 * What a step's dry run says beyond its count, in three lists an operator reads before the real
 * run: what will move, what conflicts (and how the run settles it), and what an editor should
 * check afterwards. Each entry is one line naming what it is about.
 */
export interface UpgradeReport {
  move: string[];
  conflicts: string[];
  check: string[];
}

/** What a step is handed: the database, the command's options, the site and its log. */
export interface UpgradeStepContext {
  adapter: UpgradeAdapter;
  db: unknown;
  dialect: UpgradeDialect;
  options: RunUpgradeOptions;
  /**
   * The site's configuration, where the command loaded it: a step that brings content into the
   * site's model needs its languages and entities. Absent, such a step has nothing to judge by.
   */
  site?: UpgradeSite;
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
   * do. It only reads, and runs after every earlier step has run. It may
   * throw to stop the upgrade before this step writes anything.
   */
  pending: (context: UpgradeStepContext) => Promise<number>;
  /**
   * Make the change and return how many things it changed. Called only when
   * `pending` was above 0, after the backup is confirmed, and inside the
   * migrate lock the whole upgrade holds.
   */
  run: (context: UpgradeStepContext) => Promise<number>;
  /**
   * What the dry run lists of this step's work, beyond its count: read-only, as `pending` is.
   * A step that moves content names each thing it moves, each conflict and how it is settled,
   * and what an editor should check.
   */
  report?: (context: UpgradeStepContext) => Promise<UpgradeReport>;
}
