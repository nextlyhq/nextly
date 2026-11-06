/**
 * `nextly upgrade` — bring an existing database up to date (spec §4.10).
 *
 * The upgrade is a list of steps (`upgrade-steps/index.ts`), each idempotent:
 * moving the migration records into `nextly_schema_events`, then hashing the
 * passwords stored before this release. Each step in turn says how much it
 * would change and, when that is above 0, runs and reports its count; the
 * backup is confirmed before the first step with work, and the upgrade says
 * there is nothing to do only when no step had anything. The orchestration (`runUpgrade`) is a
 * plain async function taking an adapter-like dependency so it is testable
 * without the CLI shell.
 *
 * @module cli/commands/upgrade
 * @since v0.0.3-alpha (Plan B)
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { resolveRegistryNameFromCatalog } from "../../domains/field-groups/storage/resolve-storage-names";
import { assertNoLegacyBookkeeping } from "../../domains/schema/events/legacy-detection";
import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import {
  planCoreReconcile,
  reconcileCore,
} from "../../domains/schema/migrate/core-reconcile";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { NextlyError } from "../../errors";
import { reportDryRun, type DryRunChange, type DryRunPlan } from "../dry-run";
import { exitWithError, failWithError } from "../errors";
import { coreDestructiveNeedsTerminal } from "../errors/areas/migrations";
import { createContext } from "../program";
import { createCliAdapter, openCommandAdapter } from "../utils/adapter";
import { requireDatabaseEnv } from "../utils/command-prerequisites";
import { askYesInTerminal } from "../utils/prompt-cancelled";

import { maybeForceUnlock } from "./migrate";
import { dryRunRefusalOf } from "./migrate-create";
import type {
  RunUpgradeOptions,
  UpgradeAdapter,
  UpgradeStep,
  UpgradeStepContext,
} from "./upgrade-step";
import { UPGRADE_STEPS } from "./upgrade-steps";

export type { RunUpgradeOptions, UpgradeAdapter } from "./upgrade-step";

interface UpgradeLogger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
}

export interface RunUpgradeDeps {
  adapter: UpgradeAdapter;
  logger?: UpgradeLogger;
  /** When true and no --confirm-backed-up, prompt via `promptConfirm`. */
  isTTY?: boolean;
  /** Interactive backup confirmation (TTY only). Returns true to proceed. */
  promptConfirm?: () => Promise<boolean>;
  /** The steps to run, in order: every upgrade step unless a test narrows it. */
  steps?: readonly UpgradeStep[];
  /** How long a held schema lock is waited for, in milliseconds. Absent, about a minute. */
  lockWaitMs?: number;
}

async function confirmBackup(
  options: RunUpgradeOptions,
  deps: RunUpgradeDeps
): Promise<void> {
  if (options.force || options.confirmBackedUp) return;
  if (deps.isTTY && deps.promptConfirm) {
    const ok = await deps.promptConfirm();
    if (ok) return;
    throw new NextlyError({
      code: "NEXTLY_UPGRADE_IN_PROGRESS",
      publicMessage: "Upgrade cancelled by operator.",
      // The two refusals share a code; the reason tells the CLI's error apart.
      logContext: { reason: "cancelled" },
    });
  }
  throw backupNotConfirmed();
}

/** The refusal of an upgrade with work whose backup nobody confirmed, or can. */
function backupNotConfirmed(): NextlyError {
  return new NextlyError({
    code: "NEXTLY_UPGRADE_IN_PROGRESS",
    publicMessage:
      "Refusing to upgrade without a confirmed backup. Re-run with " +
      "`--confirm-backed-up` (CI/non-TTY) after backing up your database.",
    logContext: { reason: "backup-not-confirmed" },
  });
}

/** What each step is handed: the database, the command's options and its log. */
function stepContext(
  options: RunUpgradeOptions,
  deps: Pick<RunUpgradeDeps, "adapter" | "logger">
): UpgradeStepContext {
  const { adapter } = deps;
  return {
    adapter,
    db: adapter.getDrizzle(),
    dialect: adapter.getCapabilities().dialect,
    options,
    log: msg => deps.logger?.info?.(msg),
    warn: msg => deps.logger?.warn?.(msg),
  };
}

/**
 * Run the upgrade's steps. Idempotent: a second run on an upgraded database
 * finds every step with nothing to do, and says so.
 */
export async function runUpgrade(
  options: RunUpgradeOptions,
  deps: RunUpgradeDeps
): Promise<void> {
  const { adapter } = deps;
  const context = stepContext(options, deps);
  const { dialect } = context;
  const steps = deps.steps ?? UPGRADE_STEPS;

  await withMigrateLock(
    adapter as unknown as DrizzleAdapter,
    dialect,
    async () => {
      // Each step is brought up to date before the next is asked, so a step
      // reads what the steps before it have repaired. The backup is confirmed
      // once, before the first step that has work.
      const idle: string[] = [];
      let confirmed = false;
      for (const step of steps) {
        const pending = await step.pending(context);
        if (pending === 0) {
          idle.push(step.title);
          continue;
        }
        if (!confirmed) {
          await confirmBackup(options, deps);
          confirmed = true;
        }
        for (const title of idle.splice(0)) {
          context.log(`${title}: nothing to do`);
        }
        const changed = await step.run(context);
        context.log(`${step.title}: ${String(changed)}`);
      }
      if (!confirmed) {
        context.log("Already upgraded. Nothing to do.");
        return;
      }
      for (const title of idle) context.log(`${title}: nothing to do`);

      context.log(
        "Done. You can now run `pnpm run dev` or `pnpm nextly migrate`."
      );
    },
    { command: "nextly upgrade", mode: "wait", waitMs: deps.lockWaitMs }
  );
}

/**
 * `nextly upgrade --dry-run`: each step's pending work, counted by the step's
 * own `pending` against the database as it stands, read-only, with no backup
 * question and no lock. A real run counts each step once the steps before it
 * have run, so a note says these counts are all taken first.
 *
 * Refused where the real run would be: a step whose count refuses stops the
 * plan there, as it stops the run; and with work to do, a backup nobody
 * confirmed and nobody can be asked about refuses before the first step runs,
 * so that is the refusal named then.
 */
export async function previewUpgrade(
  options: RunUpgradeOptions,
  deps: Pick<RunUpgradeDeps, "adapter" | "isTTY" | "steps">
): Promise<DryRunPlan> {
  const context = stepContext(options, deps);
  const changes: DryRunChange[] = [];
  const idle: string[] = [];
  let refusal: string | undefined;
  for (const step of deps.steps ?? UPGRADE_STEPS) {
    let pending: number;
    try {
      pending = await step.pending(context);
    } catch (error) {
      refusal = dryRunRefusalOf(error);
      if (refusal === undefined) throw error;
      break;
    }
    if (pending === 0) idle.push(step.title);
    else changes.push(stepChange(step.title, pending));
  }
  const backupConfirmed =
    options.force === true || options.confirmBackedUp === true;
  const notes = [
    ...idle.map(title => `${title}: nothing to do`),
    "Each count is taken before any step runs; a real run counts each step once the steps before it have run.",
  ];
  if (changes.length > 0 && !backupConfirmed) {
    if (deps.isTTY === true) {
      notes.push("A real run first asks whether the database is backed up.");
    } else {
      refusal = backupNotConfirmed().publicMessage;
    }
  }
  return {
    changes,
    ...(refusal !== undefined ? { refusals: [refusal] } : {}),
    notes,
  };
}

/**
 * A step with work as the dry run names it, in the words the real run reports
 * it with (`<title>: <count>`): a step's title starts with its verb.
 */
function stepChange(title: string, pending: number): DryRunChange {
  const [verb = "", ...rest] = title.split(" ");
  return { action: verb, target: `${rest.join(" ")}: ${String(pending)}` };
}

export interface RunReconcileCoreDeps {
  adapter: UpgradeAdapter;
  logger?: UpgradeLogger;
  confirmDestructive: (reasons: string[]) => Promise<boolean>;
}

/** Injected for tests; defaults to the real reconcileCore. */
interface ReconcileCoreInjection {
  reconcileCore?: typeof reconcileCore;
}

/**
 * `nextly upgrade --reconcile-core` (spec §4.10.3). Standalone Phase 1 in
 * dev-loose with per-destructive-op confirmation. Gated by the legacy
 * bookkeeping check and the shared migrate lock. Use only when `nextly
 * migrate` reports core schema drift after upgrading.
 */
export async function runReconcileCore(
  deps: RunReconcileCoreDeps,
  injection: ReconcileCoreInjection = {}
): Promise<void> {
  const reconcile = injection.reconcileCore ?? reconcileCore;
  const { adapter } = deps;
  const dialect = adapter.getCapabilities().dialect;

  await assertNoLegacyBookkeeping(adapter);

  await withMigrateLock(
    adapter as unknown as DrizzleAdapter,
    dialect,
    async () => {
      await reconcile({
        ...(await reconcileTarget(adapter)),
        // `confirmDestructive` is an interactive prompt, NOT `allowDestructive`.
        // The retired-table cleanup is gated on the latter and therefore never
        // runs from here, which is deliberate: dropping `accounts`/`sessions` is
        // the documented `nextly migrate` + NEXTLY_ALLOW_CORE_DESTRUCTIVE flow,
        // and an upgrade that only confirmed a backup has not asked for it.
        confirmDestructive: deps.confirmDestructive,
        logger: deps.logger,
      });
    },
    { command: "nextly upgrade --reconcile-core", mode: "wait" }
  );
  deps.logger?.info?.("Core schema reconciliation complete.");
}

// ---------------------------------------------------------------------------
// CLI command registration
// ---------------------------------------------------------------------------

/**
 * What `--reconcile-core` reconciles, for the real run and its dry run alike:
 * the database, and the core shape in development's loose mode. Same reason as
 * `nextly migrate`: the desired core shape must name the field-group registry
 * this database actually holds, or the reconcile creates the other one empty.
 */
async function reconcileTarget(adapter: UpgradeAdapter) {
  const dialect = adapter.getCapabilities().dialect;
  const db = adapter.getDrizzle();
  return {
    db,
    dialect,
    fieldGroupRegistryTable: await resolveRegistryNameFromCatalog({
      dialect,
      getDrizzle: <T>() => db as T,
    }),
    mode: "dev-loose" as const,
  };
}

/**
 * `nextly upgrade --reconcile-core --dry-run`: the reconcile's own plan
 * (`planCoreReconcile`), read-only, with no lock: each statement its push
 * would run, and each retired auth table it would drop. A table or column
 * drop the push strips is named as left in place. A destructive change the
 * push makes is asked about at a terminal, so it is named as a question there;
 * where nobody can be asked, the real run refuses it, and the dry run says so.
 * A second push pass, and the core rows a reconcile fills in, are described,
 * not counted. A database still keeping its migration records the earlier way
 * is refused, as the real run refuses it.
 */
export async function previewReconcileCore(deps: {
  adapter: UpgradeAdapter;
  /** Whether a real run could ask at a terminal. */
  interactive: boolean;
}): Promise<DryRunPlan> {
  const { adapter } = deps;
  try {
    await assertNoLegacyBookkeeping(adapter);
  } catch (error) {
    const refusal = dryRunRefusalOf(error);
    if (refusal === undefined) throw error;
    return { changes: [], refusals: [refusal] };
  }
  const plan = await planCoreReconcile(await reconcileTarget(adapter));
  const changes: DryRunChange[] = [
    ...plan.statements.map(statement => ({ action: "run", target: statement })),
    ...plan.retiredDrops.map(table => ({
      action: "remove",
      target: `retired auth table ${table}`,
    })),
  ];
  const destructive = plan.destructiveReasons;
  const notes = [
    ...plan.leftInPlace.map(
      reason =>
        `Left in place: ${reason}. A core reconcile never drops a table or column.`
    ),
    ...(plan.degraded
      ? [
          "The push then takes a second pass over what the first created; its statements are not counted.",
        ]
      : []),
    "A real run also fills in core rows a new column leaves without a value (how an address was verified, the account a reset or verification link belongs to); those are not counted.",
  ];
  if (destructive.length > 0 && deps.interactive) {
    notes.push(
      `A real run asks to confirm each destructive change: ${destructive.join("; ")}.`
    );
  }
  return {
    changes,
    ...(destructive.length > 0 && !deps.interactive
      ? { refusals: [coreDestructiveNeedsTerminal(destructive).why] }
      : {}),
    notes,
  };
}

export interface UpgradeCommandOptions {
  confirmBackedUp?: boolean;
  force?: boolean;
  targetTableName?: string;
  reconcileCore?: boolean;
  /** Clear a stale migrate lock before taking it (operator escape hatch). */
  forceUnlock?: boolean;
  /** Show what the upgrade would change, and change nothing. */
  dryRun?: boolean;
}

/** The action of `nextly upgrade`, loaded when it runs. */
export async function upgradeAction(
  cmdOptions: UpgradeCommandOptions,
  cmd: Command
) {
  const globalOpts = cmd.optsWithGlobals();
  const context = createContext(globalOpts);

  const dbValidation = requireDatabaseEnv(context.logger);

  if (cmdOptions.dryRun === true) {
    await reportUpgradeDryRun(cmdOptions, dbValidation, context);
    return;
  }

  let adapter: { disconnect?: () => Promise<void> } & UpgradeAdapter;
  try {
    adapter = (await createCliAdapter({
      dialect: dbValidation.dialect,
      databaseUrl: dbValidation.databaseUrl,
      logger: globalOpts.verbose ? context.logger : undefined,
    })) as unknown as { disconnect?: () => Promise<void> } & UpgradeAdapter;
  } catch (error) {
    exitWithError(context.logger, error);
  }

  try {
    // Clear a stale lock first when --force-unlock is passed (e.g. left
    // by a crashed prior run): the lock-busy error tells operators to
    // re-run with this flag, and both upgrade paths take the migrate lock.
    await maybeForceUnlock(
      cmdOptions,
      adapter.getDrizzle(),
      adapter.getCapabilities().dialect
    );

    if (cmdOptions.reconcileCore) {
      await runReconcileCore({
        adapter,
        logger: {
          info: msg => context.logger.info(msg),
          warn: msg => context.logger.warn(msg),
        },
        // Asked only where someone can answer. Otherwise the run ends here,
        // before the reconcile changes anything, and says the confirmation
        // needs a terminal rather than waiting on input nobody will give.
        confirmDestructive: reasons => {
          if (!canPrompt()) {
            return Promise.reject(coreDestructiveNeedsTerminal(reasons));
          }
          return askYesInTerminal(
            `Reconcile core schema with these destructive operations?\n  - ${reasons.join("\n  - ")}\nProceed? [y/N]: `
          );
        },
      });
    } else {
      await runUpgrade(
        {
          confirmBackedUp: cmdOptions.confirmBackedUp,
          force: cmdOptions.force,
          targetTableName: cmdOptions.targetTableName,
        },
        {
          adapter,
          logger: {
            info: msg => context.logger.info(msg),
            warn: msg => context.logger.warn(msg),
          },
          // The CLI's one answer to whether anyone can be asked.
          isTTY: canPrompt(),
          promptConfirm: () =>
            askYesInTerminal("Have you backed up your database? [y/N]: "),
        }
      );
    }
  } catch (error) {
    // Set rather than exited, so the disconnect below still runs.
    failWithError(context.logger, error);
  } finally {
    await adapter.disconnect?.();
  }
}

/**
 * `nextly upgrade --dry-run`: the database opened read-only, the plan of the
 * steps (`previewUpgrade`) or of `--reconcile-core` (`previewReconcileCore`)
 * reported, and nothing changed: no lock taken, and under `--force-unlock`
 * none cleared, only named. Whether a real run could ask at a terminal is
 * the CLI's one answer to it (`canPrompt`).
 */
async function reportUpgradeDryRun(
  cmdOptions: UpgradeCommandOptions,
  dbValidation: ReturnType<typeof requireDatabaseEnv>,
  context: ReturnType<typeof createContext>
): Promise<void> {
  let adapter:
    | ({ disconnect?: () => Promise<void> } & UpgradeAdapter)
    | undefined;
  try {
    // A dry run whose database is not there has said so, and ends here.
    const opened = await openCommandAdapter(
      {
        dialect: dbValidation.dialect,
        databaseUrl: dbValidation.databaseUrl,
        logger: context.options.verbose ? context.logger : undefined,
        dryRun: true,
      },
      context.logger
    );
    if (opened === undefined) return;
    adapter = opened as unknown as typeof adapter & UpgradeAdapter;
    const interactive = canPrompt();
    const plan = cmdOptions.reconcileCore
      ? await previewReconcileCore({ adapter, interactive })
      : await previewUpgrade(
          {
            confirmBackedUp: cmdOptions.confirmBackedUp,
            force: cmdOptions.force,
            targetTableName: cmdOptions.targetTableName,
          },
          { adapter, isTTY: interactive }
        );
    reportDryRun(
      context.logger,
      cmdOptions.forceUnlock
        ? {
            ...plan,
            changes: [
              { action: "remove", target: "any migrate lock held" },
              ...plan.changes,
            ],
          }
        : plan
    );
  } catch (error) {
    // Set rather than exited, so the disconnect below still runs.
    failWithError(context.logger, error);
  } finally {
    await adapter?.disconnect?.();
  }
}

export { registerUpgradeCommand } from "./upgrade.command";
