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

export interface PluginSchemaState {
  name: string;
  /** What the plugin's code expects. Absent means it never declared one. */
  declaredVersion: number | undefined;
  /** What the database has applied, from the owner registry. */
  appliedVersion: number | null;
  /** Whether the plugin's owner rows are marked uninstalled. */
  uninstalled: boolean;
}

export type SchemaVersionVerdict =
  | { kind: "ok" }
  | { kind: "behind"; declared: number; applied: number | null }
  | { kind: "uninstalled" };

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
  // An uninstalled plugin still listed in config is a contradiction the
  // operator has to resolve, in EVERY environment: dev push would otherwise
  // recreate the tables an uninstall deliberately removed.
  if (state.uninstalled) return { kind: "uninstalled" };

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
 * `production` decides only whether a `behind` verdict refuses or logs. An
 * `uninstalled` one refuses everywhere, because no amount of dev push makes a
 * deliberately removed plugin's tables correct to recreate.
 */
export function assertSchemaVersionUsable(
  state: PluginSchemaState,
  opts: { production: boolean; warn: (message: string) => void }
): void {
  const verdict = judgeSchemaVersion(state);
  if (verdict.kind === "ok") return;

  if (verdict.kind === "uninstalled") {
    throw new NextlyError({
      code: "PLUGIN_SCHEMA_UNINSTALLED",
      publicMessage: `The plugin "${state.name}" has been uninstalled but is still listed in your config. Run "nextly plugin:install ${state.name}" to reinstate it, or remove it from the config.`,
      logContext: { plugin: state.name },
    });
  }

  const message = `The plugin "${state.name}" expects schema version ${String(verdict.declared)}, and the database has ${verdict.applied === null ? "none" : String(verdict.applied)}. Run "nextly migrate" or "nextly plugin:install ${state.name}".`;

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

  const highest = Math.max(...args.migrationVersions);
  if (highest !== args.declaredVersion) {
    throw NextlyError.validation({
      errors: [
        {
          path: `plugin.${args.pluginName}.schemaVersion`,
          code: "INVALID",
          message: `Plugin "${args.pluginName}" declares schemaVersion ${String(args.declaredVersion)}, but its newest migration declares ${String(highest)}. They must agree, or the boot check can never pass.`,
        },
      ],
    });
  }
}
