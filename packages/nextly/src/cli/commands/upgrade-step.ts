/**
 * The shape of one step over data an earlier release stored, and what each
 * step is handed.
 *
 * `nextly migrate` runs a list of steps once its migrations have applied
 * (see `upgrade-steps/index.ts`), and `nextly i18n:convert-zoned-dates` runs
 * one. Each brings one part of an existing database up to date: it counts
 * what it would change, and changes it. The steps run in order
 * (`data-steps.ts`), each counted and run before the next is counted, so a
 * step may read what an earlier one repairs. The run asks for a backup
 * before the first step with work.
 *
 * A step is idempotent: run again after it finished, its count is 0. It
 * reports counts and never a stored value.
 *
 * Its own module, so a step imports these types without importing the
 * command that runs it.
 *
 * @module cli/commands/upgrade-step
 */

/** The database dialects the steps run on. */
export type UpgradeDialect = "postgresql" | "mysql" | "sqlite";

/**
 * Minimal adapter slice a run of the steps needs. The CLI hands it a
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

/**
 * The site a run of the steps brings its database in step with, as its configuration declares it:
 * its languages and the collections, Singles and components it declares. The Schema Builder's own
 * entities are read from the database's registries by the steps that need them.
 */
export interface UpgradeSite {
  /**
   * The site's languages and its default, as `localization` declares them; absent, none. Where the
   * configuration was read through the loader, each code is in standard form and `olderCodes`
   * names the ones it wrote the earlier way.
   */
  localization?: {
    locales: readonly (string | { code: string })[];
    defaultLocale: string;
    olderCodes?: readonly { from: string; to: string }[];
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

/** What a step is handed: the database, the site, and the command's log. */
export interface UpgradeStepContext {
  adapter: UpgradeAdapter;
  db: unknown;
  dialect: UpgradeDialect;
  /**
   * The site's configuration, where the command loaded it: a step that brings content into the
   * site's model needs its languages and entities. Absent, such a step has nothing to judge by.
   */
  site?: UpgradeSite;
  log: (message: string) => void;
  warn: (message: string) => void;
}

/** One step over data an earlier release stored. */
export interface UpgradeStep {
  /**
   * What the step does, as the operator reads it: the run prints
   * `<title>: <count>` for a step that ran.
   */
  title: string;
  /**
   * How many things the step would change now, or 0 when it has nothing to
   * do. It only reads, and runs after every earlier step has run. It may
   * throw to stop the run before this step writes anything.
   */
  pending: (context: UpgradeStepContext) => Promise<number>;
  /**
   * Make the change and return how many things it changed. Called only when
   * `pending` was above 0, after the backup is confirmed, and inside the
   * migrate lock the steps are run under.
   */
  run: (context: UpgradeStepContext) => Promise<number>;
  /**
   * What the dry run lists of this step's work, beyond its count: read-only, as `pending` is.
   * A step that moves content names each thing it moves, each conflict and how it is settled,
   * and what an editor should check.
   */
  report?: (context: UpgradeStepContext) => Promise<UpgradeReport>;
}
