/**
 * `nextly plugins install` and `nextly plugins uninstall`.
 *
 * Subcommands of the EXISTING `plugins` group rather than commands of their
 * own, because `plugins list` and `plugins info` already exist and a plugin's
 * lifecycle belongs beside its introspection.
 *
 * The decisions live in `uninstall-plan.ts`, which is tested without a
 * database. This file is the part that talks to one: decide, take the lock,
 * run the plan, record the outcome.
 *
 * ## Why the plugin must still be in config to be uninstalled
 *
 * Its DOWN statements are its own code. A plugin deleted from config first
 * cannot be uninstalled at all — there is nothing left to ask how to undo its
 * schema — which is why the boot check refuses an `uninstalled` owner that is
 * still listed rather than telling the operator to delete the line.
 *
 * @module cli/commands/plugin-lifecycle
 */

import {
  countDeletions,
  judgeDataLoss,
  NO_CONSENT,
  type DataLossConsent,
  type Deletion,
} from "../../domains/schema/migrate/data-loss-consent";
import { tablesLeftInPlace } from "../../domains/schema/ownership/drop-guard";
import { assertDependenciesInstalled } from "../../domains/schema/ownership/install-plan";
import {
  createOwnerRegistry,
  type OwnerRecord,
} from "../../domains/schema/ownership/owner-registry";
import type { PluginLifecycleRecord } from "../../domains/schema/ownership/plugin-lifecycle-state";
import { SchemaOwnersRepository } from "../../domains/schema/ownership/schema-owners-repository";
import {
  planUninstall,
  type UninstallInput,
  type UninstallPlan,
} from "../../domains/schema/ownership/uninstall-plan";
import { NextlyError } from "../../errors/nextly-error";
import type { CommandContext } from "../program";
import type { CLIDatabaseAdapter } from "../utils/adapter";

/** What both commands need about the configured plugins. */
export interface LifecyclePlugin {
  name: string;
  version: string;
  enabled: boolean;
  /** `dependsOn` and `optionalDependsOn` together — what uninstall refuses on. */
  dependsOn: string[];
  /**
   * The two kinds kept apart, for install: a required dependency must be
   * configured and installed, an optional one only installed when configured.
   */
  requires: string[];
  optionallyRequires: string[];
  /**
   * Every module the plugin DECLARES, in apply order — applied or not. Install
   * reads a dependency's to tell whether its install has happened.
   */
  declaredModules: string[];
  /**
   * The modules this database has APPLIED, in apply order, and whether each
   * can be undone. Uninstall runs DOWN for these and nothing else.
   */
  modules: { name: string; reversible: boolean }[];
  /**
   * Modules the ledger records as applied that the configured definition no
   * longer ships, renamed or removed in a later version. Their DOWN cannot be
   * read, so a full uninstall refuses while any remain.
   */
  unshippedModules: string[];
}

/**
 * One module's DOWN as it will run: verified against its checksums and
 * judged by the drop guard before any module of the uninstall runs, and then
 * executed exactly as judged.
 */
export interface PreparedModuleDown {
  moduleName: string;
  /** The module's ledger key, `plugin:<name>/<module>`. */
  filename: string;
  statements: string[];
  /** False when the module is marked `transaction: false`. */
  transaction: boolean;
  /**
   * Whether it drops a table or column, or truncates a table, judged the way
   * `migrate:down` judges one (`isDestructiveDown`). A module that drops only
   * a column it added to another table loses data no table count shows.
   */
  destructive: boolean;
}

export interface PluginLifecycleDeps {
  adapter: CLIDatabaseAdapter;
  db: unknown;
  dialect: "postgresql" | "mysql" | "sqlite";
  plugins: LifecyclePlugin[];
  logger: CommandContext["logger"];
  /**
   * Runs the plugin's own `onInstall` / `onUninstall` against a booted context.
   *
   * REQUIRED, like the two below and for the same reason: while it was
   * optional the one caller never passed it, so both commands reported the
   * hook's work done and no hook ran. A plugin whose `onInstall` seeds a row
   * or registers with an external service was installed without either.
   */
  runLifecycleHook: (
    plugin: LifecyclePlugin,
    hook: "onInstall" | "onUninstall",
    opts: { keepData: boolean },
    /**
     * Run once the boot that builds the hook's context is done, right before
     * the hook itself; not run when the plugin declares no such hook, since
     * nothing then boots. Kept out of `opts`, which the hook is handed.
     */
    beforeHook?: () => Promise<void>
  ) => Promise<void>;
  /**
   * Every named module's DOWN, in the order given, each verified against
   * the checksum it was sealed and applied with and judged by the drop
   * guard. Throws on the first module that fails either, so an uninstall
   * that would be refused part way is refused before anything runs.
   */
  prepareDowns: (
    plugin: LifecyclePlugin,
    moduleNames: readonly string[]
  ) => Promise<PreparedModuleDown[]>;
  /**
   * Executes one prepared module's DOWN statements and records the module
   * rolled back.
   *
   * REQUIRED for the same reason: optional, it was never passed, so a
   * confirmed uninstall logged every module as reverted and recorded the
   * plugin uninstalled while its tables and their data stayed exactly where
   * they were.
   */
  runDown: (
    plugin: LifecyclePlugin,
    down: PreparedModuleDown
  ) => Promise<number>;
  /**
   * Runs `work` holding the migrate lock, after re-reading `plugins` from
   * the ledger, and releases the lock however `work` ends. Throws when the
   * lock cannot be had, without running `work`.
   */
  underMigrateLock: <T>(work: () => Promise<T>) => Promise<T>;
  /**
   * Applies the plugin's pending migration modules.
   *
   * REQUIRED, like the two above. Install previously recorded a plugin as
   * installed and reported success without applying anything, so an operator
   * was told the tables were there and every later query disagreed. An
   * optional callback is what allowed that: the one caller simply did not
   * pass it, and nothing said so.
   */
  applyMigrations: (plugin: LifecyclePlugin) => Promise<void>;
  /**
   * Ledger filenames whose newest `file_apply` event is `applied` — the same
   * reading `modules` is built from. Install checks its dependencies against
   * it before anything runs.
   */
  readAppliedModules: () => Promise<ReadonlySet<string>>;
  /** Which of the named tables exist in the database now. */
  liveTables: (tables: readonly string[]) => Promise<ReadonlySet<string>>;
  /**
   * Each named table that exists now, with a token the database keeps for
   * that table through a rename and gives no table that replaces it
   * (`readTableIdentities`); null where it reports none. An uninstall reads
   * it either side of `onUninstall`, so a hook that put another table under
   * a name is told apart from one that left the table alone.
   */
  tableIdentities: (
    tables: readonly string[]
  ) => Promise<ReadonlyMap<string, string | null>>;
  /**
   * SQLite's schema version (`readSqliteSchemaVersion`), which every change
   * to the schema moves; null where it cannot be read. Read either side of
   * `onUninstall` on SQLite, whose identity, a root page, can be given to
   * another table: a hook that renames a table away, runs `VACUUM` and
   * creates another can leave every name and root page as they were, and
   * only this shows the schema changed.
   */
  schemaVersion: () => Promise<number | null>;
  /**
   * Every plugin's recorded lifecycle state (`readPluginLifecycle`): what
   * install reads its dependencies' installs from, and an uninstall run
   * again reads how it was begun from.
   */
  readLifecycle: () => Promise<ReadonlyMap<string, PluginLifecycleRecord>>;
  /** Records a plugin's new lifecycle state (`recordPluginLifecycle`). */
  recordLifecycle: (
    plugin: LifecyclePlugin,
    record: PluginLifecycleRecord
  ) => Promise<void>;
  /**
   * Whether a person is at a terminal to be asked before data is deleted.
   * Absent reads as no: a full uninstall without consent is then refused
   * rather than run, which is the safe reading of a caller that said nothing.
   */
  interactive?: boolean;
  /** Asks that person a yes-or-no question; only called when `interactive`. */
  askToDelete?: (question: string) => Promise<boolean>;
}

/** How an uninstall was asked for: whether it keeps the data, and the consent to lose it. */
export interface UninstallOptions {
  keepData: boolean;
  /**
   * Given on the command line. It answers no question here: deleting data
   * takes `consent`, and the refusal says so when `--yes` was passed.
   */
  yes: boolean;
  /** The data-loss consent; none when absent. */
  consent?: DataLossConsent;
}

function find(plugins: LifecyclePlugin[], name: string): LifecyclePlugin {
  const plugin = plugins.find(p => p.name === name);
  if (plugin) return plugin;
  // Named rather than "not found": an operator who mistyped needs to see what
  // IS configured, and one whose plugin is genuinely absent needs to know the
  // config is what was consulted.
  throw NextlyError.notFound({
    message: `No plugin named "${name}" is configured. Configured: ${
      plugins.map(p => p.name).join(", ") || "(none)"
    }`,
    logContext: { plugin: name },
  });
}

/**
 * Install: apply the plugin's pending migrations, then run `onInstall`.
 *
 * A second install re-runs `onInstall` alone, which is why that hook is
 * documented as idempotent — an operator repairing a half-finished install
 * should not have to reason about whether it is safe to repeat.
 *
 * The whole state change runs under one migrate lock, as an uninstall does:
 * the modules, the owner rows going back to `active`, and `onInstall`. With
 * the lock released between them, an uninstall could roll the new modules
 * back and mark the plugin uninstalled, and the install would then mark it
 * active again and report tables that were gone.
 */
export async function runPluginInstallCommand(
  name: string,
  deps: PluginLifecycleDeps
): Promise<void> {
  const plugin = find(deps.plugins, name);
  deps.logger.info(`Installing ${plugin.name}@${plugin.version}...`);

  // Refused before the lock, so an install that cannot proceed makes no
  // other migration wait, and decided again under it, where it holds.
  await assertInstallable(plugin, deps);
  const owned = await deps.underMigrateLock(async () => {
    await assertInstallable(plugin, deps);

    // BEFORE the hook, because `onInstall` is documented as running against
    // the plugin's own tables: a hook that seeds a row cannot do it into a
    // table no migration has created yet. The phase reports its own
    // applied/adopted counts — this command does not restate them, because a
    // second count is a second thing that can be wrong.
    await deps.applyMigrations(plugin);

    // The owner rows go back to `active` BEFORE the hook, not after.
    //
    // A REINSTALL is what makes the order load-bearing. After a full
    // uninstall the rows survive marked `uninstalled`, and the boot check
    // refuses an `uninstalled` owner that is still listed in config —
    // deliberately, since that state means "its tables were dropped".
    // `runLifecycleHook` boots the runtime to build the plugin's context, so
    // with the reset after the hook, a reinstall of a plugin declaring
    // `onInstall` could never complete: boot rejected the plugin the install
    // was in the middle of restoring.
    const registry = createOwnerRegistry(
      new SchemaOwnersRepository(deps.db, deps.dialect)
    );
    const rows = await registry.listByOwner(plugin.name);
    if (rows.length > 0) {
      await registry.setState(plugin.name, "active");
    }

    await deps.runLifecycleHook(plugin, "onInstall", { keepData: false });
    // Last, once `onInstall` has returned: the record is what the boot and a
    // dependent's install read as "installed", and an install that failed
    // before here has not set up what they rely on.
    await deps.recordLifecycle(plugin, { state: "installed" });
    return rows;
  });

  // Tables, not owner rows: a plugin's element rows (a column or index on
  // another owner's table) and its tables' own element rows are rows too.
  const tables = new Set(
    owned
      .filter(row => (row.elementKind ?? "table") === "table")
      .map(row => row.tableName)
  );
  deps.logger.success(
    `${plugin.name} installed (${String(tables.size)} table(s) recorded).`
  );
}

/**
 * Every dependency installed, or nothing runs.
 *
 * Applying this plugin's modules, activating its owner rows and running its
 * `onInstall` all assume what its dependencies' installs provide — their
 * tables AND whatever their own `onInstall` set up. Nothing downstream
 * checks that: this plugin's SQL fails only if it happens to reference a
 * dependency table, and otherwise the install succeeds without its
 * prerequisite. So it is refused up front, naming each missing dependency and
 * the command that installs it — the mirror of uninstall refusing while an
 * enabled dependent remains.
 */
/**
 * Install every configured plugin: what a deployment runs once its database
 * is migrated, and what a fresh database needs before a production boot,
 * which refuses a configured plugin no install has recorded.
 *
 * In `deps.plugins` order, which the config loader has already put in
 * dependency order, so each install finds the plugins it depends on
 * installed; that order is the loader's to decide, not this command's.
 * Stops at the first install that fails, since a later one may depend on it.
 *
 * A disabled plugin is skipped and named: its install is refused anyway,
 * because its hooks do not run, and refusing the whole run over it would
 * leave every enabled plugin after it uninstalled.
 */
export async function runPluginInstallAllCommand(
  deps: PluginLifecycleDeps
): Promise<void> {
  if (deps.plugins.length === 0) {
    deps.logger.info("No plugins are configured.");
    return;
  }
  for (const plugin of deps.plugins) {
    if (!plugin.enabled) {
      deps.logger.warn(
        `Skipping ${plugin.name}: it is disabled in config. Enable it to install it.`
      );
      continue;
    }
    await runPluginInstallCommand(plugin.name, deps);
  }
}

/**
 * A disabled plugin's hooks do not run, so an install or an uninstall of it
 * could record a state its hook never produced. Refused before any change.
 */
function assertEnabled(plugin: LifecyclePlugin): void {
  if (plugin.enabled) return;
  throw new NextlyError({
    code: "PLUGIN_DISABLED",
    publicMessage:
      `The plugin "${plugin.name}" is disabled in config. Enable it in ` +
      "the config to install or uninstall it.",
  });
}

async function assertInstallable(
  plugin: LifecyclePlugin,
  deps: PluginLifecycleDeps
): Promise<void> {
  assertEnabled(plugin);
  assertDependenciesInstalled({
    pluginName: plugin.name,
    configured: deps.plugins,
    appliedFilenames: await deps.readAppliedModules(),
    lifecycle: await deps.readLifecycle(),
  });
}

/** What an uninstall that passed every refusal will do. */
interface UninstallDecision {
  plugin: LifecyclePlugin;
  plan: UninstallPlan;
  /** The modules' DOWNs, newest first, each already verified and judged. */
  downs: PreparedModuleDown[];
  /** What it deletes, as consented to or agreed to at the terminal. */
  deletions: Deletion[];
}

/**
 * Uninstall: decide, then execute under the migrate lock.
 *
 * Every refusal is decided before the lock is taken and before anything
 * runs, and is thrown rather than exited on: an exit inside the locked work
 * skips the lock's release, and on PostgreSQL the lock is a row that then
 * blocks every migration until it expires.
 *
 * The decision is made again once the lock is held, against the plan
 * re-read from the ledger there, because the one made before it can be stale
 * by then — and it is that second decision that runs. A refusal from it
 * still leaves the database as it found it: it is thrown before the hook and
 * before any DOWN.
 */
export async function runPluginUninstallCommand(
  name: string,
  opts: UninstallOptions,
  deps: PluginLifecycleDeps
): Promise<void> {
  const first = await decideUninstall(name, opts, deps);
  await deps.underMigrateLock(async () => {
    // Asked once, before the lock: the second decision accepts what the
    // operator already agreed to and refuses anything new, rather than
    // asking again while every other migration waits on the lock.
    const decision = await decideUninstall(name, opts, deps, first.deletions);
    await executeUninstall(decision, opts, deps);
  });
}

/**
 * Every refusal an uninstall can meet, in the order an operator should see
 * them. Reads the database; changes nothing.
 */
async function decideUninstall(
  name: string,
  opts: UninstallOptions,
  deps: PluginLifecycleDeps,
  agreed?: readonly Deletion[]
): Promise<UninstallDecision> {
  const plugin = find(deps.plugins, name);
  assertEnabled(plugin);
  assertResumedTheSameWay(
    plugin,
    (await deps.readLifecycle()).get(plugin.name),
    opts.keepData
  );
  const repository = new SchemaOwnersRepository(deps.db, deps.dialect);
  const registry = createOwnerRegistry(repository);
  const recordedRows = await registry.listByOwner(plugin.name);
  // Planned over the tables that exist. An owner row outlives its table when
  // `migrate:down --plugin` rolled the module back — the row stays as
  // ownership history — and planning over it read every such database as
  // one whose tables a development push made, refusing the uninstall for
  // good.
  const live = await deps.liveTables([
    ...new Set(recordedRows.map(row => row.tableName)),
  ]);
  const owned = recordedRows.filter(row => live.has(row.tableName));
  // Element rows on this plugin's tables that somebody else owns — they go
  // with the table on a full uninstall, and the confirmation names them.
  // Read from the tables the plugin OWNS: an element it added to another
  // owner's table puts that table in `owned` too, and its other
  // contributors' elements there are not dropped with anything.
  const ownTables = owned
    .filter(row => (row.elementKind ?? "table") === "table")
    .map(row => row.tableName);
  const foreignElements = (
    await repository.read([...new Set(ownTables)])
  ).filter(
    row =>
      (row.elementKind ?? "table") !== "table" && row.ownerId !== plugin.name
  );

  const input: UninstallInput = {
    pluginName: plugin.name,
    enabled: deps.plugins
      .filter(p => p.enabled)
      .map(p => ({ name: p.name, dependsOn: p.dependsOn })),
    disabled: deps.plugins
      .filter(p => !p.enabled)
      .map(p => ({ name: p.name, requires: p.requires })),
    owned,
    foreignElements,
    modules: plugin.modules,
    unshipped: plugin.unshippedModules,
    keepData: opts.keepData,
  };

  // Throws on a dependent or an irreversible module.
  const plan = planUninstall(input);
  assertTablesCanBeUndone(plugin, plan, deps);

  // Before the confirmation: a DOWN that would be refused is refused whether
  // or not the operator confirms, and asking them to confirm it first only
  // costs them a run.
  const downs =
    plan.downModules.length > 0
      ? await deps.prepareDowns(plugin, plan.downModules)
      : [];

  assertDownsDropTables(plugin, plan, downs, deps.dialect);
  const deletions = await consentToDeletions(
    plugin,
    uninstallDeletions(plugin, plan, owned, downs),
    plan,
    opts,
    deps,
    agreed
  );

  return { plugin, plan, downs, deletions };
}

/**
 * An uninstall that began and did not finish is finished by running it again
 * the way it was begun, and refused the other way.
 *
 * Run again, an uninstall plans over what is left: the modules still applied
 * and the tables still there, so it carries on from where it stopped. Not
 * with the other `--keep-data` setting, though. A full uninstall that has
 * dropped some tables cannot then keep its data, and one that kept data has
 * run `onUninstall` for an uninstall that leaves the tables.
 */
function assertResumedTheSameWay(
  plugin: LifecyclePlugin,
  record: PluginLifecycleRecord | undefined,
  keepData: boolean
): void {
  if (record?.state !== "uninstalling" || record.keepData === keepData) return;
  const begun = record.keepData ? "with --keep-data" : "without --keep-data";
  throw new NextlyError({
    code: "PLUGIN_UNINSTALL_UNFINISHED",
    publicMessage: `The uninstall of ${plugin.name} began ${begun} and did not finish. Run it again ${begun} to finish it. Nothing was changed.`,
    logContext: { plugin: plugin.name, keepData: record.keepData },
  });
}

/**
 * Tables to drop, and nothing that would drop them.
 *
 * Development push creates a plugin's tables from the compiled model and
 * records their ownership, without any migration module being applied — so
 * the owner rows name tables to drop while the module list, which is built
 * from the ledger's applied rows, is empty. Running no DOWN statements and
 * marking the plugin `uninstalled` would leave the tables and their data
 * exactly where they were.
 *
 * Refused rather than improvised: the honest answer is that this database
 * has no recorded statement that undoes those tables, and inventing DROPs
 * here would be a destructive path nothing generated and nothing reviewed.
 */
function assertTablesCanBeUndone(
  plugin: LifecyclePlugin,
  plan: UninstallPlan,
  deps: Pick<PluginLifecycleDeps, "logger">
): void {
  if (plan.tablesDropped.length === 0 || plan.downModules.length > 0) return;
  for (const table of plan.tablesDropped) deps.logger.warn(`  - ${table}`);
  throw new NextlyError({
    code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
    publicMessage:
      `${plugin.name} owns ${String(plan.tablesDropped.length)} table(s), listed above, but this database has no applied migration module to undo them — ` +
      `they were created by a development push rather than by a migration. ` +
      `Nothing was changed. Drop them with a migration, or remove the plugin from config and reset the development database.`,
    logContext: {
      plugin: plugin.name,
      reason: "no-applied-module",
      tables: plan.tablesDropped,
    },
  });
}

/**
 * What a full uninstall deletes: each table it drops, and each column the
 * plugin added to a table it does not drop. Its DOWNs can delete nothing
 * else, since the drop guard refuses one that drops what another owner
 * holds. A DOWN that is judged to lose data while the owner rows account for
 * none of it is listed by its module, as a deletion only the consent without
 * targets covers.
 */
function uninstallDeletions(
  plugin: LifecyclePlugin,
  plan: UninstallPlan,
  owned: readonly OwnerRecord[],
  downs: readonly PreparedModuleDown[]
): Deletion[] {
  const dropped = new Set(plan.tablesDropped);
  const named: Deletion[] = [
    ...plan.tablesDropped.map(table => ({ kind: "table" as const, table })),
    ...owned
      .filter(
        row =>
          row.elementKind === "column" &&
          row.ownerId === plugin.name &&
          !dropped.has(row.tableName)
      )
      .map(row => ({
        kind: "column" as const,
        table: row.tableName,
        column: row.elementName ?? "",
      })),
  ];
  if (named.length > 0) return named;
  return downs
    .filter(down => down.destructive)
    .map(down => ({
      kind: "unnamed" as const,
      description: `${down.filename}'s DOWN, which drops a table or column`,
    }));
}

/**
 * The deletions an uninstall may make, or a refusal before anything runs:
 * covered by the data-loss consent, or agreed to at a terminal. `agreed`,
 * from the decision made before the lock, is accepted without asking again;
 * anything beyond it is refused there rather than asked about under the lock.
 */
async function consentToDeletions(
  plugin: LifecyclePlugin,
  planned: Deletion[],
  plan: UninstallPlan,
  opts: UninstallOptions,
  deps: Pick<
    PluginLifecycleDeps,
    "logger" | "db" | "dialect" | "interactive" | "askToDelete"
  >,
  agreed: readonly Deletion[] | undefined
): Promise<Deletion[]> {
  if (planned.length === 0) return [];
  const first = agreed === undefined;
  const deletions = first
    ? await countDeletions(planned, deps.db, deps.dialect)
    : planned;
  if (first) {
    warnList(
      deps,
      `Dropping its tables also drops ${String(plan.elementsDropped.length)} element(s) other owners added to them:`,
      plan.elementsDropped
    );
  }
  const verdict = await judgeDataLoss({
    deletions,
    consent: opts.consent ?? NO_CONSENT,
    interactive: first && deps.interactive === true,
    ask: question => deps.askToDelete?.(question) ?? Promise.resolve(false),
    print: first ? line => deps.logger.warn(line) : () => {},
    approved: agreed,
  });
  if (verdict.kind === "proceed") return deletions;
  const keepData = " Or use --keep-data to leave the tables in place.";
  const yes = opts.yes
    ? " --yes does not consent to deleting data; the data-loss consent does."
    : "";
  throw new NextlyError({
    code: "PLUGIN_UNINSTALL_UNCONFIRMED",
    publicMessage:
      verdict.kind === "declined"
        ? `Nothing was changed: the deletion was not confirmed.${keepData}`
        : `${verdict.message}${yes}${keepData}`,
    logContext: {
      plugin: plugin.name,
      tables: plan.tablesDropped,
      verdict: verdict.kind,
    },
  });
}

/** A heading and one line per item, or nothing when there are none. */
function warnList(
  deps: Pick<PluginLifecycleDeps, "logger">,
  heading: string,
  items: readonly string[]
): void {
  if (items.length === 0) return;
  deps.logger.warn(heading);
  for (const item of items) deps.logger.warn(`  - ${item}`);
}

/** Runs a decided uninstall: the hook, the DOWNs, the owner state. */
async function executeUninstall(
  { plugin, plan, downs }: UninstallDecision,
  opts: { keepData: boolean },
  deps: PluginLifecycleDeps
): Promise<void> {
  const registry = createOwnerRegistry(
    new SchemaOwnersRepository(deps.db, deps.dialect)
  );

  // The tables the DOWNs were judged against, as they stand before the hook:
  // what `assertHookLeftTables` compares them with once it has run. Read,
  // and refused when unreadable, before the first change, so a database that
  // cannot answer changes nothing.
  const judged = await readTablesAsTheyStand(plan, deps);
  assertIdentitiesReadable(plugin, plan, judged);

  // Before the first change, the hook included: an uninstall that stops part
  // way leaves this as the plugin's state, which the boot refuses and a run
  // of the command again finishes.
  await deps.recordLifecycle(plugin, {
    state: "uninstalling",
    keepData: opts.keepData,
  });

  // The tables keep the identities read before anything ran: the boot runs
  // every enabled plugin's init(), and one could put another table in place
  // of this plugin's, which a baseline taken after the boot would accept.
  // Only SQLite's schema version is read again once the boot is done, right
  // before the hook: the boot syncs code-first schema and can change it,
  // which read from before it would be laid at the hook's door. A plugin
  // without the hook boots nothing, and the first read stands.
  let beforeHook = judged;
  await deps.runLifecycleHook(
    plugin,
    "onUninstall",
    { keepData: opts.keepData },
    async () => {
      if (judged?.schemaVersion === undefined) return;
      const schemaVersion = await deps.schemaVersion();
      // Unreadable here, the comparison after the hook could only refuse:
      // refused now, before the hook can change rows or anything outside.
      if (schemaVersion === null)
        throw schemaVersionUnreadableAfterBoot(plugin);
      beforeHook = { ...judged, schemaVersion };
    }
  );
  await assertHookLeftTables(plugin, plan, beforeHook, deps);

  // `runDown` names a module whose DOWN runs outside a transaction before
  // it runs, as `migrate:down` does, through the same executor.
  for (const down of downs) {
    const executed = await deps.runDown(plugin, down);
    deps.logger.info(
      `Reverted ${down.moduleName} (${String(executed)} statement(s))`
    );
  }
  await assertTablesDropped(plugin, plan, deps);

  await registry.setState(plugin.name, plan.finalState);
  await deps.recordLifecycle(plugin, { state: plan.finalState });

  deps.logger.success(
    plan.finalState === "orphaned"
      ? `${plugin.name} uninstalled; its tables were kept and are now orphaned.`
      : `${plugin.name} uninstalled and its tables dropped.`
  );
  deps.logger.info(
    `Remove "${plugin.name}" from your config to finish. Until you do, boot will refuse to start.`
  );
}

/**
 * Refuse, before anything runs, a full uninstall whose DOWNs leave one of the
 * plugin's tables in place: a DOWN that drops one of the two tables its UP
 * created runs without error. Read from the statements, in the order they
 * run, following each table through renames (`tablesLeftInPlace`): a table a
 * rebuild drops and puts back, or one renamed away and kept, counts as left.
 *
 * Before, not only after: once a DOWN has run, its module is recorded rolled
 * back, and a refusal then leaves a ledger that no longer says what the
 * plugin's schema is.
 */
function assertDownsDropTables(
  plugin: LifecyclePlugin,
  plan: UninstallPlan,
  downs: readonly PreparedModuleDown[],
  dialect: PluginLifecycleDeps["dialect"]
): void {
  if (plan.finalState !== "uninstalled") return;
  const statements = downs.flatMap(down => down.statements);
  // The statements are read lower-cased. On SQLite, whose names ignore
  // case, that is how the database reads them. PostgreSQL keeps a quoted
  // name's case, and MySQL can, so there a table whose stored name is not
  // lower-case may not be the one a lower-cased drop reaches: it counts as
  // left. So do two owned tables whose names differ only in case, which the
  // statements cannot tell apart.
  const caseKept =
    dialect === "sqlite"
      ? []
      : plan.tablesDropped.filter(table => table !== table.toLowerCase());
  const byLowered = new Map<string, string[]>();
  for (const table of plan.tablesDropped) {
    if (caseKept.includes(table)) continue;
    const key = table.toLowerCase();
    byLowered.set(key, [...(byLowered.get(key) ?? []), table]);
  }
  const ambiguous = [...byLowered.values()].filter(names => names.length > 1);
  const readable = [...byLowered.entries()].filter(
    ([, names]) => names.length === 1
  );
  const leftReadable = new Set(
    tablesLeftInPlace(
      statements,
      dialect,
      readable.map(([key]) => key)
    )
  );
  const left = [
    ...caseKept,
    ...ambiguous.flat(),
    ...readable
      .filter(([key]) => leftReadable.has(key))
      .flatMap(([, names]) => names),
  ];
  if (left.length === 0) return;
  throw new NextlyError({
    code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
    publicMessage: `${plugin.name}'s DOWN migrations do not drop ${left.join(", ")}, which it owns. Nothing was changed. Fix the plugin's DOWN, or use --keep-data to leave its tables in place.`,
    logContext: {
      plugin: plugin.name,
      reason: "down-leaves-tables",
      tables: left,
    },
  });
}

/**
 * Refuse to run the DOWNs of a full uninstall once `onUninstall` has dropped,
 * renamed or replaced a table they were judged to drop.
 *
 * The DOWNs were judged against the tables as they stood before the hook
 * (`assertDownsDropTables`). A hook can change them, through the raw SQL its
 * context may be granted: a table it renamed away keeps its rows under a name
 * the DOWNs do not drop, and the check after them reads only the old name.
 * Judged by each table's identity, not its name (`tableIdentities`): a hook
 * that renames a table away and creates another under its name leaves the
 * name in place, and the approved drop would take the replacement while the
 * original and its rows survive under the other name. An identity either
 * reading lacks counts as changed. Refused before the first DOWN, so every
 * module is still recorded applied.
 */
async function assertHookLeftTables(
  plugin: LifecyclePlugin,
  plan: UninstallPlan,
  judged: TablesAsTheyStand | undefined,
  deps: Pick<
    PluginLifecycleDeps,
    "tableIdentities" | "schemaVersion" | "dialect"
  >
): Promise<void> {
  if (judged === undefined) return;
  const now = await readTablesAsTheyStand(plan, deps);
  assertIdentitiesKept(plugin, plan, judged, now);
  assertSchemaVersionKept(plugin, plan, judged, now);
}

/**
 * SQLite's schema version could not be read once the hook's boot was done.
 * The plugin is recorded uninstalling by then and its hook has not run, so
 * running the uninstall again picks it up from there.
 */
function schemaVersionUnreadableAfterBoot(
  plugin: LifecyclePlugin
): NextlyError {
  return new NextlyError({
    code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
    publicMessage: `The database's schema version could not be read before ${plugin.name}'s onUninstall, so the hook and its DOWN migrations were not run. Run the uninstall again.`,
    logContext: {
      plugin: plugin.name,
      reason: "table-identity-unreadable",
      tables: ["the schema version"],
    },
  });
}

/** Each table the DOWNs drop is the one read before anything ran. */
function assertIdentitiesKept(
  plugin: LifecyclePlugin,
  plan: UninstallPlan,
  judged: TablesAsTheyStand,
  now: TablesAsTheyStand | undefined
): void {
  const changed = plan.tablesDropped.filter(table => {
    const before = judged.identities.get(table) ?? null;
    return before === null || now?.identities.get(table) !== before;
  });
  if (changed.length === 0) return;
  const one = changed.length === 1;
  throw new NextlyError({
    code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
    publicMessage: `${changed.join(", ")} ${one ? "was" : "were"} dropped, renamed or replaced while ${plugin.name}'s onUninstall ran (its boot included), so none of its DOWN migrations, which were to drop ${one ? "it" : "them"}, was run. Put the original ${one ? "table" : "tables"} back under ${one ? "its name" : "their names"}, in place of any table created there, then run the uninstall again.`,
    logContext: {
      plugin: plugin.name,
      reason: "tables-changed-by-hook",
      tables: changed,
    },
  });
}

/**
 * On SQLite, the schema is as the hook found it. An identity there can be
 * given to the replacement (a root page the original moved off in a VACUUM),
 * and the original can be renamed into a name another table held, so no
 * reading of names and root pages shows a replacement; any change to the
 * schema during the hook is refused instead. A version either reading lacks
 * counts as changed.
 */
function assertSchemaVersionKept(
  plugin: LifecyclePlugin,
  plan: UninstallPlan,
  judged: TablesAsTheyStand,
  now: TablesAsTheyStand | undefined
): void {
  const before = judged.schemaVersion;
  if (before === undefined) return;
  if (before !== null && now?.schemaVersion === before) return;
  throw new NextlyError({
    code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
    publicMessage: `${plugin.name}'s onUninstall changed the database schema. On SQLite a table it renamed away or replaced cannot be told from the one its DOWN migrations were judged against, so none of them was run, as they could drop a replacement of ${plan.tablesDropped.join(", ")}. Undo the schema changes the hook made, and have it change rows only, then run the uninstall again.`,
    logContext: {
      plugin: plugin.name,
      reason: "schema-changed-by-hook",
      tables: plan.tablesDropped,
    },
  });
}

/**
 * The tables a full uninstall drops, as they stand: each one's identity, and
 * on SQLite the schema version (`schemaVersion`), undefined elsewhere.
 * Undefined for an uninstall that keeps its tables, which drops nothing a
 * hook could put another table in place of.
 */
interface TablesAsTheyStand {
  identities: ReadonlyMap<string, string | null>;
  schemaVersion: number | null | undefined;
}

async function readTablesAsTheyStand(
  plan: UninstallPlan,
  deps: Pick<
    PluginLifecycleDeps,
    "tableIdentities" | "schemaVersion" | "dialect"
  >
): Promise<TablesAsTheyStand | undefined> {
  if (plan.finalState !== "uninstalled") return undefined;
  return {
    identities: await deps.tableIdentities(plan.tablesDropped),
    schemaVersion:
      deps.dialect === "sqlite" ? await deps.schemaVersion() : undefined,
  };
}

/**
 * Refuse, before the hook and before the plugin is recorded uninstalling, a
 * full uninstall one of whose tables the database reports no identity for:
 * nothing could then show it was the table the DOWNs were judged against
 * once the hook has run, so the uninstall could not succeed. Refused later,
 * the hook had run and the state was recorded, and every run again would
 * do both and fail the same way.
 */
function assertIdentitiesReadable(
  plugin: LifecyclePlugin,
  plan: UninstallPlan,
  judged: TablesAsTheyStand | undefined
): void {
  if (judged === undefined) return;
  const unreadable = [
    ...plan.tablesDropped.filter(
      table => (judged.identities.get(table) ?? null) === null
    ),
    // On SQLite the schema version is half of what is compared.
    ...(judged.schemaVersion === null ? ["the schema version"] : []),
  ];
  if (unreadable.length === 0) return;
  throw new NextlyError({
    code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
    publicMessage: `The database reports no identity for ${unreadable.join(", ")}, so whether ${plugin.name}'s onUninstall leaves ${unreadable.length === 1 ? "it" : "them"} in place could not be checked. Nothing was changed. Use --keep-data to leave its tables in place.`,
    logContext: {
      plugin: plugin.name,
      reason: "table-identity-unreadable",
      tables: unreadable,
    },
  });
}

/**
 * Refuse to record a full uninstall while a table it was to drop still
 * exists. The statements were judged before they ran (`assertDownsDropTables`),
 * so this is the backstop for a DOWN that did something its text does not
 * say. Its modules are recorded rolled back by then: dropping the table and
 * running the uninstall again records the plugin uninstalled.
 */
async function assertTablesDropped(
  plugin: LifecyclePlugin,
  plan: UninstallPlan,
  deps: Pick<PluginLifecycleDeps, "liveTables">
): Promise<void> {
  if (plan.finalState !== "uninstalled") return;
  const left = [...(await deps.liveTables(plan.tablesDropped))];
  if (left.length === 0) return;
  throw new NextlyError({
    code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
    publicMessage: `${plugin.name}'s DOWN migrations ran but left ${left.join(", ")} in place, so it was not recorded as uninstalled. Drop ${left.length === 1 ? "that table" : "those tables"}, then run the uninstall again to record it.`,
    logContext: {
      plugin: plugin.name,
      reason: "tables-left-by-down",
      tables: left,
    },
  });
}
