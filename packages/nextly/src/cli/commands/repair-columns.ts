/**
 * `nextly repair-columns`: report every column whose type or nullability differs from its field's
 * descriptor, on every table Nextly builds from field definitions, and with `--apply` convert the
 * ones that are safe.
 *
 * It compares the live database with each field as the database last had it applied, gives every
 * column one outcome, and exits with the code its outcomes give: 0 when no difference remains, 2
 * when differences remain, 3 when a conversion failed or was interrupted, and 1 when it could not
 * run. With `--json` it writes one document to standard output and nothing else there.
 *
 * Without `--apply` it changes nothing: no table, row, registry entry or ledger row, and it never
 * takes the schema lock, only reads who holds it. With `--apply` it takes the schema lock, converts
 * each safe column and records each repair; a lock still held after the wait is a run that could
 * not run.
 *
 * The domain modules are imported when the command runs, not when the CLI loads, so listing the
 * CLI's commands does not pull in the schema services.
 */
import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import type { RepairColumnsDocument } from "../../domains/schema/repair-columns/report-json";
import { getCoreVersion } from "../../plugins/core-version";
import { databaseEnvError, printCliError, toCliError } from "../errors";
import { cliErrorDocsUrl } from "../errors/registry";
import type { CommandContext, GlobalOptions } from "../program";
import { createCliAdapter, validateDatabaseEnv } from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";
import { installRegistryResolver } from "../utils/registry-resolver";

export interface RepairColumnsOptions {
  config?: string;
  cwd?: string;
  verbose?: boolean;
  json?: boolean;
  /** Convert each safe column, rather than only report. */
  apply?: boolean;
}

/**
 * Read the database and build the run's document. Anything that stops the run before it can report
 * (no database settings, a configuration that does not load, a database it cannot read) is
 * returned as the document of a run that could not run, with the error that stopped it, so both
 * outputs end with the same code.
 */
export async function runRepairColumns(
  options: RepairColumnsOptions,
  context: CommandContext
): Promise<{ document: RepairColumnsDocument; error: unknown }> {
  try {
    return { document: await report(options, context), error: null };
  } catch (error) {
    const { couldNotRunDocument } = await import(
      "../../domains/schema/repair-columns/report-json"
    );
    const cliError = toCliError(error);
    return {
      document: couldNotRunDocument({
        nextlyVersion: getCoreVersion(),
        error: {
          code: cliError.code,
          message: cliError.what,
          cause: cliError.why,
          next: cliError.next,
          docs: cliErrorDocsUrl(cliError.code),
        },
      }),
      error,
    };
  }
}

async function report(
  options: RepairColumnsOptions,
  context: CommandContext
): Promise<RepairColumnsDocument> {
  const { logger } = context;
  const env = validateDatabaseEnv();
  if (!env.valid || env.dialect === undefined) throw databaseEnvError(env);
  const dialect = env.dialect;
  const cwd = options.cwd ?? context.cwd;
  const { config, projectRoot, deferredExtends } = await loadConfig({
    configPath: options.config,
    cwd,
    // The loader writes its diagnostics to standard output, which under `--json` holds the
    // document alone.
    debug: options.verbose === true && options.json !== true,
  });

  const [{ readRepairEntities }, { dryRunReport }, { applyRepairs }] =
    await Promise.all([
      import("../../domains/schema/repair-columns/read-entities"),
      import("../../domains/schema/repair-columns/run-report"),
      import("../../domains/schema/repair-columns/apply"),
    ]);

  const adapter = (await createCliAdapter({
    dialect,
    databaseUrl: env.databaseUrl,
    logger,
  })) as unknown as DrizzleAdapter & { disconnect(): Promise<void> };
  try {
    installRegistryResolver(adapter);
    // The services log with a metadata argument the CLI logger has no place for, and nothing they
    // log here is a finding, so it goes to debug output.
    const debug = (message: string) => logger.debug(message);
    // An apply reads them once it holds the schema lock; a dry run takes no lock and reads now.
    const readEntities = () =>
      readRepairEntities({
        adapter,
        dialect,
        config,
        // The manifest and the plugins' extensions of it: a Builder entity is configured as the next
        // migration would apply it, not only as the registry last saved it.
        projectRoot,
        ...(deferredExtends !== undefined ? { deferredExtends } : {}),
        migrationsDir: resolve(cwd, config.db.migrationsDir),
        logger: { debug, info: debug, warn: debug, error: debug },
      });
    const run = { adapter, dialect, nextlyVersion: getCoreVersion() };
    return options.apply === true
      ? await applyRepairs({ ...run, entities: readEntities })
      : await dryRunReport({ ...run, entities: await readEntities() });
  } finally {
    await adapter.disconnect();
  }
}

/** Print the run: the one document under `--json`, otherwise the text report or the error. */
async function printRun(
  run: { document: RepairColumnsDocument; error: unknown },
  json: boolean,
  logger: CommandContext["logger"]
): Promise<void> {
  if (json) {
    process.stdout.write(`${JSON.stringify(run.document, null, 2)}\n`);
    return;
  }
  if (run.document.result === null) {
    printCliError(logger, run.error);
    return;
  }
  const { formatReport } = await import(
    "../../domains/schema/repair-columns/run-report"
  );
  for (const line of formatReport(run.document)) {
    logger[line.level](line.text);
  }
}

/**
 * The action of `nextly repair-columns`, loaded when it runs, with the
 * context factory the program registered it with.
 */
export function repairColumnsAction(
  createContext: (options: GlobalOptions) => CommandContext
) {
  return async (options: { json?: boolean; apply?: boolean }, cmd: Command) => {
    const globals = cmd.optsWithGlobals<GlobalOptions>();
    const context = createContext(globals);
    const json = options.json === true;
    // Under `--json` standard output holds the document alone: the logger, which writes to it,
    // keeps to errors, which go to standard error.
    if (json)
      context.logger.setOptions({
        ...context.logger.getOptions(),
        quiet: true,
      });
    const run = await runRepairColumns(
      {
        config: globals.config,
        cwd: globals.cwd,
        verbose: globals.verbose,
        json,
        apply: options.apply === true,
      },
      context
    );
    await printRun(run, json, context.logger);
    // Set rather than exited with, so the output above finishes writing on a pipe.
    process.exitCode = run.document.exitCode;
  };
}
