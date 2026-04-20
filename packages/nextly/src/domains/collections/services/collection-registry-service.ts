/**
 * Collection Registry Service
 *
 * Manages the `dynamic_collections` metadata table for both code-first
 * and UI-created collections. Provides schema hash-based change detection
 * for code-first collection syncing.
 *
 * Extends BaseRegistryService for shared CRUD, migration tracking, and utility patterns.
 *
 * @module services/collections/collection-registry-service
 * @since 1.0.0
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { TransactionContext } from "@revnixhq/adapter-drizzle/types";

import { ServiceError, ServiceErrorCode } from "../../../errors";
import type {
  DynamicCollectionInsert,
  DynamicCollectionRecord,
  MigrationStatus,
  CollectionSource,
} from "../../../schemas/dynamic-collections/types";
import type { PermissionSeedService } from "../../../services/auth/permission-seed-service";
import { assertGlobalResourceSlugAvailable } from "../../../services/lib/resource-slug-guard";
import type { Logger } from "../../../services/shared";
import { BaseRegistryService } from "../../../shared/base-registry-service";
import type {
  BaseListOptions,
  BaseListResult,
} from "../../../shared/base-registry-service";
import {
  calculateSchemaHash,
  schemaHashesMatch,
} from "../../schema/services/schema-hash";

/** Options for updating a collection. */
export interface UpdateCollectionOptions {
  /** Source making the update. Used to enforce locking rules. */
  source?: CollectionSource;
}

/** Input for registering a code-first collection during sync. */
export interface CodeFirstCollectionConfig {
  slug: string;
  labels: { singular: string; plural: string };
  fields: DynamicCollectionInsert["fields"];
  description?: string;
  tableName?: string;
  timestamps?: boolean;
  admin?: DynamicCollectionInsert["admin"];
  configPath?: string;
}

/** Result of syncing code-first collections. */
export interface SyncResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  errors: Array<{ slug: string; error: string }>;
}

/** Options for listing collections. */
export interface ListCollectionsOptions extends BaseListOptions {
  source?: CollectionSource;
  migrationStatus?: MigrationStatus;
}

/** Result of listing collections with pagination info. */
export interface ListCollectionsResult
  extends BaseListResult<DynamicCollectionRecord> {}

export class CollectionRegistryService extends BaseRegistryService<
  DynamicCollectionRecord,
  MigrationStatus
> {
  protected readonly registryTableName = "dynamic_collections";
  protected readonly resourceType = "Collection";
  protected readonly tableNamePrefix = "dc_";

  private permissionSeedService?: PermissionSeedService;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  protected getSearchColumns(): string[] {
    return ["slug"];
  }

  /** Set the PermissionSeedService for auto-seeding permissions on collection sync. */
  setPermissionSeedService(service: PermissionSeedService): void {
    this.permissionSeedService = service;
  }

  async getCollectionBySlug(
    slug: string
  ): Promise<DynamicCollectionRecord | null> {
    return this.getRecordBySlug(slug);
  }

  async getCollection(slug: string): Promise<DynamicCollectionRecord> {
    return this.getRecordOrThrow(slug);
  }

  async getAllCollections(
    options?: ListCollectionsOptions
  ): Promise<DynamicCollectionRecord[]> {
    return this.getAllRecords(options);
  }

  async listCollections(
    options?: ListCollectionsOptions
  ): Promise<ListCollectionsResult> {
    return this.listRecords(options);
  }

  async isLocked(slug: string): Promise<boolean> {
    return this.checkIsLocked(slug);
  }

  async updateMigrationStatus(
    slug: string,
    status: MigrationStatus,
    migrationId?: string
  ): Promise<void> {
    return this.updateRecordMigrationStatus(slug, status, migrationId);
  }

  async updateMigrationStatusWithVerification(
    slug: string,
    tableName: string
  ): Promise<{ verified: boolean; status: MigrationStatus }> {
    return this.updateMigrationStatusWithTableVerification(slug, tableName);
  }

  async getPendingMigrations(): Promise<DynamicCollectionRecord[]> {
    return this.getRecordsWithPendingMigrations();
  }

  async registerCollection(
    data: DynamicCollectionInsert
  ): Promise<DynamicCollectionRecord> {
    this.logger.debug("Registering collection", { slug: data.slug });

    await assertGlobalResourceSlugAvailable(this.adapter, data.slug);

    const existing = await this.getCollectionBySlug(data.slug);
    if (existing) {
      throw new ServiceError(
        ServiceErrorCode.DUPLICATE_KEY,
        `Collection with slug "${data.slug}" already exists`,
        { slug: data.slug }
      );
    }

    const now = this.formatDateForDb();
    const tableName = this.ensureTableNamePrefix(data.tableName);
    const fieldsJson = JSON.stringify(data.fields);
    const schemaHash = data.schemaHash ?? this.computeSimpleHash(fieldsJson);

    const record: Record<string, unknown> = {
      id: this.generateId(),
      slug: data.slug,
      labels: JSON.stringify(data.labels),
      table_name: tableName,
      description: data.description,
      fields: fieldsJson,
      timestamps: (data.timestamps ?? true) ? 1 : 0,
      admin: data.admin ? JSON.stringify(data.admin) : null,
      source: data.source,
      locked: (data.locked ?? data.source === "code") ? 1 : 0,
      config_path: data.configPath,
      schema_hash: schemaHash,
      schema_version: data.schemaVersion ?? 1,
      migration_status: data.migrationStatus ?? "pending",
      last_migration_id: data.lastMigrationId,
      created_by: data.createdBy,
      hooks: data.hooks ? JSON.stringify(data.hooks) : null,
      created_at: now,
      updated_at: now,
    };

    try {
      const result = await this.adapter.insert<DynamicCollectionRecord>(
        this.registryTableName,
        record,
        { returning: "*" }
      );

      this.logger.info("Collection registered", {
        slug: data.slug,
        source: data.source,
      });

      const deserializedRecord = this.deserializeRecord(result);

      if (this.permissionSeedService && data.slug) {
        try {
          const permResult =
            await this.permissionSeedService.seedCollectionPermissions(
              data.slug
            );
          if (permResult.newPermissionIds?.length > 0) {
            await this.permissionSeedService.assignNewPermissionsToSuperAdmin(
              permResult.newPermissionIds
            );
          }
          this.logger.info("Collection permissions seeded", {
            slug: data.slug,
            created: permResult.created,
            total: permResult.total,
          });
        } catch (permError) {
          this.logger.error("Failed to seed collection permissions", {
            slug: data.slug,
            error: String(permError),
          });
        }
      }

      return deserializedRecord;
    } catch (error) {
      throw ServiceError.fromDatabaseError(error);
    }
  }

  async updateCollection(
    slug: string,
    data: Partial<DynamicCollectionInsert>,
    options?: UpdateCollectionOptions
  ): Promise<DynamicCollectionRecord> {
    this.logger.debug("Updating collection", { slug });

    const existing = await this.getCollection(slug);

    const targetSlug = data.slug ?? slug;
    await assertGlobalResourceSlugAvailable(this.adapter, targetSlug, {
      currentResourceType: "collection",
      currentResourceId: existing.id,
    });

    if (existing.locked && options?.source !== "code") {
      throw ServiceError.forbidden(
        `Collection "${slug}" is locked and cannot be modified from ${options?.source ?? "UI"}`,
        { slug, source: options?.source }
      );
    }

    const updateData: Record<string, unknown> = {
      updated_at: this.formatDateForDb(),
    };

    if (data.labels) {
      updateData.labels = JSON.stringify(data.labels);
    }
    if (data.description !== undefined) {
      updateData.description = data.description;
    }
    if (data.fields) {
      updateData.fields = JSON.stringify(data.fields);
      updateData.schema_version = existing.schemaVersion + 1;
      updateData.migration_status = "pending";
    }
    if (data.timestamps !== undefined) {
      updateData.timestamps = data.timestamps;
    }
    if (data.admin !== undefined) {
      updateData.admin = data.admin ? JSON.stringify(data.admin) : null;
    }
    if (data.schemaHash) {
      updateData.schema_hash = data.schemaHash;
    }
    if (data.locked !== undefined) {
      updateData.locked = data.locked;
    }
    if (data.configPath !== undefined) {
      updateData.config_path = data.configPath;
    }
    if (data.hooks !== undefined) {
      updateData.hooks = data.hooks ? JSON.stringify(data.hooks) : null;
    }

    try {
      const results = await this.adapter.update<DynamicCollectionRecord>(
        this.registryTableName,
        updateData,
        this.whereEq("slug", slug),
        { returning: "*" }
      );

      if (results.length === 0) {
        throw ServiceError.notFound(`Collection "${slug}" not found`, {
          slug,
        });
      }

      this.logger.info("Collection updated", { slug });

      return this.deserializeRecord(results[0]);
    } catch (error) {
      if (error instanceof ServiceError) {
        throw error;
      }
      throw ServiceError.fromDatabaseError(error);
    }
  }

  async deleteCollection(slug: string): Promise<void> {
    this.logger.debug("Deleting collection", { slug });

    const existing = await this.getCollection(slug);

    if (existing.locked) {
      throw ServiceError.forbidden(
        `Collection "${slug}" is locked and cannot be deleted`,
        { slug }
      );
    }

    try {
      const count = await this.adapter.delete(
        this.registryTableName,
        this.whereEq("slug", slug)
      );

      if (count === 0) {
        throw ServiceError.notFound(`Collection "${slug}" not found`, {
          slug,
        });
      }

      this.logger.info("Collection deleted", { slug });
    } catch (error) {
      if (error instanceof ServiceError) {
        throw error;
      }
      throw ServiceError.fromDatabaseError(error);
    }
  }

  async syncCodeFirstCollections(
    configs: CodeFirstCollectionConfig[]
  ): Promise<SyncResult> {
    this.logger.info("Syncing code-first collections", {
      count: configs.length,
    });

    const result: SyncResult = {
      created: [],
      updated: [],
      unchanged: [],
      errors: [],
    };

    for (const config of configs) {
      try {
        const existing = await this.getCollectionBySlug(config.slug);
        const schemaHash = calculateSchemaHash(config.fields);

        if (!existing) {
          await this.registerCollection({
            slug: config.slug,
            labels: config.labels,
            tableName: config.tableName ?? this.generateTableName(config.slug),
            description: config.description,
            fields: config.fields,
            timestamps: config.timestamps ?? true,
            admin: config.admin,
            source: "code",
            locked: true,
            configPath: config.configPath,
            schemaHash,
          });
          result.created.push(config.slug);
          await this.seedPermissionsForCollection(config.slug);
        } else if (!schemaHashesMatch(schemaHash, existing.schemaHash)) {
          await this.updateCollection(
            config.slug,
            {
              labels: config.labels,
              description: config.description,
              fields: config.fields,
              timestamps: config.timestamps,
              admin: config.admin,
              configPath: config.configPath,
              schemaHash,
              locked: true,
            },
            { source: "code" }
          );
          result.updated.push(config.slug);
          await this.seedPermissionsForCollection(config.slug);
        } else if (
          this.adminConfigChanged(config.admin, existing.admin) ||
          this.labelsChanged(config.labels, existing.labels)
        ) {
          await this.updateCollection(
            config.slug,
            {
              labels: config.labels,
              admin: config.admin,
              locked: true,
            },
            { source: "code" }
          );
          result.updated.push(config.slug);
        } else {
          await this.seedPermissionsForCollection(config.slug);
          result.unchanged.push(config.slug);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isDuplicate =
          message.toLowerCase().includes("already exists") ||
          message.toLowerCase().includes("duplicate") ||
          message.toLowerCase().includes("unique constraint");
        if (isDuplicate) {
          const refetched = await this.getCollectionBySlug(config.slug).catch(
            () => null
          );
          if (refetched) {
            this.logger.warn(
              `Code-first sync: "${config.slug}" already in DB — treating as unchanged`,
              { slug: config.slug }
            );
            result.unchanged.push(config.slug);
          } else {
            const disambiguatedTableName = `dc_${config.slug.replace(/-/g, "_")}_cf`;
            try {
              const retrySchemaHash = calculateSchemaHash(config.fields);
              await this.registerCollection({
                slug: config.slug,
                labels: config.labels,
                tableName: disambiguatedTableName,
                description: config.description,
                fields: config.fields,
                timestamps: config.timestamps ?? true,
                admin: config.admin,
                source: "code",
                locked: true,
                configPath: config.configPath,
                schemaHash: retrySchemaHash,
              });
              this.logger.warn(
                `Code-first sync: "${config.slug}" had table_name conflict — registered with table "${disambiguatedTableName}"`,
                { slug: config.slug, tableName: disambiguatedTableName }
              );
              result.created.push(config.slug);
            } catch (retryError) {
              const retryMessage =
                retryError instanceof Error
                  ? retryError.message
                  : String(retryError);
              result.errors.push({
                slug: config.slug,
                error: `table_name conflict (tried "${disambiguatedTableName}"): ${retryMessage}`,
              });
            }
          }
        } else {
          result.errors.push({ slug: config.slug, error: message });
        }
      }
    }

    this.logger.info("Code-first sync completed", {
      created: result.created.length,
      updated: result.updated.length,
      unchanged: result.unchanged.length,
      errors: result.errors.length,
    });

    return result;
  }

  async registerCollectionInTransaction(
    tx: TransactionContext,
    data: DynamicCollectionInsert
  ): Promise<DynamicCollectionRecord> {
    await assertGlobalResourceSlugAvailable(this.adapter, data.slug);

    const existing = await tx.selectOne<DynamicCollectionRecord>(
      this.registryTableName,
      {
        where: this.whereEq("slug", data.slug),
      }
    );

    if (existing) {
      throw new ServiceError(
        ServiceErrorCode.DUPLICATE_KEY,
        `Collection with slug "${data.slug}" already exists`,
        { slug: data.slug }
      );
    }

    const now = this.formatDateForDb();
    const record: Record<string, unknown> = {
      id: this.generateId(),
      slug: data.slug,
      labels: JSON.stringify(data.labels),
      table_name: data.tableName,
      description: data.description,
      fields: JSON.stringify(data.fields),
      timestamps: (data.timestamps ?? true) ? 1 : 0,
      admin: data.admin ? JSON.stringify(data.admin) : null,
      source: data.source,
      locked: (data.locked ?? data.source === "code") ? 1 : 0,
      config_path: data.configPath,
      schema_hash: data.schemaHash,
      schema_version: data.schemaVersion ?? 1,
      migration_status: data.migrationStatus ?? "pending",
      last_migration_id: data.lastMigrationId,
      created_by: data.createdBy,
      hooks: data.hooks ? JSON.stringify(data.hooks) : null,
      created_at: now,
      updated_at: now,
    };

    const result = await tx.insert<DynamicCollectionRecord>(
      this.registryTableName,
      record,
      { returning: "*" }
    );

    return this.deserializeRecord(result);
  }

  private async seedPermissionsForCollection(slug: string): Promise<void> {
    if (!this.permissionSeedService) return;

    try {
      const result =
        await this.permissionSeedService.seedCollectionPermissions(slug);

      if (result.newPermissionIds.length > 0) {
        await this.permissionSeedService.assignNewPermissionsToSuperAdmin(
          result.newPermissionIds
        );
      }

      if (result.created > 0) {
        this.logger.info(
          `Permissions seeded for collection "${slug}": ${result.created} created, ${result.skipped} already existed`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to seed permissions for collection "${slug}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private labelsChanged(
    codeLabels: { singular: string; plural: string } | undefined,
    existingLabels: unknown
  ): boolean {
    if (!codeLabels && !existingLabels) return false;
    if (!codeLabels || !existingLabels) return true;
    const existing =
      typeof existingLabels === "string"
        ? JSON.parse(existingLabels)
        : existingLabels;
    return (
      codeLabels.singular !== existing.singular ||
      codeLabels.plural !== existing.plural
    );
  }

  protected deserializeRecord(
    record: DynamicCollectionRecord | Record<string, unknown>
  ): DynamicCollectionRecord {
    const r = record as Record<string, unknown>;
    const labels = (r.labels || r.labels) as string | object;
    const fields = (r.fields || r.fields) as string | object;
    const admin = (r.admin || r.admin) as string | object | null;
    const hooks = (r.hooks || r.hooks) as string | object | null;
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
      tableName,
      description: r.description as string | undefined,
      labels: typeof labels === "string" ? JSON.parse(labels) : labels,
      fields: typeof fields === "string" ? JSON.parse(fields) : fields,
      timestamps: r.timestamps as boolean,
      admin: admin
        ? typeof admin === "string"
          ? JSON.parse(admin)
          : admin
        : undefined,
      hooks: hooks
        ? typeof hooks === "string"
          ? JSON.parse(hooks)
          : hooks
        : undefined,
      source: r.source as "code" | "ui" | "built-in",
      locked: r.locked as boolean,
      configPath,
      schemaHash,
      schemaVersion,
      migrationStatus: migrationStatus as MigrationStatus,
      lastMigrationId,
      createdBy,
      updatedAt: this.normalizeDbTimestamp(updatedAt) as string & Date,
      createdAt: this.normalizeDbTimestamp(createdAt) as string & Date,
    };
  }
}
