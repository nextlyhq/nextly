/**
 * Repair a field group's STORED definition to describe its LIVE tables.
 *
 * The exit from `diverged`: the tables moved and the row recording them did not, so every
 * storage-moving edit is refused until the record is made honest again. This operation reads the
 * tables, plans the smallest definition that describes them (`reconcile-field-group-plan.ts`
 * holds the decisions), and writes the repaired record in ONE version-conditional statement. It
 * never issues DDL — the tables are the truth being described, not the thing being fixed.
 *
 * Deliberately runnable on a group that is NOT marked `diverged`: a divergence can exist with no
 * mark (a recording write that failed after its DDL committed leaves exactly that), and the
 * operation is idempotent — on a healthy group the plan comes back unchanged and nothing is
 * written. That is also why this does not gate on `migrationStatus`.
 *
 * @module domains/field-groups/services/field-group-reconcile-service
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldConfig } from "@nextly/collections";

import { NextlyError } from "../../../errors";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { DynamicFieldGroupInsert } from "../../../schemas/dynamic-field-groups/types";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { Logger } from "../../../shared/types";
import { introspectLiveSnapshot } from "../../schema/pipeline/diff/introspect-live";
import type { SupportedDialect } from "../../schema/services/field-column-descriptor";
import { calculateSchemaHash } from "../../schema/services/schema-hash";

import type { FieldGroupRegistryService } from "./field-group-registry-service";
import {
  planFieldGroupReconcile,
  type ReconcileAdoption,
  type ReconcileRemoval,
  type ReconcileRepair,
  type ReconcileTable,
} from "./reconcile-field-group-plan";

/**
 * What a reconcile did, by IDENTITY. The lists are the operator's only window into a field whose
 * column vanished or whose type had to be guessed, so they name fields and columns rather than
 * counting them.
 */
export interface ReconcileFieldGroupResult {
  slug: string;
  /** Re-derived from which table holds the columns — see the planner. */
  localized: boolean;
  removed: ReconcileRemoval[];
  repaired: ReconcileRepair[];
  adopted: ReconcileAdoption[];
  /** True when the definition already described the tables and nothing was written. */
  unchanged: boolean;
  /** The version after the repair; unchanged repairs report the version they found. */
  schemaVersion: number;
}

/**
 * Ask the code that BUILDS these tables what type it gives a field in a given table.
 *
 * 🔴 Asked, never recovered from rendered SQL. Both builders already return the type as a value:
 * reading it back out of a printed CREATE TABLE re-derives an answer that was in hand, and does it
 * through a channel that cannot carry the whole answer — a type spelled with more than one word
 * (PostgreSQL's `DOUBLE PRECISION`) comes back truncated, and the resulting mismatch refuses a
 * group nothing is wrong with.
 *
 * The two tables have DIFFERENT builders, which is why this is keyed by table rather than resolved
 * once. `FieldGroupSchemaService` builds the main table; the localization renderer builds the
 * companion, and it spells the same field differently — a PostgreSQL `email` is `VARCHAR(255)` on
 * one and `TEXT` on the other. The planner supplies the table it OBSERVED the column in, so a
 * stored placement flag that is itself wrong cannot select the wrong builder.
 *
 * Returns `undefined` where neither builder claims the field, which the planner skips rather than
 * blocks: an underivable expectation is not evidence of drift.
 *
 * Async only to resolve the imports once; the function it returns is pure, which is what lets the
 * planner stay free of both.
 */
async function expectedColumnTypeResolver(
  dialect: SupportedDialect
): Promise<
  (field: FieldDefinition, table: ReconcileTable) => string | undefined
> {
  const { FieldGroupSchemaService } = await import(
    "./field-group-schema-service"
  );
  const { fieldToLocalizedColumnSpec } = await import(
    "../../i18n/migration/field-to-column-spec"
  );
  const { ddlType } = await import("../../i18n/migration/ddl-types");

  const creator = new FieldGroupSchemaService(dialect);

  return (field, table) => {
    if (table === "companion") {
      const spec = fieldToLocalizedColumnSpec(field, dialect, "fieldGroup");
      return spec ? ddlType(spec, dialect) : undefined;
    }
    // The parameter's own declared type. `FieldDefinition` and the config shape describe the same
    // stored field from two layers, and naming the target keeps the compiler checking this call.
    const type = creator.columnTypeFor(
      field as unknown as Parameters<
        InstanceType<typeof FieldGroupSchemaService>["columnTypeFor"]
      >[0]
    );
    return type ?? undefined;
  };
}

/**
 * Reconcile one field group's registry row against its live tables.
 *
 * Preconditions, in order and before anything is decided:
 * - the group must exist (`getComponent` raises NOT_FOUND itself);
 * - a LOCKED group is refused: its definition lives in a config file, so repairing the row would
 *   be overwritten by the next code sync — the file is what needs fixing, and this message is the
 *   only place that tells the operator so;
 * - the MAIN table must exist. A vanished table is not a definition drift: the honest repair for
 *   it is deleting the group, which is a different, destructive decision this operation must not
 *   make on the operator's behalf.
 */
export async function reconcileFieldGroup(args: {
  registry: FieldGroupRegistryService;
  adapter: DrizzleAdapter;
  logger: Logger;
  slug: string;
  /**
   * The code sync is asking, so a LOCKED group may be repaired.
   *
   * Never settable from the HTTP surface: the dispatcher does not pass it. It exists so the caller
   * that owns a code-managed definition can clear a marker that would otherwise leave the group
   * unreachable from both directions — a locked row marked `diverged` is refused by
   * `assertNotDiverged` on the sync path and by the lock check here.
   *
   * Wired: `syncCodeFirstComponents` passes it when it finds a `diverged` code-managed row, so
   * that state clears on the next sync rather than needing a hand-edited database.
   */
  fromCode?: boolean;
}): Promise<ReconcileFieldGroupResult> {
  const { registry, adapter, logger, slug } = args;

  const existing = await registry.getComponent(slug);

  // 🔴 A LOCKED group is code-managed, so its config file is the definition and a repaired row
  // would be overwritten by the next sync — but refusing outright makes the state TERMINAL, and it
  // is reachable: `updateFieldGroup` accepts `source: "code"`, so a code sync whose companion DDL
  // commits and whose row write fails marks a locked row `diverged`, after which
  // `assertNotDiverged` also blocks the very sync that would correct it. `fromCode` is the way out:
  // the sync itself asks for the repair, having the file's definition in hand. A human-initiated
  // reconcile is still refused, with the file named as the thing to fix.
  if (existing.locked && !args.fromCode) {
    throw NextlyError.conflict({
      reason: "state",
      message: `"${slug}" is managed via code, so its definition lives in a config file — repairing the database row here would be overwritten by the next code sync. Fix the definition in its config file and re-sync.`,
      logContext: { reason: "component-locked-for-reconcile", slug },
    });
  }

  const dialect = adapter.dialect;
  const companionName = `${existing.tableName}${STORAGE_FORMAT.companionSuffix}`;

  // One introspection for both tables. A table that does not exist contributes no rows to the
  // catalog query and is simply absent from the snapshot, which is how the companion's existence
  // is decided — the same absence that makes a missing MAIN table detectable below.
  const snapshot = await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [
    existing.tableName,
    companionName,
  ]);
  const liveMain = snapshot.tables.find(t => t.name === existing.tableName);
  const liveCompanion =
    snapshot.tables.find(t => t.name === companionName) ?? null;

  if (!liveMain) {
    throw NextlyError.conflict({
      reason: "state",
      message: `The table for "${slug}" does not exist, so there is no shape to reconcile the definition against. If the table was dropped deliberately, delete the field group instead of reconciling it.`,
      logContext: {
        reason: "reconcile-main-table-missing",
        slug,
        tableName: existing.tableName,
      },
    });
  }

  // 🔴 Probed BEFORE the write, mirroring the transition path's contract: the discriminator column
  // is a fact about the table the storage migration may have moved, and asking after the registry
  // write would leave a repair recorded while the runtime refresh below cannot describe the table.
  const { resolveComponentTypeColumn, registerComponentRuntimeSchema } =
    await import("./field-group-table-provisioning");
  const typeColumn = await resolveComponentTypeColumn(
    adapter,
    existing.tableName
  );

  const storedFields = existing.fields as unknown as FieldDefinition[];
  const plan = planFieldGroupReconcile<FieldDefinition>({
    storedFields,
    storedLocalized: existing.localized === true,
    dialect,
    tableName: existing.tableName,
    liveMain,
    liveCompanion,
    typeColumn,
    expectedColumnType: await expectedColumnTypeResolver(dialect),
  });

  // 🔴 REFUSE before writing anything when the tables hold a state the planner can see but must
  // not decide — a column on both tables, a column whose physical type no longer matches its
  // declared field, an identifier no field name can represent. Each has two readings and nothing
  // in the database says which the operator meant, so writing either one would produce a
  // definition describing neither and mark it `synced`. The blockers are named individually
  // because the operator's next action differs per kind.
  if (plan.blockers.length > 0) {
    throw NextlyError.conflict({
      reason: "state",
      message: `"${slug}" cannot be reconciled automatically: ${plan.blockers
        .map(b => b.detail)
        .join(" ")} Nothing was changed.`,
      logContext: {
        reason: "reconcile-ambiguous",
        slug,
        blockers: plan.blockers,
      },
    });
  }

  // The finished field set goes through the validator the OTHER registry writers use — the same one
  // `createComponent` and `updateComponent` run — because this writes the rows they write.
  //
  // Not the manifest validator: that one gates the `ui-schema.json` mirror and rejects declarations
  // the registry has always accepted, camelCase field names among them. Running it here would refuse
  // to repair any group whose definition came from code or the Direct API, which is precisely the
  // set that cannot repair itself by re-saving through the builder.
  const { assertValidPluginFieldOptions } = await import(
    "../../../api/fields-payload"
  );
  assertValidPluginFieldOptions(plan.fields);

  // A standing `diverged` mark is itself part of what this operation repairs: once the definition
  // describes the tables, leaving the mark would keep refusing schema edits on a group that is
  // now fine — the plan can be unchanged while the STATUS is still the thing that is wrong.
  const markerStandsWrongly = existing.migrationStatus === "diverged";

  if (plan.unchanged && !markerStandsWrongly) {
    // Nothing to write — and writing anyway would bump the version and invalidate every open
    // editor for a repair that repaired nothing.
    logger.info("[FieldGroups] Reconcile found nothing to repair", { slug });
    return {
      slug,
      localized: plan.localized,
      removed: [],
      repaired: [],
      adopted: [],
      unchanged: true,
      schemaVersion: existing.schemaVersion,
    };
  }

  // ONE conditional write carries the whole repair. The version pin is the correctness of the
  // operation: the plan was computed against the row as read above, and a row another writer moved
  // since then may already describe tables this plan has never seen — overwriting it would turn
  // the repair into the very divergence it exists to clear.
  const outcome = await registry.updateComponentIfVersion(
    slug,
    {
      fields: plan.fields as unknown as DynamicFieldGroupInsert["fields"],
      localized: plan.localized,
      // The definition now describes the tables, which is what this status means. Passed
      // explicitly: the registry defaults a fields-carrying write to "pending", the state for a
      // change that has not reached the database yet — the opposite of what just happened.
      migrationStatus: "synced",
      schemaHash: calculateSchemaHash(plan.fields as unknown as FieldConfig[]),
    },
    existing.schemaVersion
  );

  if (!outcome.matched) {
    throw NextlyError.conflict({
      // `state`, not `version`: the version message tells the caller to refresh and RETRY, and a
      // retry is right here — but only after re-reading, which re-running the operation does.
      reason: "state",
      message: `"${slug}" changed while it was being reconciled. Nothing was written. Run the reconcile again so it repairs against the current state.`,
      logContext: {
        reason: "reconcile-version-moved",
        slug,
        expectedSchemaVersion: existing.schemaVersion,
      },
    });
  }

  // Point the running process at the repaired shape. Registration DESCRIBES the tables — it moves
  // no storage — and the repair is durable whether or not this succeeds, so a failure here raises
  // to the caller as its own error rather than unwinding anything.
  registerComponentRuntimeSchema(
    adapter,
    dialect,
    existing.tableName,
    // The parameter's own declared type. `FieldDefinition` and `FieldConfig` describe the same
    // stored field from two layers, and the registry's insert shape is the seam between them —
    // naming the target type keeps the compiler checking this call rather than waving it through.
    plan.fields as unknown as FieldConfig[],
    typeColumn,
    plan.localized
  );

  logger.info("[FieldGroups] Reconciled definition against live tables", {
    slug,
    removed: plan.removed.map(r => r.fieldName),
    repaired: plan.repaired.map(r => `${r.fieldName}.${r.attribute}`),
    adopted: plan.adopted.map(a => a.fieldName),
    localized: plan.localized,
  });

  return {
    slug,
    localized: plan.localized,
    removed: plan.removed,
    repaired: plan.repaired,
    adopted: plan.adopted,
    unchanged: false,
    schemaVersion: outcome.newSchemaVersion,
  };
}
