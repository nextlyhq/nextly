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

import { createInterface } from "node:readline";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { resolveRegistryNameFromCatalog } from "../../domains/field-groups/storage/resolve-storage-names";
import { assertNoLegacyBookkeeping } from "../../domains/schema/events/legacy-detection";
import { reconcileCore } from "../../domains/schema/migrate/core-reconcile";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { NextlyError, describeError } from "../../errors";
import { createContext } from "../program";
import { createCliAdapter, validateDatabaseEnv } from "../utils/adapter";

import { maybeForceUnlock } from "./migrate";
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
    });
  }
  throw new NextlyError({
    code: "NEXTLY_UPGRADE_IN_PROGRESS",
    publicMessage:
      "Refusing to upgrade without a confirmed backup. Re-run with " +
      "`--confirm-backed-up` (CI/non-TTY) after backing up your database.",
  });
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
  const dialect = adapter.getCapabilities().dialect;
  const db = adapter.getDrizzle();
  const context: UpgradeStepContext = {
    adapter,
    db,
    dialect,
    options,
    log: msg => deps.logger?.info?.(msg),
    warn: msg => deps.logger?.warn?.(msg),
  };
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
  const db = adapter.getDrizzle();

  await assertNoLegacyBookkeeping(adapter);

  await withMigrateLock(
    adapter as unknown as DrizzleAdapter,
    dialect,
    async () => {
      await reconcile({
        db,
        dialect,
        // Same reason as `nextly migrate`: the desired core shape must name the
        // registry this database actually holds, or the reconcile creates the
        // other one empty.
        fieldGroupRegistryTable: await resolveRegistryNameFromCatalog({
          dialect,
          getDrizzle: <T>() => db as T,
        }),
        mode: "dev-loose",
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

export interface UpgradeCommandOptions {
  confirmBackedUp?: boolean;
  force?: boolean;
  targetTableName?: string;
  reconcileCore?: boolean;
  /** Clear a stale migrate lock before taking it (operator escape hatch). */
  forceUnlock?: boolean;
}

/** Minimal interactive yes/no prompt for the TTY backup confirmation. */
function promptYesNo(question: string): Promise<boolean> {
  return new Promise(resolve => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, answer => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

export function registerUpgradeCommand(program: Command): void {
  program
    .command("upgrade")
    .description(
      "Bring an existing database up to date: move the migration records into nextly_schema_events, hash passwords stored before this release, and remove passwords kept in version history"
    )
    .option(
      "--confirm-backed-up",
      "Confirm a backup exists (required in CI/non-TTY)",
      false
    )
    .option("-f, --force", "Skip the interactive backup prompt", false)
    .option(
      "--target-table-name <name>",
      "Override the events table name on a collision"
    )
    .option(
      "--reconcile-core",
      "Reconcile drifted core schema (dev-loose, confirms each destructive op). Use only if `nextly migrate` reports core drift.",
      false
    )
    // Both upgrade paths take the shared migrate lock, and the lock-busy
    // error tells operators to re-run with this flag — so every lock-taking
    // command must register it. Same escape hatch as `nextly migrate`.
    .option(
      "--force-unlock",
      "Clear a stale migrate lock before running",
      false
    )
    .action(async (cmdOptions: UpgradeCommandOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);

      const dbValidation = validateDatabaseEnv();
      if (!dbValidation.valid || !dbValidation.dialect) {
        for (const err of dbValidation.errors ?? []) context.logger.error(err);
        process.exit(1);
      }

      let adapter: { disconnect?: () => Promise<void> } & UpgradeAdapter;
      try {
        adapter = (await createCliAdapter({
          dialect: dbValidation.dialect,
          databaseUrl: dbValidation.databaseUrl,
          logger: globalOpts.verbose ? context.logger : undefined,
        })) as unknown as { disconnect?: () => Promise<void> } & UpgradeAdapter;
      } catch (error) {
        context.logger.error(
          `Failed to connect to database: ${describeError(error)}`
        );
        process.exit(1);
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
            confirmDestructive: reasons =>
              promptYesNo(
                `Reconcile core schema with these destructive operations?\n  - ${reasons.join("\n  - ")}\nProceed? [y/N]: `
              ),
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
              isTTY: Boolean(process.stdin.isTTY),
              promptConfirm: () =>
                promptYesNo("Have you backed up your database? [y/N]: "),
            }
          );
        }
      } catch (error) {
        context.logger.error(describeError(error));
        process.exitCode = 1;
      } finally {
        await adapter.disconnect?.();
      }
    });
}
