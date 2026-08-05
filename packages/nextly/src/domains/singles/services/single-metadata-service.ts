/**
 * Schema changes for a Single, owned in one place with the registry write they belong to.
 *
 * ## Why this exists
 *
 * A Single's table used to be created by the request handler: the handler generated the DDL, ran
 * it, and then wrote the registry row. That split is why a lock cannot cover the pair — a lock
 * taken inside the registry service is acquired after the tables have already changed. Collections
 * already avoid this by owning both halves in one method; this is the same shape for Singles.
 *
 * ## What it guarantees, and what it does not
 *
 * **Recoverable and idempotent. NOT atomic.** That is not a compromise, it is the only honest
 * claim: MySQL commits DDL implicitly, so a table change and a row write cannot be made atomic
 * there by any ordering or any transaction. The migration engine reached the same conclusion and
 * says so in `field-groups/migration/steps.ts` — "sequenced with repair rather than atomic, and
 * every half idempotent to make that repair possible". Promising atomicity would be a promise that
 * silently does not hold on one of the three supported databases.
 *
 * So the guarantee is: whatever happens, the database is left in a state that can be described and
 * finished.
 *
 * ## How that is achieved: the intent is written first
 *
 * The row is persisted as `pending` BEFORE the table is touched, and confirmed afterwards. The
 * order matters more than it looks:
 *
 * - Written last (the previous behaviour) a crash between the DDL and the row leaves a table that
 *   nothing has any record of — an orphan findable only by guessing at table names.
 * - Written first, every interrupted operation leaves a durable row saying what was being
 *   attempted, and recovery is a query rather than an inference.
 *
 * That query already exists: `SingleRegistryService.getPendingMigrations()`. It had no callers
 * before this service, because nothing ever left a row in `pending`.
 *
 * The ordering also moves the registry's own rejections (a taken slug, a name reserved by a global
 * resource) to BEFORE the DDL rather than after it. Those checks used to run once the table had
 * already been created.
 *
 * 🔴 Everything else that can REJECT a create has to run before `createSingle` is called, or a
 * rejected request strands a `pending` row. Field validation, the reserved-slug check and the
 * table-name conflict check all belong to the caller and all happen first.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type {
  DynamicSingleInsert,
  DynamicSingleRecord,
  SingleMigrationStatus,
} from "../../../schemas/dynamic-singles/types";
import type { Logger } from "../../../shared/types";
import { applyMigrationStatements } from "../../schema/services/apply-migration-statements";

import type { SingleRegistryService } from "./single-registry-service";

/**
 * 🔴 The schema generators, the runtime-schema builder and the companion reconcile are loaded on
 * demand, NOT at the top of this file.
 *
 * This service is registered in the DI container, and the registration module is imported during
 * boot by anything that touches the container. A static import here would pull the whole schema and
 * i18n machinery into that graph for every consumer, including every process that never creates a
 * Single. `di/register.ts` avoids exactly this with 37 `await import()` calls covering these same
 * three modules, and a static import from a registration module quietly undoes that work — measured
 * at +41% on the package's own test suite, enough to push its slowest files past their timeout.
 *
 * The cost of loading them here is paid once, on a path that is already writing DDL to a database.
 */

/**
 * The registry row to create, minus the one field this service owns.
 *
 * Deliberately the registry's own insert type rather than a hand-listed subset: a bespoke input
 * shape silently drops whatever it forgets, and the fields most easily forgotten here (version
 * retention, revalidation, webhook recording) are the ones whose absence is invisible until a
 * user notices a switch reading as off.
 */
export type CreateSingleInput = Omit<DynamicSingleInsert, "migrationStatus">;

/** What the caller gets back: the row, and how far the schema change actually got. */
export interface CreateSingleResult {
  record: DynamicSingleRecord;
  migrationStatus: SingleMigrationStatus;
}

/**
 * The rendered DDL plus what the table must look like once it has run.
 *
 * Produced before anything is persisted, so the generator's own validation rejects a bad request
 * while there is still nothing to clean up.
 */
interface CreateDdlPlan {
  migrationSQL: string;
  fields: FieldDefinition[];
  isLocalized: boolean;
  hasStatus: boolean;
}

/**
 * The resolver the adapter uses to answer table lookups.
 *
 * Registering a freshly created table with it is what lets the very next read resolve without a
 * server restart. Declared structurally because the adapter holds it as a protected member; this
 * names the one method used rather than reaching in untyped.
 */
interface DynamicSchemaResolver {
  registerDynamicSchema?: (name: string, table: unknown) => void;
}

export class SingleMetadataService {
  constructor(
    private readonly registry: SingleRegistryService,
    private readonly logger: Logger,
    /**
     * Optional on purpose, and it changes what this service does rather than whether it works.
     *
     * With no adapter registered the statements are generated and never run — the behaviour the
     * request handler had before this service existed. Demanding a connection here would turn a
     * configuration this product supports into a crash.
     */
    private readonly adapter?: DrizzleAdapter
  ) {}

  /**
   * The dialect the DDL is generated for.
   *
   * Read from the adapter that will RUN the statements, never from the schema service's own
   * default. `DB_DIALECT` is optional and falls back to `postgresql`, so an app configured with
   * only a MySQL or SQLite URL would otherwise have its table created as PostgreSQL.
   */
  private get dialect(): "postgresql" | "mysql" | "sqlite" | undefined {
    return this.adapter?.getCapabilities().dialect;
  }

  /**
   * Create a Single's table and its registry row.
   *
   * The caller has already validated the input and established that no other Single owns this
   * table name. Rejecting after this point would leave a `pending` row behind.
   */
  async createSingle(input: CreateSingleInput): Promise<CreateSingleResult> {
    // 0. PLAN, and deliberately BEFORE the intent write.
    //
    // 🔴 The generator is a validator as well as a renderer: a required relationship declaring
    // `onDelete: "set null"` is refused there, because no database can null a reference the column
    // forbids. Generating after the row was written would let that rejection strand a `pending`
    // Single with its permissions seeded, and the corrected retry would then collide with the slug
    // it had just created. Nothing is persisted until this has succeeded.
    const plan = await this.planCreate(input);

    // 1. INTENT. Durable before anything is touched, so an interruption from here on leaves a row
    // that `getPendingMigrations()` can find and finish.
    //
    // 🔴 Which is only worth writing if something can finish it. An unfinished attempt owns the
    // slug, so without this the write-ahead row is not a recovery aid but a permanent blocker: the
    // retry is refused as a duplicate and the user has no way forward short of editing the registry
    // by hand. That would be strictly worse than the orphan table intent-first exists to prevent —
    // an orphan at least left the slug free.
    const record = await this.adoptOrRegister(input);

    // 2. APPLY. Idempotent, so it can run over whatever the interrupted attempt managed to create.
    const migrationStatus = await this.applyCreateDdl(input, plan);

    // 3. CONFIRM. Recorded against the row written in step 1.
    await this.registry.updateMigrationStatus(input.slug, migrationStatus);

    // The row as it now stands. `migrationStatus` is the only field of it a caller reads that the
    // confirm write changed, so it is carried over rather than re-fetched; returning the step-1
    // copy unchanged would report every applied create as still pending.
    return { record: { ...record, migrationStatus }, migrationStatus };
  }

  /**
   * Write the intent, taking over an unfinished attempt at the same Single rather than colliding
   * with it.
   *
   * A row that is not `applied` describes an operation that never reported success, so a create
   * naming the same slug is a retry of it. The row is re-stated from THIS request — a corrected
   * retry usually differs from the attempt that failed, and confirming the old field set while
   * applying the new DDL would leave the registry describing a table nobody asked for.
   *
   * An `applied` Single is left alone: that is a genuine duplicate and belongs to whoever holds it.
   */
  private async adoptOrRegister(
    input: CreateSingleInput
  ): Promise<DynamicSingleRecord> {
    const existing = await this.registry.getSingleBySlug(input.slug);
    if (!existing || existing.migrationStatus === "applied") {
      return this.registry.registerSingle({
        ...input,
        migrationStatus: "pending",
      });
    }

    // 🔴 Only `failed` is adopted, and only by CLAIMING it, which are two separate points.
    //
    // WHICH state: `failed` is a FINISHED attempt — it recorded its own outcome, so nothing is
    // still running against this slug. `pending` cannot say that; it is equally the state of a
    // create in flight right now, and taking that over would overwrite its row with a second
    // payload while its DDL is still building the first schema.
    //
    // HOW: reading `failed` and then writing is not enough. Two retries can both read it before
    // either writes, and both would then run DDL against one slug. The claim puts the status in the
    // WHERE clause so the database picks the winner — and it cannot go through `updateSingle`,
    // which writes `migration_status` only when the field hash or status flag changes and so would
    // leave the commonest retry of all, the same payload again, looking unclaimed for the whole
    // time its DDL was running.
    //
    // Serialising `pending` as well is the migration lock this relocation exists to unblock. This
    // claim is not a substitute for it; it is the narrower guarantee available without one.
    if (existing.migrationStatus !== "failed") {
      throw NextlyError.conflict({
        logContext: {
          reason: "single-create-in-flight",
          slug: input.slug,
          migrationStatus: existing.migrationStatus,
          hint: "A create for this slug has not recorded an outcome yet. Retry once it has.",
        },
      });
    }

    if (!(await this.registry.claimFailedForRetry(input.slug))) {
      throw NextlyError.conflict({
        logContext: {
          reason: "single-create-claimed-elsewhere",
          slug: input.slug,
          hint: "Another retry took over this failed create first.",
        },
      });
    }

    this.logger.info(`[Singles] Resuming a failed create for "${input.slug}"`);
    return this.registry.updateSingle(input.slug, {
      ...input,
      migrationStatus: "pending",
    });
  }

  /**
   * Render the DDL and work out what the table must look like once it has run.
   *
   * Separated from the apply because the two have opposite contracts: this one is allowed to
   * REJECT the request and must do so before anything is persisted, while the apply must never
   * throw so a failure is still recorded against a row.
   */
  private async planCreate(input: CreateSingleInput): Promise<CreateDdlPlan> {
    const isLocalized = input.localized === true;
    const hasStatus = input.status === true;
    const fields = input.fields as unknown as FieldDefinition[];
    const { DynamicCollectionSchemaService } = await import(
      "../../dynamic-collections/services/dynamic-collection-schema-service"
    );
    const schemaService = new DynamicCollectionSchemaService(
      undefined,
      this.dialect
    );

    const migrationSQL = schemaService.generateMigrationSQL(
      input.tableName,
      fields,
      // i18n: translatable columns are omitted from the main table when localized — they live in
      // the companion `<table>_locales`, provisioned separately. `isSingle` skips the slug column
      // and adds `updated_at`; `hasStatus` adds the column the runtime schema expects when the user
      // opted into Draft/Published.
      { isSingle: true, hasStatus, localized: isLocalized }
    );

    return { migrationSQL, fields, isLocalized, hasStatus };
  }

  /**
   * Run the create DDL, reporting how far it got.
   *
   * Never throws: a schema change that fails is recorded rather than raised, so the caller still
   * has a row describing what was attempted. That is the same choice the request handler made
   * before this service existed, and it is what makes the state repairable instead of lost.
   */
  private async applyCreateDdl(
    input: CreateSingleInput,
    plan: CreateDdlPlan
  ): Promise<SingleMigrationStatus> {
    const { migrationSQL, fields, isLocalized, hasStatus } = plan;
    const adapter = this.adapter;
    if (!adapter) {
      this.logger.warn(
        "[Singles] No adapter registered, migration not executed"
      );
      return "pending";
    }

    try {
      // The shared runner, not a private copy: it owns both the splitting rule and the tolerance
      // that makes re-running over half-applied schema the repair case rather than a dead end.
      await applyMigrationStatements(adapter, migrationSQL);
    } catch (error) {
      this.logger.error(
        `[Singles] Migration execution failed for "${input.tableName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return "failed";
    }

    // Observed, not assumed. "Applied" has to mean the table is there.
    if (!(await adapter.tableExists(input.tableName))) {
      this.logger.error(
        `[Singles] Table "${input.tableName}" was not created after migration`
      );
      return "failed";
    }

    await this.registerRuntimeSchema(
      input,
      fields,
      adapter,
      hasStatus,
      isLocalized
    );

    // The companion is the other half of a localized single's storage, so failing to provision it
    // leaves translatable values with nowhere to live. Reported as a failed migration rather than
    // thrown: the main table exists and the row describes it, which is what makes a retry possible.
    try {
      const { reconcileSingleCompanion } = await import(
        "./reconcile-single-companion"
      );
      await reconcileSingleCompanion({
        slug: input.slug,
        tableName: input.tableName,
        oldFields: [],
        newFields: fields,
        localized: isLocalized,
        // A brand-new single was never localized before, so a localized create is a create-only
        // companion (no seed/drop) rather than an enable transition.
        wasLocalized: false,
        // A single being created has no prior state at all.
        wasStatus: false,
        status: hasStatus,
        adapter,
      });
    } catch (error) {
      this.logger.error(
        `[Singles] Companion provisioning failed for "${input.tableName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return "failed";
    }

    return "applied";
  }

  /**
   * Bind the new table to the running server so the next read resolves it.
   *
   * Best-effort by design: the registry is rebuilt from the database on the next boot, so a
   * failure here costs a restart rather than the table. Taken from the adapter that ran the DDL
   * rather than from the container, because that adapter is the one whose reads have to resolve
   * the name and a caller may hold one the container has never seen.
   */
  private async registerRuntimeSchema(
    input: CreateSingleInput,
    fields: FieldDefinition[],
    adapter: DrizzleAdapter,
    hasStatus: boolean,
    isLocalized: boolean
  ): Promise<void> {
    try {
      const { generateRuntimeSchema } = await import(
        "../../schema/services/runtime-schema-generator"
      );
      const { table } = generateRuntimeSchema(
        input.tableName,
        fields,
        adapter.getCapabilities().dialect,
        // i18n: the main runtime table omits translatable columns for a localized single, matching
        // the DDL above.
        { status: hasStatus, localized: isLocalized }
      );
      const resolver = (
        adapter as unknown as { tableResolver?: DynamicSchemaResolver }
      ).tableResolver;
      if (resolver && typeof resolver.registerDynamicSchema === "function") {
        resolver.registerDynamicSchema(input.tableName, table);
      }
    } catch (error) {
      this.logger.warn(
        `[Singles] Runtime schema registration failed for "${input.tableName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
