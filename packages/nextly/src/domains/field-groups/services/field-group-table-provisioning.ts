// Runtime registration and companion provisioning for a field group's table.
//
// Both were private to the components dispatcher, which is why the two other create transports
// could not reuse the schema half and shipped a registry row describing a table that did not
// exist. Moved here unchanged so one service can own the table change and the registry write
// together; the bodies are byte-identical to the versions the dispatcher carried.

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldConfig } from "../../../collections/fields/types";
import {
  getConfigFromDI,
  getSchemaRegistryFromDI,
} from "../../../dispatcher/helpers/di";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  getI18nArchiveDdl,
  getI18nArchiveIndexRepairDdl,
} from "../../../schemas/nextly-i18n-archive";
import { FieldGroupSchemaService } from "../../../services/field-groups/field-group-schema-service";
import { buildCompanionTransitionStatements } from "../../i18n/migration/reconcile-companion";
import { localizedColumnsOnMain } from "../../i18n/runtime/companion-io";
import { buildCompanionRuntimeTable } from "../../i18n/runtime/companion-registration";
import { isIdempotencyError } from "../../schema/pipeline/sql-statement-utils";

/**
 * Whether the in-memory schema was actually refreshed, and why not when it was not.
 *
 * Reported rather than thrown because this step runs AFTER the durable write on every caller: the
 * schema change is already committed, so raising here would describe a repair that landed as one
 * that failed. Returning the outcome lets a caller that must not overstate its result — a repair
 * telling an operator the group is usable again — say what is still stale, while the callers that
 * treat registration as best-effort carry on ignoring it exactly as before.
 */
export interface RuntimeSchemaRegistration {
  registered: boolean;
  /** Present only when `registered` is false; safe to show an operator. */
  reason?: string;
}

export function registerComponentRuntimeSchema(
  adapter: DrizzleAdapter,
  dialect: string,
  tableName: string,
  fields: FieldConfig[],
  typeColumn: string,
  // i18n: when localized, the main comp_ runtime table omits translatable columns and the
  // companion comp_<slug>_locales runtime table is registered for per-language reads/writes.
  localized = false
): RuntimeSchemaRegistration {
  try {
    const fieldGroupSchemaService = new FieldGroupSchemaService(
      dialect as ConstructorParameters<typeof FieldGroupSchemaService>[0]
    );
    const runtimeTable = fieldGroupSchemaService.generateRuntimeSchema(
      tableName,
      fields,
      { localized, typeColumn }
    );
    const companion = localized
      ? buildCompanionRuntimeTable({
          slug: tableName,
          tableName,
          fields: fields as { name: string; type: string }[],
          dialect: dialect as Parameters<
            typeof buildCompanionRuntimeTable
          >[0]["dialect"],
          localized: true,
          status: false,
        })
      : null;

    /**
     * Register the pair through whichever sink is available.
     *
     * 🔴 Both tables, always. A localized field group's reads and writes go through the COMPANION,
     * so registering only the main table leaves the half that actually serves translated values
     * stale — and a caller that reports this as a completed refresh then tells an operator the
     * group is usable when the localized half is not. Written once and applied to both sinks
     * because the two branches answer the same question, and the fallback previously answered it
     * differently while returning the same verdict.
     */
    const registerBoth = (
      register: (name: string, table: unknown) => void
    ): void => {
      register(tableName, runtimeTable);
      if (companion) {
        register(companion.companionTableName, companion.table);
      }
    };

    const registry = getSchemaRegistryFromDI();
    if (registry) {
      registerBoth((name, table) =>
        registry.registerDynamicSchema(name, table)
      );
      return { registered: true };
    }

    // Fallback for paths where DI isn't wired (tests, CLI).
    const resolver = (
      adapter as unknown as {
        tableResolver?: {
          registerDynamicSchema?: (name: string, table: unknown) => void;
        };
      }
    ).tableResolver;
    const fallbackRegister = resolver?.registerDynamicSchema;
    if (typeof fallbackRegister === "function") {
      registerBoth((name, table) =>
        fallbackRegister.call(resolver, name, table)
      );
      return { registered: true };
    }

    console.warn(
      `[registerComponentRuntimeSchema] No SchemaRegistry available for ` +
        `'${tableName}'. Component queries may reference old column names ` +
        `until next server restart.`
    );
    return {
      registered: false,
      reason: "no schema registry is available in this process",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[registerComponentRuntimeSchema] In-memory schema refresh failed for ` +
        `'${tableName}': ${msg}. Component queries may reference old ` +
        `column names until next server restart.`
    );
    return { registered: false, reason: msg };
  }
}

/**
 * Provision (create / ADD-DROP columns) the component's companion `comp_<slug>_locales` table
 * out-of-band after a schema change, then register its runtime table. The push pipeline excludes
 * companions, so every component create/update/apply path that changes the localized field set
 * goes through here. No-op when the component isn't localized. Mirrors reconcileSingleCompanion.
 * DDL throws on failure; runtime registration is best-effort. Does not move existing main-table
 * rows into the companion — that is the `nextly migrate` enable/disable path.
 */
export async function reconcileComponentCompanion(args: {
  slug: string;
  tableName: string;
  oldFields: FieldDefinition[];
  newFields: FieldDefinition[];
  /** Localization state AFTER this save (requested). */
  localized: boolean;
  /** Localization state BEFORE this save (persisted). Drives enable/disable detection. */
  wasLocalized: boolean;
  adapter: DrizzleAdapter;
  // Whether any DDL actually ran. The caller cannot derive this from the request: a field-set
  // change on a group that was and remains non-localized reaches here and moves nothing, and a
  // caller that inferred "the tables changed" from the request shape would report a physical
  // transition that never happened.
}): Promise<boolean> {
  const { slug, tableName, oldFields, newFields, localized, adapter } = args;
  const wasLocalized = args.wasLocalized;
  // Nothing to do when the component was and remains non-localized.
  if (!wasLocalized && !localized) return false;

  const dialect = adapter.dialect;
  const defaultLocale = getConfigFromDI()?.localization?.defaultLocale ?? "en";

  const plan = buildCompanionTransitionStatements({
    // The companion mirrors the main table, and a field group's builder reads a width from a different key.
    builtBy: "fieldGroup" as const,
    slug,
    tableName,
    dialect,
    defaultLocale,
    // Components are never Draft/Published — companion has no `_status`.
    status: false,
    // And never had one, so the disable restore has no status to carry back.
    wasStatus: false,
    wasLocalized,
    isLocalized: localized,
    oldFields,
    newFields,
    companionExists: await adapter.tableExists(`${tableName}_locales`),
    // Which translatable columns the main table still carries. A disable must not re-add one that
    // is already there, and must still restore it: presence says the column exists, never that its
    // value is current, because every localized write went to the companion alone.
    existingMainColumns: await localizedColumnsOnMain(
      adapter,
      tableName,
      oldFields
    ).then(cols => cols.map(c => c.name)),
  });

  // A disable archives non-default translations, so ensure `nextly_i18n_archive` exists first
  // (Builder entities have no `nextly migrate` step to provision it). Idempotent.
  if (plan.needsArchive) {
    for (const stmt of getI18nArchiveDdl(dialect)) {
      await adapter.executeQuery(stmt);
    }
    // MySQL's table DDL cannot restore an index the table is missing, and
    // index-only drift produces no reconcile operations, so the repair runs
    // here. Tolerated rather than checked first: attempting it and accepting
    // "duplicate key name" is one round trip instead of two, and the same
    // tolerance the schema executor already applies.
    const indexRepair = getI18nArchiveIndexRepairDdl(dialect);
    if (indexRepair) {
      try {
        await adapter.executeQuery(indexRepair);
      } catch (err) {
        if (!isIdempotencyError(err)) throw err;
      }
    }
  }
  // 🔴 STRICT on purpose: the companion does NOT tolerate a re-run.
  //
  // Tolerating it would make a half-finished localization ENABLE look like success. Interrupted
  // after the companion is created but before the seed and the main-column drops, the retry is
  // indistinguishable from an orphan repair — the planner cannot tell them apart, because the
  // signal that separates them (`existingMainColumns`) is consumed only on the disable path — so
  // the duplicate columns would be swallowed and the entity recorded as localized while its
  // default-locale content is still stranded on the main table.
  //
  // A loud failure is the worse experience and the safer outcome. It costs the repair of a
  // localized entity whose create half-failed; it prevents silently reporting a migration that did
  // not happen.
  for (const stmt of plan.statements) {
    await adapter.executeQuery(stmt);
  }

  // The transition record describes a companion that no longer exists, so it stops being true
  // the moment the disable succeeds. Left behind, it would refuse the next enable's real
  // source locale — the check that protects a live transition would block a legitimate one.
  if (plan.companionDropped) {
    // The other half of "this companion is gone": readiness remembers only that one exists.
    const { forgetCompanionReadiness } = await import(
      "../../i18n/runtime/companion-readiness"
    );
    forgetCompanionReadiness(adapter, `${tableName}_locales`);
    const { resolveTransitionStore } = await import(
      "../../i18n/migration/transition-recorder"
    );
    const { forgetI18nTransition } = await import(
      "../../i18n/migration/transition-state"
    );
    await forgetI18nTransition(
      await resolveTransitionStore(adapter),
      "fieldGroup",
      slug
    );
  }
  // Runtime registration of the companion is handled by registerComponentRuntimeSchema(localized)
  // in the calling handlers, so no separate registration is needed here.

  // The archive DDL is excluded on purpose: it provisions a shared framework table and is
  // idempotent, so it says nothing about whether THIS field group's storage moved.
  return plan.statements.length > 0;
}

/**
 * Which discriminator column a field group's table actually carries.
 *
 * PROBED rather than assumed, because the storage migration renames these tables and their
 * columns: which spelling a given database uses is a fact about that database, not something a
 * release can infer from its own version. The constant is the fallback for a table the probe
 * cannot see, which is the shape a fresh install has.
 *
 * Here rather than private to a transport for the reason the rest of this module exists: the
 * dispatcher held it, so every other transport that rebinds a runtime schema either reimplemented
 * it or skipped it.
 *
 * 🔴 Call it BEFORE the DDL, never from inside `registerComponentRuntimeSchema`. That function's
 * `catch` is a cache-refresh failsafe — it suppresses so a refresh problem cannot fail a request
 * whose schema change already committed — and a catalog probe placed inside it inherits that
 * policy, letting a caller report success while leaving the runtime table unregistered or holding
 * obsolete columns. Resolving first is equivalent and safer: a schema change only ever alters user
 * columns, so the discriminator is the same either side of it, and a probe that cannot answer
 * fails the request before anything is committed.
 */
export async function resolveComponentTypeColumn(
  adapter: DrizzleAdapter,
  tableName: string
): Promise<string> {
  const { resolveTypeColumns } = await import(
    "../storage/resolve-storage-names"
  );
  const { STORAGE_FORMAT } = await import("../../../schemas/storage-format");
  const typeColumns = await resolveTypeColumns(adapter, [tableName]);
  return typeColumns.get(tableName) ?? STORAGE_FORMAT.columns.type;
}
