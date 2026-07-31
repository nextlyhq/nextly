import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors";
import type { FieldGroupAdminOptions } from "../../../field-groups/config/types";
import { MAX_FIELD_GROUP_NESTING_DEPTH } from "../../../field-groups/config/validate-field-group";
// Throws NextlyError so public messages stay generic and never echo a slug,
// while identifiers (slug, source, refs) travel in `logContext` and operators
// keep full diagnostic context.
import type {
  DynamicFieldGroupInsert,
  DynamicFieldGroupRecord,
  FieldGroupMigrationStatus,
  FieldGroupSource,
} from "../../../schemas/dynamic-field-groups/types";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { BaseRegistryService } from "../../../shared/base-registry-service";
import type {
  BaseListOptions,
  BaseListResult,
} from "../../../shared/base-registry-service";
import type { Logger } from "../../../shared/types";
import { teardownEntityI18n } from "../../i18n/migration/teardown-entity-i18n";
import {
  calculateSchemaHash,
  schemaHashesMatch,
} from "../../schema/services/schema-hash";
import { resolveComponentTableName } from "../../schema/utils/resolve-table-name";
import { assertNoMigrationInFlight } from "../migration/sync-guard";

import { teardownEntityComponentData } from "./teardown-entity-field-group-data";

/**
 * A reference to a Component from a Collection, Single, or another Component.
 */
export interface ComponentReference {
  entityType: "collection" | "single" | "component";
  entitySlug: string;
  fieldName: string;
  fieldPath: string;
}

export interface UpdateComponentOptions {
  source?: FieldGroupSource;
}

/**
 * Input for registering a code-first Component during sync.
 *
 * Carries no table name: the sync derives the physical name from the slug, so a
 * caller-supplied one could only disagree with the table the schema layer
 * creates.
 */
export interface CodeFirstComponentConfig {
  slug: string;
  label: string;
  fields: DynamicFieldGroupInsert["fields"];
  description?: string;
  admin?: FieldGroupAdminOptions;
  configPath?: string;
  /** i18n: whether the component is localized (translatable fields → companion table). */
  localized?: boolean;
}

export interface SyncComponentResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  errors: Array<{ slug: string; error: string }>;
}

export interface ListComponentsOptions extends BaseListOptions {
  source?: FieldGroupSource;
  migrationStatus?: FieldGroupMigrationStatus;
}

/**
 * Result of listing components with pagination info.
 *
 * Declared as a `type` alias rather than an empty `interface` because the latter
 * triggers @typescript-eslint/no-empty-object-type. The named export is preserved
 * for clearer call-site semantics even though it adds no members today.
 */
export type ListComponentsResult = BaseListResult<DynamicFieldGroupRecord>;

export interface EnrichedComponentSchema {
  label: string;
  fields: Record<string, unknown>[];
  admin?: FieldGroupAdminOptions;
}

export interface EnrichedFieldConfig extends Record<string, unknown> {
  name?: string;
  type?: string;
  componentFields?: Record<string, unknown>[];
  componentSchemas?: Record<string, EnrichedComponentSchema>;
}

export class FieldGroupRegistryService extends BaseRegistryService<
  DynamicFieldGroupRecord,
  FieldGroupMigrationStatus
> {
  protected readonly registryTableName = STORAGE_FORMAT.registryTable;
  protected readonly resourceType = "Component";
  protected readonly tableNamePrefix = STORAGE_FORMAT.tablePrefix;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  protected getSearchColumns(): string[] {
    return ["slug", "label"];
  }

  /**
   * Refuse to change the registry while a storage migration is in flight.
   *
   * The migration renames a field group's table and moves the registry row
   * pointing at it as one step. An author changing `dbName` in that window
   * produces a database state byte-identical to the migration's own committed
   * step, so a resume cannot tell the two apart: it either adopts the author's
   * table as its own work, or renames it away. Nothing observable distinguishes
   * them afterwards, which is why this prevents rather than detects.
   *
   * Creating and deleting matter for a different reason: a run's identity
   * covers which field groups existed when it was planned, so either one makes
   * a resume refuse the plan it is resuming.
   *
   * Called before opening any transaction. The check reads through the adapter,
   * which takes its own connection, so asking from inside one would wait for a
   * second checkout and hang a pool sized to one.
   */
  private async assertMigrationNotInFlight(): Promise<void> {
    await assertNoMigrationInFlight({
      action: "field group change",
      adapter: this.adapter,
      logger: this.logger,
    });
  }

  async getComponentBySlug(
    slug: string,
    executor?: unknown
  ): Promise<DynamicFieldGroupRecord | null> {
    return this.getRecordBySlug(slug, executor);
  }

  async getComponent(
    slug: string,
    executor?: unknown
  ): Promise<DynamicFieldGroupRecord> {
    return this.getRecordOrThrow(slug, executor);
  }

  async getAllComponents(
    options?: ListComponentsOptions
  ): Promise<DynamicFieldGroupRecord[]> {
    return this.getAllRecords(options);
  }

  async listComponents(
    options?: ListComponentsOptions
  ): Promise<ListComponentsResult> {
    return this.listRecords(options);
  }

  async isLocked(slug: string): Promise<boolean> {
    return this.checkIsLocked(slug);
  }

  async updateMigrationStatus(
    slug: string,
    status: FieldGroupMigrationStatus,
    migrationId?: string
  ): Promise<void> {
    return this.updateRecordMigrationStatus(slug, status, migrationId);
  }

  async updateMigrationStatusWithVerification(
    slug: string,
    tableName: string
  ): Promise<{ verified: boolean; status: FieldGroupMigrationStatus }> {
    return this.updateMigrationStatusWithTableVerification(slug, tableName);
  }

  async getPendingMigrations(): Promise<DynamicFieldGroupRecord[]> {
    return this.getRecordsWithPendingMigrations();
  }

  /**
   * Register a new Component in the registry.
   *
   * @throws NextlyError(DUPLICATE) if a Component with the same slug already exists.
   * @throws NextlyError(DATABASE_ERROR) on insert failure.
   */
  async registerComponent(
    data: DynamicFieldGroupInsert
  ): Promise<DynamicFieldGroupRecord> {
    this.logger.debug("Registering Component", { slug: data.slug });
    await this.assertMigrationNotInFlight();

    const existing = await this.getComponentBySlug(data.slug);
    if (existing) {
      // Generic public message; the conflicting slug stays out of the
      // wire and lives in logContext for operator visibility.
      throw NextlyError.duplicate({
        logContext: { reason: "component-slug-conflict", slug: data.slug },
      });
    }

    const now = this.formatDateForDb();
    // Store the caller-resolved physical name verbatim. Callers derive it via
    // resolveComponentTableName; re-prefixing here would desync the registry
    // from the table the schema layer creates.
    const tableName = data.tableName;
    const record: Record<string, unknown> = {
      id: this.generateId(),
      slug: data.slug,
      label: data.label,
      table_name: tableName,
      description: data.description,
      fields: JSON.stringify(data.fields),
      admin: data.admin ? JSON.stringify(data.admin) : null,
      source: data.source,
      locked: (data.locked ?? data.source === "code") ? 1 : 0,
      // i18n: persist the localized flag so embedded instances route translatable
      // fields to the companion `comp_<slug>_locales` table.
      localized: data.localized === true ? 1 : 0,
      config_path: data.configPath,
      schema_hash: data.schemaHash,
      schema_version: data.schemaVersion ?? 1,
      migration_status: data.migrationStatus ?? "pending",
      last_migration_id: data.lastMigrationId,
      created_by: data.createdBy,
      created_at: now,
      updated_at: now,
    };

    try {
      const result = await this.adapter.insert<DynamicFieldGroupRecord>(
        this.registryTableName,
        record,
        { returning: "*" }
      );

      this.logger.info("Component registered", {
        slug: data.slug,
        source: data.source,
      });

      return this.deserializeRecord(result);
    } catch (error) {
      // Spec §8.2 — DB errors map to NextlyError via fromDatabaseError, which
      // produces generic public messages and rich logContext (dbKind, dbCode).
      // Normalise raw driver errors via toDbError(dialect) first so the kind
      // is preserved instead of collapsing to INTERNAL_ERROR.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  async registerComponentInTransaction(
    tx: TransactionContext,
    data: DynamicFieldGroupInsert
  ): Promise<DynamicFieldGroupRecord> {
    const existing = await tx.selectOne<DynamicFieldGroupRecord>(
      this.registryTableName,
      {
        where: this.whereEq("slug", data.slug),
      }
    );

    if (existing) {
      // As in registerComponent: generic public message, slug in logContext.
      throw NextlyError.duplicate({
        logContext: { reason: "component-slug-conflict", slug: data.slug },
      });
    }

    const now = this.formatDateForDb();
    // Same contract as registerComponent: the caller resolves the physical name.
    const tableName = data.tableName;
    const record: Record<string, unknown> = {
      id: this.generateId(),
      slug: data.slug,
      label: data.label,
      table_name: tableName,
      description: data.description,
      fields: JSON.stringify(data.fields),
      admin: data.admin ? JSON.stringify(data.admin) : null,
      source: data.source,
      locked: (data.locked ?? data.source === "code") ? 1 : 0,
      // i18n: persist the localized flag so embedded instances route translatable
      // fields to the companion `comp_<slug>_locales` table.
      localized: data.localized === true ? 1 : 0,
      config_path: data.configPath,
      schema_hash: data.schemaHash,
      schema_version: data.schemaVersion ?? 1,
      migration_status: data.migrationStatus ?? "pending",
      last_migration_id: data.lastMigrationId,
      created_by: data.createdBy,
      created_at: now,
      updated_at: now,
    };

    const result = await tx.insert<DynamicFieldGroupRecord>(
      this.registryTableName,
      record,
      { returning: "*" }
    );

    return this.deserializeRecord(result);
  }

  /**
   * Update a Component's metadata.
   *
   * @throws NextlyError(NOT_FOUND) when no Component matches the slug.
   * @throws NextlyError(FORBIDDEN) when the Component is locked and the source isn't "code".
   */
  async updateComponent(
    slug: string,
    data: Partial<DynamicFieldGroupInsert>,
    options?: UpdateComponentOptions
  ): Promise<DynamicFieldGroupRecord> {
    this.logger.debug("Updating Component", { slug });
    await this.assertMigrationNotInFlight();

    const existing = await this.getComponent(slug);

    if (existing.locked && options?.source !== "code") {
      // Generic FORBIDDEN; slug and source go to logContext only.
      throw NextlyError.forbidden({
        logContext: {
          reason: "component-locked",
          slug,
          source: options?.source ?? "UI",
        },
      });
    }

    const updateData: Record<string, unknown> = {
      updated_at: this.formatDateForDb(),
    };

    if (data.label !== undefined) {
      updateData.label = data.label;
    }

    if (data.description !== undefined) {
      updateData.description = data.description;
    }

    if (data.fields) {
      updateData.fields = JSON.stringify(data.fields);
      updateData.schema_version = existing.schemaVersion + 1;
      updateData.migration_status = data.migrationStatus || "pending";
    }

    if (data.admin !== undefined) {
      updateData.admin = data.admin ? JSON.stringify(data.admin) : null;
    }

    if (data.schemaHash) {
      updateData.schema_hash = data.schemaHash;
    }

    if (data.locked !== undefined) {
      updateData.locked = data.locked ? 1 : 0;
    }

    // i18n: persist the Internationalization flag on update. Previously omitted, so a component
    // toggled localized in the UI (or a code-first sync flag flip) could never update the column
    // — only registerComponent (create) ever wrote it. Mirrors the collection/single registries.
    if (data.localized !== undefined) {
      updateData.localized = data.localized === true ? 1 : 0;
    }

    if (data.configPath !== undefined) {
      updateData.config_path = data.configPath;
    }

    // Only ever supplied by the legacy-pointer repair, which has verified the
    // derived table exists and the stored one does not.
    if (data.tableName !== undefined) {
      updateData.table_name = data.tableName;
    }

    try {
      const results = await this.adapter.update<DynamicFieldGroupRecord>(
        this.registryTableName,
        updateData,
        this.whereEq("slug", slug),
        { returning: "*" }
      );

      if (results.length === 0) {
        // Generic "Not found."; slug in logContext.
        throw NextlyError.notFound({ logContext: { slug } });
      }

      this.logger.info("Component updated", { slug });

      return this.deserializeRecord(results[0]);
    } catch (error) {
      // Preserve already-mapped NextlyErrors (the notFound above, or a
      // forbidden from the locked-check). Anything else is a raw DB error.
      // Normalise raw driver errors first so unique/fk/etc. produce the right kind.
      if (NextlyError.is(error)) {
        throw error;
      }
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /**
   * Delete a Component from the registry.
   */
  async deleteComponent(slug: string): Promise<void> {
    this.logger.debug("Deleting Component", { slug });
    await this.assertMigrationNotInFlight();

    const existing = await this.getComponent(slug);

    if (existing.locked) {
      // Generic FORBIDDEN — slug-specific reason stays operator-side.
      throw NextlyError.forbidden({
        logContext: { reason: "component-locked-for-delete", slug },
      });
    }

    const references = await this.findComponentReferences(slug);

    if (references.length > 0) {
      // The CONFLICT factory carries a stable generic public message.
      // The structured `references` payload is operator-only — putting it on
      // logContext keeps it out of the wire while preserving full debug info.
      throw NextlyError.conflict({
        reason: "state",
        logContext: { reason: "component-has-references", slug, references },
      });
    }

    try {
      // Tear down the localization artifacts BEFORE the main table: the companion
      // `_locales` table holds an FK to this table's `id`, so dropping the main table
      // first would orphan it (Postgres CASCADE) or fail outright (MySQL). This also
      // purges the component's rows from the shared `nextly_i18n_archive`.
      // A component can host other components. Those nested instances point at THIS
      // table via `_parent_table`, so dropping it below would strand them. Deletion is
      // blocked while anything references this component, but nothing blocks the reverse
      // direction, so the nested rows are this delete's responsibility.
      await teardownEntityComponentData({
        adapter: this.adapter,
        parentTable: existing.tableName,
      });

      await teardownEntityI18n({
        kind: "fieldGroup",
        adapter: this.adapter,
        slug,
        tableName: existing.tableName,
      });

      // Drop the data table after its dependents, since both hold references into it.
      // A failure here leaves the component present but its nested instances, companion
      // table and archived translations already removed — the teardowns above are not
      // reversible. A transaction would not close that window portably: MySQL commits
      // implicitly on DDL, so the drop could not roll back there. Retrying the delete is
      // safe (every step is existence-guarded) and is the intended recovery.
      await this.dropComponentTable(existing.tableName);

      // PG RETURNING-less DELETE always returns 0 rows, so no post-delete count check.
      await this.adapter.delete(
        this.registryTableName,
        this.whereEq("slug", slug)
      );

      this.logger.info("Component deleted", { slug });
    } catch (error) {
      // Preserve mapped NextlyErrors thrown from the locked / has-references
      // checks above; raw DB errors map via fromDatabaseError. Normalise raw
      // driver errors via toDbError(dialect) first so the kind is preserved.
      if (NextlyError.is(error)) {
        throw error;
      }
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  // Uses IF EXISTS so the operation is safe even if the table was never created.
  // PostgreSQL uses CASCADE to drop any dependent objects.
  private async dropComponentTable(tableName: string): Promise<void> {
    const q = this.dialect === "mysql" ? "`" : '"';
    const quotedName = `${q}${tableName}${q}`;
    const sql =
      this.dialect === "postgresql"
        ? `DROP TABLE IF EXISTS ${quotedName} CASCADE`
        : `DROP TABLE IF EXISTS ${quotedName}`;

    this.logger.debug("Dropping component table", { tableName });
    await this.adapter.executeQuery(sql);
    this.logger.info("Component table dropped", { tableName });
  }

  /**
   * Sync code-first Components with the registry.
   */
  async syncCodeFirstComponents(
    configs: CodeFirstComponentConfig[]
  ): Promise<SyncComponentResult> {
    this.logger.info("Syncing code-first Components", {
      count: configs.length,
    });

    const result: SyncComponentResult = {
      created: [],
      updated: [],
      unchanged: [],
      errors: [],
    };

    for (const config of configs) {
      try {
        const existing = await this.getComponentBySlug(config.slug);
        const schemaHash = calculateSchemaHash(config.fields);
        // Canonical resolution: comp_ + normalized slug, matching what the
        // runtime schema layer and migrate:create derive for the same
        // component. Resolved before the
        // existence check so a stored name that drifted from it is reconciled
        // rather than left addressing a table the schema layer never created.
        const desiredTableName = resolveComponentTableName(config.slug);
        // A component's stored table name is never changed here. Repointing an
        // existing component at different storage moves no data, and the paths
        // that generate DDL do not all have the registry available — the
        // offline migration generator has no database connection at all — so a
        // divergence between the configured name and the stored one cannot be
        // honoured consistently. Moving a registered component to different
        // storage is a migration, not a config edit.
        //
        // Reported rather than passed over: registry-backed reads, filters and
        // teardown all follow the stored name, so a mismatch means they address
        // a table the schema layer is not maintaining. Recording it as a sync
        // error surfaces it on every boot until a migration resolves it.
        let repairedTableName: string | undefined;
        // Any difference is treated the same way, casing included. Derived
        // names are always lowercase, so a stored pointer differing only in
        // case is a legacy or hand-edited row rather than a supported state,
        // and whether two spellings are one table is server configuration that
        // cannot be inferred from the catalog: a single listed spelling means
        // the other does not exist, not that the server folded them.
        if (existing !== null && existing.tableName !== desiredTableName) {
          // One mismatch is repairable without moving anything: the stored name
          // addresses no table while the configured one does. That is a row
          // written before names resolved canonically — the data has always
          // been in the configured table — so correcting the pointer converges
          // the registry onto the config rather than leaving them divergent.
          const [storedExists, desiredExists] = await Promise.all([
            this.adapter.tableExists(existing.tableName),
            this.adapter.tableExists(desiredTableName),
          ]);

          if (!storedExists && desiredExists) {
            repairedTableName = desiredTableName;
            this.logger.warn("Component registry table name repaired", {
              slug: config.slug,
              from: existing.tableName,
              to: desiredTableName,
            });
          } else {
            result.errors.push({
              slug: config.slug,
              error:
                `Registry table '${existing.tableName}' does not match the derived ` +
                `'${desiredTableName}'. Storage is not repointed automatically; run a ` +
                `migration to move the data.`,
            });
            continue;
          }
        }
        if (!existing) {
          await this.registerComponent({
            slug: config.slug,
            label: config.label,
            tableName: desiredTableName,
            description: config.description,
            fields: config.fields,
            admin: config.admin,
            source: "code",
            locked: true,
            localized: config.localized === true,
            configPath: config.configPath,
            schemaHash,
          });
          result.created.push(config.slug);
        } else if (
          repairedTableName !== undefined ||
          !schemaHashesMatch(schemaHash, existing.schemaHash) ||
          (config.localized === true) !== (existing.localized === true)
        ) {
          await this.updateComponent(
            config.slug,
            {
              label: config.label,
              description: config.description,
              fields: config.fields,
              admin: config.admin,
              configPath: config.configPath,
              schemaHash,
              locked: true,
              localized: config.localized === true,
              tableName: repairedTableName,
            },
            { source: "code" }
          );
          result.updated.push(config.slug);
        } else if (this.adminConfigChanged(config.admin, existing.admin)) {
          await this.updateComponent(
            config.slug,
            {
              admin: config.admin,
              locked: true,
            },
            { source: "code" }
          );
          result.updated.push(config.slug);
        } else {
          result.unchanged.push(config.slug);
        }
      } catch (error) {
        result.errors.push({
          slug: config.slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.info("Code-first Component sync completed", {
      created: result.created.length,
      updated: result.updated.length,
      unchanged: result.unchanged.length,
      errors: result.errors.length,
    });

    return result;
  }

  /**
   * Find all references to a Component across Collections, Singles, and other Components.
   */
  async findComponentReferences(
    componentSlug: string
  ): Promise<ComponentReference[]> {
    this.logger.debug("Checking for component references", {
      slug: componentSlug,
    });

    const references: ComponentReference[] = [];

    try {
      const collections = await this.adapter.select<Record<string, unknown>>(
        "dynamic_collections",
        { columns: ["slug", "fields"] }
      );

      for (const collection of collections) {
        const slug = collection.slug as string;
        const fields = this.parseJsonField(collection.fields);
        if (fields) {
          const found = this.scanFieldsForComponentRef(
            fields,
            componentSlug,
            slug,
            "collection"
          );
          references.push(...found);
        }
      }
    } catch (error) {
      // Table may not exist yet (fresh install) — not an error.
      this.logger.debug("Could not scan dynamic_collections for references", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const singles = await this.adapter.select<Record<string, unknown>>(
        "dynamic_singles",
        { columns: ["slug", "fields"] }
      );

      for (const single of singles) {
        const slug = single.slug as string;
        const fields = this.parseJsonField(single.fields);
        if (fields) {
          const found = this.scanFieldsForComponentRef(
            fields,
            componentSlug,
            slug,
            "single"
          );
          references.push(...found);
        }
      }
    } catch (error) {
      this.logger.debug("Could not scan dynamic_singles for references", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const components = await this.adapter.select<Record<string, unknown>>(
        this.registryTableName,
        { columns: ["slug", "fields"] }
      );

      for (const comp of components) {
        const slug = comp.slug as string;
        if (slug === componentSlug) {
          continue;
        }
        const fields = this.parseJsonField(comp.fields);
        if (fields) {
          const found = this.scanFieldsForComponentRef(
            fields,
            componentSlug,
            slug,
            "component"
          );
          references.push(...found);
        }
      }
    } catch (error) {
      this.logger.debug(
        `Could not scan ${STORAGE_FORMAT.registryTable} for references`,
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    if (references.length > 0) {
      this.logger.debug("Found component references", {
        slug: componentSlug,
        count: references.length,
        references: references.map(
          r => `${r.entityType}:${r.entitySlug}.${r.fieldPath}`
        ),
      });
    }

    return references;
  }

  /**
   * Enrich field configurations with inline component schemas.
   */
  async enrichFieldsWithComponentSchemas(
    fields: Record<string, unknown>[],
    currentDepth = 0
  ): Promise<EnrichedFieldConfig[]> {
    const slugs = this.collectComponentSlugs(fields);

    if (slugs.size === 0) {
      return fields;
    }

    const componentMap = await this.fetchComponentsBySlugsBatch([...slugs]);

    return this.enrichFieldsRecursive(fields, componentMap, currentDepth);
  }

  private collectComponentSlugs(
    fields: Record<string, unknown>[],
    slugs = new Set<string>()
  ): Set<string> {
    for (const field of fields) {
      const fieldType = field.type as string;

      if (fieldType === STORAGE_FORMAT.fieldType) {
        const componentSlug = field.component as string | undefined;
        if (componentSlug) {
          slugs.add(componentSlug);
        }

        const componentsArray = field.components as string[] | undefined;
        if (Array.isArray(componentsArray)) {
          for (const slug of componentsArray) {
            slugs.add(slug);
          }
        }
      }

      const nestedFields = field.fields as
        | Record<string, unknown>[]
        | undefined;
      if (Array.isArray(nestedFields)) {
        this.collectComponentSlugs(nestedFields, slugs);
      }
    }

    return slugs;
  }

  private async fetchComponentsBySlugsBatch(
    slugs: string[]
  ): Promise<Map<string, DynamicFieldGroupRecord>> {
    const componentMap = new Map<string, DynamicFieldGroupRecord>();

    if (slugs.length === 0) {
      return componentMap;
    }

    try {
      const results = await this.adapter.select<DynamicFieldGroupRecord>(
        this.registryTableName,
        {
          where: {
            and: [
              {
                column: "slug",
                op: "IN",
                value: slugs,
              },
            ],
          },
        }
      );

      for (const result of results) {
        const deserialized = this.deserializeRecord(result);
        componentMap.set(deserialized.slug, deserialized);
      }
    } catch (error) {
      this.logger.error(
        "[ComponentRegistry.fetchComponentsBySlugsBatch] Database error",
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    return componentMap;
  }

  private async enrichFieldsRecursive(
    fields: Record<string, unknown>[],
    componentMap: Map<string, DynamicFieldGroupRecord>,
    currentDepth: number
  ): Promise<EnrichedFieldConfig[]> {
    const enrichedFields: EnrichedFieldConfig[] = [];

    for (const field of fields) {
      const fieldType = field.type as string;
      const enrichedField: EnrichedFieldConfig = { ...field };

      if (fieldType === STORAGE_FORMAT.fieldType) {
        const componentSlug = field.component as string | undefined;
        if (componentSlug) {
          const component = componentMap.get(componentSlug);
          if (component) {
            let componentFields = component.fields as unknown as Record<
              string,
              unknown
            >[];
            if (
              currentDepth < MAX_FIELD_GROUP_NESTING_DEPTH &&
              Array.isArray(componentFields)
            ) {
              const nestedSlugs = this.collectComponentSlugs(componentFields);
              if (nestedSlugs.size > 0) {
                const missingSlugsFetch = [...nestedSlugs].filter(
                  s => !componentMap.has(s)
                );
                if (missingSlugsFetch.length > 0) {
                  const nestedMap =
                    await this.fetchComponentsBySlugsBatch(missingSlugsFetch);
                  for (const [slug, record] of nestedMap) {
                    componentMap.set(slug, record);
                  }
                }
                componentFields = await this.enrichFieldsRecursive(
                  componentFields,
                  componentMap,
                  currentDepth + 1
                );
              }
            }
            enrichedField.componentFields = componentFields;
          }
        }

        const componentsArray = field.components as string[] | undefined;
        if (Array.isArray(componentsArray) && componentsArray.length > 0) {
          const componentSchemas: Record<string, EnrichedComponentSchema> = {};

          for (const slug of componentsArray) {
            const component = componentMap.get(slug);
            if (component) {
              let componentFields = component.fields as unknown as Record<
                string,
                unknown
              >[];
              if (
                currentDepth < MAX_FIELD_GROUP_NESTING_DEPTH &&
                Array.isArray(componentFields)
              ) {
                const nestedSlugs = this.collectComponentSlugs(componentFields);
                if (nestedSlugs.size > 0) {
                  const missingSlugsFetch = [...nestedSlugs].filter(
                    s => !componentMap.has(s)
                  );
                  if (missingSlugsFetch.length > 0) {
                    const nestedMap =
                      await this.fetchComponentsBySlugsBatch(missingSlugsFetch);
                    for (const [s, record] of nestedMap) {
                      componentMap.set(s, record);
                    }
                  }
                  componentFields = await this.enrichFieldsRecursive(
                    componentFields,
                    componentMap,
                    currentDepth + 1
                  );
                }
              }

              componentSchemas[slug] = {
                label: component.label,
                fields: componentFields,
                admin: component.admin,
              };
            }
          }

          if (Object.keys(componentSchemas).length > 0) {
            enrichedField.componentSchemas = componentSchemas;
          }
        }
      }

      const nestedFields = field.fields as
        | Record<string, unknown>[]
        | undefined;
      if (Array.isArray(nestedFields)) {
        enrichedField.fields = await this.enrichFieldsRecursive(
          nestedFields,
          componentMap,
          currentDepth
        );
      }

      enrichedFields.push(enrichedField);
    }

    return enrichedFields;
  }

  private parseJsonField(value: unknown): Record<string, unknown>[] | null {
    if (!value) {
      return null;
    }
    try {
      if (typeof value === "string") {
        return JSON.parse(value);
      }
      if (Array.isArray(value)) {
        return value;
      }
      return null;
    } catch {
      return null;
    }
  }

  private scanFieldsForComponentRef(
    fields: Record<string, unknown>[],
    targetSlug: string,
    entitySlug: string,
    entityType: ComponentReference["entityType"],
    parentPath = ""
  ): ComponentReference[] {
    const references: ComponentReference[] = [];

    for (const field of fields) {
      const fieldName = field.name as string;
      if (!fieldName) {
        continue;
      }

      const fieldPath = parentPath ? `${parentPath}.${fieldName}` : fieldName;
      const fieldType = field.type as string;

      if (fieldType === STORAGE_FORMAT.fieldType) {
        if (field.component === targetSlug) {
          references.push({ entityType, entitySlug, fieldName, fieldPath });
        }

        const componentsArray = field.components;
        if (
          Array.isArray(componentsArray) &&
          componentsArray.includes(targetSlug)
        ) {
          references.push({ entityType, entitySlug, fieldName, fieldPath });
        }
      }

      if (
        (fieldType === "repeater" || fieldType === "group") &&
        Array.isArray(field.fields)
      ) {
        const nested = this.scanFieldsForComponentRef(
          field.fields as Record<string, unknown>[],
          targetSlug,
          entitySlug,
          entityType,
          fieldPath
        );
        references.push(...nested);
      }
    }

    return references;
  }

  protected deserializeRecord(
    record: DynamicFieldGroupRecord | Record<string, unknown>
  ): DynamicFieldGroupRecord {
    const r = record as Record<string, unknown>;
    const fields = r.fields as string | object;
    const admin = r.admin as string | object | null;
    const tableName = (r.table_name || r.tableName) as string;
    const configPath = (r.config_path || r.configPath) as string | undefined;
    const schemaHash = (r.schema_hash || r.schemaHash) as string;
    const schemaVersion = (r.schema_version || r.schemaVersion) as number;
    const migrationStatus = (r.migration_status || r.migrationStatus) as string;
    const lastMigrationId = (r.last_migration_id || r.lastMigrationId) as
      | string
      | undefined;
    const createdBy = (r.created_by || r.createdBy) as string | undefined;
    const createdAt = (r.created_at || r.createdAt) as Date | string | number;
    const updatedAt = (r.updated_at || r.updatedAt) as Date | string | number;

    return {
      id: r.id as string,
      slug: r.slug as string,
      label: r.label as string,
      tableName,
      description: r.description as string | undefined,
      fields:
        typeof fields === "string"
          ? (JSON.parse(fields) as DynamicFieldGroupRecord["fields"])
          : (fields as DynamicFieldGroupRecord["fields"]),
      admin: admin
        ? typeof admin === "string"
          ? (JSON.parse(admin) as FieldGroupAdminOptions)
          : admin
        : undefined,
      source: r.source as FieldGroupSource,
      locked: Boolean(r.locked),
      localized: Boolean(r.localized),
      configPath,
      schemaHash,
      schemaVersion,
      migrationStatus: migrationStatus as FieldGroupMigrationStatus,
      lastMigrationId,
      createdBy,
      createdAt: this.normalizeDbTimestamp(createdAt) as unknown as Date,
      updatedAt: this.normalizeDbTimestamp(updatedAt) as unknown as Date,
    };
  }
}
