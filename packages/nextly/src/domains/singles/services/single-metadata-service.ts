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
 * 🔴 Everything that can REJECT a create has to run before the intent is written, or a rejected
 * request strands a `pending` row. Validation, the reserved-slug check and the table-name conflict
 * check all belong to the caller and all happen first.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldConfig } from "../../../collections/fields/types";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { Logger } from "../../../shared/types";
import { DynamicCollectionSchemaService } from "../../dynamic-collections/services/dynamic-collection-schema-service";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";

import type { SingleRegistryService } from "./single-registry-service";

/** What a create needs to know, after the caller has validated it. */
export interface CreateSingleInput {
  slug: string;
  label: string;
  tableName: string;
  fields: FieldConfig[];
  description?: string;
  admin?: Record<string, unknown>;
  status?: boolean;
  localized?: boolean;
  versions?: boolean;
  revalidate?: boolean;
}

/** What the caller gets back: the row, and how far the schema change actually got. */
export interface SchemaChangeResult<T> {
  record: T;
  migrationStatus: "pending" | "applied" | "failed";
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
  async createSingle(
    input: CreateSingleInput
  ): Promise<SchemaChangeResult<unknown>> {
    const isLocalized = input.localized === true;

    // 1. INTENT. Durable before anything is touched, so an interruption from here on leaves a row
    // that `getPendingMigrations()` can find and finish.
    const record = await this.registry.registerSingle({
      slug: input.slug,
      label: input.label,
      tableName: input.tableName,
      description: input.description,
      fields: input.fields,
      admin: input.admin,
      source: "ui",
      locked: false,
      status: input.status === true,
      localized: isLocalized,
      versions: input.versions,
      revalidate: input.revalidate,
      migrationStatus: "pending",
    } as Parameters<SingleRegistryService["registerSingle"]>[0]);

    // 2. APPLY.
    const migrationStatus = await this.applyCreateDdl(input, isLocalized);

    // 3. CONFIRM. Recorded against the row written in step 1.
    await this.registry.updateMigrationStatus(input.slug, migrationStatus);

    return { record, migrationStatus };
  }

  /**
   * Generate and run the create DDL, reporting how far it got.
   *
   * Never throws: a schema change that fails is recorded rather than raised, so the caller still
   * has a row describing what was attempted. That is the same choice the request handler made
   * before this service existed, and it is what makes the state repairable instead of lost.
   */
  private async applyCreateDdl(
    input: CreateSingleInput,
    isLocalized: boolean
  ): Promise<"pending" | "applied" | "failed"> {
    const schemaService = new DynamicCollectionSchemaService(
      undefined,
      this.dialect
    );

    const migrationSQL = schemaService.generateMigrationSQL(
      input.tableName,
      input.fields as unknown as FieldDefinition[],
      // i18n: translatable columns are omitted from the main table when localized — they live in
      // the companion `<table>_locales`, provisioned below.
      {
        isSingle: true,
        hasStatus: input.status === true,
        localized: isLocalized,
      }
    );

    const adapter = this.adapter;
    if (!adapter) {
      this.logger.warn?.(
        "[Singles] No adapter registered, migration not executed"
      );
      return "pending";
    }

    try {
      // The shared splitter, not a private copy. The two the handlers carried had already drifted
      // from each other elsewhere in this codebase, which is why one canonical version exists.
      for (const statement of splitStatements([migrationSQL])) {
        await adapter.executeQuery(statement);
      }
    } catch (error) {
      this.logger.error?.(
        `[Singles] Migration execution failed for "${input.tableName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return "failed";
    }

    // Observed, not assumed. "Applied" has to mean the table is there.
    if (!(await adapter.tableExists(input.tableName))) {
      this.logger.error?.(
        `[Singles] Table "${input.tableName}" was not created after migration`
      );
      return "failed";
    }

    return "applied";
  }
}
