/**
 * `nextly setup-token` — give an operator a usable setup token without
 * reading the server's output.
 *
 * In production, until an install has an administrator, setup needs the
 * token a server start prints once. On a platform whose output is hard to
 * reach, this replaces it against the install's own database and prints the
 * new one; the previous token stops working. With `--generate`, it prints a
 * value suitable for `NEXTLY_SETUP_TOKEN` instead and touches nothing.
 *
 * @module cli/commands/setup-token
 */
import type { Command } from "commander";

import { claimFirstSetup } from "../../auth/setup-token/setup-gate";
import {
  SETUP_TOKEN_ENV,
  generateSetupToken,
  replaceSetupToken,
  type SetupTokenMeta,
  operatorSetupToken,
} from "../../auth/setup-token/setup-token";
import { NextlyError } from "../../errors/nextly-error";
import { reportDryRun, type DryRunPlan } from "../dry-run";
import { exitWithError, type CliError } from "../errors";
import {
  setupAlreadyComplete,
  setupInProgress,
  setupTokenSetByEnv,
} from "../errors/areas/commands";
import type { CommandContext, GlobalOptions } from "../program";

/**
 * What the command concluded, for its shell to print and exit on: the lines
 * to print, or the refusal the command ends with.
 */
export type SetupTokenCommandResult =
  | { ok: true; lines: string[] }
  | { ok: false; error: CliError };

/**
 * The command's decisions, apart from connecting: kept separate so they are
 * tested against a store, and the shell around them only connects and prints.
 */
export async function setupTokenCommand(input: {
  generate: boolean;
  meta?: SetupTokenMeta;
  hasAdministrator?: () => Promise<boolean>;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<SetupTokenCommandResult> {
  if (input.generate) {
    return {
      ok: true,
      lines: [
        `${SETUP_TOKEN_ENV}=${generateSetupToken()}`,
        `Set this as ${SETUP_TOKEN_ENV} in the install's environment, then restart it.`,
      ],
    };
  }
  if (!input.meta || !input.hasAdministrator) {
    throw NextlyError.internal({
      logContext: { reason: "setup-token-command-without-store" },
    });
  }
  // Under the claim a setup holds from judging its token to spending it, so a
  // replacement never lands between the two: a leaked token a setup already
  // accepted cannot complete it after being replaced, nor delete its
  // replacement when it is spent.
  const claim = await claimFirstSetup(input.meta);
  if (!claim) return { ok: false, error: setupInProgress("setup-token") };
  let outcome: Awaited<ReturnType<typeof replaceSetupToken>>;
  try {
    if (await input.hasAdministrator()) {
      return { ok: false, error: setupAlreadyComplete("setup-token") };
    }
    outcome = await replaceSetupToken({ meta: input.meta, env: input.env });
  } finally {
    await claim.release();
  }
  if (outcome.kind === "operator-token") {
    return { ok: false, error: setupTokenSetByEnv(SETUP_TOKEN_ENV) };
  }
  return { ok: true, lines: [outcome.line] };
}

/**
 * What replacing the setup token would do, asked as the command asks it and
 * written by nothing: no setup claim is taken and no token is made, so none
 * is printed. Each refusal is the real run's.
 */
export async function previewSetupToken(input: {
  hasAdministrator: () => Promise<boolean>;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<DryRunPlan> {
  if (await input.hasAdministrator()) {
    return {
      changes: [],
      refusals: [setupAlreadyComplete("setup-token").what],
    };
  }
  // The question `replaceSetupToken` asks before it stores anything.
  if (operatorSetupToken(input.env ?? process.env).kind !== "absent") {
    return {
      changes: [],
      refusals: [setupTokenSetByEnv(SETUP_TOKEN_ENV).what],
    };
  }
  return {
    changes: [
      {
        action: "write",
        target:
          "a new setup token in the install's store, replacing any current one",
      },
    ],
    notes: ["The new token is printed by a real run only."],
  };
}

interface SetupTokenCommandOptions {
  generate?: boolean;
  /** `--dry-run`: name the replacement, make and print no token. */
  dryRun?: boolean;
}

export async function runSetupTokenCommand(
  options: SetupTokenCommandOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  // `--generate` touches nothing, so it loads none of the database code a run
  // over the install's store does, and a dry run of it is the same run.
  const result = options.generate
    ? await setupTokenCommand({ generate: true })
    : await overStore(options, context);
  if (result === undefined) return;
  if (!result.ok) exitWithError(logger, result.error);
  for (const line of result.lines) logger.info(line);
}

/**
 * The run over the install's store, and what it concluded; nothing under
 * `--dry-run`, which reports for itself. The code that reads the store is
 * imported here, where a run first needs it.
 */
async function overStore(
  options: SetupTokenCommandOptions,
  context: CommandContext
): Promise<SetupTokenCommandResult | undefined> {
  const { logger } = context;
  const [{ loadConfig }, { withAdapter }, { setupTokenStore }] =
    await Promise.all([
      import("../utils/config-loader"),
      import("../utils/adapter"),
      import("./setup-token-store"),
    ]);
  // The config first, as every command that reads the database loads it: it
  // publishes the configured PostgreSQL schema the connection resolves in, so
  // an install in `cms` has its token replaced there, not in `public`.
  await loadConfig({
    configPath: context.options.config,
    cwd: context.options.cwd,
  });
  if (options.dryRun === true) {
    await previewOverStore(logger);
    return undefined;
  }
  // The connection refuses a missing or unusable database setting itself.
  return withAdapter(
    adapter =>
      setupTokenCommand({
        generate: false,
        ...setupTokenStore(adapter, logger),
      }),
    { logger }
  );
}

/**
 * The dry run over the install's store, opened read-only: a database that is
 * not there is named as the refusal.
 */
async function previewOverStore(
  logger: CommandContext["logger"]
): Promise<void> {
  const { openCommandAdapter } = await import("../utils/adapter");
  const { setupTokenStore } = await import("./setup-token-store");
  const adapter = await openCommandAdapter({ dryRun: true }, logger);
  if (adapter === undefined) return;
  try {
    const { hasAdministrator } = setupTokenStore(adapter, logger);
    reportDryRun(logger, await previewSetupToken({ hasAdministrator }));
  } finally {
    await adapter.disconnect();
  }
}

/**
 * The action of `nextly setup-token`, loaded when it runs, building its
 * context with the factory the program hands in.
 */
export function setupTokenAction(
  createContext: (options: GlobalOptions) => CommandContext
): (cmdOptions: SetupTokenCommandOptions, cmd: Command) => Promise<void> {
  return async (cmdOptions: SetupTokenCommandOptions, cmd: Command) => {
    const context = createContext(cmd.optsWithGlobals());
    try {
      await runSetupTokenCommand(cmdOptions, context);
    } catch (error) {
      exitWithError(context.logger, error);
    }
  };
}
