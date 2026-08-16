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
import { normalizeType } from "../../schema/pipeline/diff/normalize-type";
import type { SupportedDialect } from "../../schema/services/field-column-descriptor";
import { calculateSchemaHash } from "../../schema/services/schema-hash";

import type { FieldGroupRegistryService } from "./field-group-registry-service";
import {
  planFieldGroupReconcile,
  type ReconcileAdoption,
  type ReconcileRemoval,
  type ReconcileRepair,
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
 * What THIS database's creator would write for each of a field group's columns, normalised.
 *
 * 🔴 Read out of the creator's own rendered DDL rather than from the column descriptor, because
 * the two disagree and the creator is the one that made the tables. `FieldGroupSchemaService`
 * carries its own dialect type table: measured live, a `date` becomes `DATETIME` on MySQL and an
 * `email` becomes `VARCHAR(255)` on PostgreSQL, where the descriptor answers `timestamp` and
 * `text`. Comparing a live column against the descriptor reported drift on healthy groups and
 * refused to repair them.
 *
 * The same extraction `assertNoUnappliableSchemaChange` uses, for the same reason — a column
 * definition is one INDENTED, QUOTED line, which no statement in the script is.
 *
 * A column this cannot parse is simply absent from the map, and the planner skips comparing it.
 * That direction is deliberate: an underivable expectation is not evidence of drift, and treating
 * it as such is what produced the false refusal in the first place.
 */
async function expectedColumnTypes(args: {
  dialect: SupportedDialect;
  tableName: string;
  fields: FieldDefinition[];
  localized: boolean;
}): Promise<ReadonlyMap<string, string>> {
  const out = new Map<string, string>();

  const { FieldGroupSchemaService } = await import(
    "./field-group-schema-service"
  );
  const sql = new FieldGroupSchemaService(args.dialect).generateMigrationSQL(
    args.tableName,
    args.fields as unknown as Parameters<
      InstanceType<typeof FieldGroupSchemaService>["generateMigrationSQL"]
    >[1],
    { localized: args.localized }
  );
  for (const line of sql.split("\n")) {
    // Name then type, from an indented quoted definition. The type runs to the first space that
    // begins a constraint keyword, so `VARCHAR(255) NOT NULL` yields `VARCHAR(255)`.
    const match =
      /^\s+["`]([A-Za-z0-9_]+)["`]\s+([A-Za-z0-9_]+(?:\([^)]*\))?)/.exec(line);
    if (!match) continue;
    const [, column, type] = match;
    const normalised = normalizeType(type);
    if (column !== undefined && normalised !== undefined) {
      out.set(column, normalised);
    }
  }

  // The companion's columns come from the localization renderer, which is what actually adds them.
  if (args.localized) {
    const { isFieldLocalized } = await import("../../i18n/classify-fields");
    const { fieldToLocalizedColumnSpec } = await import(
      "../../i18n/migration/field-to-column-spec"
    );
    const { ddlType } = await import("../../i18n/migration/ddl-types");
    for (const field of args.fields) {
      if (!isFieldLocalized(field, true)) continue;
      const spec = fieldToLocalizedColumnSpec(
        field,
        args.dialect,
        "fieldGroup"
      );
      if (!spec) continue;
      const normalised = normalizeType(ddlType(spec, args.dialect));
      if (normalised !== undefined) out.set(spec.name, normalised);
    }
  }

  return out;
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
    expectedColumnTypes: await expectedColumnTypes({
      dialect,
      tableName: existing.tableName,
      fields: storedFields,
      localized: existing.localized === true,
    }),
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

  // The finished field set goes through the SAME validator every other definition write uses, so
  // a repair cannot persist something the builder would later refuse. The planner already filters
  // unrepresentable column names; this is the boundary rather than a second opinion — it covers
  // whatever the shared contract gains next without this module being told.
  const { assertValidFieldsPayload } = await import(
    "../../../api/fields-payload"
  );
  assertValidFieldsPayload(plan.fields, { kind: "component" });

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
