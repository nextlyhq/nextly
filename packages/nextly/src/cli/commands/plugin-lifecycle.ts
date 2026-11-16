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
  consentToCover,
  countDeletions,
  deletionKey,
  judgeDataLoss,
  NO_CONSENT,
  resolveDataLossConsent,
  type DataLossConsent,
  type Deletion,
} from "../../domains/schema/migrate/data-loss-consent";
import { qualifiedFilename } from "../../domains/schema/migrate/plugin/plugin-migration";
import { tablesLeftInPlace } from "../../domains/schema/ownership/drop-guard";
import { assertDependenciesInstalled } from "../../domains/schema/ownership/install-plan";
import {
  createOwnerRegistry,
  ELEMENT_NOUNS,
  type OwnerRecord,
} from "../../domains/schema/ownership/owner-registry";
import type { PluginLifecycleRecord } from "../../domains/schema/ownership/plugin-lifecycle-state";
import { SchemaOwnersRepository } from "../../domains/schema/ownership/schema-owners-repository";
import {
  planUninstall,
  type UninstallDependent,
  type UninstallInput,
  type UninstallPlan,
} from "../../domains/schema/ownership/uninstall-plan";
import { NextlyError } from "../../errors/nextly-error";
import type { DryRunChange, DryRunPlan } from "../dry-run";
import { plannedOrRefused } from "../dry-run-refusal";
import type { CommandContext } from "../program";
import type { CLIDatabaseAdapter } from "../utils/adapter";
import {
  deletionChanges,
  deletionSource,
  judgeRunDeletions,
  type Agreement,
  type DeletionSource,
} from "../utils/data-loss-consent";

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
   * What it deletes (a table or column dropped, rows removed, a column
   * converted, code that may delete), named the way `migrate:down` names a
   * DOWN's deletions (`rollbackDeletions`). A module that drops only a column
   * it added to another table loses data no table count shows.
   */
  deletions: Deletion[];
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
   * What the modules `applyMigrations` would apply delete, each module with
   * its ledger name and text, judged as one run as `nextly migrate` judges
   * them (`pendingPluginDeletions`). Install takes the data-loss consent for
   * them before it applies any (`judgeInstallDeletions`).
   */
  installDeletions: (
    plugin: LifecyclePlugin
  ) => Promise<readonly InstallUnit[]>;
  /**
   * Ledger filenames whose newest `file_apply` event is `applied` — the same
   * reading `modules` is built from. Install checks its dependencies against
   * it before anything runs.
   */
  readAppliedModules: () => Promise<ReadonlySet<string>>;
  /** Which of the named tables exist in the database now. */
  liveTables: (tables: readonly string[]) => Promise<ReadonlySet<string>>;
  /**
   * What other owners built on or into the schema a full uninstall of the
   * plugin would drop: elements on its tables, keys and relationship fields
   * pointing in, and elements using a column it contributed elsewhere. Reads
   * only, and throws rather than answering "nothing" about a record it could
   * not read, so the uninstall refuses.
   *
   * @param owned the plugin's live owner rows: its tables, and the columns it
   *   contributed to other owners' tables
   */
  schemaDependents: (
    plugin: LifecyclePlugin,
    owned: readonly OwnerRecord[]
  ) => Promise<UninstallDependent[]>;
  /**
   * Forget a fully uninstalled plugin: delete its settings (secrets
   * included), its migration-ledger rows and its owner records, so a later
   * install starts from nothing and applies every module again. Its
   * `plugin_lifecycle` record stays: the boot reads it. Each delete matches
   * nothing the second time, so a resumed uninstall can run it again.
   */
  forgetPlugin: (plugin: LifecyclePlugin) => Promise<void>;
  /**
   * The columns, indexes, foreign keys and checks each named table has now,
   * by kind and name; a table that does not exist is absent. A full
   * uninstall reads it once its DOWNs have run, so it forgets the plugin
   * only once everything it added to other owners' tables is gone.
   */
  liveElements: (
    tables: readonly string[]
  ) => Promise<ReadonlyMap<string, readonly LiveElement[]>>;
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
  /**
   * Records a plugin's new lifecycle state (`recordPluginLifecycle`), with the
   * access that state brings written in the same transaction: an install's
   * permissions, roles and preset grants, an uninstall's orphan marks.
   *
   * `recordEvent: false` writes the access and nothing else: what a repeat
   * install of a plugin already recorded installed needs, since its state
   * does not change and a second identical event would only repeat the first.
   */
  recordLifecycle: (
    plugin: LifecyclePlugin,
    record: PluginLifecycleRecord,
    options?: { recordEvent?: boolean }
  ) => Promise<void>;
  /**
   * Whether a person is at a terminal to be asked before data is deleted.
   * Absent reads as no: a full uninstall without consent is then refused
   * rather than run, which is the safe reading of a caller that said nothing.
   */
  interactive?: boolean;
  /** Asks that person a yes-or-no question; only called when `interactive`. */
  askToDelete?: (question: string) => Promise<boolean>;
  /**
   * The columns each named table has now. An uninstall lists a column the
   * plugin added to another owner's table only while it is still there: its
   * ownership row outlives a `migrate:down --plugin` that removed it. Absent,
   * every recorded column is listed, which asks for more consent, never less.
   */
  liveColumns?: (
    tables: readonly string[]
  ) => Promise<ReadonlyMap<string, ReadonlySet<string>>>;
}

/** One module an install applies, and what it deletes. */
export interface InstallUnit {
  /** Its ledger name (`plugin:<name>/<module>`), named above its deletions. */
  label: string;
  /** Its statements, which bind an agreement to the module as it stands. */
  text: string;
  deletions: readonly Deletion[];
}

/** How an install was asked for: the consent to the data its modules delete. */
export interface InstallOptions {
  /** `--accept-data-loss`, or `NEXTLY_ACCEPT_DATA_LOSS` when absent. */
  consent?: DataLossConsent;
}

/** A column, index, foreign key or check a table has now. */
export interface LiveElement {
  kind: Exclude<NonNullable<OwnerRecord["elementKind"]>, "table">;
  name: string;
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
    logContext: { reason: "plugin-not-configured", plugin: name },
  });
}

/**
 * Install: apply the plugin's pending migrations, then run `onInstall`.
 *
 * An install of a plugin whose recorded state is already `installed` changes
 * no state: it applies the modules its package added since, adds the
 * permissions and roles it newly declares (with every preset role's grants
 * and the release record, in one transaction), and records no lifecycle event
 * and runs no `onInstall`. A deploy script that runs `plugins install --all`
 * on every release then leaves the ledger as one install wrote it. An install
 * that did not finish recorded nothing, so running it again still runs
 * `onInstall`, which is why that hook is documented as idempotent.
 *
 * The whole state change runs under one migrate lock, as an uninstall does:
 * the modules, the owner rows going back to `active`, and `onInstall`. With
 * the lock released between them, an uninstall could roll the new modules
 * back and mark the plugin uninstalled, and the install would then mark it
 * active again and report tables that were gone.
 */
export async function runPluginInstallCommand(
  name: string,
  deps: PluginLifecycleDeps,
  options: InstallOptions = {}
): Promise<void> {
  const plugin = find(deps.plugins, name);
  deps.logger.info(`Installing ${plugin.name}@${plugin.version}...`);

  // Refused before the lock, so an install that cannot proceed makes no
  // other migration wait, and decided again under it, where it holds. A
  // person is asked about the data its modules delete before the lock too.
  await assertInstallable(plugin, deps);
  const agreed = await judgeInstallDeletions(plugin, deps, options);
  const outcome = await deps.underMigrateLock(async () => {
    await assertInstallable(plugin, deps);
    await judgeInstallDeletions(plugin, deps, options, agreed);
    // Read under the lock, where no uninstall can change it before the
    // writes below.
    const repeat = await isRecordedInstalled(plugin, deps);

    // BEFORE the hook, because `onInstall` is documented as running against
    // the plugin's own tables: a hook that seeds a row cannot do it into a
    // table no migration has created yet. The phase reports its own
    // applied/adopted counts — this command does not restate them, because a
    // second count is a second thing that can be wrong. A repeat install
    // applies them too: a package upgraded since the first install brings
    // its new modules this way.
    await deps.applyMigrations(plugin);

    if (repeat) {
      // No owner rows to reactivate (an installed plugin's are active) and
      // no hook: the state is not changing. The access an upgraded package
      // declares, and the release record, still land in one transaction.
      await deps.recordLifecycle(
        plugin,
        { state: "installed" },
        { recordEvent: false }
      );
      return { repeat, rows: [] as OwnerRecord[] };
    }

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
    return { repeat, rows };
  });

  if (outcome.repeat) {
    deps.logger.success(
      `${plugin.name} is already installed: its pending modules and newly declared access are applied, and onInstall did not run again.`
    );
    return;
  }
  // Tables, not owner rows: a plugin's element rows (a column or index on
  // another owner's table) and its tables' own element rows are rows too.
  const tables = new Set(
    outcome.rows
      .filter(row => (row.elementKind ?? "table") === "table")
      .map(row => row.tableName)
  );
  deps.logger.success(
    `${plugin.name} installed (${String(tables.size)} table(s) recorded).`
  );
}

/**
 * Whether the plugin's recorded lifecycle state is `installed`, which makes
 * an install a repeat: one that changes no state. An interrupted install
 * recorded nothing, and an uninstall replaced the record, so either reads as
 * not installed and runs the full install.
 */
async function isRecordedInstalled(
  plugin: LifecyclePlugin,
  deps: Pick<PluginLifecycleDeps, "readLifecycle">
): Promise<boolean> {
  const record = (await deps.readLifecycle()).get(plugin.name);
  return record?.state === "installed";
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
  deps: PluginLifecycleDeps,
  options: InstallOptions = {}
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
    await runPluginInstallCommand(plugin.name, deps, options);
  }
}

/** The note a plan of deleting changes carries: the consent a real run needs. */
function consentNote(deletions: readonly Deletion[]): string[] {
  return deletions.length === 0
    ? []
    : [
        `A real run asks before deleting this data, or takes ${consentToCover(deletions)}.`,
      ];
}

/**
 * `plugins install --dry-run`: the install's own reads, and nothing written,
 * no lock and no consent asked. Its refusals (a disabled plugin, a dependency
 * not installed) are the real install's, read through `assertInstallable`.
 * It names each module the install would apply with what that module
 * deletes, in the consent's own words; the owner rows a reinstall sets back
 * to active; and the lifecycle record. `onInstall` is plugin code the dry run
 * does not run, so it is described as not simulated.
 *
 * `installedEarlier` names plugins an `--all` run plans before this one: the
 * real run installs them first, so their dependents' checks read them as
 * installed.
 */
export function previewPluginInstall(
  name: string,
  deps: PluginLifecycleDeps,
  installedEarlier: ReadonlySet<string> = new Set()
): Promise<DryRunPlan> {
  return plannedOrRefused(async () => {
    const plugin = find(deps.plugins, name);
    await assertInstallable(plugin, withInstalled(deps, installedEarlier));
    const units = await deps.installDeletions(plugin);
    // A repeat install changes no state (`runPluginInstallCommand`), so its
    // plan is the modules alone, and it says why nothing else is listed.
    if (await isRecordedInstalled(plugin, deps)) {
      return {
        changes: units.flatMap(unit => [
          { action: "run", target: `plugin module ${unit.label}` },
          ...deletionChanges(unit.deletions),
        ]),
        notes: [
          ...consentNote(units.flatMap(unit => unit.deletions)),
          `${plugin.name} is already recorded installed: a real install applies its pending modules and any permission or role it newly declares, records no new lifecycle event, and does not run onInstall again.`,
        ],
      };
    }
    const rows = await createOwnerRegistry(
      new SchemaOwnersRepository(deps.db, deps.dialect)
    ).listByOwner(plugin.name);
    const changes: DryRunChange[] = [
      ...units.flatMap(unit => [
        { action: "run", target: `plugin module ${unit.label}` },
        ...deletionChanges(unit.deletions),
      ]),
      ...(rows.length > 0
        ? [
            {
              action: "set",
              target: `${plugin.name}'s ${String(rows.length)} recorded schema owner row(s) to active`,
            },
          ]
        : []),
      { action: "record", target: `${plugin.name} as installed` },
    ];
    return {
      changes,
      notes: [
        ...consentNote(units.flatMap(unit => unit.deletions)),
        `${plugin.name}'s onInstall hook, if it declares one, is not simulated: a real install runs it after the modules.`,
      ],
    };
  });
}

/**
 * `plugins install --all --dry-run`: each enabled plugin planned in the order
 * the real run installs them, each one planned before it counting as
 * installed. A disabled plugin is skipped as the real run skips it, and the
 * plan stops at the first refusal, where the real run stops.
 */
export async function previewPluginInstallAll(
  deps: PluginLifecycleDeps
): Promise<DryRunPlan> {
  const changes: DryRunChange[] = [];
  const notes: string[] = [];
  const installed = new Set<string>();
  for (const plugin of deps.plugins) {
    if (!plugin.enabled) {
      notes.push(
        `Skipping ${plugin.name}: it is disabled in config. Enable it to install it.`
      );
      continue;
    }
    const plan = await previewPluginInstall(plugin.name, deps, installed);
    changes.push(...plan.changes);
    notes.push(...(plan.notes ?? []));
    if ((plan.refusals ?? []).length > 0) {
      return { changes, refusals: plan.refusals, notes };
    }
    installed.add(plugin.name);
  }
  return {
    changes,
    notes: deps.plugins.length === 0 ? ["No plugins are configured."] : notes,
  };
}

/**
 * `deps` with the plugins in `installed` read as installed: each declared
 * module applied and the lifecycle recorded installed, which is what their
 * installs leave.
 */
function withInstalled(
  deps: PluginLifecycleDeps,
  installed: ReadonlySet<string>
): PluginLifecycleDeps {
  if (installed.size === 0) return deps;
  return {
    ...deps,
    readAppliedModules: async () => {
      const applied = new Set(await deps.readAppliedModules());
      for (const plugin of deps.plugins.filter(p => installed.has(p.name))) {
        for (const module of plugin.declaredModules) {
          applied.add(qualifiedFilename(plugin.name, module));
        }
      }
      return applied;
    },
    readLifecycle: async () => {
      const lifecycle = new Map(await deps.readLifecycle());
      for (const name of installed) lifecycle.set(name, { state: "installed" });
      return lifecycle;
    },
  };
}

/**
 * Refuses, before anything changes, an install whose modules delete data the
 * consent does not cover, listing each module above its deletions, with the
 * same judgement, question and refusal as `nextly migrate`
 * (`judgeRunDeletions`): asked before the lock (`agreed` absent) and judged
 * again under it, accepting only what was agreed. Returns what was agreed.
 */
async function judgeInstallDeletions(
  plugin: LifecyclePlugin,
  deps: PluginLifecycleDeps,
  options: InstallOptions,
  agreed?: Agreement
): Promise<Agreement> {
  const sources = new Map<Deletion, DeletionSource>();
  for (const unit of await deps.installDeletions(plugin)) {
    const source = deletionSource(unit.label, unit.text);
    for (const deletion of unit.deletions) sources.set(deletion, source);
  }
  return judgeRunDeletions({
    sources,
    consent: options.consent ?? resolveDataLossConsent({ env: process.env }),
    agreed,
    interactive: deps.interactive,
    askToDelete: deps.askToDelete,
    warn: line => deps.logger.warn(line),
  });
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
  /**
   * Its owner rows on tables that exist, leaving out a column no longer in
   * its table: what the dependents were read over.
   */
  owned: OwnerRecord[];
  /** Its lifecycle record as the uninstall found it. */
  found: PluginLifecycleRecord | undefined;
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
 * them, then the consent to what it deletes. Reads the database; changes
 * nothing.
 */
async function decideUninstall(
  name: string,
  opts: UninstallOptions,
  deps: PluginLifecycleDeps,
  agreed?: readonly Deletion[]
): Promise<UninstallDecision> {
  const { planned, ...decided } = await planUninstallDecision(name, opts, deps);
  const deletions = await consentToDeletions(
    decided.plugin,
    planned,
    decided.plan,
    opts,
    deps,
    agreed
  );
  return { ...decided, deletions };
}

/**
 * An uninstall decided up to its consent: every refusal it can meet, and
 * `planned`, the deletions its DOWNs would make, not yet consented to. Reads
 * the database; changes nothing. What a dry run reports, and what the real
 * run then takes the consent to.
 */
async function planUninstallDecision(
  name: string,
  opts: UninstallOptions,
  deps: PluginLifecycleDeps
): Promise<Omit<UninstallDecision, "deletions"> & { planned: Deletion[] }> {
  const plugin = find(deps.plugins, name);
  assertEnabled(plugin);
  const found = (await deps.readLifecycle()).get(plugin.name);
  assertResumedTheSameWay(plugin, found, opts.keepData);
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
  const liveOwned = recordedRows.filter(row => live.has(row.tableName));
  const columnTables = [
    ...new Set(
      liveOwned
        .filter(row => row.elementKind === "column")
        .map(row => row.tableName)
    ),
  ];
  const liveColumns =
    columnTables.length > 0 && deps.liveColumns !== undefined
      ? await deps.liveColumns(columnTables)
      : undefined;
  // A column's row outlives a `migrate:down --plugin` that removed it, as
  // its table's does; no DOWN left to run drops it, so nothing is asked
  // about it.
  const owned = liveOwned.filter(
    row => row.elementKind !== "column" || columnStands(row, liveColumns)
  );
  // What other owners built on or into this schema refuses a full
  // uninstall: dropping it would delete their data, which this operator's
  // consent cannot give away. Keeping the data drops nothing, so it is not
  // read then.
  const dependents = opts.keepData
    ? []
    : await deps.schemaDependents(plugin, owned);

  const input: UninstallInput = {
    pluginName: plugin.name,
    enabled: deps.plugins
      .filter(p => p.enabled)
      .map(p => ({ name: p.name, dependsOn: p.dependsOn })),
    disabled: deps.plugins
      .filter(p => !p.enabled)
      .map(p => ({ name: p.name, requires: p.requires })),
    owned,
    dependents,
    modules: plugin.modules,
    unshipped: plugin.unshippedModules,
    keepData: opts.keepData,
  };

  // Throws on a dependent or an irreversible module.
  const plan = planUninstall(input);
  await assertTablesCanBeUndone(plugin, plan, owned, deps);

  // Before the confirmation: a DOWN that would be refused is refused whether
  // or not the operator confirms, and asking them to confirm it first only
  // costs them a run.
  const downs =
    plan.downModules.length > 0
      ? await deps.prepareDowns(plugin, plan.downModules)
      : [];

  assertDownsDropTables(plugin, plan, downs, deps.dialect);
  return {
    plugin,
    plan,
    downs,
    planned: uninstallDeletions(plugin, plan, owned, downs),
    owned,
    found,
  };
}

/**
 * `plugins uninstall --dry-run`: the uninstall decided as the real run
 * decides it (`planUninstallDecision`), with no lock, no consent asked and
 * nothing written, its refusals the real run's. It names the lifecycle
 * record begun, each module's DOWN, each deletion in the consent's own words,
 * what happens to the plugin's owner rows (removed with its settings, or kept
 * as orphaned under `--keep-data`), and the record finished. `onUninstall` is
 * plugin code the dry run does not run, so it is described as not simulated;
 * the real run decides again after its boot.
 */
export function previewPluginUninstall(
  name: string,
  opts: UninstallOptions,
  deps: PluginLifecycleDeps
): Promise<DryRunPlan> {
  return plannedOrRefused(async () => {
    const decided = await planUninstallDecision(name, opts, deps);
    const { plugin, plan, downs, planned } = decided;
    if (finishedAlready({ ...decided, deletions: [] })) {
      return {
        changes: [],
        notes: [`${plugin.name} is already uninstalled.`],
      };
    }
    const changes: DryRunChange[] = [
      { action: "record", target: `${plugin.name} as uninstalling` },
      ...downs.map(down => ({
        action: "run",
        target: `the DOWN of ${down.filename} (${String(down.statements.length)} statement(s))`,
      })),
      ...deletionChanges(planned),
      plan.finalState === "uninstalled"
        ? {
            action: "remove",
            target: `${plugin.name}'s schema owner rows, module ledger rows and settings`,
          }
        : {
            action: "set",
            target: `${plugin.name}'s schema owner rows to ${plan.finalState}`,
          },
      { action: "record", target: `${plugin.name} as ${plan.finalState}` },
    ];
    return {
      changes,
      notes: [
        ...consentNote(planned),
        ...(decided.found?.state === "uninstalled"
          ? []
          : [
              `${plugin.name}'s onUninstall hook, if it declares one, is not simulated: a real uninstall runs it before the DOWNs, and decides again over what its boot leaves.`,
            ]),
      ],
    };
  });
}

/**
 * Whether a recorded column is still in its table, as `liveColumns` read it:
 * the one reading of which recorded columns an uninstall still drops. Unread
 * (`liveColumns` absent), every recorded column counts as there, which asks
 * for more, never less.
 */
function columnStands(
  row: OwnerRecord,
  liveColumns: ReadonlyMap<string, ReadonlySet<string>> | undefined
): boolean {
  return (
    liveColumns === undefined ||
    liveColumns.get(row.tableName)?.has(row.elementName ?? "") === true
  );
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
    // The boot gate refuses an unfinished uninstall under the same code; the reason tells
    // this one, run again the other way, apart.
    logContext: {
      plugin: plugin.name,
      keepData: record.keepData,
      reason: "resumed-the-other-way",
    },
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
 *
 * The same holds for a column, index, foreign key or check the plugin added
 * to another owner's table that is there now (`liveElementsItAdded`): with
 * no DOWN left to run, nothing removes it, and the check after the DOWNs
 * would refuse only once the hook had run and the uninstall was recorded
 * begun. Refused here instead, before either.
 */
async function assertTablesCanBeUndone(
  plugin: LifecyclePlugin,
  plan: UninstallPlan,
  owned: readonly OwnerRecord[],
  deps: Pick<PluginLifecycleDeps, "logger" | "liveElements">
): Promise<void> {
  if (plan.finalState !== "uninstalled" || plan.downModules.length > 0) return;
  const elements = await liveElementsItAdded(plugin, plan, owned, deps);
  if (plan.tablesDropped.length === 0 && elements.length === 0) return;
  for (const table of plan.tablesDropped) deps.logger.warn(`  - ${table}`);
  for (const element of elements) {
    deps.logger.warn(`  - ${describeAdded(element)}`);
  }
  throw new NextlyError({
    code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
    publicMessage: nothingUndoesMessage(plugin, plan.tablesDropped, elements),
    logContext: {
      plugin: plugin.name,
      reason: "no-applied-module",
      tables: plan.tablesDropped,
      ...(elements.length > 0 ? { elements } : {}),
    },
  });
}

/** The refusal's words for schema no applied module can undo, as listed above it. */
function nothingUndoesMessage(
  plugin: LifecyclePlugin,
  tables: readonly string[],
  elements: readonly AddedElement[]
): string {
  const next =
    "Nothing was changed. Drop them with a migration, or remove the plugin from config and reset the development database.";
  if (elements.length === 0) {
    return (
      `${plugin.name} owns ${String(tables.length)} table(s), listed above, but this database has no applied migration module to undo them — ` +
      `they were created by a development push rather than by a migration. ${next}`
    );
  }
  const owns = [
    ...(tables.length > 0 ? [`${String(tables.length)} table(s)`] : []),
    `${String(elements.length)} element(s) on other owners' tables`,
  ].join(" and ");
  return (
    `${plugin.name} owns ${owns}, listed above, but this database has no applied migration module to undo them — ` +
    `a development push created them, or a DOWN that already ran left them in place. ${next}`
  );
}

/**
 * What a full uninstall deletes: each table it drops, and each column the
 * plugin added to a table it does not drop. Its DOWNs can delete nothing
 * else, since the drop guard refuses one that drops what another owner
 * holds. A DOWN that is judged to lose data while the owner rows account for
 * none of it is listed by its module, as a deletion only the consent without
 * targets covers.
 *
 * Read from the plan: only its DOWNs delete, so a plan that runs none — an
 * uninstall keeping its data — deletes nothing and needs no consent, whatever
 * the plugin owns, and neither does one whose DOWNs are all judged to lose no
 * data (dropping an index, say). A recorded column is listed only while it is
 * still in its table: `owned` has left out the others (`columnStands`).
 */
function uninstallDeletions(
  plugin: LifecyclePlugin,
  plan: UninstallPlan,
  owned: readonly OwnerRecord[],
  downs: readonly PreparedModuleDown[]
): Deletion[] {
  if (plan.downModules.length === 0) return [];
  const fromDowns = downs.flatMap(down => down.deletions);
  if (fromDowns.length === 0) return [];
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
  // Every deletion the DOWNs make is listed: what the owner records name,
  // then what the reader names beyond it, so a DOWN deleting another
  // owner's rows is never covered by consent naming the plugin's tables.
  const listed = new Set(named.map(deletionKey));
  for (const deletion of fromDowns) {
    if (listed.has(deletionKey(deletion))) continue;
    listed.add(deletionKey(deletion));
    named.push(deletion);
  }
  return named;
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
      // A refusal's reason, as the data-loss consent gives it: needing a consent, or one that
      // leaves a deletion out, each of which the CLI answers with its own next step.
      ...(verdict.kind === "refused"
        ? { reason: `data-loss-${verdict.reason}` }
        : {}),
    },
  });
}

/** Runs a decided uninstall: the hook, the DOWNs, the owner state. */
async function executeUninstall(
  decided: UninstallDecision,
  opts: UninstallOptions,
  deps: PluginLifecycleDeps
): Promise<void> {
  const { plugin } = decided;
  if (finishedAlready(decided)) {
    deps.logger.success(
      `${plugin.name} is already uninstalled; nothing was changed.`
    );
    deps.logger.info(
      `Remove "${plugin.name}" from your config to finish. Until you do, boot will refuse to start.`
    );
    return;
  }
  const registry = createOwnerRegistry(
    new SchemaOwnersRepository(deps.db, deps.dialect)
  );

  // The tables the DOWNs were judged against, as they stand before the hook:
  // what `assertHookLeftTables` compares them with once it has run. Read,
  // and refused when unreadable, before the first change, so a database that
  // cannot answer changes nothing.
  const judged = await readTablesAsTheyStand(decided.plan, deps);
  assertIdentitiesReadable(plugin, decided.plan, judged);

  // Recorded begun right before the first change, the hook included: an
  // uninstall that stops part way leaves this as the plugin's state, which
  // the boot refuses and a run of the command again finishes. Not before the
  // hook's boot: the decision made again after it can still refuse, having
  // changed nothing, and the state must then be the one it was, absent
  // included, so that keeping the data instead is not refused as an
  // unfinished uninstall resumed the other way. Once only.
  let begun = false;
  const recordBegun = async (): Promise<void> => {
    if (begun) return;
    begun = true;
    await deps.recordLifecycle(plugin, {
      state: "uninstalling",
      keepData: opts.keepData,
    });
  };

  // The hook's boot syncs the code-first schema, so once it is done the
  // uninstall is decided again over what it left (`afterTheBoot`), and that
  // decision is the one the hook and the DOWNs run under. A plugin without
  // the hook boots nothing, and the first decision and reading stand.
  //
  // A plugin recorded uninstalled has had its hook run, and no install since:
  // its boot would sync the schema that uninstall removed back into place.
  // So neither runs again; whatever a later `migrate` applied is undone by
  // the DOWNs alone.
  let decision = decided;
  let beforeHook = judged;
  if (decided.found?.state !== "uninstalled") {
    await deps.runLifecycleHook(
      plugin,
      "onUninstall",
      { keepData: opts.keepData },
      async () => {
        ({ decision, beforeHook } = await afterTheBoot(
          decided,
          judged,
          opts,
          deps
        ));
        await recordBegun();
      }
    );
  }
  // No hook ran: before the first DOWN.
  await recordBegun();
  const { plan, downs, owned } = decision;
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
  await assertElementsDropped(plugin, plan, owned, deps);

  // A full uninstall leaves nothing of the plugin behind but the record that
  // it was uninstalled; keeping the data keeps its rows, marked orphaned.
  if (plan.finalState === "uninstalled") {
    await deps.forgetPlugin(plugin);
  } else {
    await registry.setState(plugin.name, plan.finalState);
  }
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
 * An uninstall run again after one finished, with nothing left to undo: the
 * plugin is recorded uninstalled, no module of it is applied, and it owns
 * nothing that exists. It is reported done and changes nothing, the hook
 * included, rather than recorded begun and finished a second time.
 */
function finishedAlready(decided: UninstallDecision): boolean {
  return (
    decided.found?.state === "uninstalled" &&
    decided.plan.downModules.length === 0 &&
    decided.owned.length === 0
  );
}

/**
 * A full uninstall decided again once the hook's boot is done, and the tables
 * as the hook finds them.
 *
 * The boot syncs the code-first schema. It can create one of the plugin's
 * tables that was missing, recording it as the plugin's, and it can bring a
 * relationship or upload field into one of its collections into the
 * registries: neither was there when the uninstall was decided. So every
 * refusal is asked again over the owner rows, tables and dependents as the
 * boot left them, accepting the deletions already agreed to and refusing
 * anything new, before the hook and any DOWN run.
 *
 * The tables keep the identities read before anything ran: the boot runs
 * every enabled plugin's init(), and one could put another table in place of
 * this plugin's, which a baseline taken after the boot would accept. Only a
 * table the boot created is read now, having had none before, and SQLite's
 * schema version, which the boot's sync moves and which, read from before
 * it, would be laid at the hook's door.
 */
async function afterTheBoot(
  decided: UninstallDecision,
  judged: TablesAsTheyStand | undefined,
  opts: UninstallOptions,
  deps: PluginLifecycleDeps
): Promise<{
  decision: UninstallDecision;
  beforeHook: TablesAsTheyStand | undefined;
}> {
  const decision = await decideAgainAfterTheBoot(decided, opts, deps);
  if (judged === undefined) return { decision, beforeHook: judged };
  const created = decision.plan.tablesDropped.filter(
    table => !judged.identities.has(table)
  );
  const identities =
    created.length === 0
      ? judged.identities
      : new Map([
          ...judged.identities,
          ...(await deps.tableIdentities(created)),
        ]);
  const schemaVersion =
    judged.schemaVersion === undefined ? undefined : await deps.schemaVersion();
  // Unreadable here, the comparison after the hook could only refuse:
  // refused now, before the hook can change rows or anything outside.
  if (schemaVersion === null)
    throw schemaVersionUnreadableAfterBoot(decided.plugin);
  const beforeHook = { identities, schemaVersion };
  assertIdentitiesReadable(decided.plugin, decision.plan, beforeHook);
  return { decision, beforeHook };
}

/**
 * The full uninstall decided again, or its refusal, which comes before the
 * uninstall is recorded begun and so leaves the state as it was found. An
 * uninstall keeping its data drops nothing the boot could add, and its owner
 * rows are marked whatever they are, so it is not decided again.
 */
async function decideAgainAfterTheBoot(
  decided: UninstallDecision,
  opts: UninstallOptions,
  deps: PluginLifecycleDeps
): Promise<UninstallDecision> {
  if (decided.plan.finalState !== "uninstalled") return decided;
  return decideUninstall(decided.plugin.name, opts, deps, decided.deletions);
}

/**
 * Refuse to forget a fully uninstalled plugin while a column, index, foreign
 * key or check it added to another owner's table is still there.
 *
 * Its tables are checked by `assertTablesDropped`; what it added elsewhere
 * goes only with its DOWNs, and a DOWN that leaves one runs without error.
 * Forgetting the plugin then would delete the owner row that says whose the
 * element is, and the migration rows a later install reads, which would
 * replay an `ADD COLUMN` or `CREATE INDEX` over the one still there. Its
 * records are kept instead, and the uninstall is left to run again.
 * Matched by kind and name, the name without regard to case, so a database
 * that folds a name's case is not read as having dropped it.
 */
async function assertElementsDropped(
  plugin: LifecyclePlugin,
  plan: UninstallPlan,
  owned: readonly OwnerRecord[],
  deps: Pick<PluginLifecycleDeps, "liveElements">
): Promise<void> {
  if (plan.finalState !== "uninstalled") return;
  const left = await liveElementsItAdded(plugin, plan, owned, deps);
  if (left.length === 0) return;
  throw new NextlyError({
    code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
    publicMessage: `${plugin.name}'s DOWN migrations ran but left ${left.map(describeAdded).join(", ")} in place, so it was not recorded as uninstalled and its records were kept. Drop ${left.length === 1 ? "it" : "them"}, then run the uninstall again to record it.`,
    logContext: {
      plugin: plugin.name,
      reason: "elements-left-by-down",
      elements: left,
    },
  });
}

/** A column, index, foreign key or check the plugin added to another owner's table. */
interface AddedElement {
  table: string;
  kind: LiveElement["kind"];
  name: string;
}

/** How an element the plugin added elsewhere reads in a refusal. */
function describeAdded(element: AddedElement): string {
  return `${ELEMENT_NOUNS[element.kind]} "${element.name}" on ${element.table}`;
}

/**
 * What the plugin added to other owners' tables that is there now: its
 * element rows on tables a full uninstall does not drop, read against
 * `liveElements`. Matched by kind and name, the name without regard to case,
 * so a database that folds a name's case is not read as having dropped it.
 * The one reading both the check before the hook and the one after the DOWNs
 * make.
 */
async function liveElementsItAdded(
  plugin: LifecyclePlugin,
  plan: UninstallPlan,
  owned: readonly OwnerRecord[],
  deps: Pick<PluginLifecycleDeps, "liveElements">
): Promise<AddedElement[]> {
  const dropped = new Set(plan.tablesDropped);
  const added = owned.flatMap((row): AddedElement[] => {
    const kind = row.elementKind ?? "table";
    if (
      kind === "table" ||
      row.ownerKind !== "plugin" ||
      row.ownerId !== plugin.name ||
      dropped.has(row.tableName)
    ) {
      return [];
    }
    return [{ table: row.tableName, kind, name: row.elementName ?? "" }];
  });
  if (added.length === 0) return [];
  const read = await deps.liveElements([
    ...new Set(added.map(element => element.table)),
  ]);
  const live = new Map(
    [...read].map(([table, elements]) => [table.toLowerCase(), elements])
  );
  return added.filter(element =>
    (live.get(element.table.toLowerCase()) ?? []).some(
      there =>
        there.kind === element.kind &&
        there.name.toLowerCase() === element.name.toLowerCase()
    )
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
 * Neither the hook nor the record that the uninstall began has happened by
 * then, so running the uninstall again starts it afresh.
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
