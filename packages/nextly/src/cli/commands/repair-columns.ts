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
  CannotCarry,
  ColumnConversionPlan,
} from "../../domains/schema/repair-columns/conversion/types";
import { differenceClass } from "../../domains/schema/repair-columns/difference-class";
import type {
  ColumnFinding,
  ColumnLocation,
  ColumnState,
  DifferenceCause,
} from "../../domains/schema/repair-columns/types";
import type {
  ConversionJudgement,
  ConversionReason,
  ConversionReasonKind,
  RowKey,
} from "../../domains/schema/value-conversion/types";
import { databaseEnvError, exitWithError } from "../errors";
import type { CommandContext, GlobalOptions } from "../program";
import { createCliAdapter, validateDatabaseEnv } from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";
import { installRegistryResolver } from "../utils/registry-resolver";

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

/** What each reason means for the column's values, as the report says it. */
const REASON_TEXT: Record<ConversionReasonKind, string> = {
  "not-json": "values that do not parse as JSON would be cleared",
  "kept-unreadable":
    "values the new type would keep in a form the field cannot read would be cleared",
  "too-long": "values longer than the new type holds would be cut",
  "stored-differently":
    "values the database would accept and store as a different value",
  "null-under-not-null": "rows hold a null where the column is to be NOT NULL",
  "unreadable-reference-list": "values cannot be read as a list of references",
  "no-conversion": "Nextly has no conversion from this type to that one",
  "late-write":
    "MySQL checks the rows and changes the column in separate transactions, so a value written meanwhile could be changed with no error",
};

function describeKey(key: RowKey): string {
  return "id" in key
    ? `id ${key.id}`
    : `parent ${key.parent} locale ${key.locale}`;
}

/** One reason with the rows that give it, by key and never by value. */
function describeReason(reason: ConversionReason): string {
  const text = REASON_TEXT[reason.kind];
  if (reason.rows === undefined) return text;
  const { first, count } = reason.rows;
  const keys = first.map(describeKey).join(", ");
  const rows = count === 1 ? "1 row" : `${count} rows`;
  const shown = first.length < count ? `, first ${first.length}` : "";
  return `${text} (${rows}${shown}: ${keys})`;
}

/** One thing the new type cannot keep, with what the owner can change. */
function describeCannotCarry(problem: CannotCarry): string {
  return `cannot keep the ${problem.property} "${problem.name}": ${problem.reason}; ${problem.ownerCan}`;
}

/**
 * A difference's class and every reason behind it: what its rows give, then what its conversion
 * cannot keep, then the character set or collation the new type has no place for.
 */
function describeJudgement(
  judgement: ConversionJudgement | null,
  conversion: ColumnConversionPlan | null
): string {
  if (judgement === null) return "";
  const reasons = [
    ...judgement.reasons.map(describeReason),
    ...(conversion?.cannotCarry ?? []).map(describeCannotCarry),
  ];
  const notCarried = (conversion?.notCarried ?? [])
    .map(
      item =>
        `${item.property === "characterSet" ? "character set" : "collation"} ${item.value}`
    )
    .join(", ");
  const outcome = differenceClass(judgement, conversion);
  const classed =
    reasons.length === 0
      ? ` ${outcome}.`
      : ` ${outcome}: ${reasons.join("; ")}.`;
  const carried =
    notCarried === ""
      ? classed
      : `${classed} Not carried, since the new type has no place for it: ${notCarried}.`;
  return conversion === null
    ? carried
    : `${carried}${describeCost(conversion)}`;
}

/** What the database keeps others from doing while a conversion runs, as the report says it. */
const BLOCKS_TEXT: Record<ColumnConversionPlan["blocks"], string> = {
  "reads-and-writes": "reads and writes of the table wait until it ends",
  writes: "reads continue and writes wait until it ends",
  "brief-locks":
    "reads and writes continue, apart from brief locks as it starts and ends",
};

/** What converting the column costs while it runs. */
function describeCost(conversion: ColumnConversionPlan): string {
  const rewrite = conversion.rewritesTable
    ? "rewrites the table"
    : "changes the column without rewriting the table";
  return ` Converting it ${rewrite}; ${BLOCKS_TEXT[conversion.blocks]}.`;
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
      return `${at}: is ${describeState(finding.live)}, expected ${describeState(finding.expected)}${describeCause(finding.cause)}.${describeJudgement(finding.judgement, finding.conversion)}${owner}`;
  }
}

interface RepairColumnsOptions {
  config?: string;
  cwd?: string;
  verbose?: boolean;
}

/**
 * Compare and print. Returns the findings; anything that stops the run is thrown, unusable
 * database settings as the CLI error that names them, for the caller to end with.
 */
async function runRepairColumns(
  options: RepairColumnsOptions,
  context: CommandContext
): Promise<ColumnFinding[]> {
  const { logger } = context;
  const env = validateDatabaseEnv();
  if (!env.valid || env.dialect === undefined) throw databaseEnvError(env);
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

/**
 * The action of `nextly repair-columns`, loaded when it runs, with the
 * context factory the program registered it with.
 */
export function repairColumnsAction(
  createContext: (options: GlobalOptions) => CommandContext
) {
  return async (_options: Record<string, never>, cmd: Command) => {
    const globals = cmd.optsWithGlobals<GlobalOptions>();
    const context = createContext(globals);
    // Every way the run stops ends in the CLI's error shape, with the code that names it.
    await runRepairColumns(
      { config: globals.config, cwd: globals.cwd, verbose: globals.verbose },
      context
    ).catch((error: unknown) => exitWithError(context.logger, error));
  };
}
