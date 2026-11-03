/**
 * The page builder's own tables: the usage indexes' bookkeeping, and the runs
 * that turn every copy of a component into plain blocks before it is deleted.
 *
 * Kept in tables this plugin declares, reached only through its own `ctx.db`,
 * rather than in collections. A collection has an admin screen, a REST route
 * and a Direct API path, and a super-admin passes every access rule on all
 * three, so a progress row written by hand there claimed a scope was walked
 * and the documents in it were never indexed. A table declared here has none
 * of those paths: core offers no route to it, and `ctx.db` lets only this
 * plugin, and a plugin that declares a dependency on it, reach it.
 *
 * Created as `page_builder__<name>` on every dialect. The prefix is declared
 * rather than left to default, because a table's name is permanent once a
 * migration ships it.
 *
 * @module schema/tables
 */
import {
  col,
  type ColumnBuilder,
  defineTable,
  type TableDefinition,
} from "@nextlyhq/plugin-sdk/schema";

/** The prefix every table of this plugin is created under. */
export const SCHEMA_PREFIX = "page_builder";

/**
 * The schema version the database must have applied before the plugin starts.
 * It moves with every migration module.
 */
export const SCHEMA_VERSION = 2;

/** The columns of {@link usageRuns}, as `defineTable` checks and publishes them. */
type UsageRunsColumns = {
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly name: ColumnBuilder<string, false, false>;
  readonly generation: ColumnBuilder<string, false, false>;
  readonly token: ColumnBuilder<string, false, false>;
  readonly dirty: ColumnBuilder<boolean, false, true>;
};

/**
 * The run the usage indexes are being built under: one row, named `usage`.
 *
 * `generation` is the derivation the run walks under (the bounds, the index
 * slugs and the derivation's revision), and `token` names the run itself. A
 * new run, with a new token, starts when the generation changes or when a
 * maintenance write fails. Every write a backfill pass makes checks, in its
 * own transaction, that its token is still this row's, so a pass a newer run
 * has replaced writes nothing.
 *
 * `dirty` says a maintenance write failed since the last run that walked every
 * scope. It is set with the token it rotates, and cleared only by that newer
 * run once it has walked the whole site, never by a later save.
 */
export const usageRuns: TableDefinition<"usage_runs", UsageRunsColumns> =
  defineTable<"usage_runs", UsageRunsColumns>(
    "usage_runs",
    {
      id: col.id(),
      name: col.varchar(64),
      generation: col.varchar(512),
      token: col.char(36),
      dirty: col.boolean({ default: false }),
    },
    // One row per name, so two instances starting the first run at once
    // cannot both insert one.
    { indexes: [{ columns: ["name"], unique: true }] }
  );

/** The columns of {@link usageProgress}, as `defineTable` checks and publishes them. */
type UsageProgressColumns = {
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly token: ColumnBuilder<string, false, false>;
  readonly scopeKey: ColumnBuilder<string, false, false>;
  readonly cursor: ColumnBuilder<string, true, false>;
  readonly done: ColumnBuilder<boolean, false, true>;
};

/**
 * How far one run has walked one scope.
 *
 * `cursor` is the id of the last document the walk finished, so a scope larger
 * than one job's budget resumes after it on the next tick instead of starting
 * again. `done` says the whole scope was walked and its orphan rows swept.
 * Rows of any token but the run's are left over from a replaced run, and are
 * removed when the run is replaced.
 */
export const usageProgress: TableDefinition<
  "usage_progress",
  UsageProgressColumns
> = defineTable<"usage_progress", UsageProgressColumns>(
  "usage_progress",
  {
    id: col.id(),
    token: col.char(36),
    scopeKey: col.varchar(512),
    cursor: col.varchar(255, { nullable: true }),
    done: col.boolean({ default: false }),
  },
  // One row per scope of a run; a pass reads its run's rows by token.
  { indexes: [{ columns: ["token", "scopeKey"], unique: true }] }
);

/** The columns of {@link componentDeletions}. */
type ComponentDeletionsColumns = {
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly componentId: ColumnBuilder<string, false, false>;
  readonly purpose: ColumnBuilder<string, false, false>;
  readonly startedBy: ColumnBuilder<string, false, false>;
  readonly phase: ColumnBuilder<string, false, true>;
  readonly cursor: ColumnBuilder<string, true, false>;
};

/**
 * One run rewriting every host of a component, one row per component and
 * purpose: `delete` turns its copies into plain blocks before it is deleted,
 * `strip-retired` removes the values of fields it no longer exposes. The two
 * may run at once, each with its own progress.
 *
 * Inserting a `delete` row IS the fence: while it exists, a write that would
 * add a reference to the component is refused. A `strip-retired` run fences
 * nothing. The unique (`componentId`, `purpose`) means two people starting one
 * run at once start it once.
 *
 * `startedBy` names who the run's writes are made as, as `user:<id>` for a
 * signed-in person or `api-key:<id>` for a key, so a later call can be
 * matched against it.
 *
 * `phase` says which walk the run is on: `converting` (every host, skipping
 * the ones its progress says are done), `final` (every host again, trusting
 * no progress row) or `done`. `cursor` is where the final walk stopped, so a
 * walk larger than one tick resumes rather than starting over.
 */
export const componentDeletions: TableDefinition<
  "component_deletions",
  ComponentDeletionsColumns
> = defineTable<"component_deletions", ComponentDeletionsColumns>(
  "component_deletions",
  {
    id: col.id(),
    componentId: col.varchar(255),
    purpose: col.varchar(32),
    startedBy: col.varchar(255),
    phase: col.varchar(16, { default: "converting" }),
    cursor: col.varchar(1024, { nullable: true }),
  },
  { indexes: [{ columns: ["componentId", "purpose"], unique: true }] }
);

/** The columns of {@link componentDeletionHosts}. */
type ComponentDeletionHostsColumns = {
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly deletionId: ColumnBuilder<string, false, false>;
  readonly hostKey: ColumnBuilder<string, false, false>;
  readonly state: ColumnBuilder<string, false, false>;
  readonly reason: ColumnBuilder<string, true, false>;
};

/**
 * What a run has done to one host document: `rewritten`, `unchanged`, `left`
 * (with the reason) or `pending` (re-queued by a write made while fenced).
 * Hosts outside every walk that block the run (a Layout naming the component)
 * are recorded here too, as `left`, before the run is marked done.
 *
 * An ordering hint for the converting walk only. The final walk reads every
 * host again whatever these rows say, so a row claiming a host is done skips
 * nothing that still needs converting.
 */
export const componentDeletionHosts: TableDefinition<
  "component_deletion_hosts",
  ComponentDeletionHostsColumns
> = defineTable<"component_deletion_hosts", ComponentDeletionHostsColumns>(
  "component_deletion_hosts",
  {
    id: col.id(),
    deletionId: col.char(36),
    hostKey: col.varchar(512),
    state: col.varchar(16),
    reason: col.varchar(64, { nullable: true }),
  },
  { indexes: [{ columns: ["deletionId", "hostKey"], unique: true }] }
);

/** Every table this plugin declares, in creation order. */
export const PAGE_BUILDER_TABLES: readonly [
  typeof usageRuns,
  typeof usageProgress,
  typeof componentDeletions,
  typeof componentDeletionHosts,
] = [usageRuns, usageProgress, componentDeletions, componentDeletionHosts];
