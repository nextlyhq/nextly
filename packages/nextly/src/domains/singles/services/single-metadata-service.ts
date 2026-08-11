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
 * **NOT atomic, and not yet recoverable.** MySQL commits DDL implicitly, so a table change and a
 * row write cannot be made atomic there by any ordering or any transaction. The migration engine
 * reached the same conclusion and says so in `field-groups/migration/steps.ts` — "sequenced with
 * repair rather than atomic, and every half idempotent to make that repair possible". Promising
 * atomicity would be a promise that silently does not hold on one of the three supported databases.
 *
 * ## The write order, and what it costs
 *
 * The DDL runs first and the registry row is written last, carrying the outcome the apply reached.
 * Two consequences follow, and both are real:
 *
 * - A crash between the DDL and the row leaves a table nothing has any record of, findable only by
 *   guessing at table names.
 * - A DDL that FAILS still writes its row, recording `failed`. That row owns the slug, and the
 *   create path refuses a slug that is already owned, so a failed create cannot be retried through
 *   the same path until the row is removed.
 *
 * Writing the intent first would trade the first cost for a worse one. A row persisted before the
 * table is touched owns the slug from that moment, and nothing here can yet finish or discard an
 * interrupted attempt, so a create killed mid-flight would block every retry rather than leaving a
 * table that at least harms nobody. The two halves have to arrive together: the ordering changes
 * when a recovery path exists to release what an interrupted attempt claimed.
 *
 * `SingleRegistryService.getPendingMigrations()` is the query such a path would use. It has no
 * callers, because nothing on this path ever leaves a row in `pending` except an app with no
 * adapter registered at all.
 *
 * 🔴 Everything that can REJECT a create runs before `createSingle` is called, so a rejected
 * request neither creates a table nor writes a row: field validation, the reserved-slug check, the
 * table-name conflict check and the global resource slug guard all belong to the caller.
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
    // 1. PLAN, before anything is persisted or executed. The generator is a validator as well as a
    // renderer, so a request it refuses leaves nothing behind at all — no row, no table — and the
    // corrected retry is a fresh create rather than a collision with its own wreckage.
    const plan = await this.planCreate(input);

    // 2. APPLY. Never throws; a failure is reported as a status so the row can still record it.
    const migrationStatus = await this.applyCreateDdl(input, plan);

    // 3. RECORD, with the outcome already known.
    //
    // 🔴 Deliberately last, which is where the request handler had it. Writing the intent FIRST
    // would be better — a crash between the two leaves a table nothing has any record of — but only
    // once something exists that can finish an interrupted attempt. Without that, the half-written
    // row owns the slug and refuses every retry, which is a worse state than the orphan it
    // prevents. That recovery half is the migration lock this relocation exists to unblock, and the
    // ordering changes with it rather than before it.
    const record = await this.registry.registerSingle({
      ...input,
      migrationStatus,
    });

    return { record, migrationStatus };
  }

  /**
   * Remove a Single: its storage first, then its registry row.
   *
   * The order is the opposite of the create's and for the same reason. A create writes the row last
   * so a failure cannot leave a row describing storage that was never made; a delete drops the
   * storage first so a failure cannot leave storage that no row describes. Both put the registry
   * write on the side where an interruption is visible rather than invisible.
   *
   * Failures propagate here rather than being recorded as a status. A single that cannot be fully
   * removed stays intact and retryable, which is a better state than one whose row is gone while its
   * tables survive: the row is what makes the tables findable.
   */
  async deleteSingle(
    slug: string,
    tableName: string | undefined
  ): Promise<void> {
    const adapter = this.adapter;
    if (tableName && adapter) {
      // Embedded field-group instances point back at this table by a plain string with no foreign
      // key, so the drop below cascades nothing and would strand them. Sweep first.
      const { teardownEntityComponentData } = await import(
        "../../field-groups/services/teardown-entity-field-group-data"
      );
      await teardownEntityComponentData({ adapter, parentTable: tableName });

      // Remove the companion `_locales` table and this single's archive rows before the main table.
      // The companion holds a foreign key to `<main>.id`, so it must go first or the main drop
      // orphans it on PostgreSQL and is rejected by the constraint on MySQL.
      const { teardownEntityI18n } = await import(
        "../../i18n/migration/teardown-entity-i18n"
      );
      await teardownEntityI18n({ adapter, slug, tableName, kind: "single" });

      // PostgreSQL needs CASCADE to drop dependent objects: the companion's foreign key makes the
      // main table a target, and a non-cascading drop raises rather than proceeding. The other two
      // dialects reject the keyword, so it is asked for only where it means something.
      //
      // The adapter renders this rather than a SQL string built here, because it already owns the
      // two things such a string has to get right on every dialect: quoting the identifier, and
      // turning a driver failure into the normalised database error the callers above expect.
      await adapter.dropTable(tableName, {
        ifExists: true,
        cascade: adapter.getCapabilities().dialect === "postgresql",
      });
    }

    // A row a concurrent delete already took is the state this method exists to reach, so it
    // completes rather than failing.
    //
    // The tolerance covers this one call and nothing above it. A teardown or a drop that fails has
    // to surface even when its message mentions something missing, because answering "deleted" to
    // it would leave the registry row present and the storage half removed — the exact state the
    // ordering above is arranged to prevent.
    try {
      await this.registry.deleteSingle(slug, { force: true });
    } catch (error) {
      if (!NextlyError.isNotFound(error)) throw error;
    }
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
