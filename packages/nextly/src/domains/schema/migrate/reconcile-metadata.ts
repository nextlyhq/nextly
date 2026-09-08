/**
 * Making the registry agree with the tables `migrate` just created.
 *
 * 🔴 Without this, a collection built in the Schema Builder and deployed to
 * production never shows a dashboard card. `registerFromMigrations` is the only
 * writer that records `applied`, and its one caller sits inside
 * `runBootTimeApplyIfDev`, whose first line returns unless
 * `NODE_ENV === "development"`. `nextly migrate` applies the DDL and touches no
 * registry row at all, so the row stays `pending` after its table exists — and a
 * restart re-runs the same dev-gated path and changes nothing.
 *
 * The reconciliation half of that was already built and never connected:
 * `getPendingMigrations()` and `updateMigrationStatusWithVerification()` are
 * public on all three registry services and had no product callers anywhere.
 *
 * ## Why WRITE rather than derive on read
 *
 * The status could be computed from the file ledger whenever someone asks. It is
 * written instead, for two reasons. The registry row is what every reader
 * already consults — the widget layer, the admin, the permission seeder — so
 * deriving it would mean teaching each of them a second source and keeping the
 * two agreeing. And Directus, the closest structural analogue with a per-entity
 * registry, writes its metadata in the same operation as the DDL rather than as
 * a later pass; the migration tools with no registry at all (Prisma, Drizzle
 * Kit, Rails, Django) cannot answer the question, because they have no row to
 * reconcile.
 *
 * ## Sequenced with repair, not atomic
 *
 * The DDL and this bookkeeping cannot share a transaction: MySQL commits DDL
 * implicitly, so there is no boundary to roll back across. `migrate` therefore
 * runs this AFTER the tables land and treats every half as idempotent —
 * matching what `single-metadata-service` and `field-groups/migration/steps`
 * already do for the identical DDL-then-registry-row problem. A failure here
 * leaves tables that work and a row that is behind, which the next invocation
 * repairs; failing the command instead would report a successful migration as
 * broken.
 *
 * @module domains/schema/migrate/reconcile-metadata
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { Logger } from "../../../shared/types";
import type { SupportedDialect } from "../../../types/database";
import { CollectionRegistryService } from "../../collections/services/collection-registry-service";
import { FieldGroupRegistryService } from "../../field-groups/services/field-group-registry-service";
import { SingleRegistryService } from "../../singles/services/single-registry-service";
import { SchemaEventsRepository } from "../events/schema-events-repository";

import { registerFromMigrations } from "./metadata-register";
import {
  isAwaitingMigration,
  noPendingEntities,
  readPendingEntities,
  type PendingEntities,
} from "./pending-entities";

/**
 * The logging surface a CALLER supplies, structural so the CLI's own context
 * satisfies it without adapting.
 *
 * Narrower than `Logger`, which the registry services take: they log with a
 * metadata object the CLI's logger has no parameter for. {@link asServiceLogger}
 * widens one into the other in the single place that needs it, rather than
 * making every caller carry a shape it does not have.
 */
export interface ReconcileLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  debug: (message: string) => void;
  error?: (message: string) => void;
}

/**
 * A `Logger` for the registry services, from the narrower surface above.
 *
 * The metadata argument is DROPPED rather than serialized into the message: it
 * carries slugs and table names this already reports in its own summary, and a
 * caller whose logger takes no second argument would otherwise see either
 * nothing or a stringified object appended to every line.
 */
function asServiceLogger(logger: ReconcileLogger): Logger {
  return {
    debug: message => logger.debug(message),
    info: message => logger.info(message),
    warn: message => logger.warn(message),
    error: message => (logger.error ?? logger.warn)(message),
  };
}

export interface ReconcileMetadataDeps {
  adapter: DrizzleAdapter;
  dialect: SupportedDialect;
  migrationsDir: string;
  logger: ReconcileLogger;
  /** Seam for tests; defaults to the real snapshot reader. */
  registerFn?: typeof registerFromMigrations;
  /**
   * Seam for tests; defaults to reading the migration headers from disk.
   *
   * Replaces the file and ledger I/O ONLY. Which registry gets which set, and
   * how a row is judged against it, still run — so a test cannot pass by
   * reaching the sweep through a route production does not have.
   */
  readPendingEntitiesFn?: typeof readPendingEntities;
}

export interface ReconcileMetadataResult {
  collectionsRegistered: number;
  singlesRegistered: number;
  /** Rows moved from `pending`/`generated` to `applied`. */
  marked: number;
  /**
   * Rows left exactly as they were, because their table is not there yet.
   *
   * Reported rather than silently skipped: it is the number that tells an
   * operator the difference between "nothing needed doing" and "something is
   * still waiting for a migration that has not been generated".
   */
  stillPending: number;
  /**
   * Rows held back because a migration naming them has not run, counted inside
   * {@link ReconcileMetadataResult.stillPending}.
   *
   * Reported separately because "waiting for a migration that does not exist
   * yet" and "waiting for one already generated" send an operator to different
   * places, and a single total cannot tell them apart.
   */
  awaitingMigration: number;
  /**
   * Unapplied migrations naming no entity, so nothing could be judged against
   * them. Rows were promoted on table existence alone.
   */
  unscopedMigrations: string[];
  /**
   * Registries this pass could not read at all, by kind.
   *
   * 🔴 Reported rather than only logged, because the per-registry guard below
   * turns a TOTAL failure into an ordinary-looking success otherwise. That is
   * not hypothetical: with no table resolver installed, every registry read
   * refuses, all three are caught, and the command finishes claiming zero rows
   * needed repair — indistinguishable from a database that was already correct.
   * A caller that can see this list can say the difference.
   */
  unreadable: string[];
}

/** One registry service, reduced to the two calls this needs from it. */
interface PendingRegistry {
  kind: string;
  /**
   * Slugs of this kind that an unapplied migration names.
   *
   * Empty means nothing is outstanding for this kind, which promotes exactly as
   * the existence rule alone used to.
   */
  awaiting: Set<string>;
  getPendingMigrations: () => Promise<readonly unknown[]>;
  updateMigrationStatusWithVerification: (
    slug: string,
    tableName: string
  ) => Promise<{ verified: boolean }>;
}

/** `slug` and `tableName` off a registry record, when it carries usable ones. */
function identify(
  record: unknown
): { slug: string; tableName: string } | undefined {
  if (typeof record !== "object" || record === null) return undefined;
  const { slug, tableName } = record as {
    slug?: unknown;
    tableName?: unknown;
  };
  if (typeof slug !== "string" || slug === "") return undefined;
  if (typeof tableName !== "string" || tableName === "") return undefined;
  return { slug, tableName };
}

/**
 * Move every pending row whose table now EXISTS to `applied`.
 *
 * 🔴 Existence is checked here, before delegating, and the row is left untouched
 * when the table is absent. `updateMigrationStatusWithVerification` writes
 * `failed` in that case, which is right where a create is known to have been
 * attempted and wrong here: after a migrate run, a `pending` row with no table
 * has two indistinguishable causes — a migration that failed, and a migration
 * file that was never generated. Condemning the second turns a collection still
 * waiting for its DDL into one an operator has to un-fail by hand, and this pass
 * runs on every invocation, so nothing is lost by waiting.
 *
 * The delegate re-checks existence, and that duplicate read is deliberate: it
 * keeps ONE implementation of "verify, then record", so the status can never be
 * written by a path that skipped the check.
 */
async function markApplied(
  registry: PendingRegistry,
  adapter: DrizzleAdapter,
  logger: ReconcileLogger
): Promise<{
  marked: number;
  stillPending: number;
  awaitingMigration: number;
}> {
  let marked = 0;
  let stillPending = 0;
  let awaitingMigration = 0;

  const rows = await registry.getPendingMigrations();
  for (const row of rows) {
    const named = identify(row);
    if (!named) {
      // A row with no usable slug or table name cannot be verified against
      // anything. Counted as still pending so the total stays honest.
      stillPending += 1;
      continue;
    }

    try {
      /*
       * 🔴 Asked BEFORE the database, and the order is what makes the counts
       * mean anything. A `--step` run can leave a generated CREATE unapplied,
       * so the row is both named by an outstanding migration and missing its
       * table; deciding on the table first files it under "no migration exists
       * yet" and sends the operator to `migrate:create` for a file that is
       * already sitting in the repository. Both orders withhold the row — only
       * one of them says why correctly.
       *
       * Only a slug an unapplied migration NAMES is held back. A row nothing
       * names falls through to the existence rule, because withholding on
       * silence would empty the dashboards this sweep exists to fill.
       */
      if (isAwaitingMigration(row, registry.awaiting)) {
        stillPending += 1;
        awaitingMigration += 1;
        logger.debug(
          `Leaving ${registry.kind} "${named.slug}" pending: a migration naming it has not been applied`
        );
        continue;
      }

      /*
       * Existence is necessary and not sufficient. An EDITED entity keeps its
       * old physical table, so this answers yes for a change that has not
       * migrated at all — which is why the header check above exists.
       */
      if (!(await adapter.tableExists(named.tableName))) {
        stillPending += 1;
        continue;
      }

      const outcome = await registry.updateMigrationStatusWithVerification(
        named.slug,
        named.tableName
      );
      if (outcome.verified) marked += 1;
      else stillPending += 1;
    } catch (error) {
      // Per ROW, so one unreadable record cannot cost the rest their status.
      // The tables are already in place; the worst case is a row that stays
      // behind until the next invocation.
      stillPending += 1;
      logger.warn(
        `Could not record migration status for ${registry.kind} "${named.slug}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return { marked, stillPending, awaitingMigration };
}

/**
 * Register what the snapshots describe, then record what the tables prove.
 *
 * Called INSIDE the migrate lock, unlike the dev-boot path, which runs its
 * equivalent outside for reasons scoped to several dev-server workers racing.
 * A CLI invocation holds the lock already, so the read-then-write below cannot
 * interleave with another migrate — which is what lets it be a plain sweep
 * rather than a conflict-tolerant one.
 */
export async function reconcileMigrationMetadata(
  deps: ReconcileMetadataDeps
): Promise<ReconcileMetadataResult> {
  const { adapter, dialect, migrationsDir, logger } = deps;
  const register = deps.registerFn ?? registerFromMigrations;

  /*
   * Step 1: rows the snapshots describe that the registry does not have yet.
   *
   * 🔴 Registration inserts them as `applied`, so it is given the evidence for
   * that claim rather than asserting it. Every `*.snapshot.json` in the
   * directory is otherwise read and merged, including snapshots belonging to
   * migrations a `--step N` run never reached -- and those entities are then
   * exposed as applied while their tables may not exist, out of reach of the
   * sweep below, which only looks at rows that are still pending.
   *
   * The ledger is the evidence: `nextly_schema_events` records a `file_apply`
   * per migration, and `isFileApplied` is the same query `runFileMigrations`
   * already uses to decide what is outstanding — so registration and execution
   * read one source rather than two that can disagree.
   */
  const events = new SchemaEventsRepository(adapter.getDrizzle(), dialect);

  /*
   * Memoized because both halves of this pass ask the ledger about the same
   * files: registration, to decide what it may insert, and the sweep's
   * evidence, to decide what shape the database has reached. One query per
   * migration file rather than two, and — more usefully — one ANSWER, so the
   * two halves cannot disagree about whether a file ran.
   */
  const appliedCache = new Map<string, Promise<boolean>>();
  const isApplied = (filename: string): Promise<boolean> => {
    const cached = appliedCache.get(filename);
    if (cached) return cached;
    const pending = events.isFileApplied(filename);
    appliedCache.set(filename, pending);
    return pending;
  };

  const registered = await register({
    migrationsDir,
    adapter,
    dialect,
    logger,
    isApplied,
  });

  /*
   * Step 1b: which entities an unapplied migration still names.
   *
   * Read AFTER registration so the ledger answers are already cached, and read
   * at all because the sweep below cannot tell an edited entity from a settled
   * one without it — the physical table is identical in both cases.
   *
   * A failure here is not allowed to fail the pass: with nothing outstanding
   * recorded, every row falls back to the existence rule, which is the
   * behaviour that shipped before this check existed.
   */
  const load = deps.readPendingEntitiesFn ?? readPendingEntities;
  let awaiting: PendingEntities;
  try {
    awaiting = await load({ migrationsDir, dialect, isApplied, logger });
  } catch (error) {
    awaiting = noPendingEntities();
    logger.warn(
      `Could not read which migrations are still pending, so registry rows were promoted on table existence alone: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // Step 2: rows the registry already had, waiting on a table.
  const serviceLogger = asServiceLogger(logger);
  const registries: PendingRegistry[] = [
    {
      kind: "collection",
      awaiting: awaiting.collections,
      ...bind(new CollectionRegistryService(adapter, serviceLogger)),
    },
    {
      kind: "single",
      awaiting: awaiting.singles,
      ...bind(new SingleRegistryService(adapter, serviceLogger)),
    },
    {
      // The header names field groups too, so all three kinds are judged by
      // the same rule.
      kind: "field group",
      awaiting: awaiting.components,
      ...bind(new FieldGroupRegistryService(adapter, serviceLogger)),
    },
  ];

  let marked = 0;
  let stillPending = 0;
  let awaitingMigration = 0;
  const unreadable: string[] = [];
  for (const registry of registries) {
    try {
      const swept = await markApplied(registry, adapter, logger);
      marked += swept.marked;
      stillPending += swept.stillPending;
      awaitingMigration += swept.awaitingMigration;
    } catch (error) {
      /*
       * 🔴 Per REGISTRY, so one that cannot be read costs only its own rows.
       * The reachable cause is an install whose registry table is not there --
       * a project with no singles has no `dynamic_singles` -- and letting that
       * throw would mean a missing table for a feature nobody uses stops the
       * collections beside it from ever recording their status.
       *
       * Warned rather than silent: a registry that cannot be swept is a real
       * gap in what this pass claims to have done, and the count it would have
       * contributed is simply absent from the totals.
       */
      unreadable.push(registry.kind);
      logger.warn(
        `Could not sweep ${registry.kind} migration statuses: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return {
    collectionsRegistered: registered.collectionsRegistered,
    singlesRegistered: registered.singlesRegistered,
    marked,
    stillPending,
    awaitingMigration,
    unscopedMigrations: awaiting.unscoped,
    unreadable,
  };
}

/**
 * The two calls, bound to their service.
 *
 * Bound rather than passed as `service.getPendingMigrations` directly, because
 * both read `this`; an unbound reference would throw on the first property
 * access and read as a database failure.
 */
function bind(service: {
  getPendingMigrations: () => Promise<readonly unknown[]>;
  updateMigrationStatusWithVerification: (
    slug: string,
    tableName: string
  ) => Promise<{ verified: boolean }>;
}): Pick<
  PendingRegistry,
  "getPendingMigrations" | "updateMigrationStatusWithVerification"
> {
  return {
    getPendingMigrations: () => service.getPendingMigrations(),
    updateMigrationStatusWithVerification: (slug, tableName) =>
      service.updateMigrationStatusWithVerification(slug, tableName),
  };
}
