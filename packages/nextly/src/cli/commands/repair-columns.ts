/**
 * `nextly repair-columns`: report every column whose type or nullability differs from its field's
 * descriptor, on every table Nextly builds from field definitions.
 *
 * Read-only. It compares the live database with each field as the database last had it applied,
 * and reports a table or column that is not there as not migrated, a change the configuration holds
 * and no migration has applied as pending (an entity no migration has applied yet included), and a
 * plugin's column with the plugin named. A record of what was applied that cannot be read stops the
 * run instead. It changes nothing: no table, row, registry entry or ledger row.
 *
 * The domain modules are imported when the command runs, not when the CLI loads, so listing the
 * CLI's commands does not pull in the schema services.
 */
import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import type {
  ColumnFinding,
  ColumnLocation,
  ColumnState,
  DifferenceCause,
} from "../../domains/schema/repair-columns/types";
import { describeError } from "../../errors/index";
import type { CommandContext, GlobalOptions } from "../program";
import { createCliAdapter, validateDatabaseEnv } from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";
import { installRegistryResolver } from "../utils/registry-resolver";

const REPAIR_COLUMNS_COMMAND = "repair-columns";

const ENTITY_LABEL: Record<ColumnLocation["kind"], string> = {
  collection: "collection",
  single: "Single",
  fieldGroup: "field group",
  userFields: "user fields",
};

/** A column's type and nullability as the report prints them. */
function describeState(state: ColumnState): string {
  const size =
    state.typeModifier !== undefined && !state.type.includes("(")
      ? `(${state.typeModifier})`
      : "";
  return `${state.type}${size} ${state.nullable ? "NULL" : "NOT NULL"}`;
}

function describeCause(cause: DifferenceCause | null): string {
  if (cause === null) return "";
  return cause.kind === "legacy"
    ? `; created before ${cause.before}`
    : "; created by the current version's generator";
}

/** The entity, field and column a finding is about, as each line opens. */
function describeLocation(location: ColumnLocation): string {
  const entity =
    location.kind === "userFields"
      ? ENTITY_LABEL.userFields
      : `${ENTITY_LABEL[location.kind]} "${location.slug}"`;
  const where = `${location.table}.${location.column}`;
  return `${entity}, field "${location.field}" (${where}${location.translation ? ", translation table" : ""})`;
}

/** One finding as one line of the text report. */
export function formatFinding(finding: ColumnFinding): string {
  const at = describeLocation(finding.location);
  const owner =
    finding.plugin !== undefined
      ? ` Owned by plugin "${finding.plugin}"; reported, never changed here.`
      : "";
  switch (finding.kind) {
    case "not-migrated":
      return `${at}: not migrated, the ${finding.missing} does not exist (expected ${describeState(finding.expected)}). Run \`nextly migrate\`.${owner}`;
    case "pending-migration": {
      const from =
        finding.applied === null
          ? "not applied"
          : describeState(finding.applied);
      const to =
        finding.configured === null
          ? "removed"
          : describeState(finding.configured);
      return `${at}: pending a migration, ${from} as applied, ${to} as configured. Run \`nextly migrate:create\`, then \`nextly migrate\`.${owner}`;
    }
    case "differs":
      return `${at}: is ${describeState(finding.live)}, expected ${describeState(finding.expected)}${describeCause(finding.cause)}.${owner}`;
  }
}

interface RepairColumnsOptions {
  config?: string;
  cwd?: string;
  verbose?: boolean;
}

/**
 * Compare and print. Returns the findings, or null when the database settings are unusable, which
 * it names; anything else that stops the run is thrown, and the caller exits 1 for either.
 */
async function runRepairColumns(
  options: RepairColumnsOptions,
  context: CommandContext
): Promise<ColumnFinding[] | null> {
  const { logger } = context;
  const env = validateDatabaseEnv();
  if (!env.valid || env.dialect === undefined) {
    for (const problem of env.errors) logger.error(problem);
    return null;
  }
  const dialect = env.dialect;
  const cwd = options.cwd ?? context.cwd;
  const { config, projectRoot, deferredExtends } = await loadConfig({
    configPath: options.config,
    cwd,
    debug: options.verbose,
  });

  const [{ readRepairEntities }, { findColumnDifferences }] = await Promise.all(
    [
      import("../../domains/schema/repair-columns/read-entities"),
      import("../../domains/schema/repair-columns/find-differences"),
    ]
  );

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
    const entities = await readRepairEntities({
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
    const findings = await findColumnDifferences({
      db: adapter.getDrizzle(),
      dialect,
      entities,
    });

    logger.info(
      "Each column Nextly builds from field definitions, compared with its field as last migrated. Nothing is changed."
    );
    logger.newline();
    if (findings.length === 0) {
      logger.success("Every column matches its field.");
    } else {
      for (const finding of findings) logger.warn(formatFinding(finding));
      logger.newline();
      logger.info(`${String(findings.length)} column finding(s).`);
    }
    return findings;
  } finally {
    await adapter.disconnect();
  }
}

export function registerRepairColumnsCommand(
  program: Command,
  createContext: (options: GlobalOptions) => CommandContext
): void {
  program
    .command(REPAIR_COLUMNS_COMMAND)
    .description(
      "Report every column whose type or nullability differs from its field (changes nothing)"
    )
    .action(async (_options: Record<string, never>, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const context = createContext(globals);
      const findings = await runRepairColumns(
        { config: globals.config, cwd: globals.cwd, verbose: globals.verbose },
        context
      ).catch((error: unknown) => {
        context.logger.error(describeError(error));
        process.exit(1);
      });
      // Settings it could not use were named above; the run could not compare anything.
      if (findings === null) process.exit(1);
    });
}
