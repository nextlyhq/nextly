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
import type { FieldGroupSchemaService } from "./field-group-schema-service";
import {
  planFieldGroupReconcile,
  type ExpectedColumnDefault,
  type ReconcileAdoption,
  type ReconcileBlocker,
  type ReconcilePlan,
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
  /**
   * Whether the RUNNING process was re-pointed at the repaired shape.
   *
   * Separate from the repair's own success because the two can genuinely differ: the row is written
   * durably before this is attempted, so `false` means the database is correct and this process is
   * not, which a restart fixes. Reported rather than folded into an error so an operator is never
   * told a landed repair failed, nor told a stale process is ready.
   */
  runtimeRefreshed: boolean;
  /** Why the refresh did not happen; present only when `runtimeRefreshed` is false. */
  runtimeRefreshReason?: string;
}

/**
 * What a reconcile WOULD do, computed without writing anything.
 *
 * The repair rewrites a definition in ways re-running cannot undo — a field whose column vanished
 * loses its authored label, validation and options, and an adopted column is recorded under a
 * logical type that was GUESSED from a physical one. An operator asked to approve that has to be
 * able to read it first, so the plan is offered before the write rather than reported after it.
 *
 * `blockers` is the reason this is a result rather than a thrown refusal. The repair throws on a
 * drift it must not decide, and a thrown error carries no structured payload to the browser — its
 * `logContext` is stripped from the response — so the only channel that can name each blocker
 * individually is a successful one.
 */
export interface ReconcileFieldGroupPreview {
  slug: string;
  /** Re-derived from which table holds the columns, exactly as the repair would derive it. */
  localized: boolean;
  removed: ReconcileRemoval[];
  repaired: ReconcileRepair[];
  adopted: ReconcileAdoption[];
  /** Non-empty means the repair would REFUSE. Nothing here is applicable until each is resolved. */
  blockers: ReconcileBlocker[];
  /**
   * True when the definition already describes the tables.
   *
   * This is NOT the same as "applying does nothing" — read `wouldWrite` for that. A group whose
   * every field matches can still carry a stale failure mark, and clearing that is a write.
   */
  unchanged: boolean;
  /** Whether applying would write at all, decided by the same expression the repair uses. */
  wouldWrite: boolean;
  /**
   * The stale status applying would clear, when one stands over healthy tables.
   *
   * Present so the surface can say WHY applying still does something on a group it just described
   * as unchanged, rather than showing an empty change list beside an enabled button.
   */
  staleStatus?: string;
  /**
   * The version this plan was computed against.
   *
   * Sent back on the apply so the operator cannot approve one plan and have another execute: the
   * repair refuses when the row has moved since. Without it the apply re-plans against whatever
   * the row says by then, which may be a different repair than the one that was shown.
   */
  schemaVersion: number;
}

/**
 * A stored field as the table builder's own parameter type.
 *
 * `FieldDefinition` and the config shape describe the same stored field from two layers; naming the
 * builder's declared parameter keeps the compiler checking these calls rather than waving them
 * through, and stating it once stops the two resolvers spelling the seam differently.
 */
function asCreatorField(
  field: FieldDefinition
): Parameters<FieldGroupSchemaService["columnTypeFor"]>[0] {
  return field as unknown as Parameters<
    FieldGroupSchemaService["columnTypeFor"]
  >[0];
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
    const type = creator.columnTypeFor(asCreatorField(field));
    return type ?? undefined;
  };
}

/**
 * The DEFAULT each builder would give a field, alongside the type resolver above.
 *
 * Split from it rather than folded in because the two answers have different shapes: a type is a
 * value or nothing, while a default has to distinguish "writes none" from "cannot say" — and the
 * companion is exactly the case that needs the distinction. Its columns are rendered by the
 * localization path, which this module does not model defaults for, so a companion-resident column
 * reports `known: false` and is skipped rather than being claimed to have no default. Claiming
 * that would turn every localized checkbox carrying a default into a refusal.
 */
/**
 * The DEFAULT each system column is created with, asked of the code that creates them.
 *
 * The desired-state skeleton records no default for any system column, so it cannot answer this —
 * and a comparison built on its silence would report drift on every healthy table. The creator is
 * the only side that knows, and it renders its own CREATE TABLE from this same map.
 */
async function structuralColumnDefaults(
  dialect: SupportedDialect
): Promise<ReadonlyMap<string, string>> {
  const { FieldGroupSchemaService } = await import(
    "./field-group-schema-service"
  );
  return new FieldGroupSchemaService(dialect).structuralColumnDefaults();
}

async function expectedColumnDefaultResolver(
  dialect: SupportedDialect
): Promise<
  (field: FieldDefinition, table: ReconcileTable) => ExpectedColumnDefault
> {
  const { FieldGroupSchemaService } = await import(
    "./field-group-schema-service"
  );
  const creator = new FieldGroupSchemaService(dialect);

  return (field, table) => {
    if (table === "companion") return { known: false };
    const value = creator.columnDefaultFor(asCreatorField(field));
    return value === null ? { known: true } : { known: true, value };
  };
}

/**
 * A status that MEANS unhealthy, so a reconcile that finds the tables fine still has work to do.
 *
 * `failed` counts alongside `diverged`, and it is the commoner way in: a create whose table landed
 * and whose verification query failed records `failed` over a table that may already match the
 * definition exactly. Listing the statuses that mean unhealthy, rather than testing for one of
 * them, is what keeps a status added later from silently becoming permanent.
 */
const UNHEALTHY_STATUSES = new Set(["diverged", "failed"]);

/** What the preview and the repair both need before either can decide anything. */
interface ReconcileAssessment {
  existing: Awaited<ReturnType<FieldGroupRegistryService["getComponent"]>>;
  plan: ReconcilePlan<FieldDefinition>;
  typeColumn: string;
  dialect: SupportedDialect;
  /** A standing failure mark over tables the plan found healthy — stale, and itself a repair. */
  markerStandsWrongly: boolean;
  /**
   * Whether applying would write at all.
   *
   * 🔴 Computed HERE so the preview and the repair cannot disagree about it. `plan.unchanged`
   * alone answers a narrower question — whether the DEFINITION describes the tables — and a group
   * whose definition matches while its status still reads `diverged` needs a write that
   * `plan.unchanged` does not predict. A preview deriving "nothing will happen" from the plan
   * would report exactly that, and then the apply would bump the version.
   */
  wouldWrite: boolean;
}

/** The inputs that decide a plan. The repair takes more; none of the extra changes the plan. */
interface ReconcileAssessmentArgs {
  registry: FieldGroupRegistryService;
  adapter: DrizzleAdapter;
  slug: string;
  fromCode?: boolean;
}

/**
 * Read the row and the tables, and plan the repair — without writing.
 *
 * 🔴 The preview and the repair share THIS function rather than each computing a plan of their
 * own. A preview's entire value is that it describes what the apply will do, and two
 * implementations of one question agree on the day they are written and drift silently afterwards.
 * Deriving both from one call makes a disagreement unrepresentable rather than merely unlikely.
 *
 * Preconditions, in order and before anything is decided:
 * - the group must exist (`getComponent` raises NOT_FOUND itself);
 * - a LOCKED group is refused: its definition lives in a config file, so repairing the row would
 *   be overwritten by the next code sync — the file is what needs fixing, and this message is the
 *   only place that tells the operator so;
 * - the MAIN table must exist. A vanished table is not a definition drift: the honest repair for
 *   it is deleting the group, which is a different, destructive decision this operation must not
 *   make on the operator's behalf.
 *
 * All three are refused for the PREVIEW too, deliberately. A preview that answered where the apply
 * would refuse would be inviting the operator to approve an operation that cannot run.
 */
async function assessFieldGroupReconcile(
  args: ReconcileAssessmentArgs
): Promise<ReconcileAssessment> {
  const { registry, adapter, slug } = args;

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
  const { resolveComponentTypeColumn } = await import(
    "./field-group-table-provisioning"
  );
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
    expectedColumnDefault: await expectedColumnDefaultResolver(dialect),
    structuralColumnDefaults: await structuralColumnDefaults(dialect),
  });

  const markerStandsWrongly = UNHEALTHY_STATUSES.has(
    existing.migrationStatus ?? ""
  );

  return {
    existing,
    plan,
    typeColumn,
    dialect,
    markerStandsWrongly,
    wouldWrite: !(plan.unchanged && !markerStandsWrongly),
  };
}

/**
 * What reconciling this field group WOULD do, without doing any of it.
 *
 * Reports blockers rather than throwing on them: a refusal thrown from the repair carries its
 * blockers in `logContext`, which never reaches the caller, so the operator is told only that
 * something is ambiguous. Here each one is named, and the caller can explain them individually.
 *
 * Writes nothing and registers nothing, so it is safe to run on any group at any time.
 */
export async function previewFieldGroupReconcile(
  args: ReconcileAssessmentArgs
): Promise<ReconcileFieldGroupPreview> {
  const { existing, plan, markerStandsWrongly, wouldWrite } =
    await assessFieldGroupReconcile(args);

  return {
    slug: args.slug,
    localized: plan.localized,
    removed: plan.removed,
    repaired: plan.repaired,
    adopted: plan.adopted,
    blockers: plan.blockers,
    unchanged: plan.unchanged,
    wouldWrite,
    ...(markerStandsWrongly && existing.migrationStatus
      ? { staleStatus: existing.migrationStatus }
      : {}),
    schemaVersion: existing.schemaVersion,
  };
}

/**
 * Reconcile one field group's registry row against its live tables.
 *
 * Preconditions are `assessFieldGroupReconcile`'s, which this shares with the preview.
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
  /**
   * The version a PREVIEW was computed against, when this apply is approving one.
   *
   * 🔴 Without it an approved plan and the executed plan are different questions. The operator
   * reads a preview describing two removals, the row moves, they confirm, and this function
   * re-plans against the newer row and may remove five — having been told about two. Supplying it
   * makes the repair refuse instead, so an approval can only ever apply to the state it was shown.
   *
   * Omitted by a caller with no preview to honour (the code sync), which keeps repairing against
   * whatever it reads.
   */
  expectedSchemaVersion?: number;
}): Promise<ReconcileFieldGroupResult> {
  const { registry, adapter, logger, slug } = args;

  const { existing, plan, typeColumn, dialect, wouldWrite } =
    await assessFieldGroupReconcile(args);

  // Imported here rather than in the assessment: only the repair points the running process at a
  // new shape. A preview that pulled this in would be loading the code that performs the change it
  // exists to avoid performing.
  const { registerComponentRuntimeSchema } = await import(
    "./field-group-table-provisioning"
  );

  // 🔴 Refused BEFORE the repair is described or attempted, so an operator approving a preview can
  // never apply a different plan than the one they read. The conditional write below would also
  // reject this, but only after the whole repair had been planned against a row the operator never
  // saw — and its message names a race rather than a stale approval.
  if (
    args.expectedSchemaVersion !== undefined &&
    args.expectedSchemaVersion !== existing.schemaVersion
  ) {
    throw NextlyError.conflict({
      reason: "state",
      message: `"${slug}" changed after the repair was previewed, so the preview no longer describes it. Nothing was written. Preview it again and review the new plan before applying.`,
      logContext: {
        reason: "reconcile-preview-stale",
        slug,
        expectedSchemaVersion: args.expectedSchemaVersion,
        actualSchemaVersion: existing.schemaVersion,
      },
    });
  }

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

  // A standing failure mark is itself part of what this operation repairs: once the definition
  // describes the tables, leaving the mark would keep refusing schema edits on a group that is
  // now fine — the plan can be unchanged while the STATUS is still the thing that is wrong. That
  // is why the decision is `wouldWrite` rather than `plan.unchanged`, and why it is computed in
  // the assessment: the preview reports the same value, so it can never promise a quiet apply.
  if (!wouldWrite) {
    // Nothing to WRITE — and writing anyway would bump the version and invalidate every open
    // editor for a repair that repaired nothing.
    //
    // 🔴 Registration still runs, and its real outcome is reported rather than assumed. "The row
    // matches the tables" says nothing about what THIS process is holding: an earlier apply whose
    // own registration failed leaves a stale resolver behind a perfectly healthy row, and that is
    // exactly the state an operator runs this operation to get out of. Claiming a refresh that was
    // never attempted made the one answer they act on the least trustworthy part of it.
    const unchangedRegistration = registerComponentRuntimeSchema(
      adapter,
      dialect,
      existing.tableName,
      plan.fields as unknown as FieldConfig[],
      typeColumn,
      plan.localized
    );
    logger.info("[FieldGroups] Reconcile found nothing to repair", {
      slug,
      runtimeRefreshed: unchangedRegistration.registered,
    });
    return {
      slug,
      localized: plan.localized,
      removed: [],
      repaired: [],
      adopted: [],
      unchanged: true,
      schemaVersion: existing.schemaVersion,
      runtimeRefreshed: unchangedRegistration.registered,
      ...(unchangedRegistration.reason !== undefined
        ? { runtimeRefreshReason: unchangedRegistration.reason }
        : {}),
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
    existing.schemaVersion,
    // 🔴 The caller's identity has to reach the WRITE, not stop at the precondition above. A
    // code-managed group is LOCKED, and the registry refuses a locked row to any writer that is not
    // the config file — first with a permission refusal, then with the lock clause in the
    // conditional predicate. `fromCode` means the code sync is asking, holding the file that IS the
    // definition, so it is the owner here exactly as it is for the lock check at the top of this
    // function. Omitting it left the recovery path reaching the database and being refused every
    // time, on the one route out of a locked row marked `diverged`.
    args.fromCode ? { source: "code" } : undefined
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
  // no storage — and the repair is durable whether or not this succeeds, so a failure here must
  // not unwind anything. It must also not be silent: this operation's whole promise is that the
  // group is usable again, and a process still holding the pre-repair columns will fail the very
  // reads the operator runs next. The outcome is reported so the answer can say which of the two
  // happened rather than implying the stronger one.
  const registration = registerComponentRuntimeSchema(
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
    runtimeRefreshed: registration.registered,
  });

  return {
    slug,
    localized: plan.localized,
    removed: plan.removed,
    repaired: plan.repaired,
    adopted: plan.adopted,
    unchanged: false,
    schemaVersion: outcome.newSchemaVersion,
    runtimeRefreshed: registration.registered,
    ...(registration.reason !== undefined
      ? { runtimeRefreshReason: registration.reason }
      : {}),
  };
}
