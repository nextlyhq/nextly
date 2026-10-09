/**
 * Refusing to boot a plugin whose schema is behind.
 *
 * A plugin declaring `schemaVersion: 3` against a database that has applied 2
 * is a plugin whose code expects a column that is not there. Every query it
 * makes will fail, and the first sign is a request error rather than anything
 * about migrations — so the boot refuses instead, naming the command that
 * fixes it.
 *
 * ## Why development only logs
 *
 * Dev push owns the schema there: the tables are reconciled from config on
 * every reload, so "behind" is a transient state that resolves itself moments
 * later. Refusing would make the ordinary edit-and-reload loop impossible.
 *
 * @module domains/schema/ownership/schema-version-check
 * @since 1.0.0
 */
import { NextlyError } from "../../../errors/nextly-error";
import type { SchemaEventRow } from "../events/schema-events-repository";
import { pluginSchemaVersionFromLedger } from "../migrate/plugin/plugin-schema-version";

export interface PluginSchemaState {
  name: string;
  /** What the plugin's code expects. Absent means it never declared one. */
  declaredVersion: number | undefined;
  /** What the database has applied, from the migration ledger. */
  appliedVersion: number | null;
}

export type SchemaVersionVerdict =
  | { kind: "ok" }
  | { kind: "behind"; declared: number; applied: number | null };

/**
 * Judge one plugin's schema state.
 *
 * Returns the verdict rather than throwing, so the caller decides what an
 * environment does with it — and so both the refusal and the development log
 * read the same decision rather than each deriving one.
 */
export function judgeSchemaVersion(
  state: PluginSchemaState
): SchemaVersionVerdict {
  // A plugin that declares no version is never checked. It has made no claim
  // about the schema, so there is nothing to be behind.
  if (state.declaredVersion === undefined) return { kind: "ok" };

  const applied = state.appliedVersion;
  if (applied !== null && applied >= state.declaredVersion)
    return { kind: "ok" };

  return {
    kind: "behind",
    declared: state.declaredVersion,
    applied,
  };
}

/**
 * Refuse a boot the plugin's schema cannot support.
 *
 * `production` decides whether a `behind` verdict refuses or logs.
 */
export function assertSchemaVersionUsable(
  state: PluginSchemaState,
  opts: { production: boolean; warn: (message: string) => void }
): void {
  const verdict = judgeSchemaVersion(state);
  if (verdict.kind === "ok") return;

  const message = `The plugin "${state.name}" expects schema version ${String(verdict.declared)}, and the database has ${verdict.applied === null ? "none" : String(verdict.applied)}. Run "nextly migrate".`;

  if (!opts.production) {
    // Development push reconciles from config on every reload, so this
    // resolves itself moments later. Refusing would break the edit loop.
    opts.warn(message);
    return;
  }

  throw new NextlyError({
    code: "PLUGIN_SCHEMA_BEHIND",
    publicMessage: message,
    logContext: {
      plugin: state.name,
      declared: verdict.declared,
      applied: verdict.applied,
    },
  });
}

/** What the boot gate reads about one configured plugin. */
export interface PluginSchemaDeclaration {
  name: string;
  /** The `schemaVersion` the plugin declares, if any. */
  schemaVersion?: number;
  /** The migration modules it ships. */
  migrations: ReadonlyArray<{ name: string; schemaVersion: number }>;
}

/**
 * The boot gate: judge every configured plugin's declared schema version
 * against what the database has applied.
 *
 * The applied version is read from the migration LEDGER — the newest
 * `schemaVersion` among a plugin's modules still applied — the reading
 * `migrate:down` and the element rows already share. The owner registry
 * cannot answer it: a plugin whose modules only change data owns no table,
 * so it has no owner row to carry a version, and its production boot was
 * refused as behind after every one of its modules had applied.
 *
 * A ledger that is not there yet is an install whose migrations have not run,
 * so every plugin reads as having applied nothing; a ledger that is there and
 * cannot be read is a fault, and is not turned into "nothing applied".
 */
export async function assertPluginSchemaVersionsUsable(args: {
  plugins: readonly PluginSchemaDeclaration[];
  /** The ledger's `file_apply` rows. */
  readLedger: () => Promise<SchemaEventRow[]>;
  /** Whether the ledger table exists, asked only when reading it fails. */
  ledgerExists: () => Promise<boolean>;
  production: boolean;
  warn: (message: string) => void;
}): Promise<void> {
  let ledger: SchemaEventRow[] = [];
  try {
    ledger = await args.readLedger();
  } catch (error) {
    if (await args.ledgerExists()) throw error;
    args.warn(
      'Migration ledger not found — plugin schema versions cannot be checked yet. Run "nextly migrate" to create it.'
    );
  }
  for (const plugin of args.plugins) {
    assertSchemaVersionUsable(
      {
        name: plugin.name,
        declaredVersion: plugin.schemaVersion,
        appliedVersion: pluginSchemaVersionFromLedger(
          ledger,
          plugin.name,
          plugin.migrations
        ),
      },
      { production: args.production, warn: args.warn }
    );
  }
}

/**
 * Refuse, at RESOLVE time, a plugin that could never satisfy the check above.
 *
 * A plugin declaring `schemaVersion` without shipping migrations would refuse
 * boot forever: nothing can ever raise the applied version. Caught where the
 * manifest is read, so the failure names the manifest rather than arriving as
 * a mysterious production refusal.
 */
export function assertSchemaVersionDeclarable(args: {
  pluginName: string;
  declaredVersion: number | undefined;
  /**
   * Each module's `schemaVersion`, in the order the modules RUN
   * (`orderedMigrations`), not the order they are listed in.
   */
  migrationVersions: readonly number[];
}): void {
  if (args.declaredVersion === undefined) return;

  if (args.migrationVersions.length === 0) {
    throw NextlyError.validation({
      errors: [
        {
          path: `plugin.${args.pluginName}.schemaVersion`,
          code: "INVALID",
          message: `Plugin "${args.pluginName}" declares schemaVersion ${String(args.declaredVersion)} but ships no migrations, so nothing could ever apply it.`,
        },
      ],
    });
  }

  // In run order, never lower than the module before. The version applied
  // is the one the LAST module to run carries, so a later module with a lower
  // version would leave the database behind the declaration after every
  // module had applied. Equal is allowed: a module that only changes data
  // does not move the schema.
  const lowered = args.migrationVersions.findIndex(
    (version, at) => at > 0 && version < args.migrationVersions[at - 1]
  );
  if (lowered !== -1) {
    throw NextlyError.validation({
      errors: [
        {
          path: `plugin.${args.pluginName}.schemaVersion`,
          code: "INVALID",
          message: `Plugin "${args.pluginName}" ships a migration declaring schemaVersion ${String(args.migrationVersions[lowered])} after one declaring ${String(args.migrationVersions[lowered - 1])}. Migrations run in name order, and each must declare a version no lower than the one before it.`,
        },
      ],
    });
  }

  const last = args.migrationVersions[args.migrationVersions.length - 1];
  if (last !== args.declaredVersion) {
    throw NextlyError.validation({
      errors: [
        {
          path: `plugin.${args.pluginName}.schemaVersion`,
          code: "INVALID",
          message: `Plugin "${args.pluginName}" declares schemaVersion ${String(args.declaredVersion)}, but its newest migration declares ${String(last)}. They must agree, or the boot check can never pass.`,
        },
      ],
    });
  }
}
