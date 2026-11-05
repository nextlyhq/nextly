/**
 * The page builder's own tables: the usage indexes and their bookkeeping, the
 * fence a Layout's removal puts up, the runs that turn every copy of a
 * component into plain blocks before it is deleted, and the site-wide options
 * only this plugin writes.
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
export const SCHEMA_VERSION = 5;

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

/** The columns of {@link layoutRemovals}, as `defineTable` checks and publishes them. */
type LayoutRemovalsColumns = {
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly layoutId: ColumnBuilder<string, false, false>;
  readonly action: ColumnBuilder<string, false, false>;
  readonly step: ColumnBuilder<string, false, false>;
  readonly token: ColumnBuilder<string, false, false>;
  readonly startedBy: ColumnBuilder<string, true, false>;
  readonly pagesLeft: ColumnBuilder<number, true, false>;
  readonly copy: ColumnBuilder<unknown, true, false>;
  readonly copyVersion: ColumnBuilder<string, true, false>;
  readonly settledAt: ColumnBuilder<Date, true, false>;
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
};

/**
 * One row per Layout being removed: inserting it is the fence.
 *
 * While a row exists, the Layout cannot be made the site default, and the
 * Layout's own delete or unpublish is refused unless the write carries this
 * row's `token` and the row is at its `final` step. A table rather than a
 * collection, for the reason the module docblock gives: a super-admin can
 * write any collection row, and a fence an author could forge or delete would
 * let a plain delete through.
 *
 * - `step` moves `marked` → `checked` → `final` → `removed`, each move a
 *   compare-and-set on `token` and the step it leaves, so a request another
 *   one replaced changes nothing.
 * - `copy` is the Layout as it stood at the final step, its live row and its
 *   working draft, so a delete that a promotion raced can be restored. Cleared
 *   once the check after the write passed (`settledAt`).
 * - `copyVersion` is the two rows' `updatedAt`, and the delete or unpublish
 *   goes ahead only while the Layout still has it.
 * - `updatedAt` is the lease: a row left at an earlier step by a request that
 *   stopped is taken over by a later one, and cleared by the sweep, once it is
 *   older than the lease.
 *
 * A `removed` row stays. For an unpublish it keeps the fence until the Layout
 * is published again; for a delete it records that the Layout was removed.
 */
export const layoutRemovals: TableDefinition<
  "layout_removals",
  LayoutRemovalsColumns
> = defineTable<"layout_removals", LayoutRemovalsColumns>(
  "layout_removals",
  {
    id: col.id(),
    layoutId: col.varchar(255),
    action: col.varchar(16),
    step: col.varchar(16),
    token: col.char(36),
    startedBy: col.varchar(255, { nullable: true }),
    pagesLeft: col.integer({ nullable: true }),
    copy: col.json({ nullable: true }),
    copyVersion: col.varchar(128, { nullable: true }),
    settledAt: col.timestamp({ nullable: true }),
    ...col.timestamps(),
  },
  // One row per Layout, so two removals of one Layout cannot both insert the
  // fence: the second meets the unique index and is told the first is running.
  { indexes: [{ columns: ["layoutId"], unique: true }] }
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

/** The columns of {@link siteOptions}, as `defineTable` checks and publishes them. */
type SiteOptionsColumns = {
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly name: ColumnBuilder<string, false, false>;
  readonly value: ColumnBuilder<string, false, false>;
  readonly createdAt: ColumnBuilder<Date, false, true>;
  readonly updatedAt: ColumnBuilder<Date, false, true>;
};

/**
 * One row per site-wide option this plugin keeps outside the Site Style
 * document: `name` says which, `value` holds it.
 *
 * A table rather than a field on a Single, because a row can be written only
 * if absent: one conflict-safe insert both records a choice and refuses to
 * replace one already made, which a Single's read-merge-write cannot promise.
 * See `spacing-mode-store` for the one option it holds today.
 */
export const siteOptions: TableDefinition<"site_options", SiteOptionsColumns> =
  defineTable<"site_options", SiteOptionsColumns>(
    "site_options",
    {
      id: col.id(),
      name: col.varchar(64),
      value: col.varchar(255),
      ...col.timestamps(),
    },
    // One row per option, so two writers inserting the same option at once
    // cannot both succeed.
    { indexes: [{ columns: ["name"], unique: true }] }
  );

/** The columns every usage index row has: the document it describes. */
type UsageSubjectColumns = {
  readonly id: ColumnBuilder<string, false, false> & {
    readonly generated: "uuidv7";
  };
  readonly scope: ColumnBuilder<string, false, false>;
  readonly entity: ColumnBuilder<string, false, false>;
  readonly entityKey: ColumnBuilder<string, false, false>;
  readonly field: ColumnBuilder<string, false, false>;
  readonly locale: ColumnBuilder<string, false, false>;
  readonly variant: ColumnBuilder<string, false, false>;
};

/**
 * The subject columns, declared once for both index tables, so the two cannot
 * come to describe a document differently. Each is a closed vocabulary or an
 * identifier: `scope` is `collection` or `single`, `entity` a slug, `entityKey`
 * a document id (empty for a Single, which has one document), `field` a field
 * name, `locale` a locale code (empty for a field not stored per language) and
 * `variant` `published` or `draft`.
 */
function usageSubjectColumns(): UsageSubjectColumns {
  return {
    id: col.id(),
    scope: col.varchar(16),
    entity: col.varchar(255),
    entityKey: col.varchar(255),
    field: col.varchar(255),
    locale: col.varchar(64),
    variant: col.varchar(16),
  };
}

/** The columns of {@link classUsageRows}. */
type ClassUsageColumns = UsageSubjectColumns & {
  readonly classId: ColumnBuilder<string, false, false>;
};

/**
 * The class usage index: one row per named class a stored document applies,
 * or one marker row (`classId` longer than any class id may be) for a document
 * that could not be read whole.
 *
 * A table rather than a collection, for the reason the module docblock gives:
 * a row a super-admin added or removed by hand changed what a count said, and
 * health had no way to tell. Rows are derived from the documents, on every
 * save and by the backfill, and nothing else writes them.
 *
 * Indexed by document, which every maintenance pass reads by, and by class,
 * which every count asks about.
 */
export const classUsageRows: TableDefinition<"class_usage", ClassUsageColumns> =
  defineTable<"class_usage", ClassUsageColumns>(
    "class_usage",
    { ...usageSubjectColumns(), classId: col.varchar(255) },
    {
      indexes: [{ columns: ["entity", "entityKey"] }, { columns: ["classId"] }],
    }
  );

/**
 * The longest component id the plugin records: the width of the component
 * index's `componentId` column, the widest MySQL lets it be beside the other
 * columns of its index. A component definition is an entry of a collection,
 * whose id core makes 36 characters long; a value longer than this names no
 * component, and the derivation leaves it out rather than fail every write
 * that would store it.
 */
export const MAX_COMPONENT_ID_LENGTH = 512;

/** The columns of {@link componentUsageRows}. */
type ComponentUsageColumns = UsageSubjectColumns & {
  readonly kind: ColumnBuilder<string, false, false>;
  readonly componentId: ColumnBuilder<string, false, false>;
};

/**
 * The component usage index: one row per component a stored document can
 * place, or one `unreadable` row for a document that could not be read whole.
 *
 * `componentId` is {@link MAX_COMPONENT_ID_LENGTH} wide; the derivation
 * records no longer value. Indexed by document and by component, for the
 * reasons the class index is.
 */
export const componentUsageRows: TableDefinition<
  "component_usage",
  ComponentUsageColumns
> = defineTable<"component_usage", ComponentUsageColumns>(
  "component_usage",
  {
    ...usageSubjectColumns(),
    kind: col.varchar(16),
    componentId: col.varchar(MAX_COMPONENT_ID_LENGTH),
  },
  {
    indexes: [
      { columns: ["entity", "entityKey"] },
      { columns: ["componentId"] },
    ],
  }
);

/** Every table this plugin declares, in creation order. */
export const PAGE_BUILDER_TABLES: readonly [
  typeof usageRuns,
  typeof usageProgress,
  typeof layoutRemovals,
  typeof componentDeletions,
  typeof componentDeletionHosts,
  typeof siteOptions,
  typeof classUsageRows,
  typeof componentUsageRows,
] = [
  usageRuns,
  usageProgress,
  layoutRemovals,
  componentDeletions,
  componentDeletionHosts,
  siteOptions,
  classUsageRows,
  componentUsageRows,
];
