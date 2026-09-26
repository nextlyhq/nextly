/**
 * What rolling back a plugin's migration module means, for both paths that
 * do it: `migrate:down --plugin` and `plugins uninstall`.
 *
 * One home, so both rollback paths verify and record a module the same way.
 *
 * @module cli/commands/plugin-module-rollback
 */
import type { SupportedDialect } from "../../database/schema-registry";
import { ledgerFilename } from "../../domains/schema/events/ledger-scope";
import type { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import {
  assertAppliedUnchanged,
  assertModuleIntact,
  type PluginMigration,
} from "../../domains/schema/migrate/plugin/plugin-migration";
import { NextlyError } from "../../errors/nextly-error";

/**
 * A plugin's module for one ledger row, verified as the module that was
 * applied, before any of its DOWN runs.
 *
 * The rollback paths run statements taken from the plugin's CURRENT
 * definition. The module's own checksum seals its `down` alongside its `up`
 * (`canonicalMigrationForm`), and the ledger row carries the checksum of
 * what was applied — so a module edited after generation, or changed after it
 * was applied, is refused here exactly as the apply path refuses it, rather
 * than having its edited DOWN run against a database it never described.
 *
 * `recordedSha` is the applied row's `sha256`; null or absent (a row written
 * before checksums were recorded) skips only the second comparison.
 */
export function verifiedPluginModule(args: {
  pluginName: string;
  migrations: readonly PluginMigration[];
  /** The module's name, the last segment of its ledger key. */
  moduleName: string;
  /** The ledger key, for the refusal message. */
  filename: string;
  recordedSha: string | null | undefined;
}): PluginMigration {
  const module = args.migrations.find(m => m.name === args.moduleName);
  if (!module) {
    // Named rather than "file not found": the row exists, so the module was
    // shipped once. It is the plugin that is now absent or downgraded, and
    // those are different fixes.
    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage:
        `${args.filename} is recorded in the ledger, but plugin "${args.pluginName}" does not currently ship a module named "${args.moduleName}". ` +
        `Reinstall the version that shipped it before rolling it back.`,
      statusCode: 400,
      logContext: {
        filename: args.filename,
        plugin: args.pluginName,
        module: args.moduleName,
      },
    });
  }
  assertModuleIntact(args.pluginName, module);
  assertAppliedUnchanged(args.pluginName, module, args.recordedSha ?? null);
  return module;
}

/**
 * Records a rollback whose DOWN failed, under the ledger key the migration is
 * applied under (`ledgerFilename`, the spelling the rolled-back record uses).
 *
 * Recorded as a `file_rollback` event, never a `file_apply` one. The
 * migration's applied state is read from the newest `file_apply` row, and a
 * failed DOWN on PostgreSQL or SQLite was rolled back whole, so the migration
 * is still applied: a `file_apply` row saying `failed` would make every
 * reader take it for pending — `migrate:down` would pick the migration before
 * it, and a retried uninstall would leave it out.
 *
 * On MySQL each DDL statement commits as it runs, so a DOWN that failed part
 * way may have changed the schema. The row says so, and `migrate:status`
 * shows it beside the migration.
 */
export async function recordRollbackFailed(args: {
  repo: Pick<SchemaEventsRepository, "insertEvent">;
  filename: string;
  dialect: SupportedDialect;
  /** Which command failed and why. */
  note: string;
}): Promise<void> {
  await args.repo.insertEvent({
    eventType: "file_rollback",
    status: "failed",
    source: "cli-migrate",
    filename: ledgerFilename(args.filename),
    endedAt: new Date(),
    note:
      args.dialect === "mysql"
        ? `${PARTIAL_ROLLBACK_NOTE} ${args.note}`
        : args.note,
  });
}

/**
 * The prefix a failed MySQL rollback's note carries: its DOWN may have
 * committed part of its statements before failing.
 */
export const PARTIAL_ROLLBACK_NOTE =
  "[possibly partial: MySQL commits each DDL statement as it runs]";
