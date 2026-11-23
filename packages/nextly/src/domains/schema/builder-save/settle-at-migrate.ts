/**
 * `nextly migrate`'s settle of a Builder save left part-way, before its run changes anything: the
 * same settle a development start runs (`settleLeftSaves`), and a save made outside development
 * judged by its files (`byFiles`), held under the schema lock and the project's migration files.
 * What it cannot settle refuses the run before its first file, naming the save and the step that
 * settles it. A save left pending has its remaining files applied by the run, and is settled again
 * after it.
 *
 * A production start that migrates settles nothing: it only refuses (`refuseWhileSaveInProgress`,
 * asked under its lock by `recheckSaveRecords`).
 *
 * @module domains/schema/builder-save/settle-at-migrate
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { BusyTableBounds } from "../busy-table/bounds";
import { commandWriterHold } from "../migrate-create/writer-hold";
import { withMigrateLock } from "../pipeline/locks";

import { refuseWhileSaveInProgress } from "./save-in-progress";
import { settleLeftSaves, type SettleDeps } from "./settle-left-save";
import { settleRegistryWriter } from "./settle-registry";

/** Where `nextly migrate` runs, as its settle needs it. */
export interface MigrateSettleArgs {
  adapter: DrizzleAdapter;
  /** The project root the records name their definition files from. */
  projectRoot: string;
  migrationsDir: string;
  /** The schema lock's lease, from the configuration. */
  lockTtlSeconds?: number;
  /** The database the run reaches (`databaseIdentity`): a marker of a save against another stays. */
  database: string;
  /** The run's busy-table bounds, from its flags over the environment, for the settle's lock. */
  busyBounds?: BusyTableBounds;
  logger: SettleDeps["logger"];
}

/**
 * What the run is told by its settle: the records it finishes, which do not refuse it. One left
 * pending, whose remaining files the run applies; and one that applied whole with no registry row
 * to bring up, whose row the run's metadata pass adds from the newest applied snapshot. Each is
 * settled again after the run.
 */
export interface MigrateSettled {
  pending: ReadonlySet<string>;
  /**
   * Whether the settle changed the project or the ledger: a save withdrawn, finished or recorded.
   * The run then reads what the project declares again.
   */
  changed: boolean;
}

/**
 * Settle every Builder save left part-way before the run, then refuse while one stands that the
 * run does not finish.
 *
 * @throws NextlyError `CONFLICT` naming each save left and the step that settles it
 */
export async function settleBeforeMigrate(
  args: MigrateSettleArgs
): Promise<MigrateSettled> {
  // A database with no meta table yet (a first run) holds no record.
  if (!(await args.adapter.tableExists("nextly_meta"))) {
    return { pending: new Set(), changed: false };
  }
  const settled = await settleHeld(args);
  const pending = new Set(
    settled
      .filter(
        save => save.outcome === "pending" || save.keptFor === "registry-row"
      )
      .map(save => save.id)
  );
  await refuseWhileSaveInProgress(args.adapter, {
    allow: pending,
    notice: line => args.logger.warn(line),
  });
  return {
    pending,
    changed: settled.some(save => save.outcome !== "left"),
  };
}

/**
 * The check the run asks again under its own lock, before its first file: a save that started
 * after the settle above let the lock go refuses the run as one standing before it would.
 */
export function recheckBeforeFiles(
  args: Pick<MigrateSettleArgs, "adapter" | "logger">,
  settled: MigrateSettled
): () => Promise<void> {
  return () =>
    refuseWhileSaveInProgress(args.adapter, {
      allow: settled.pending,
      notice: line => args.logger.warn(line),
    });
}

/**
 * Settle again, once the run has applied its files and written its registry rows, the saves the
 * settle before it let through: their remaining files recorded applied, or their row now there to
 * bring up, each is whole and its record clears. One the run did not finish stays, refusing the
 * next run as before.
 */
export async function settleAfterMigrate(
  args: MigrateSettleArgs,
  settled: MigrateSettled
): Promise<void> {
  if (settled.pending.size === 0) return;
  await settleHeld(args, settled.pending);
}

/**
 * `settleLeftSaves` under the schema lock and the project's migration files, as a writer of them
 * holds them, with a save made outside development judged by its files. Run in a scope of its own,
 * so the hold it takes on the files ends with it.
 */
async function settleHeld(args: MigrateSettleArgs, only?: ReadonlySet<string>) {
  const hold = await commandWriterHold({
    migrationsDir: args.migrationsDir,
    command: "nextly migrate",
    dryRun: false,
  });
  try {
    hold.enter();
    const outcome = await withMigrateLock(
      args.adapter,
      args.adapter.getCapabilities().dialect,
      () =>
        settleLeftSaves({
          adapter: args.adapter,
          projectRoot: args.projectRoot,
          migrationsDir: args.migrationsDir,
          database: args.database,
          logger: args.logger,
          keepPending: true,
          byFiles: true,
          ...(only === undefined ? {} : { only }),
          writeRegistry: settleRegistryWriter(args.adapter),
        }),
      {
        command: "nextly migrate's settle of a left Builder save",
        ...(args.lockTtlSeconds === undefined
          ? {}
          : { ttlSeconds: args.lockTtlSeconds }),
        ...(args.busyBounds === undefined
          ? {}
          : { busyBounds: args.busyBounds }),
      }
    );
    return outcome.ran ? outcome.value : [];
  } finally {
    await hold.release();
  }
}
