/**
 * Schema changes for a Field Group, owned in one place with the registry write they belong to.
 *
 * ## Why this exists
 *
 * A field group can be created through three transports, and only one of them made the table. The
 * dispatcher generated the DDL, ran it and wrote the registry row; `api/field-groups.ts` POST and
 * the Direct API wrote the row and returned success. The registry then described a `comp_<slug>`
 * table that did not exist, and every read and write to that field group failed against the
 * database. The reason was structural rather than careless: the code that provisions the table was
 * private to the dispatcher, so nothing else could reach it.
 *
 * One service owns both halves, and every transport goes through it.
 *
 * ## What it guarantees, and what it does not
 *
 * **NOT atomic.** MySQL commits DDL implicitly, so a table change and a row write cannot be made
 * atomic there by any ordering or any transaction. The migration engine reached the same conclusion
 * and says so in `field-groups/migration/steps.ts`. Promising atomicity would be a promise that
 * silently does not hold on one of the three supported databases.
 *
 * The DDL runs first and the row is written last, carrying the outcome the apply reached. A crash
 * between the two leaves a table nothing has a record of, and a DDL that FAILS still writes its row
 * recording `failed`. Writing the intent first would trade the first cost for a worse one: a row
 * persisted before the table is touched owns the slug from that moment, and nothing here can yet
 * finish or discard an interrupted attempt, so a create killed mid-flight would block every retry.
 * The ordering changes when a recovery path exists to release what an interrupted attempt claimed.
 *
 * 🔴 Everything that can REJECT a create runs before `createFieldGroup` is called, so a rejected
 * request neither creates a table nor writes a row.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type {
  DynamicFieldGroupInsert,
  DynamicFieldGroupRecord,
} from "../../../schemas/dynamic-field-groups/types";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { Logger } from "../../../shared/types";

import type { FieldGroupRegistryService } from "./field-group-registry-service";

/**
 * 🔴 The schema service and the table provisioning are loaded on demand, NOT at the top of this
 * file.
 *
 * This service is registered in the DI container, and the registration module is imported during
 * boot by anything that touches the container. A static import here would pull the whole schema and
 * i18n machinery into that graph for every consumer, including every process that never creates a
 * field group. `di/register.ts` avoids exactly this with its `await import()` calls covering these
 * same modules, and a static import from a registration module quietly undoes that work.
 */

/** How far a schema change got. The registry stores this and the admin reads it back. */
export type FieldGroupMigrationStatus = "pending" | "applied" | "failed";

/**
 * The registry row to create, minus the one field this service owns.
 *
 * Deliberately the registry's own insert type rather than a hand-listed subset: a bespoke input
 * shape silently drops whatever it forgets, and that is not hypothetical — the singles equivalent
 * listed its fields by hand and lost three of them, which nothing in the types or the tests caught.
 */
export type CreateFieldGroupInput = Omit<
  DynamicFieldGroupInsert,
  "migrationStatus"
>;

export interface CreateFieldGroupResult {
  record: DynamicFieldGroupRecord;
  migrationStatus: FieldGroupMigrationStatus;
}

export class FieldGroupMetadataService {
  constructor(
    private readonly registry: FieldGroupRegistryService,
    private readonly logger: Logger,
    /**
     * Optional on purpose, and it changes what this service does rather than whether it works.
     *
     * With no adapter registered the statements are generated and never run, which is the behaviour
     * the request handler had before this service existed. Demanding a connection here would turn a
     * configuration this product supports into a crash.
     */
    private readonly adapter?: DrizzleAdapter
  ) {}

  /**
   * The dialect the DDL is generated for.
   *
   * Read from the adapter that will RUN the statements, never from a default. `DB_DIALECT` is
   * optional and falls back to `postgresql`, so an app configured with only a MySQL or SQLite URL
   * would otherwise have its table created as PostgreSQL.
   */
  private get dialect(): "postgresql" | "mysql" | "sqlite" {
    return this.adapter?.getCapabilities().dialect ?? "postgresql";
  }

  /**
   * Create a field group's table and its registry row.
   *
   * The caller has already validated the input and established that no other field group owns this
   * table name.
   */
  async createFieldGroup(
    input: CreateFieldGroupInput
  ): Promise<CreateFieldGroupResult> {
    // 1. PLAN, before anything is persisted or executed. The generator validates as well as
    // renders, so a request it refuses leaves nothing behind at all.
    const migrationSQL = await this.planCreate(input);

    // 2. APPLY. Never throws; a failure is reported as a status so the row can still record it.
    const migrationStatus = await this.applyCreateDdl(input, migrationSQL);

    // 3. RECORD, with the outcome already known.
    const record = await this.registry.registerComponent({
      ...input,
      migrationStatus,
    });

    return { record, migrationStatus };
  }

  /** Render the DDL. Separated from the apply because this half is allowed to reject the request. */
  private async planCreate(input: CreateFieldGroupInput): Promise<string> {
    const { FieldGroupSchemaService } = await import(
      "../../../services/field-groups/field-group-schema-service"
    );
    return new FieldGroupSchemaService(this.dialect).generateMigrationSQL(
      input.tableName,
      input.fields,
      // i18n: translatable columns are omitted from the main comp_ table when localized; they live
      // in the companion `comp_<slug>_locales`, provisioned below.
      { localized: input.localized === true }
    );
  }

  /**
   * Run the create DDL, reporting how far it got.
   *
   * Never throws: a schema change that fails is recorded rather than raised, so the caller still has
   * a row describing what was attempted. That is what makes the state repairable instead of lost.
   */
  private async applyCreateDdl(
    input: CreateFieldGroupInput,
    migrationSQL: string
  ): Promise<FieldGroupMigrationStatus> {
    const adapter = this.adapter;
    if (!adapter) {
      this.logger.warn(
        "[FieldGroups] No adapter registered, migration not executed"
      );
      return "pending";
    }

    const isLocalized = input.localized === true;
    const fields = input.fields as unknown as FieldDefinition[];

    try {
      const { applyMigrationStatements } = await import(
        "../../schema/services/apply-migration-statements"
      );
      await applyMigrationStatements(adapter, migrationSQL);
    } catch (error) {
      this.logger.error(
        `[FieldGroups] Migration execution failed for "${input.tableName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return "failed";
    }

    // Observed, not assumed. "Applied" has to mean the table is there.
    if (!(await adapter.tableExists(input.tableName))) {
      this.logger.error(
        `[FieldGroups] Table "${input.tableName}" was not created after migration`
      );
      return "failed";
    }

    const { reconcileComponentCompanion, registerComponentRuntimeSchema } =
      await import("./field-group-table-provisioning");

    registerComponentRuntimeSchema(
      adapter,
      this.dialect,
      input.tableName,
      input.fields,
      // The constant, NOT a probe, and this is the one path where that inference is sound: this is
      // the CREATE path for a new slug, and the statements just executed are the DDL generator's
      // own, which write this column. A table the storage migration had moved would carry the
      // migrated prefix and could not be addressed by this name at all. Probing here can only hurt,
      // because a transient introspection failure would record the row as failed and still return
      // success, leaving a created table with no runtime schema until a restart.
      STORAGE_FORMAT.columns.type,
      isLocalized
    );

    // The companion is the other half of a localized field group's storage, so failing to provision
    // it leaves translatable values with nowhere to live. Reported as a failed migration rather than
    // thrown: the main table exists and the row describes it, which is what makes a retry possible.
    try {
      await reconcileComponentCompanion({
        slug: input.slug,
        tableName: input.tableName,
        oldFields: [],
        newFields: fields,
        localized: isLocalized,
        // A brand-new field group was never localized, so a localized create is a create-only
        // companion rather than an enable transition.
        wasLocalized: false,
        adapter,
      });
    } catch (error) {
      this.logger.error(
        `[FieldGroups] Companion provisioning failed for "${input.tableName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return "failed";
    }

    return "applied";
  }
}
