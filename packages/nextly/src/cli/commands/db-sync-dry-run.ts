/**
 * What `nextly db:sync --dry-run` reports for a sync, with or without `--remove-orphaned`: the
 * refusals the real sync would stop on, the orphans `--remove-orphaned` would delete, and the
 * schema push's plan, all read over a read-only connection with no lock taken and nothing asked.
 *
 * Each part comes from the code the real sync runs: the same checks, the same orphan listing its
 * data-loss consent is judged on, and the push's plan from the same desired schema
 * (`desiredSchemaForSync`), previewed by the pipeline's own read-only entry point.
 *
 * @module cli/commands/db-sync-dry-run
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { loadBuilderEntities } from "../../di/load-dynamic-tables";
import { assertNoMigrationInFlight } from "../../domains/field-groups/migration/sync-guard";
import { runWithFieldTypes } from "../../domains/schema/field-types/field-type-scope";
import { describeOp } from "../../domains/schema/pipeline/diff/describe-operation";
import { previewDesiredSchema } from "../../domains/schema/pipeline/preview";
import type { ClassifierEvent } from "../../domains/schema/pipeline/resolution/types";
import { assertConfiguredSiblingFields } from "../../domains/schema/sibling-fields";
import { assertConfiguredAddresses } from "../../shared/address-rule";
import { assertPluginFieldDeclarations } from "../../shared/lib/assert-plugin-field-declarations";
import type { DryRunChange, DryRunPlan } from "../dry-run";
import type { CommandContext } from "../program";
import type { CLIDatabaseAdapter } from "../utils/adapter";
import type { LoadConfigResult } from "../utils/config-loader";
import { deletionChanges } from "../utils/data-loss-consent";

import type { ResolvedDevOptions } from "./db-sync";
import { syncRefusalOf } from "./db-sync-registry";
import { collectOrphanDeletions, publishExtensionSchema } from "./dev-build";
import { desiredSchemaForSync } from "./dev-server";

/** What a sync's dry run does not show, and what its schema plan is made against. */
const SYNC_DRY_RUN_NOTE =
  "Not shown: the registry rows the sync writes; the core, translation (_locales), Single and component tables it creates or reconciles; the user_ext table; and the permissions it seeds. The schema plan is made against the registry as it stands before the sync rewrites it.";

/**
 * The dry run of a sync: what it changes, in the order the real sync changes it, or the refusal it
 * stops on, in the order it asks them. Reads only.
 */
export async function planDbSync(
  configResult: LoadConfigResult,
  adapter: CLIDatabaseAdapter,
  options: ResolvedDevOptions,
  context: CommandContext
): Promise<DryRunPlan> {
  const drizzleAdapter = adapter as unknown as DrizzleAdapter;
  const changes: DryRunChange[] = [];

  // A database without `users` is one the real sync builds the core tables in first, before any
  // of the checks below, which then read the empty registries those tables start with.
  let coreTablesPresent = false;
  try {
    coreTablesPresent = await drizzleAdapter.tableExists("users");
  } catch {
    // An unreadable catalog reads as no core tables, as the real sync's probe reads it.
  }
  if (!coreTablesPresent) {
    changes.push({
      action: "write",
      target: "the core tables (users, roles, permissions, the registries)",
    });
  }

  try {
    return await runWithFieldTypes(configResult.fieldTypes, async () => {
      await assertSyncAllowed(configResult, drizzleAdapter, context);

      // The orphans `--remove-orphaned` deletes, in the consent listing's own words, from the
      // listing the real sync judges its consent on. The syncs delete them before the push.
      if (options.removeOrphaned) {
        changes.push(
          ...deletionChanges(
            await collectOrphanDeletions(configResult, adapter, context.logger)
          )
        );
      }

      const push = await planPush(
        configResult,
        drizzleAdapter,
        options,
        context
      );
      changes.push(...push.changes);
      return {
        changes,
        notes: [...push.notes, SYNC_DRY_RUN_NOTE],
      };
    });
  } catch (error) {
    const refusal = syncRefusalOf(error);
    if (refusal === undefined) throw error;
    return { changes, refusals: [refusal] };
  }
}

/**
 * The refusals the real sync asks before it changes any schema, in its order: a field-group
 * storage migration in flight, a configured address or pair of sibling fields the registry does
 * not hold, and a plugin field declaration that does not resolve.
 */
async function assertSyncAllowed(
  configResult: LoadConfigResult,
  adapter: DrizzleAdapter,
  context: CommandContext
): Promise<void> {
  await assertNoMigrationInFlight({
    adapter,
    logger: context.logger,
    action: "db:sync",
  });
  const registered = await loadBuilderEntities(adapter);
  await assertConfiguredAddresses(configResult.config, registered, table =>
    adapter.tableExists(table)
  );
  await assertConfiguredSiblingFields(configResult.config, registered, table =>
    adapter.tableExists(table)
  );
  assertPluginFieldDeclarations(configResult.config);
}

/**
 * The schema push's plan: each operation the push would run, from the desired schema the real
 * push applies, and each question it would ask, named rather than asked. A run that applies no
 * schema change (`--no-auto-sync`, or production) says so instead.
 */
async function planPush(
  configResult: LoadConfigResult,
  adapter: DrizzleAdapter,
  options: ResolvedDevOptions,
  context: CommandContext
): Promise<{ changes: DryRunChange[]; notes: string[] }> {
  if (options.autoSync === false) {
    return {
      changes: [],
      notes: ["--no-auto-sync: a real run applies no schema change."],
    };
  }
  if (process.env.NODE_ENV === "production") {
    return {
      changes: [],
      notes: [
        "NODE_ENV is production: a real run applies no schema change, and refuses when it finds a collection created or changed (use nextly migrate:create and nextly migrate).",
      ],
    };
  }

  // The tables plugins declare and the columns they contribute, which the push plans from, as the
  // real sync publishes them before its pushes.
  await publishExtensionSchema(configResult, adapter, context);
  const { desired } = await desiredSchemaForSync(
    configResult.config,
    adapter,
    context.logger
  );
  const preview = await previewDesiredSchema({
    desired,
    db: adapter.getDrizzle(),
    dialect: adapter.getCapabilities().dialect,
    defaultLocale: configResult.config.localization?.defaultLocale ?? "en",
  });

  return {
    changes: preview.operations.map(operation => ({
      action: "run",
      target: describeOp(operation),
    })),
    notes: [
      ...preview.candidates.map(
        candidate =>
          `A real run would ask whether ${candidate.tableName}.${candidate.fromColumn} was renamed to ${candidate.toColumn}.`
      ),
      ...preview.events.map(questionOf),
    ],
  };
}

/** The question a real run would ask about `event`, named. */
function questionOf(event: ClassifierEvent): string {
  const column = `${event.tableName}.${event.columnName}`;
  switch (event.kind) {
    case "add_not_null_with_nulls":
      return `A real run would ask how to fill ${column}, made required while ${event.nullCount} row(s) hold no value.`;
    case "add_required_field_no_default":
      return `A real run would ask how to fill ${column}, a required column with no default, in ${event.tableRowCount} existing row(s).`;
    case "type_change":
      return `A real run would ask before changing ${column} from ${event.fromType} to ${event.toType}.`;
    case "destructive_drop":
      return `A real run would ask before dropping ${column} and its values in ${event.tableRowCount} row(s).`;
  }
}
