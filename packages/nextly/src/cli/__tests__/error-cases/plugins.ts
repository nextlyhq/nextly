/**
 * Cases for plugins: installing and removing them, their migrations, and the schema guard that
 * keeps one owner's migration off another owner's tables.
 *
 * @module cli/__tests__/error-cases/plugins
 */
import {
  judgeDataLoss,
  resolveDataLossConsent,
} from "../../../domains/schema/migrate/data-loss-consent";
import { assertModulesInNameOrder } from "../../../domains/schema/migrate/plugin/plugin-migration";
import { assertNoForeignDrops } from "../../../domains/schema/ownership/drop-guard";
import { assertDependenciesInstalled } from "../../../domains/schema/ownership/install-plan";
import type { OwnerRecord } from "../../../domains/schema/ownership/owner-registry";
import { assertPluginsInstalled } from "../../../domains/schema/ownership/plugin-install-gate";
import { assertSchemaVersionUsable } from "../../../domains/schema/ownership/schema-version-check";
import {
  planUninstall,
  type UninstallInput,
} from "../../../domains/schema/ownership/uninstall-plan";
import { NextlyError } from "../../../errors/nextly-error";
import {
  installTargetUnclear,
  pluginNotFound,
} from "../../errors/areas/plugins";

import type { ErrorCases } from "./types";

const PLUGIN = "@acme/seo";
const MODULE = "20261020_120000_add_redirects";

/** What `run` throws; a case whose thrower does not throw fails here rather than passing. */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

/** An uninstall of the plugin with nothing else configured, keeping nothing. */
function uninstall(overrides: Partial<UninstallInput>): UninstallInput {
  return {
    pluginName: PLUGIN,
    enabled: [{ name: PLUGIN, dependsOn: [] }],
    owned: [],
    modules: [{ name: MODULE, reversible: true }],
    keepData: false,
    ...overrides,
  };
}

/** The app's table-level owner row for `dc_posts`. */
const APP_POSTS: OwnerRecord = {
  tableName: "dc_posts",
  elementKind: "table",
  elementName: "",
  ownerKind: "app",
  ownerId: "app",
  migratedBy: "app",
  ownerVersion: null,
  schemaVersion: null,
  state: "active",
};

/** The plugin's migration run, judged by the schema guard. */
function guarded(statement: string): unknown {
  return thrown(() =>
    assertNoForeignDrops({
      statements: [statement],
      stream: `plugin:${PLUGIN}`,
      owners: new Map([["dc_posts", APP_POSTS]]),
      elementOwners: [APP_POSTS],
      dialect: "sqlite",
      source: `${PLUGIN}/${MODULE}`,
    })
  );
}

/** The refusal an uninstall reaches for its table when no terminal can ask, as `consentToDeletions` throws it. */
export async function uninstallRefused(
  flag: string | undefined
): Promise<NextlyError> {
  const verdict = await judgeDataLoss({
    deletions: [{ kind: "table", table: "seo_redirects", count: 12 }],
    consent: resolveDataLossConsent({ flag, env: {} }),
    interactive: false,
    ask: () => Promise.resolve(false),
    print: () => {},
  });
  if (verdict.kind !== "refused")
    throw new Error(`expected a refusal, got ${verdict.kind}`);
  return new NextlyError({
    code: "PLUGIN_UNINSTALL_UNCONFIRMED",
    publicMessage: `${verdict.message} Or use --keep-data to leave the tables in place.`,
    logContext: {
      plugin: PLUGIN,
      tables: ["seo_redirects"],
      verdict: verdict.kind,
      reason: `data-loss-${verdict.reason}`,
    },
  });
}

export const PLUGIN_CASES = {
  PLUGIN_NOT_FOUND: () => pluginNotFound("@acme/sitemap"),
  PLUGIN_INSTALL_TARGET_UNCLEAR: () => installTargetUnclear(undefined),
  // As `assertEnabled` in `cli/commands/plugin-lifecycle.ts` throws it.
  PLUGIN_DISABLED: () =>
    new NextlyError({
      code: "PLUGIN_DISABLED",
      publicMessage: `The plugin "${PLUGIN}" is disabled in config. Enable it in the config to install or uninstall it.`,
    }),
  PLUGIN_UNINSTALL_UNFINISHED: () =>
    thrown(() =>
      assertPluginsInstalled({
        plugins: [{ name: PLUGIN }],
        states: new Map([[PLUGIN, { state: "uninstalling", keepData: false }]]),
        production: true,
        warn: () => {},
      })
    ),
  // As `assertResumedTheSameWay` in `cli/commands/plugin-lifecycle.ts` throws it.
  PLUGIN_UNINSTALL_KEEP_DATA_MISMATCH: () =>
    new NextlyError({
      code: "PLUGIN_UNINSTALL_UNFINISHED",
      publicMessage: `The uninstall of ${PLUGIN} began without --keep-data and did not finish. Run it again without --keep-data to finish it. Nothing was changed.`,
      logContext: {
        plugin: PLUGIN,
        keepData: false,
        reason: "resumed-the-other-way",
      },
    }),
  // As `consentToDeletions` in `cli/commands/plugin-lifecycle.ts` throws it for a "no".
  PLUGIN_UNINSTALL_DECLINED: () =>
    new NextlyError({
      code: "PLUGIN_UNINSTALL_UNCONFIRMED",
      publicMessage:
        "Nothing was changed: the deletion was not confirmed. Or use --keep-data to leave the tables in place.",
      logContext: {
        plugin: PLUGIN,
        tables: ["seo_redirects"],
        verdict: "declined",
      },
    }),
  PLUGIN_UNINSTALL_IRREVERSIBLE: () =>
    thrown(() =>
      planUninstall(
        uninstall({ modules: [{ name: MODULE, reversible: false }] })
      )
    ),
  PLUGIN_MIGRATION_NOT_SHIPPED: () =>
    thrown(() => planUninstall(uninstall({ unshipped: [MODULE] }))),
  // The `cli/commands/plugin-lifecycle.ts` refusals of a full uninstall, each as it throws it.
  PLUGIN_TABLES_NOT_MIGRATED: () =>
    new NextlyError({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      publicMessage:
        `${PLUGIN} owns 1 table(s), listed above, but this database has no applied migration module to undo them — ` +
        `they were created by a development push rather than by a migration. ` +
        `Nothing was changed. Drop them with a migration, or remove the plugin from config and reset the development database.`,
      logContext: {
        plugin: PLUGIN,
        reason: "no-applied-module",
        tables: ["seo_redirects"],
      },
    }),
  PLUGIN_DOWN_KEEPS_TABLES: () =>
    new NextlyError({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      publicMessage: `${PLUGIN}'s DOWN migrations do not drop seo_redirects, which it owns. Nothing was changed. Fix the plugin's DOWN, or use --keep-data to leave its tables in place.`,
      logContext: {
        plugin: PLUGIN,
        reason: "down-leaves-tables",
        tables: ["seo_redirects"],
      },
    }),
  PLUGIN_DOWN_LEFT_TABLES: () =>
    new NextlyError({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      publicMessage: `${PLUGIN}'s DOWN migrations ran but left seo_redirects in place, so it was not recorded as uninstalled. Drop that table, then run the uninstall again to record it.`,
      logContext: {
        plugin: PLUGIN,
        reason: "tables-left-by-down",
        tables: ["seo_redirects"],
      },
    }),
  PLUGIN_TABLE_IDENTITY_UNREADABLE: () =>
    new NextlyError({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      publicMessage: `The database reports no identity for seo_redirects, so whether ${PLUGIN}'s onUninstall leaves it in place could not be checked. Nothing was changed. Use --keep-data to leave its tables in place.`,
      logContext: {
        plugin: PLUGIN,
        reason: "table-identity-unreadable",
        tables: ["seo_redirects"],
      },
    }),
  PLUGIN_HOOK_CHANGED_TABLES: () =>
    new NextlyError({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      publicMessage: `seo_redirects was dropped, renamed or replaced while ${PLUGIN}'s onUninstall ran (its boot included), so none of its DOWN migrations, which were to drop it, was run. Put the original table back under its name, in place of any table created there, then run the uninstall again.`,
      logContext: {
        plugin: PLUGIN,
        reason: "tables-changed-by-hook",
        tables: ["seo_redirects"],
      },
    }),
  PLUGIN_HOOK_CHANGED_SCHEMA: () =>
    new NextlyError({
      code: "PLUGIN_UNINSTALL_IRREVERSIBLE",
      publicMessage: `${PLUGIN}'s onUninstall changed the database schema. On SQLite a table it renamed away or replaced cannot be told from the one its DOWN migrations were judged against, so none of them was run, as they could drop a replacement of seo_redirects. Undo the schema changes the hook made, and have it change rows only, then run the uninstall again.`,
      logContext: {
        plugin: PLUGIN,
        reason: "schema-changed-by-hook",
        tables: ["seo_redirects"],
      },
    }),
  PLUGIN_HAS_DEPENDENTS: () =>
    thrown(() =>
      planUninstall(
        uninstall({
          enabled: [
            { name: PLUGIN, dependsOn: [] },
            { name: "@acme/sitemap", dependsOn: [PLUGIN] },
          ],
        })
      )
    ),
  PLUGIN_DEPENDENCY_NOT_INSTALLED: () =>
    thrown(() =>
      assertDependenciesInstalled({
        pluginName: "@acme/sitemap",
        configured: [
          {
            name: "@acme/sitemap",
            requires: [PLUGIN],
            optionallyRequires: [],
            declaredModules: [],
          },
          {
            name: PLUGIN,
            requires: [],
            optionallyRequires: [],
            declaredModules: [MODULE],
          },
        ],
        appliedFilenames: new Set(),
        lifecycle: new Map(),
      })
    ),
  PLUGIN_NOT_INSTALLED: () =>
    thrown(() =>
      assertPluginsInstalled({
        plugins: [{ name: PLUGIN }],
        states: new Map(),
        production: true,
        warn: () => {},
      })
    ),
  PLUGIN_UNINSTALLED_BUT_CONFIGURED: () =>
    thrown(() =>
      assertPluginsInstalled({
        plugins: [{ name: PLUGIN }],
        states: new Map([[PLUGIN, { state: "uninstalled" }]]),
        production: true,
        warn: () => {},
      })
    ),
  PLUGIN_SCHEMA_BEHIND: () =>
    thrown(() =>
      assertSchemaVersionUsable(
        { name: PLUGIN, declaredVersion: 3, appliedVersion: 2 },
        { production: true, warn: () => {} }
      )
    ),
  // As `cli/commands/migrate.ts` throws it, before any plugin migration runs.
  PLUGIN_SHIPS_NO_MIGRATIONS: () =>
    new NextlyError({
      code: "PLUGIN_MIGRATIONS_UNAVAILABLE",
      publicMessage:
        "A plugin declares tables or table elements but ships no migrations to create them. They exist in development through push; generate the plugin's migrations before deploying.",
      logContext: { tables: ["seo_redirects", "dc_posts.seo_title"] },
    }),
  // As `assertModuleIntact` in `domains/schema/migrate/plugin/plugin-migration.ts` throws it.
  PLUGIN_MIGRATION_CHANGED: () =>
    new NextlyError({
      code: "MIGRATION_CHECKSUM_MISMATCH",
      publicMessage: `Plugin "${PLUGIN}" migration ${MODULE}: a plugin migration has been changed since it was generated. Regenerate it, or restore the original. A module written or edited by hand is sealed with \`migrationChecksum\` from \`@nextlyhq/plugin-sdk/schema\` — \`checksum: migrationChecksum(content)\` over the module without its checksum — which is the form \`nextly migrate:create --plugin <entry> --blank\` and \`--no-transaction\` write.`,
      logContext: {
        plugin: PLUGIN,
        migration: MODULE,
        expected: "9f2c4e1a",
        actual: "4b7d0c3e",
      },
    }),
  // As `assertAppliedUnchanged` in the same file throws it.
  PLUGIN_APPLIED_MIGRATION_CHANGED: () =>
    new NextlyError({
      code: "MIGRATION_CHECKSUM_MISMATCH",
      publicMessage: `Plugin "${PLUGIN}" migration ${MODULE}: a plugin migration that has already been applied no longer matches what was applied. The database does not match the file that claims to describe it. Restore the migration as it was when it ran.`,
      logContext: {
        plugin: PLUGIN,
        migration: MODULE,
        applied: "9f2c4e1a",
        onDisk: "4b7d0c3e",
      },
    }),
  // As `appliedModuleMissing` in `domains/schema/migrate/plugin/plugin-history.ts` builds it.
  PLUGIN_APPLIED_MIGRATION_REMOVED: () =>
    new NextlyError({
      code: "PLUGIN_MIGRATION_HISTORY_CHANGED",
      publicMessage: `Plugin "${PLUGIN}" no longer lists its migration "${MODULE}", which the database records as applied. A plugin's applied migrations are never removed or renamed: the database holds what they did, and the migrations after them were written for that. Restore "${MODULE}" under its name. To take it out, roll it back first with \`nextly migrate:down --plugin ${PLUGIN}\` while it is still listed. Nothing was applied.`,
      logContext: {
        plugin: PLUGIN,
        migration: MODULE,
        ledgerKey: `plugin:${PLUGIN}/${MODULE}`,
        reason: "applied-module-missing",
      },
    }),
  // As `pendingBeforeApplied` in the same file builds it.
  PLUGIN_MIGRATION_BEFORE_APPLIED: () =>
    new NextlyError({
      code: "PLUGIN_MIGRATION_HISTORY_CHANGED",
      publicMessage: `Plugin "${PLUGIN}" lists a migration "20261019_090000_add_index" that has not run, ordered before "${MODULE}", which has. A new migration may only follow the ones already applied: run now, it would run after migrations written to come after it. Rename it so its name sorts after "${MODULE}", as the generator's timestamps do. If it was rolled back by hand, roll back the migrations after it first, or once its changes are in place record it with \`nextly migrate:resolve --applied plugin:${PLUGIN}/20261019_090000_add_index\`. Nothing was applied.`,
      logContext: {
        plugin: PLUGIN,
        migration: "20261019_090000_add_index",
        lastApplied: MODULE,
        reason: "pending-before-applied",
      },
    }),
  PLUGIN_MIGRATIONS_OUT_OF_ORDER: () =>
    thrown(() =>
      assertModulesInNameOrder(PLUGIN, [
        { name: MODULE },
        { name: "20261019_090000_add_index" },
      ])
    ),
  // As `assertSchemaChangeWritten` in `domains/schema/migrate/plugin/run-plugin-migrations.ts`
  // throws it.
  PLUGIN_MIGRATION_SQL_MISSING: () =>
    new NextlyError({
      code: "PLUGIN_MIGRATION_SQL_MISSING",
      publicMessage:
        `Plugin "${PLUGIN}" migration ${MODULE} changes the schema on sqlite but has no sqlite statements, so running it would record a change it never made. Nothing was applied. ` +
        "Write the module's sqlite `up` and `down` in the plugin, then run `nextly migrate` again.",
      logContext: { plugin: PLUGIN, migration: MODULE, dialect: "sqlite" },
    }),
  // The generator's refusals in `domains/schema/migrate-create/generate-plugin.ts`, each as it
  // throws it.
  PLUGIN_MIGRATION_ADDS_UNFILLABLE_COLUMN: () =>
    new NextlyError({
      code: "PLUGIN_MIGRATION_ADDS_UNFILLABLE_COLUMN",
      publicMessage:
        `This migration would add seo_redirects.status as NOT NULL with no default to a table plugin "${PLUGIN}" created earlier, and the rows already in it would have no value for it. ` +
        "Give the column a default, or write the addition by hand — add the column nullable, fill the existing rows, then make it NOT NULL — in a module from `nextly migrate:create --plugin <entry> --blank`, which records this change for the SQL you write.",
      logContext: { plugin: PLUGIN, columns: ["seo_redirects.status"] },
    }),
  PLUGIN_MIGRATION_DROPS_CREATED_SCHEMA: () =>
    new NextlyError({
      code: "PLUGIN_MIGRATION_DROPS_CREATED_SCHEMA",
      publicMessage:
        `This migration would drop seo_redirects.target, which an earlier migration of plugin "${PLUGIN}" created, and lose its rows. ` +
        "If it was renamed, write the rename by hand; if the drop is deliberate, write the drop by hand — in a module from `nextly migrate:create --plugin <entry> --blank`, which records this change for the SQL you write.",
      logContext: { plugin: PLUGIN, drops: ["seo_redirects.target"] },
    }),
  PLUGIN_SCHEMA_VERSION_NOT_ADVANCED: () =>
    new NextlyError({
      code: "PLUGIN_SCHEMA_VERSION_NOT_ADVANCED",
      publicMessage:
        "The plugin's schemaVersion must move past 3 before new migrations can be generated (it is 3).",
      logContext: { plugin: PLUGIN, previousSchemaVersion: 3, declared: 3 },
    }),
  DROP_OF_FOREIGN_TABLE: () => guarded("DROP TABLE dc_posts"),
  MIGRATION_SQL_UNCHECKABLE: () =>
    guarded("DROP TABLE seo_redirects /* left open"),
  // As `cli/commands/plugin-module-rollback.ts` throws it.
  PLUGIN_ROLLBACK_MODULE_NOT_SHIPPED: () =>
    new NextlyError({
      code: "INVALID_INPUT",
      publicMessage:
        'plugin:@acme/seo/0002_redirects is recorded in the ledger, but plugin "@acme/seo" does not currently ship a module named "0002_redirects". Reinstall the version that shipped it before rolling it back.',
      statusCode: 400,
      logContext: {
        reason: "plugin-module-not-shipped",
        filename: "plugin:@acme/seo/0002_redirects",
        plugin: "@acme/seo",
        module: "0002_redirects",
      },
    }),
  // The refusals below are built as `cli/commands/plugin-lifecycle-runner.ts` throws them.
  PLUGIN_NEEDS_MIGRATED_DATABASE: () =>
    NextlyError.conflict({
      reason: "state",
      message:
        'This database has not been migrated yet. Run "nextly migrate" before installing or uninstalling a plugin.',
      logContext: {
        reason: "database-not-migrated",
        missing: ["nextly_schema_events", "nextly_schema_owners"],
      },
    }),
  PLUGIN_LIFECYCLE_LOCK_BUSY: () =>
    new NextlyError({
      code: "CONFLICT",
      publicMessage:
        "Another migration is holding the migrate lock, so @acme/seo was not installed. Nothing was changed — re-run once it finishes.",
      logContext: { reason: "plugin-lifecycle-lock-busy", outcome: "settled" },
    }),
  PLUGIN_HOOK_SERVICES_REGISTERED: () =>
    new NextlyError({
      code: "CONFLICT",
      publicMessage:
        "Services are already registered in this process, so @acme/seo's onInstall was not run.",
      logContext: {
        reason: "plugin-hook-services-registered",
        plugin: "@acme/seo",
        hook: "onInstall",
      },
    }),
  PLUGIN_HOOK_HANDLERS_RUNNING: () =>
    new NextlyError({
      code: "CONFLICT",
      publicMessage:
        "Event handlers that @acme/seo's onUninstall set off were still running after 30s, so the command stopped there. Run it again once what they do can finish.",
      logContext: {
        reason: "plugin-hook-handlers-running",
        plugin: "@acme/seo",
        hook: "onUninstall",
      },
    }),
} satisfies ErrorCases;
