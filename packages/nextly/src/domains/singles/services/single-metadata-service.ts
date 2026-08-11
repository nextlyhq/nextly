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
  /**
   * Forget the table, so the next lookup rebuilds it.
   *
   * Optional because a caller may hold a resolver older than the method. Where it is absent the
   * failure path leaves the previous registration alone, which is what this code did before.
   */
  retractDynamicSchema?: (name: string) => void;
}

/**
 * A schema change to an existing Single, with everything the caller has already decided.
 *
 * The caller owns every rejection: the locked-single check, the field-payload validation, the
 * retention-without-toggle rejection and the localization-config gate all run before this is
 * built. What arrives here is a change that is allowed to proceed.
 *
 * The two flag pairs are passed rather than derived because only the caller can tell them apart.
 * `hasStatus`/`isLocalized` are what the single is being saved AS, `wasStatus`/`wasLocalized` what
 * it currently IS, and an undefined toggle in the request body means "leave alone" — which reads
 * as the previous value, not as `false`.
 */
export interface UpdateSingleSchemaInput {
  slug: string;
  existing: DynamicSingleRecord;
  /**
   * The registry columns to write, minus `migrationStatus`, which this service owns.
   *
   * Passed through rather than rebuilt: the caller has already normalised the version-retention,
   * revalidation and webhook toggles into the resolved configs the runtime readers test, and
   * re-deriving them here would be a second implementation of that normalisation.
   */
  updateData: Record<string, unknown>;
  /** The new field list, or undefined when the save changes only flags. */
  fields?: FieldDefinition[];
  isLocalized: boolean;
  wasLocalized: boolean;
  hasStatus: boolean;
  wasStatus: boolean;
  /**
   * Whether the request SET the Draft/Published toggle, as opposed to leaving it alone.
   *
   * Not derivable from `hasStatus !== wasStatus`: saving the toggle at the value it already holds
   * is a request that reaches the companion, because provisioning is idempotent and a single whose
   * companion `_status` never got created is repaired by exactly that save. Collapsing the two
   * would turn the repair into a no-op.
   */
  statusRequested: boolean;
}

/** The updated row, and the status the caller reports back to the user. */
export interface UpdateSingleSchemaResult {
  record: DynamicSingleRecord;
  migrationStatus: SingleMigrationStatus;
}

/**
 * The schema work an update has to do, decided before any statement runs.
 *
 * One plan covers both shapes of update. A field change renders statements; a save that only flips
 * Internationalization or Draft/Published renders none but still has companion work, and modelling
 * that as an empty statement list rather than as a second execution path is what keeps the two
 * from drifting: they share one apply, one status vocabulary and one failure contract.
 */
interface UpdateDdlPlan {
  /** Statements to run. Empty for a save that changes only flags. */
  migrationSQL: string;
  /** The field list the table holds once this plan has run. */
  fields: FieldDefinition[];
  /** The field list the table holds now. The companion reconcile diffs against it. */
  previousFields: FieldDefinition[];
  /**
   * Whether the statements describe the WHOLE table rather than a change to it.
   *
   * Only a plan that rebuilds the table from the desired spec re-establishes every artifact it
   * needs — the columns, the indexes, the junction tables. An ALTER describes a delta and says
   * nothing about anything it does not mention, which is why it cannot vouch for a table whose
   * create failed part way.
   */
  describesWholeTable: boolean;
  /**
   * Whether this plan owns `migration_status`.
   *
   * A field change does: the column records how far the schema change got, and an app with no
   * adapter registered leaves it `pending` for the migration runner to pick up later. A flag-only
   * save does not — with no adapter there is nothing to provision and nothing was asked of the
   * main table's schema, so the previous status is left exactly as it was rather than being
   * overwritten with a verdict about a migration that was never requested.
   */
  ownsMigrationStatus: boolean;
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
   * Apply a schema change to an existing Single and write the registry row that describes it.
   *
   * The same three phases as `createSingle`, and for the same reason: a lock has to cover the
   * table change and the row write together, and it can only do that where both halves live.
   *
   * 🔴 The phase boundary is what decides whether a failure is raised or recorded, and it replaces
   * a `migrationBegan` flag the request handler carried. Everything that can reject — reading the
   * live table, asking the generator for statements — happens in the PLAN, where the schema is
   * still exactly as it was and the caller's field list has not been saved. Once APPLY starts, a
   * statement may already have run, so a failure is a partly-applied migration that must be
   * recorded rather than a request that never began.
   */
  async updateSingleSchema(
    input: UpdateSingleSchemaInput
  ): Promise<UpdateSingleSchemaResult> {
    // 1. PLAN. May reject; nothing is persisted and no statement has run.
    const plan = await this.planUpdate(input);

    // The status the response reports. A save with no schema work at all keeps whatever the last
    // migration reached, because this request neither confirmed nor changed it.
    let migrationStatus = input.existing.migrationStatus;
    const updateData = { ...input.updateData };

    if (plan) {
      // 2. APPLY. Returns a status rather than throwing, except for a refusal (see below).
      const applied = await this.applyUpdateDdl(input, plan);
      if (applied !== undefined) {
        updateData.migrationStatus = applied;
        migrationStatus = applied;
      }
    }

    // 3. RECORD, with the outcome already known.
    const record = await this.registry.updateSingle(input.slug, updateData, {
      source: "ui",
    });

    return { record, migrationStatus };
  }

  /**
   * Work out what the schema change has to do, reading the live table but changing nothing.
   *
   * Returns null when the save asks nothing of the schema: no field change, no Internationalization
   * transition, and no Draft/Published save on a single that has a companion to keep in step.
   *
   * Allowed to throw, and that is the point. The generator is a validator as well as a renderer —
   * it refuses a required column with no value for the rows already there, or a referenced column
   * SQLite cannot detach — and refusing here, before the apply, is what leaves the table untouched
   * and the caller's field list unsaved.
   */
  private async planUpdate(
    input: UpdateSingleSchemaInput
  ): Promise<UpdateDdlPlan | null> {
    const {
      existing,
      fields,
      isLocalized,
      wasLocalized,
      hasStatus,
      wasStatus,
      statusRequested,
    } = input;
    const previousFields = (existing.fields ??
      []) as unknown as FieldDefinition[];

    if (fields === undefined) {
      // A save with no field change still has companion work when the single is crossing the
      // Internationalization boundary, or when Draft/Published is saved on a single that is
      // localized in either state — that toggle ADDs or DROPs the companion's own `_status`.
      // Without this the flag persisted while the physical schema stayed as it was, stranding
      // data in the table the new flag says it does not live in.
      const needsCompanionWork =
        isLocalized !== wasLocalized ||
        (statusRequested && (isLocalized || wasLocalized));
      if (!needsCompanionWork) return null;
      return {
        migrationSQL: "",
        fields: previousFields,
        previousFields,
        describesWholeTable: false,
        ownsMigrationStatus: false,
      };
    }

    const adapter = this.adapter;
    const tableName = existing.tableName;
    const { DynamicCollectionSchemaService } = await import(
      "../../dynamic-collections/services/dynamic-collection-schema-service"
    );
    const schemaService = new DynamicCollectionSchemaService(
      undefined,
      this.dialect
    );

    // With no adapter there is no live table to read and no statement to run. The row still
    // records `pending`, which is what the migration runner looks for.
    if (!adapter) {
      return {
        migrationSQL: "",
        fields,
        previousFields,
        describesWholeTable: false,
        ownsMigrationStatus: true,
      };
    }

    // Create or alter is decided HERE, not in the apply, because it is a question about the
    // database's current state and the apply is past the point where questions are safe to ask.
    // A table missing because an earlier create failed is rebuilt rather than altered into
    // nothing.
    if (!(await adapter.tableExists(tableName))) {
      return {
        // i18n: a fresh (re)create omits translatable columns when localized; they belong to the
        // companion.
        migrationSQL: schemaService.generateMigrationSQL(tableName, fields, {
          isSingle: true,
          hasStatus,
          localized: isLocalized,
        }),
        fields,
        previousFields,
        // The table is absent, so this renders it in full: every column, index and junction table
        // the desired spec asks for.
        describesWholeTable: true,
        ownsMigrationStatus: true,
      };
    }

    const alterInput = await this.normalizeFieldsForAlter(
      previousFields,
      fields,
      isLocalized || wasLocalized
    );

    // Whether a required column can be added without a value for the rows already there, and
    // which columns a foreign key or an index references, are facts about the live table. The
    // generator refuses an edit these rule out, which is why they are read before the apply.
    const db = adapter.getDrizzle();
    const liveDialect = adapter.getCapabilities().dialect;
    const [tableHasAnyRows, foreignKeysByColumn, indexNames] =
      await this.readLiveTableFacts(db, liveDialect, tableName);

    return {
      migrationSQL: schemaService.generateAlterTableMigration(
        tableName,
        alterInput.oldFields,
        alterInput.newFields,
        {
          wasStatus,
          hasStatus,
          tableHasRows: tableHasAnyRows,
          foreignKeysByColumn,
          indexNames,
        }
      ),
      fields,
      previousFields,
      describesWholeTable: false,
      ownsMigrationStatus: true,
    };
  }

  /**
   * The two field lists the ALTER diff compares, normalised to describe the same table.
   *
   * Two adjustments, and both exist because the stored field list and the physical table are not
   * the same thing:
   *
   * - The physical table always carries `title`, `slug` and `updated_at`, which the generators add
   *   and the stored definitions may not mention. Without them the diff plans an ADD COLUMN for
   *   columns that already exist. They are matched by the COLUMN a field becomes rather than by
   *   its name: a field named `Title` already owns the `title` column, and prepending the system
   *   one beside it would hand the diff two fields for one column.
   * - i18n: translatable columns live on the companion whenever the single is localized in either
   *   state, so they are dropped from both sides — the main-table diff must never ADD or DROP
   *   them. `reconcileSingleCompanion` owns that side.
   */
  private async normalizeFieldsForAlter(
    previousFields: FieldDefinition[],
    newFields: FieldDefinition[],
    omitLocalizedColumns: boolean
  ): Promise<{ oldFields: FieldDefinition[]; newFields: FieldDefinition[] }> {
    const { resolveLocalizedFieldNames } = await import(
      "../../i18n/classify-fields"
    );
    const { columnsDeclaredBy } = await import(
      "../../schema/services/field-column-descriptor"
    );

    // `localized: false` for the same reason the synthetic declarations carry it: these are
    // main-table system columns, and text-like fields localize by default. Without it the filter
    // below strips them from a localized single's ALTER input, so the diff stops seeing the
    // `title`/`slug` the table already has and plans them as additions.
    const systemFields: FieldDefinition[] = [
      { name: "title", type: "text", required: true, localized: false },
      { name: "slug", type: "text", required: true, localized: false },
    ];
    const updatedAt: FieldDefinition = {
      name: "updatedAt",
      type: "date",
      required: false,
    };

    const omitLocalized = (fields: FieldDefinition[]): FieldDefinition[] => {
      if (!omitLocalizedColumns) return fields;
      const localizedNames = new Set(resolveLocalizedFieldNames(fields, true));
      return fields.filter(f => !localizedNames.has(f.name));
    };

    const normalize = (fields: FieldDefinition[]): FieldDefinition[] => {
      const forAlter = omitLocalized(fields);
      const declared = columnsDeclaredBy(forAlter);
      return [
        ...systemFields.filter(sf => !declared.has(sf.name)),
        ...forAlter,
        updatedAt,
      ];
    };

    return {
      oldFields: normalize(previousFields),
      newFields: normalize(newFields),
    };
  }

  /** The live-table facts the ALTER generator needs, read in one round trip. */
  private async readLiveTableFacts(
    db: unknown,
    dialect: "postgresql" | "mysql" | "sqlite",
    tableName: string
  ): Promise<[boolean, Map<string, string[]>, Set<string>]> {
    const { readForeignKeyColumns, readIndexNames, tableHasRows } =
      await import("../../schema/pipeline/live-table-facts");
    return Promise.all([
      tableHasRows(db, dialect, tableName),
      readForeignKeyColumns(db, dialect, tableName),
      readIndexNames(db, dialect, tableName),
    ]);
  }

  /**
   * Run the plan, reporting how far it got.
   *
   * Returns undefined when the plan owns no status — a flag-only save with no adapter registered
   * asked nothing of the main table's schema, so overwriting the previous verdict with one about a
   * migration that was never requested would be a claim this apply cannot make.
   *
   * 🔴 Never throws once it has begun. The PHASE decides that, not the error type: from here on a
   * statement may already have run, and raising would skip the row write and leave the registry
   * describing storage that no longer matches it. Refusals are the plan's job, which is where
   * raising is free because nothing has been touched yet.
   */
  private async applyUpdateDdl(
    input: UpdateSingleSchemaInput,
    plan: UpdateDdlPlan
  ): Promise<SingleMigrationStatus | undefined> {
    const adapter = this.adapter;
    const tableName = input.existing.tableName;

    if (!adapter) {
      this.logger.warn(
        "[Singles] No adapter registered, migration not executed"
      );
      return plan.ownsMigrationStatus ? "pending" : undefined;
    }

    try {
      if (plan.migrationSQL) {
        // The shared runner, not a private copy: it owns both the splitting rule and the tolerance
        // that makes re-running over half-applied schema the repair case rather than a dead end.
        await applyMigrationStatements(adapter, plan.migrationSQL);
      }

      // Observed, not assumed, and it covers the rebuild case as well as the alter: a plan that
      // created the table has to find it afterwards for "applied" to mean anything.
      if (!(await adapter.tableExists(tableName))) {
        this.logger.error(
          `[Singles] Table "${tableName}" not found after migration update`
        );
        return "failed";
      }

      // 🔴 Past this point the MAIN table holds `plan.fields`. The companion may or may not follow,
      // and the two halves are what the runtime shape is composed from — so from here the position
      // in this method is the evidence for which state is true, and no flag is needed to track it.
      //
      // i18n: provision or alter the companion for the field set being saved — CREATE and seed the
      // default locale from main on enable, restore and archive on disable, ADD/DROP columns as
      // translatable fields change. Reported as a failed migration rather than thrown: the main
      // table is already in its new shape, and the row describing it is what makes a retry possible.
      const { reconcileSingleCompanion } = await import(
        "./reconcile-single-companion"
      );
      try {
        await reconcileSingleCompanion({
          slug: input.slug,
          tableName,
          oldFields: plan.previousFields,
          newFields: plan.fields,
          localized: input.isLocalized,
          wasLocalized: input.wasLocalized,
          status: input.hasStatus,
          wasStatus: input.wasStatus,
          adapter,
        });
      } catch (companionError) {
        // 🔴 The shape is RETRACTED here, never rebound, because nothing at this level knows what
        // the table now looks like.
        //
        // A reconcile that fails has stopped somewhere inside a sequence that moves columns between
        // the main table and its companion, and where it stopped decides the answer. Binding the
        // DESIRED shape is wrong when an enable never moved the columns; binding the PREVIOUS one
        // is wrong when a disable had already restored them and failed afterwards, clearing its
        // transition marker; binding nothing is wrong when the main ALTER added a column. Each of
        // those is correct for one stopping point and wrong for another, and the stopping point is
        // not observable from out here.
        //
        // Retracting is the one claim that is always correct: this is no longer describable from
        // here. `ensureSingleRuntimeTable` then rebuilds on the next touch, and its rebuild branch
        // PROBES the database for where the translatable columns physically live — which is the
        // fact every one of those guesses was standing in for.
        this.retractRuntimeSchema(adapter, tableName);
        this.logger.error(
          `[Singles] Companion reconcile failed for "${tableName}": ${
            companionError instanceof Error
              ? companionError.message
              : String(companionError)
          }`
        );
        return "failed";
      }

      // 🔴 Registered only once the companion has been reconciled, never before it.
      //
      // The shape this binds is derived from what the single is being saved AS, so on a
      // localization ENABLE it omits the translatable columns — which are still physically on the
      // main table until the companion has taken them. Bind it first and a companion CREATE that
      // then fails leaves the resolver describing a main table that does not exist in that shape,
      // and `ensureSingleRuntimeTable` treats a registration it did not make as owned by whoever
      // made it, so it adopts this one instead of rebuilding. Reads and writes would drop those
      // fields until a restart.
      //
      // Leaving the previous shape in place on failure is the safe direction: it is at worst stale
      // in the same way it was before the save, and the lazy rebuild can still correct it.
      await this.registerUpdatedRuntimeSchema(
        input,
        plan,
        adapter,
        input.isLocalized
      );

      // 🔴 Only a plan that describes the WHOLE table may clear a durable `failed`.
      //
      // A create that got its `CREATE TABLE` through and then failed on an index or a junction
      // table leaves the table PRESENT but incomplete. Every later save takes the alter branch,
      // and an ALTER describes a delta: it re-establishes nothing it does not mention, so an
      // unrelated field edit can run plenty of statements without going anywhere near the missing
      // artifact. Neither "the table exists" nor "something ran" is evidence the schema is whole,
      // and the durable verdict is the only record that it is not.
      //
      // The rebuild branch is the exception because it renders the table from the desired spec in
      // full, so reaching the end of it does mean every artifact was asked for.
      //
      // ⚠️ Known cost, accepted: a create that built the main table and failed only its COMPANION
      // can never clear this, because every retry finds the table present and so takes the alter
      // branch, even when the retry's reconcile succeeds and the schema is now complete. Clearing
      // it correctly needs both halves established, and `migration_status` is one bit — it records
      // that a migration failed, not which half. Verifying the live table against the desired spec
      // is the answer, and until something does, holding a stale `failed` is the safer error: it is
      // visible and blocks nothing, where a wrong `applied` hides an unenforced constraint until a
      // write fails.
      if (
        input.existing.migrationStatus === "failed" &&
        !plan.describesWholeTable
      ) {
        this.logger.warn(
          `[Singles] "${tableName}" is recorded as a failed migration and this save only ` +
            `describes a change to it, so its status is left as failed`
        );
        return "failed";
      }

      return "applied";
    } catch (error) {
      // 🔴 Everything inside this block is recorded, including a `NextlyError`, and the error TYPE
      // is deliberately not consulted.
      //
      // The tempting rule is "a refusal propagates whatever phase it arrives from", on the grounds
      // that recording one as `failed` would save a field list the table never took. It is the
      // wrong rule here, because by this point the schema may already have changed and raising
      // skips the row write entirely — which leaves the registry describing storage that no longer
      // matches it. Disabling localization is the reachable case: `reconcileSingleCompanion`
      // restores the translations, archives them and DROPS the companion, and only then clears the
      // transition marker, which refuses a slug containing a dot. Raise there and the companion is
      // gone while the row still says the single is localized, so every later read targets a table
      // that no longer exists — silently, and with nothing left to describe the state.
      //
      // Recording is strictly better once a statement has run: `failed` is visible, accurate and
      // retryable, where a raise leaves an inconsistency nothing reports. Refusals belong in the
      // PLAN, which runs before any of this and raises exactly as before; that is what the phase
      // split is for, and it is the only place where raising costs nothing.
      this.logger.error(
        `[Singles] Migration execution failed for "${tableName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      if (plan.migrationSQL) {
        this.logger.error(`[Singles] Migration SQL was: ${plan.migrationSQL}`);
      }
      return "failed";
    }
  }

  /**
   * Forget the main table's registered shape, so the next read rebuilds it from the database.
   *
   * Best-effort in the same way the registration is: a resolver that cannot retract leaves the
   * previous entry in place, which is where this path was before the method existed.
   */
  private retractRuntimeSchema(
    adapter: DrizzleAdapter,
    tableName: string
  ): void {
    const resolver = (
      adapter as unknown as { tableResolver?: DynamicSchemaResolver }
    ).tableResolver;
    if (resolver && typeof resolver.retractDynamicSchema === "function") {
      resolver.retractDynamicSchema(tableName);
    }
  }

  /**
   * Rebind the main table to the running server so the next read sees its new column shape.
   *
   * Best-effort, like the create path's: the registry is rebuilt from the database on the next
   * boot, so a failure costs a restart rather than the migration.
   */
  private async registerUpdatedRuntimeSchema(
    input: UpdateSingleSchemaInput,
    plan: UpdateDdlPlan,
    adapter: DrizzleAdapter,
    /**
     * Where the translatable columns physically live RIGHT NOW, which is not always what the save
     * asked for: an enable that failed its companion leaves them on the main table. Passed rather
     * than read from `input.isLocalized` so the caller states what it observed instead of what it
     * intended.
     */
    localized: boolean
  ): Promise<void> {
    try {
      const { generateRuntimeSchema } = await import(
        "../../schema/services/runtime-schema-generator"
      );
      const { table } = generateRuntimeSchema(
        input.existing.tableName,
        plan.fields,
        adapter.getCapabilities().dialect,
        // i18n: the main runtime table omits translatable columns for a localized single, matching
        // where those columns physically are.
        { status: input.hasStatus, localized }
      );
      const resolver = (
        adapter as unknown as { tableResolver?: DynamicSchemaResolver }
      ).tableResolver;
      if (resolver && typeof resolver.registerDynamicSchema === "function") {
        resolver.registerDynamicSchema(input.existing.tableName, table);
      }
    } catch (error) {
      this.logger.warn(
        `[Singles] Runtime schema registration failed for "${input.existing.tableName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
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
