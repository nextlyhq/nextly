import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { TransactionContext } from "@revnixhq/adapter-drizzle/types";

import type { ComponentAdminOptions } from "../../../components/config/types";
import { MAX_COMPONENT_NESTING_DEPTH } from "../../../components/config/validate-component";
import { ServiceError, ServiceErrorCode } from "../../../errors";
import type {
  DynamicComponentInsert,
  DynamicComponentRecord,
  ComponentMigrationStatus,
  ComponentSource,
} from "../../../schemas/dynamic-components/types";
import { BaseRegistryService } from "../../../shared/base-registry-service";
import type {
  BaseListOptions,
  BaseListResult,
} from "../../../shared/base-registry-service";
import type { Logger } from "../../../shared/types";
import {
  calculateSchemaHash,
  schemaHashesMatch,
} from "../../schema/services/schema-hash";

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
  source?: ComponentSource;
}

/**
 * Input for registering a code-first Component during sync.
 */
export interface CodeFirstComponentConfig {
  slug: string;
  label: string;
  fields: DynamicComponentInsert["fields"];
  description?: string;
  tableName?: string;
  admin?: ComponentAdminOptions;
  configPath?: string;
}

export interface SyncComponentResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  errors: Array<{ slug: string; error: string }>;
}

export interface ListComponentsOptions extends BaseListOptions {
  source?: ComponentSource;
  migrationStatus?: ComponentMigrationStatus;
}

export interface ListComponentsResult
  extends BaseListResult<DynamicComponentRecord> {}

export interface EnrichedComponentSchema {
  label: string;
  fields: Record<string, unknown>[];
  admin?: ComponentAdminOptions;
}

export interface EnrichedFieldConfig extends Record<string, unknown> {
  name?: string;
  type?: string;
  componentFields?: Record<string, unknown>[];
  componentSchemas?: Record<string, EnrichedComponentSchema>;
}

export class ComponentRegistryService extends BaseRegistryService<
  DynamicComponentRecord,
  ComponentMigrationStatus
> {
  protected readonly registryTableName = "dynamic_components";
  protected readonly resourceType = "Component";
  protected readonly tableNamePrefix = "comp_";

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  protected getSearchColumns(): string[] {
    return ["slug", "label"];
  }

  async getComponentBySlug(
    slug: string
  ): Promise<DynamicComponentRecord | null> {
    return this.getRecordBySlug(slug);
  }

  async getComponent(slug: string): Promise<DynamicComponentRecord> {
    return this.getRecordOrThrow(slug);
  }

  async getAllComponents(
    options?: ListComponentsOptions
  ): Promise<DynamicComponentRecord[]> {
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
    status: ComponentMigrationStatus,
    migrationId?: string
  ): Promise<void> {
    return this.updateRecordMigrationStatus(slug, status, migrationId);
  }

  async updateMigrationStatusWithVerification(
    slug: string,
    tableName: string
  ): Promise<{ verified: boolean; status: ComponentMigrationStatus }> {
    return this.updateMigrationStatusWithTableVerification(slug, tableName);
  }

  async getPendingMigrations(): Promise<DynamicComponentRecord[]> {
    return this.getRecordsWithPendingMigrations();
  }

  /**
   * Register a new Component in the registry.
   *
   * @throws ServiceError if Component with same slug already exists
   */
  async registerComponent(
    data: DynamicComponentInsert
  ): Promise<DynamicComponentRecord> {
    this.logger.debug("Registering Component", { slug: data.slug });

    const existing = await this.getComponentBySlug(data.slug);
    if (existing) {
      throw new ServiceError(
        ServiceErrorCode.DUPLICATE_KEY,
        `Component with slug "${data.slug}" already exists`,
        { slug: data.slug }
      );
    }

    const now = this.formatDateForDb();
    const tableName = this.ensureTableNamePrefix(data.tableName);
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
      const result = await this.adapter.insert<DynamicComponentRecord>(
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
      throw ServiceError.fromDatabaseError(error);
    }
  }

  async registerComponentInTransaction(
    tx: TransactionContext,
    data: DynamicComponentInsert
  ): Promise<DynamicComponentRecord> {
    const existing = await tx.selectOne<DynamicComponentRecord>(
      this.registryTableName,
      {
        where: this.whereEq("slug", data.slug),
      }
    );

    if (existing) {
      throw new ServiceError(
        ServiceErrorCode.DUPLICATE_KEY,
        `Component with slug "${data.slug}" already exists`,
        { slug: data.slug }
      );
    }

    const now = this.formatDateForDb();
    const tableName = this.ensureTableNamePrefix(data.tableName);
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
      config_path: data.configPath,
      schema_hash: data.schemaHash,
      schema_version: data.schemaVersion ?? 1,
      migration_status: data.migrationStatus ?? "pending",
      last_migration_id: data.lastMigrationId,
      created_by: data.createdBy,
      created_at: now,
      updated_at: now,
    };

    const result = await tx.insert<DynamicComponentRecord>(
      this.registryTableName,
      record,
      { returning: "*" }
    );

    return this.deserializeRecord(result);
  }

  /**
   * Update a Component's metadata.
   *
   * @throws ServiceError if Component not found or locked
   */
  async updateComponent(
    slug: string,
    data: Partial<DynamicComponentInsert>,
    options?: UpdateComponentOptions
  ): Promise<DynamicComponentRecord> {
    this.logger.debug("Updating Component", { slug });

    const existing = await this.getComponent(slug);

    if (existing.locked && options?.source !== "code") {
      throw ServiceError.forbidden(
        `Component "${slug}" is locked and cannot be modified from ${options?.source ?? "UI"}`,
        { slug, source: options?.source }
      );
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

    if (data.configPath !== undefined) {
      updateData.config_path = data.configPath;
    }

    try {
      const results = await this.adapter.update<DynamicComponentRecord>(
        this.registryTableName,
        updateData,
        this.whereEq("slug", slug),
        { returning: "*" }
      );

      if (results.length === 0) {
        throw ServiceError.notFound(`Component "${slug}" not found`, {
          slug,
        });
      }

      this.logger.info("Component updated", { slug });

      return this.deserializeRecord(results[0]);
    } catch (error) {
      if (error instanceof ServiceError) {
        throw error;
      }
      throw ServiceError.fromDatabaseError(error);
    }
  }

  /**
   * Delete a Component from the registry.
   */
  async deleteComponent(slug: string): Promise<void> {
    this.logger.debug("Deleting Component", { slug });

    const existing = await this.getComponent(slug);

    if (existing.locked) {
      throw ServiceError.forbidden(
        `Component "${slug}" is locked and cannot be deleted`,
        { slug }
      );
    }

    const references = await this.findComponentReferences(slug);

    if (references.length > 0) {
      const refDescriptions = references.map(
        (ref: ComponentReference) =>
          `${ref.entityType} "${ref.entitySlug}" in field "${ref.fieldPath}"`
      );

      throw ServiceError.conflict(
        `Cannot delete component "${slug}": referenced by ${refDescriptions.join(", ")}`,
        { slug, references }
      );
    }

    try {
      // Drop the component's data table FIRST. If it fails, the registry entry
      // stays intact so the error is surfaced with no partial-deletion state.
      await this.dropComponentTable(existing.tableName);

      // PG RETURNING-less DELETE always returns 0 rows, so no post-delete count check.
      await this.adapter.delete(
        this.registryTableName,
        this.whereEq("slug", slug)
      );

      this.logger.info("Component deleted", { slug });
    } catch (error) {
      if (error instanceof ServiceError) {
        throw error;
      }
      throw ServiceError.fromDatabaseError(error);
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

        if (!existing) {
          await this.registerComponent({
            slug: config.slug,
            label: config.label,
            tableName: config.tableName ?? this.generateTableName(config.slug),
            description: config.description,
            fields: config.fields,
            admin: config.admin,
            source: "code",
            locked: true,
            configPath: config.configPath,
            schemaHash,
          });
          result.created.push(config.slug);
        } else if (!schemaHashesMatch(schemaHash, existing.schemaHash)) {
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
      this.logger.debug("Could not scan dynamic_components for references", {
        error: error instanceof Error ? error.message : String(error),
      });
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
      return fields as EnrichedFieldConfig[];
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

      if (fieldType === "component") {
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
  ): Promise<Map<string, DynamicComponentRecord>> {
    const componentMap = new Map<string, DynamicComponentRecord>();

    if (slugs.length === 0) {
      return componentMap;
    }

    try {
      const results = await this.adapter.select<DynamicComponentRecord>(
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
    componentMap: Map<string, DynamicComponentRecord>,
    currentDepth: number
  ): Promise<EnrichedFieldConfig[]> {
    const enrichedFields: EnrichedFieldConfig[] = [];

    for (const field of fields) {
      const fieldType = field.type as string;
      const enrichedField: EnrichedFieldConfig = { ...field };

      if (fieldType === "component") {
        const componentSlug = field.component as string | undefined;
        if (componentSlug) {
          const component = componentMap.get(componentSlug);
          if (component) {
            let componentFields = component.fields as unknown as Record<
              string,
              unknown
            >[];
            if (
              currentDepth < MAX_COMPONENT_NESTING_DEPTH &&
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
                currentDepth < MAX_COMPONENT_NESTING_DEPTH &&
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
                admin: component.admin as ComponentAdminOptions | undefined,
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

      if (fieldType === "component") {
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
    record: DynamicComponentRecord | Record<string, unknown>
  ): DynamicComponentRecord {
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
          ? (JSON.parse(fields) as DynamicComponentRecord["fields"])
          : (fields as DynamicComponentRecord["fields"]),
      admin: admin
        ? typeof admin === "string"
          ? (JSON.parse(admin) as ComponentAdminOptions)
          : (admin as ComponentAdminOptions)
        : undefined,
      source: r.source as ComponentSource,
      locked: Boolean(r.locked),
      configPath,
      schemaHash,
      schemaVersion,
      migrationStatus: migrationStatus as ComponentMigrationStatus,
      lastMigrationId,
      createdBy,
      createdAt: this.normalizeDbTimestamp(createdAt) as unknown as Date,
      updatedAt: this.normalizeDbTimestamp(updatedAt) as unknown as Date,
    };
  }
}
