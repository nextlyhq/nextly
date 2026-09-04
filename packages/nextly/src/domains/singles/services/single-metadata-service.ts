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
 *   guessing at table names. A retry of the create reclaims that ground rather than building over
 *   it: a table already standing at the create's table name is dropped when empty and refused when
 *   it holds rows, never silently adopted (`resetOrphanStorage`).
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
import { assertGlobalResourceSlugAvailable } from "../../../services/lib/resource-slug-guard";
import type { Logger } from "../../../shared/types";
import { fieldGroupSlugList } from "../../field-groups/storage/field-group-field-type";
import { applyMigrationStatements } from "../../schema/services/apply-migration-statements";
import { withSchemaChangeExcluded } from "../../schema/services/schema-change-exclusion";

import { singleTableFamiliesCollide } from "./resolve-single-table-name";
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
  /**
   * Whether the request SET the Internationalization toggle, as opposed to leaving it alone.
   *
   * The mirror of {@link UpdateSingleSchemaInput.statusRequested}, and required for the same
   * reason: `isLocalized` falls back to the value the CALLER read, so once this service re-reads
   * the record it cannot tell "the user asked for localized: false" from "the user said nothing and
   * the caller filled in what it saw". Only the first should survive a refresh.
   */
  localizedRequested: boolean;
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

/**
 * Whether an update request can reach schema DDL at all, from the input alone.
 *
 * Two callers need this answer and they need it at different moments, which is why it is a function
 * rather than a condition written twice. `planUpdate` uses it to decide there is nothing to plan.
 * `updateSingleSchema` needs it BEFORE the exclusion is taken, to decide whether this operation may
 * create the lock table — and it cannot ask `planUpdate`, because planning reads the live table and
 * so has to happen inside the exclusion it is being consulted about.
 *
 * A save with no field change still has companion work when the single crosses the
 * Internationalization boundary, or when Draft/Published is saved on a single that is localized in
 * either state, because that toggle ADDs or DROPs the companion's own `_status`.
 *
 * Conservative in the direction that matters: it answers yes whenever DDL is possible, not only
 * when it is certain. A wrong yes costs one `CREATE TABLE IF NOT EXISTS` for the lock; a wrong no
 * would let a schema change run with no lock table to claim.
 */
/**
 * Could this request reach schema DDL at all? Answered from the request ALONE, before the refresh.
 *
 * 🔴 Deliberately a SECOND function rather than a reuse of {@link requestsSchemaWork}, because the
 * two answer different questions at different moments and the repository's one-question-one-answer
 * rule is about the same question being computed twice.
 *
 * This one decides whether the exclusion may CREATE the lock table, so it has to be settled BEFORE
 * the lock is taken — which is before the record can be re-read. It therefore cannot look at any
 * `was*` flag: those describe a state the caller sampled and another save may already have changed.
 * Asking only what the REQUEST set keeps it correct under that ignorance.
 *
 * The invariant that makes the pair safe: everything `requestsSchemaWork` calls schema work, this
 * calls possible schema work. A false here must mean no DDL under any refreshed state. A label,
 * admin, versioning, revalidation or webhook save sets none of these three and still claims no DDL
 * rights, which is what keeps a DML-only deployment able to make those edits.
 */
function mayIssueSchemaDdl(input: UpdateSingleSchemaInput): boolean {
  return (
    input.fields !== undefined ||
    input.localizedRequested ||
    input.statusRequested
  );
}

function requestsSchemaWork(input: UpdateSingleSchemaInput): boolean {
  const { fields, isLocalized, wasLocalized, statusRequested } = input;
  if (fields !== undefined) return true;
  return (
    isLocalized !== wasLocalized ||
    (statusRequested && (isLocalized || wasLocalized))
  );
}

/**
 * One comparable spelling of a stored field list.
 *
 * Compared as JSON rather than deeply walked because both sides are the SAME stored value read
 * twice: if nothing rewrote it, the two are identical, so there is no normalisation to get wrong.
 * `undefined` and an empty list are deliberately the same answer — a row that has never held field
 * definitions and one holding none describe the same schema.
 */
function stableFieldDefinitions(fields: unknown): string {
  return JSON.stringify(fields ?? []);
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
    // 🔴 The exclusion wraps ALL THREE phases, not just the apply. A storage migration renaming
    // tables between the plan and the row write would leave this create describing storage that
    // moved underneath it, and the row is as much a part of the schema as the table is.
    return withSchemaChangeExcluded(
      {
        adapter: this.adapter,
        logger: this.logger,
        label: `create single "${input.slug}"`,
        issuesDdl: true,
      },
      () => this.createSingleExcluded(input)
    );
  }

  private async createSingleExcluded(
    input: CreateSingleInput
  ): Promise<CreateSingleResult> {
    // 0. RE-ASSERT ownership, now that the exclusion is held.
    //
    // 🔴 The caller checked this outside the lock, and an HMR reload can register a code-first
    // Single onto the same table or slug in between. Without repeating it, the apply below runs
    // `CREATE TABLE IF NOT EXISTS` against a table the config now owns, reconciles its companion,
    // and rebinds the RUNTIME schema to this request's fields — and the runtime stays rebound until
    // the process restarts, even though the registry insert afterwards correctly rejects the
    // duplicate. The insert is what makes the row safe; it is not what makes the process safe.
    await this.assertCreateStillPossible(input);

    // 1. PLAN, before anything is persisted or executed. The generator is a validator as well as a
    // renderer, so a request it refuses leaves nothing behind at all — no row, no table — and the
    // corrected retry is a fresh create rather than a collision with its own wreckage.
    const plan = await this.planCreate(input);

    // 2. CLEAR THE GROUND. A table already standing where this create is about to build is never
    // adopted: empty, it is dropped so the apply renders every column from THIS request's fields;
    // holding rows, the create is refused — and the refusal is still free, because nothing has
    // been persisted and no statement has run.
    await this.resetOrphanStorage(input);

    // 3. APPLY. Never throws; a failure is reported as a status so the row can still record it.
    const migrationStatus = await this.applyCreateDdl(input, plan);

    // 4. RECORD, with the outcome already known.
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
   * Leave the create's table name pointing at nothing, or refuse the create.
   *
   * `CREATE TABLE IF NOT EXISTS` is a no-op against a table that already exists, on every dialect,
   * and the statement runner tolerates already-applied index statements so half-applied schema can
   * be finished. Together those make an apply over a LEFTOVER table silent: a create interrupted
   * between the DDL and the registry write leaves a table no row describes, and a retry with a
   * DIFFERENT field set would adopt that table unchanged — recording `applied` and binding a
   * runtime schema that names columns the table does not have, so every later read and write fails
   * far from the cause. Verifying the adopted table against the requested shape is not an answer
   * either: the DDL generator and the schema descriptor render several field kinds differently
   * (float widths, inline unique constraints, companion-owned columns), so a comparison between
   * them reports working tables as broken.
   *
   * So a standing table is never built over. Which way it goes is decided by the one thing an
   * orphan cannot have:
   *
   * - **Empty**, it is wreckage of an interrupted attempt. The ownership re-assertion above proved
   *   no registered Single claims it as a main table OR as a `_locales` companion, and a table
   *   outside every registered Single's family is one no Nextly path can write rows through — so
   *   nothing can put content into it between the probe and the drop either. It is dropped — with
   *   its own locale companion, its junction tables and its field-group data, each held to the
   *   same emptiness bar first — so
   *   the apply that follows renders every column, index and junction table from this request's
   *   fields, and `applied` describes the table that is actually there.
   * - **Holding rows**, it is somebody's data, and dropping it would destroy exactly what proves
   *   it is not wreckage. The create is refused with the table named and the way forward stated.
   *   Raised rather than recorded: no statement has run and no row is written, so the slug stays
   *   free and the operator can retry after dealing with the table.
   */
  private async resetOrphanStorage(input: CreateSingleInput): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) return;
    if (!(await adapter.tableExists(input.tableName))) return;

    const { readReferencingTables, tableHasRows } = await import(
      "../../schema/pipeline/live-table-facts"
    );
    const db = adapter.getDrizzle();
    const dialect = adapter.getCapabilities().dialect;

    // The wreckage is a FAMILY plus its junctions, not one table. A relationship field's junction
    // tables carry a foreign key to the main table, so a main table cannot simply be dropped while
    // they stand: MySQL refuses the drop outright, and PostgreSQL's CASCADE strips the junction's
    // constraint and leaves the junction itself to be adopted by the re-render — the same silent
    // adoption this method exists to prevent. They are read from the live catalog because the
    // abandoned attempt's field list is gone with its registry row. The `_locales` companion also
    // references the main table and is excluded here: `dropSingleStorage` below owns its teardown.
    const companion = `${input.tableName}_locales`;
    const referencing = (
      await readReferencingTables(db, dialect, input.tableName)
    ).filter(name => name !== companion);

    // Every table about to be dropped is probed BEFORE anything is dropped, so a refusal leaves
    // the whole group exactly as it stood.
    for (const name of [input.tableName, ...referencing]) {
      if (await tableHasRows(db, dialect, name)) {
        throw NextlyError.conflict({
          reason: "state",
          message: `Table "${name}" already exists and holds rows, but no Single describes it. Drop or rename that table, then retry the create.`,
          logContext: {
            reason: "single-create-table-occupied",
            slug: input.slug,
            tableName: input.tableName,
            occupiedTable: name,
          },
        });
      }
    }

    this.logger.info(
      `[Singles] Dropping empty unregistered table "${input.tableName}" before creating "${input.slug}"`
    );
    // Referencing tables first: they hold the foreign keys, and a parent cannot be dropped while a
    // reference to it stands on MySQL.
    for (const name of referencing) {
      await adapter.dropTable(name, {
        ifExists: true,
        cascade: dialect === "postgresql",
      });
    }
    await this.dropSingleStorage(input.slug, input.tableName, adapter);
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
    return withSchemaChangeExcluded(
      {
        adapter: this.adapter,
        logger: this.logger,
        label: `delete single "${slug}"`,
        issuesDdl: true,
      },
      () => this.deleteSingleExcluded(slug, tableName)
    );
  }

  private async deleteSingleExcluded(
    slug: string,
    callerTableName: string | undefined
  ): Promise<void> {
    // 🔴 Re-read before dropping anything. The caller checked `locked` outside this exclusion, and
    // an HMR reload can turn an unlocked UI Single into a locked code-first one in between — after
    // which this would drop the table and call `deleteSingle(..., { force: true })`, walking past
    // the registry's own protection for code-owned records. The table name is taken from the fresh
    // record for the same reason: the caller's copy describes storage as it was.
    //
    // A record that has already gone is NOT an error here. Delete is idempotent by intent, and
    // refusing a second delete would turn a retry into a failure; the teardown below still runs
    // against the caller's table name so a half-finished delete can be completed.
    const current = await this.registry.getSingleBySlug(slug);
    if (current?.locked === true) {
      throw NextlyError.forbidden({
        logContext: {
          reason: "single became locked while awaiting the exclusion",
          slug,
        },
      });
    }
    const tableName = current?.tableName ?? callerTableName;

    const adapter = this.adapter;
    if (tableName && adapter) {
      await this.dropSingleStorage(slug, tableName, adapter);
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
   * Drop everything a Single stores: its embedded field-group data, its locale companion, and the
   * main table itself, in that order.
   *
   * Shared by the delete path and by the create path's orphan reset, because "remove this Single's
   * storage" is one question and two renderings of the teardown order would drift — the order is
   * load-bearing on two dialects (see the companion comment below).
   */
  private async dropSingleStorage(
    slug: string,
    tableName: string,
    adapter: DrizzleAdapter
  ): Promise<void> {
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
    return withSchemaChangeExcluded(
      {
        adapter: this.adapter,
        logger: this.logger,
        label: `update single schema "${input.slug}"`,
        // A save that changes only labels, admin options, versioning, revalidation or webhooks
        // writes a registry row and nothing else. Claiming DDL rights for it would make a
        // deployment whose role has DML but not DDL start refusing metadata edits that worked
        // before, because taking the exclusion would try to CREATE the lock table.
        //
        // 🔴 Asked CONSERVATIVELY, and of the request rather than of the transition. This is decided
        // before the lock, so before the record is re-read — and a toggle that looks like a no-op
        // against the caller's stale flags can become a real transition against the refreshed ones,
        // whose DDL would then run with no claim held.
        issuesDdl: mayIssueSchemaDdl(input),
      },
      () => this.updateSingleSchemaExcluded(input)
    );
  }

  private async updateSingleSchemaExcluded(
    args: UpdateSingleSchemaInput
  ): Promise<UpdateSingleSchemaResult> {
    // 0. RE-READ the record, now that the exclusion is held.
    //
    // 🔴 The caller read it BEFORE this lock existed, and a storage migration can complete in
    // between. Its `data:registry-definitions` step rewrites `dynamic_singles.fields` into the new
    // field-group vocabulary, so planning from the caller's copy would derive the change from
    // definitions the database no longer holds — and the registry write at the end would put the
    // legacy spelling back, under a marker that now says the migration settled.
    //
    // Holding a lock over the WORK is not enough when the INPUT was sampled outside it. This is the
    // same sampled-versus-held argument the exclusion itself rests on, applied one level up.
    //
    // Only the record is refreshed. The `is*` / `was*` flags describe what the REQUEST asked for and
    // what it is transitioning from, which a migration does not touch — it renames vocabulary, not
    // toggles — so re-deriving them here would substitute this service's reading of the request for
    // the caller's.
    const current = await this.refreshForUpdate(args);

    // 🔴 The plugin judge is re-consulted here for the same reason the create re-consults it: an
    // HMR reload can replace the process-global field-type registry while this request waits, and
    // `planUpdate` below renders DDL against the NEW registration while `updateData.fields` still
    // carries options only the old one accepted.
    const { assertValidPluginFieldOptions } = await import(
      "../../../api/fields-payload"
    );
    assertValidPluginFieldOptions(args.fields ?? []);

    // The `was*` flags describe the state being transitioned FROM, so they follow the refreshed
    // record. The `is*`/`has*` flags describe what the request asked for — but only where it
    // actually asked: the caller resolves an absent toggle to the value it read, and that value can
    // be stale. Where the request said nothing, the refreshed record decides.
    //
    // Without this, two overlapping Builder saves plan from mutually inconsistent state: one enables
    // Draft/Published, the next enables localization carrying `hasStatus: false` from before, and
    // the companion is created without `_status` while the row ends up saying it has one.
    const wasLocalized = current.localized === true;
    const wasStatus = current.status === true;
    const input: UpdateSingleSchemaInput = {
      ...args,
      existing: current,
      wasLocalized,
      wasStatus,
      isLocalized: args.localizedRequested ? args.isLocalized : wasLocalized,
      hasStatus: args.statusRequested ? args.hasStatus : wasStatus,
    };

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
  /**
   * Read the Single again inside the exclusion, and re-check what the caller checked outside it.
   *
   * Both refusals are re-checked rather than trusted: a delete that lands while this request waited
   * leaves nothing to update, and a Single that became `locked` in the same window is code-first
   * now, so applying a UI edit to it would write a row the config is about to contradict.
   */
  private async refreshForUpdate(
    input: UpdateSingleSchemaInput
  ): Promise<DynamicSingleRecord> {
    const current = await this.registry.getSingleBySlug(input.slug);

    if (!current) {
      throw NextlyError.notFound({
        logContext: {
          reason: "single disappeared while awaiting the exclusion",
          slug: input.slug,
        },
      });
    }
    if (current.locked) {
      throw NextlyError.forbidden({
        logContext: {
          reason: "single became locked while awaiting the exclusion",
          slug: input.slug,
        },
      });
    }

    // 🔴 Refreshing the record fixes what this request PLANS from. It does not fix what it WRITES:
    // the caller composed `updateData.fields` against the definitions it read, and those are written
    // back verbatim at the end. A storage migration that renamed the field-group vocabulary in
    // between would be undone by this save, under a marker that now says it settled.
    //
    // The DEFINITIONS are compared, not a hash of them. `schema_hash` looks like the cheaper
    // question and cannot answer this one: the migration's registry step projects only
    // `["id", fields, config_path]` and rewrites `fields` without recomputing the hash, so the
    // pre- and post-migration hashes are equal precisely when the vocabulary changed. Comparing the
    // thing itself needs nothing to be maintained alongside it.
    //
    // This also catches the case nobody had named: two people editing one Single, where the second
    // save silently discarded the first.
    const seen = stableFieldDefinitions(input.existing.fields);
    const live = stableFieldDefinitions(current.fields);
    if (seen !== live) {
      throw NextlyError.conflict({
        logContext: {
          reason:
            "single's stored field definitions changed while this request awaited the exclusion",
          slug: input.slug,
        },
      });
    }

    return current;
  }

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
    } = input;
    const previousFields = (existing.fields ??
      []) as unknown as FieldDefinition[];

    // Asked through the shared predicate rather than restated here. `updateSingleSchema` needs the
    // same answer BEFORE it takes the exclusion, and two copies of this condition would agree today
    // and drift silently — with the drift showing up as a schema change running unprotected.
    if (!requestsSchemaWork(input)) return null;

    if (fields === undefined) {
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

    // Detected from the FULL field lists: a renamed LOCALIZED field-group
    // field sits in neither side of alterInput (the localized filter removes
    // both spellings), and its association migration must not be excluded
    // along with the column handling.
    const groupMigration = await this.planFieldGroupAssociationMigration(
      adapter,
      previousFields,
      fields
    );

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
          ...groupMigration,
        }
      ),
      fields,
      previousFields,
      describesWholeTable: false,
      ownsMigrationStatus: true,
    };
  }

  /**
   * The options a field-group association rename contributes to the alter
   * generator: the rename pair itself and the registry-resolved physical
   * table per referenced slug.
   *
   * A field-group rename migrates the association key on the group's own
   * table, whose physical name only the registry knows — the storage
   * migration renames comp_ tables to fg_, and a group may carry a historical
   * custom name. Resolved strictly when a rename is detected: a precondition
   * of that migration, since proceeding without it orphans every existing
   * row under the old field name.
   */
  private async planFieldGroupAssociationMigration(
    adapter: DrizzleAdapter,
    oldFields: FieldDefinition[],
    newFields: FieldDefinition[]
  ): Promise<{
    associationRename?: {
      from: FieldDefinition;
      to: FieldDefinition;
    };
    fieldGroupTableNames: ReadonlyMap<string, string>;
  }> {
    const { DynamicCollectionSchemaService } = await import(
      "../../dynamic-collections/services/dynamic-collection-schema-service"
    );
    const rename = new DynamicCollectionSchemaService(
      undefined,
      this.dialect
    ).detectFieldGroupAssociationRename(oldFields, newFields);
    if (!rename) return { fieldGroupTableNames: new Map() };

    const { FieldGroupRegistryService } = await import(
      "../../field-groups/services/field-group-registry-service"
    );
    const registry = new FieldGroupRegistryService(adapter, this.logger);
    const resolved = new Map<string, string>();
    const slugs = new Set<string>();
    for (const f of [...oldFields, ...newFields]) {
      for (const slug of fieldGroupSlugList(f)) slugs.add(slug);
    }
    await Promise.all(
      [...slugs].map(async slug => {
        const record = await registry.getComponentBySlug(slug);
        if (record) resolved.set(slug, record.tableName);
      })
    );
    const unresolved = [...slugs].filter(slug => !resolved.has(slug));
    if (unresolved.length > 0) {
      throw NextlyError.validation({
        errors: [
          {
            path: `fields.${unresolved.join(", ")}`,
            code: "FIELD_GROUP_TABLE_UNRESOLVED",
            message:
              `Cannot rename this field group: its data lives in tables ` +
              `whose names come from the field-group registry, and no ` +
              `record could be resolved for: ${unresolved.join(", ")}. ` +
              `Restore the missing field group (or remove the field) and ` +
              `save again.`,
          },
        ],
        logContext: { unresolvedFieldGroups: unresolved },
      });
    }
    return {
      associationRename: rename,
      fieldGroupTableNames: resolved,
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
  /**
   * Re-run the create's ownership preconditions, inside the exclusion.
   *
   * Asks the same two questions the caller asked and re-uses the same shared guard for the second,
   * rather than restating either: a table another Single already owns, and a slug some other
   * resource kind has taken.
   */
  private async assertCreateStillPossible(
    input: CreateSingleInput
  ): Promise<void> {
    // 🔴 Compared as table FAMILIES, not main names. A Single's storage occupies its main table
    // AND the `_locales` companion beside it, and slug normalisation folds `-` to `_`, so two
    // Singles whose main names differ can still collide on one physical table: `foo-locales`
    // resolves to `single_foo_locales`, which is `single_foo`'s companion. That matters doubly
    // here, because a name this scan clears is one the orphan reset below is licensed to DROP —
    // a main-name comparison would clear another Single's empty companion for destruction.
    const owner = (await this.registry.getAllSingles()).find(
      single =>
        single.slug !== input.slug &&
        singleTableFamiliesCollide(single.tableName, input.tableName)
    );
    if (owner) {
      throw NextlyError.duplicate({
        logContext: {
          reason:
            "another single claimed this table while awaiting the exclusion",
          slug: input.slug,
          tableName: input.tableName,
          ownedBy: owner.slug,
        },
      });
    }

    const adapter = this.adapter;
    if (adapter) {
      await assertGlobalResourceSlugAvailable(adapter, input.slug);
    }

    // 🔴 Re-judged here, not only by the caller, because the thing that judges it can CHANGE while
    // this request waits. A plugin field's options are validated by the plugin's own
    // `validateOptions`, read from the process-global field-type registry — and an HMR reload
    // replaces that registry wholesale from inside this same exclusion. A declaration the previous
    // registration accepted would otherwise be planned, built and persisted against the new one,
    // and every later write to the Single would fail on options it rejects.
    //
    // Placed alongside the ownership checks so the whole precondition set is re-established in one
    // place: this method is what a new precondition should be added to.
    const { assertValidPluginFieldOptions } = await import(
      "../../../api/fields-payload"
    );
    assertValidPluginFieldOptions(input.fields);
  }

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
