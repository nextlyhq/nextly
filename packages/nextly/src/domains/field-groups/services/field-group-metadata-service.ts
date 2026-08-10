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

import { NextlyError } from "../../../errors";
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
   * The caller has already validated the input's shape.
   */
  async createFieldGroup(
    input: CreateFieldGroupInput
  ): Promise<CreateFieldGroupResult> {
    // 0. REFUSE what cannot be provisioned, before anything is executed.
    await this.assertIdentifiersFit(input);
    await this.assertTableUnowned(input);

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

    // 4. BIND the runtime schema, and only now.
    //
    // 🔴 The order here is what decides a race, so it is not arbitrary. Two creates whose slugs
    // normalise to one table can both pass the ownership check above, because a read cannot exclude
    // a write that has not happened yet. What separates them is the registry's own `table_name`
    // unique index: the second INSERT is rejected by the database.
    //
    // That only helps if nothing irreversible has happened first. Binding before the insert meant
    // the loser rebound the shared table to ITS field list and only then failed, leaving the winner
    // reading through a schema that does not describe it until the process restarts. Binding after
    // the insert means the loser never reaches this line.
    //
    // A lock spanning the check, the DDL and the insert would be stronger, and is what the migration
    // lock will provide once it exists. It cannot be built here: MySQL commits DDL implicitly, so no
    // transaction opened around this can cover the table change on all three dialects.
    if (migrationStatus === "applied") {
      await this.bindRuntimeSchema(input);
    }

    return { record, migrationStatus };
  }

  /**
   * Point the runtime at the table that was just created.
   *
   * Separated from the apply so it can run after the registry write rather than with the DDL. It
   * describes the table to the running process; the DDL only makes it exist.
   */
  private async bindRuntimeSchema(input: CreateFieldGroupInput): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) return;

    const { registerComponentRuntimeSchema } = await import(
      "./field-group-table-provisioning"
    );
    registerComponentRuntimeSchema(
      adapter,
      this.dialect,
      input.tableName,
      input.fields,
      // The constant, NOT a probe, and this is the one path where that inference is sound: this is
      // the CREATE path for a new slug, and the statements just executed are the DDL generator's
      // own, which write this column. A table the storage migration had moved would carry the
      // migrated prefix and could not be addressed by this name at all.
      STORAGE_FORMAT.columns.type,
      input.localized === true
    );
  }

  /**
   * Refuse a create whose generated names the database would not store intact.
   *
   * 🔴 Checked over the NAMES rather than over the slug, because the slug is not the only input.
   * A field's index is named `idx_<tableName>_<columnName>`, so the longest identifier depends on
   * the slug AND the longest indexed field name — and no bound on one can constrain the other. A
   * slug inside its limit paired with `authorId` still produces a 66-character index.
   *
   * Refused BEFORE any DDL because the failure is otherwise partial and silent-ish: the table and
   * the parent index are created, the field index fails, and the caller gets back a record whose
   * migration is recorded failed. Nothing is corrupted, but a field group exists that nothing can
   * query, and the request that made it reported a success shape.
   *
   * Here rather than in a transport for the same reason the ownership check is: the mounted route
   * bounded its slug and the other two transports did not, which is this service's founding defect
   * reappearing one level up.
   */
  private async assertIdentifiersFit(
    input: CreateFieldGroupInput
  ): Promise<void> {
    const { FieldGroupSchemaService, MAX_IDENTIFIER_LENGTH } = await import(
      "./field-group-schema-service"
    );

    const tooLong = new FieldGroupSchemaService(this.dialect)
      .generatedIdentifiers(input.tableName, input.fields, {
        localized: input.localized === true,
      })
      .filter(name => name.length > MAX_IDENTIFIER_LENGTH);

    if (tooLong.length === 0) return;

    throw NextlyError.validation({
      errors: tooLong.map(name => ({
        path: "slug",
        code: "IDENTIFIER_TOO_LONG",
        // The offending NAME, not just its length: the caller cannot otherwise tell which of the
        // slug and a field name to shorten.
        message: `Generated database identifier "${name}" is ${name.length} characters; the limit is ${MAX_IDENTIFIER_LENGTH}. Shorten the field group's slug or the field name it derives from.`,
      })),
    });
  }

  /**
   * Refuse a create whose table another field group already owns.
   *
   * Keyed on the TABLE NAME rather than the slug, because the two are not the same key: a slug is
   * normalised on its way to a table name, so `foo-bar` and `foo_bar` name one physical table while
   * looking like two free slugs.
   *
   * It has to run before the DDL rather than after. `CREATE TABLE IF NOT EXISTS` reports success
   * against a table that already exists, the runtime registration that follows then rebinds that
   * table to THIS request's fields, and only afterwards does the registry reject the duplicate — so
   * a refused create would leave the existing field group reading through a schema that does not
   * describe it, until the process restarts.
   *
   * Here rather than in a request handler because all three create transports need it and only one
   * of them had it. The same reason the DDL itself moved into this service.
   *
   * Two callers racing can still both pass this check; the registry table declares `table_name`
   * unique, so the second insert is rejected by the database rather than by this.
   */
  private async assertTableUnowned(
    input: CreateFieldGroupInput
  ): Promise<void> {
    const owner = (await this.registry.getAllComponents()).find(
      existing => existing.tableName === input.tableName
    );
    if (!owner) return;

    throw NextlyError.duplicate({
      logContext: {
        reason: "component-table-conflict",
        slug: input.slug,
        tableName: input.tableName,
        ownedBy: owner.slug,
      },
    });
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

    // The verification shares the statements' catch rather than following it. `tableExists`
    // re-raises the query failures it meets, and left outside this it would reject the whole apply
    // — breaking the one promise this method makes, that a schema change which fails is RECORDED
    // rather than raised. A transient failure there would take the registry write with it and leave
    // the table that was just created with nothing describing it.
    try {
      const { applyMigrationStatements } = await import(
        "../../schema/services/apply-migration-statements"
      );
      await applyMigrationStatements(adapter, migrationSQL);

      // Observed, not assumed. "Applied" has to mean the table is there.
      if (!(await adapter.tableExists(input.tableName))) {
        this.logger.error(
          `[FieldGroups] Table "${input.tableName}" was not created after migration`
        );
        return "failed";
      }
    } catch (error) {
      this.logger.error(
        `[FieldGroups] Migration execution failed for "${input.tableName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return "failed";
    }

    const { reconcileComponentCompanion } = await import(
      "./field-group-table-provisioning"
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
