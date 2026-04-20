/**
 * Single Registry Service
 *
 * Unified registry for managing both code-first and UI-created Singles.
 * Central point for registering, updating, syncing, and inspecting
 * Single metadata (not data — data lives in `single_{slug}` tables).
 *
 * Extends {@link BaseRegistryService} for shared CRUD, migration
 * tracking, and utility patterns. Single-specific responsibilities:
 *
 * - Code-first sync with schema hash change detection
 * - Source locking (code-first Singles are read-only from the UI)
 * - Force-required delete (Singles are meant to persist)
 * - Permission seeding via PermissionSeedService
 * - Transaction-scoped registration for atomic multi-step flows
 *
 * Key differences from CollectionRegistryService and ComponentRegistryService:
 * - Singles use a singular `label` string (no plural form)
 * - Singles use `single_` table prefix instead of `dc_` or `comp_`
 * - Delete requires `force: true` (Singles should persist)
 * - Access rules only support `read` and `update` (no `create`/`delete`)
 * - Source includes `"built-in"` alongside `"code"` and `"ui"`
 *
 * @module domains/singles/services/single-registry-service
 * @since 1.0.0
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { TransactionContext } from "@revnixhq/adapter-drizzle/types";

import { ServiceError, ServiceErrorCode } from "../../../errors";
import type {
  DynamicSingleInsert,
  DynamicSingleRecord,
  SingleMigrationStatus,
  SingleSource,
} from "../../../schemas/dynamic-singles/types";
import type { PermissionSeedService } from "../../../services/auth/permission-seed-service";
import { assertGlobalResourceSlugAvailable } from "../../../services/lib/resource-slug-guard";
import {
  BaseRegistryService,
  type BaseListOptions,
  type BaseListResult,
} from "../../../shared/base-registry-service";
import type { Logger } from "../../../shared/types";
import {
  calculateSchemaHash,
  schemaHashesMatch,
} from "../../schema/services/schema-hash";

// ============================================================
// Types
// ============================================================

/**
 * Options for updating a Single from the registry.
 */
export interface UpdateSingleOptions {
  /**
   * Source making the update.
   * Used to enforce locking rules (code-first Singles can't be updated from UI).
   */
  source?: SingleSource;
}

/**
 * Options for deleting a Single.
 */
export interface DeleteSingleOptions {
  /**
   * Force deletion even for locked Singles.
   * Required because Singles should normally persist.
   * Use only for admin/CLI operations to clean up orphaned Singles.
   */
  force?: boolean;
}

/**
 * Input for registering a code-first Single during sync.
 */
export interface CodeFirstSingleConfig {
  /** Unique slug identifier */
  slug: string;

  /** Display label */
  label: string;

  /** Field configurations */
  fields: DynamicSingleInsert["fields"];

  /** Optional description */
  description?: string;

  /** Optional table name (defaults to single_${slug}) */
  tableName?: string;

  /** Admin UI configuration */
  admin?: DynamicSingleInsert["admin"];

  /** Path to the config file */
  configPath?: string;
}

/**
 * Result of syncing code-first Singles.
 */
export interface SyncSingleResult {
  /** Slugs of newly created Singles */
  created: string[];

  /** Slugs of Singles that were updated (schema changed) */
  updated: string[];

  /** Slugs of Singles that were unchanged */
  unchanged: string[];

  /** Errors encountered during sync */
  errors: Array<{ slug: string; error: string }>;
}

/**
 * Options for listing Singles.
 */
export interface ListSinglesOptions extends BaseListOptions {
  source?: SingleSource;
  migrationStatus?: SingleMigrationStatus;
}

/**
 * Result of listing Singles with pagination info.
 */
export type ListSinglesResult = BaseListResult<DynamicSingleRecord>;

// ============================================================
// Service Implementation
// ============================================================

/**
 * Single Registry Service
 *
 * Manages the `dynamic_singles` metadata table for both code-first
 * and UI-created Singles. Provides schema hash-based change detection
 * for code-first Single syncing.
 */
export class SingleRegistryService extends BaseRegistryService<
  DynamicSingleRecord,
  SingleMigrationStatus
> {
  protected readonly registryTableName = "dynamic_singles";
  protected readonly resourceType = "Single";
  protected readonly tableNamePrefix = "single_";

  /** Optional PermissionSeedService for auto-permission management. */
  private permissionSeedService?: PermissionSeedService;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  protected getSearchColumns(): string[] {
    return ["slug", "label"];
  }

  /**
   * Set the PermissionSeedService for auto-seeding permissions on single changes.
   * Called from DI registration after both services are constructed.
   */
  setPermissionSeedService(service: PermissionSeedService): void {
    this.permissionSeedService = service;
  }

  // ============================================================
  // Public API — Delegates to BaseRegistryService
  // ============================================================

  async getSingleBySlug(slug: string): Promise<DynamicSingleRecord | null> {
    return this.getRecordBySlug(slug);
  }

  async getSingle(slug: string): Promise<DynamicSingleRecord> {
    return this.getRecordOrThrow(slug);
  }

  async getAllSingles(
    options?: ListSinglesOptions
  ): Promise<DynamicSingleRecord[]> {
    return this.getAllRecords(options);
  }

  async listSingles(options?: ListSinglesOptions): Promise<ListSinglesResult> {
    return this.listRecords(options);
  }

  async isLocked(slug: string): Promise<boolean> {
    return this.checkIsLocked(slug);
  }

  async updateMigrationStatus(
    slug: string,
    status: SingleMigrationStatus,
    migrationId?: string
  ): Promise<void> {
    return this.updateRecordMigrationStatus(slug, status, migrationId);
  }

  async updateMigrationStatusWithVerification(
    slug: string,
    tableName: string
  ): Promise<{ verified: boolean; status: SingleMigrationStatus }> {
    return this.updateMigrationStatusWithTableVerification(slug, tableName);
  }

  async getPendingMigrations(): Promise<DynamicSingleRecord[]> {
    return this.getRecordsWithPendingMigrations();
  }

  // ============================================================
  // Single-Specific: Registration
  // ============================================================

  /**
   * Register a new Single in the registry.
   *
   * @throws ServiceError if Single with same slug already exists
   */
  async registerSingle(
    data: DynamicSingleInsert
  ): Promise<DynamicSingleRecord> {
    this.logger.debug("Registering Single", { slug: data.slug });

    await assertGlobalResourceSlugAvailable(this.adapter, data.slug);

    const existing = await this.getSingleBySlug(data.slug);
    if (existing) {
      throw new ServiceError(
        ServiceErrorCode.DUPLICATE_KEY,
        `Single with slug "${data.slug}" already exists`,
        { slug: data.slug }
      );
    }

    const fieldsJson = JSON.stringify(data.fields);
    const schemaHash = data.schemaHash ?? this.computeSimpleHash(fieldsJson);
    const record = this.buildInsertRecord(data, fieldsJson, schemaHash);

    try {
      const result = await this.adapter.insert<DynamicSingleRecord>(
        this.registryTableName,
        record,
        { returning: "*" }
      );

      this.logger.info("Single registered", {
        slug: data.slug,
        source: data.source,
      });

      await this.seedPermissionsForSingle(data.slug);

      return this.deserializeRecord(result);
    } catch (error) {
      throw ServiceError.fromDatabaseError(error);
    }
  }

  /**
   * Register a Single within a transaction.
   */
  async registerSingleInTransaction(
    tx: TransactionContext,
    data: DynamicSingleInsert
  ): Promise<DynamicSingleRecord> {
    await assertGlobalResourceSlugAvailable(this.adapter, data.slug);

    const existing = await tx.selectOne<DynamicSingleRecord>(
      this.registryTableName,
      {
        where: this.whereEq("slug", data.slug),
      }
    );

    if (existing) {
      throw new ServiceError(
        ServiceErrorCode.DUPLICATE_KEY,
        `Single with slug "${data.slug}" already exists`,
        { slug: data.slug }
      );
    }

    const fieldsJson = JSON.stringify(data.fields);
    const record = this.buildInsertRecord(
      data,
      fieldsJson,
      data.schemaHash ?? this.computeSimpleHash(fieldsJson)
    );

    const result = await tx.insert<DynamicSingleRecord>(
      this.registryTableName,
      record,
      { returning: "*" }
    );

    return this.deserializeRecord(result);
  }

  // ============================================================
  // Single-Specific: Update
  // ============================================================

  /**
   * Update a Single's metadata.
   *
   * @throws ServiceError if Single not found or locked and not from code source
   */
  async updateSingle(
    slug: string,
    data: Partial<DynamicSingleInsert>,
    options?: UpdateSingleOptions
  ): Promise<DynamicSingleRecord> {
    this.logger.debug("Updating Single", { slug });

    const existing = await this.getSingle(slug);

    const targetSlug = data.slug ?? slug;
    await assertGlobalResourceSlugAvailable(this.adapter, targetSlug, {
      currentResourceType: "single",
      currentResourceId: existing.id,
    });

    if (existing.locked && options?.source !== "code") {
      throw ServiceError.forbidden(
        `Single "${slug}" is locked and cannot be modified from ${options?.source ?? "UI"}`,
        { slug, source: options?.source }
      );
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date(),
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

    if (data.accessRules !== undefined) {
      updateData.access_rules = data.accessRules
        ? JSON.stringify(data.accessRules)
        : null;
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
      const results = await this.adapter.update<DynamicSingleRecord>(
        this.registryTableName,
        updateData,
        this.whereEq("slug", slug),
        { returning: "*" }
      );

      if (results.length === 0) {
        throw ServiceError.notFound(`Single "${slug}" not found`, { slug });
      }

      this.logger.info("Single updated", { slug });

      return this.deserializeRecord(results[0]);
    } catch (error) {
      if (error instanceof ServiceError) {
        throw error;
      }
      throw ServiceError.fromDatabaseError(error);
    }
  }

  // ============================================================
  // Single-Specific: Delete
  // ============================================================

  /**
   * Delete a Single from the registry.
   *
   * Singles represent persistent site-wide config, so deletion requires
   * `force: true`. Use only for admin/CLI operations to clean up orphans.
   */
  async deleteSingle(
    slug: string,
    options?: DeleteSingleOptions
  ): Promise<void> {
    this.logger.debug("Deleting Single", { slug, force: options?.force });

    const existing = await this.getSingle(slug);

    if (!options?.force) {
      throw ServiceError.forbidden(
        `Single "${slug}" cannot be deleted. Singles represent persistent site-wide configuration. ` +
          `Use { force: true } for admin/CLI cleanup operations.`,
        { slug }
      );
    }

    if (existing.locked) {
      this.logger.warn("Force deleting locked Single", {
        slug,
        source: existing.source,
      });
    }

    try {
      const count = await this.adapter.delete(
        this.registryTableName,
        this.whereEq("slug", slug)
      );

      if (count === 0) {
        throw ServiceError.notFound(`Single "${slug}" not found`, { slug });
      }

      this.logger.info("Single deleted", { slug, force: true });

      if (this.permissionSeedService) {
        try {
          const permissionResult =
            await this.permissionSeedService.deletePermissionsForResource(slug);

          if (permissionResult.created > 0) {
            this.logger.info(
              `Deleted ${permissionResult.created} permission(s) for single "${slug}"`
            );
          }

          if (permissionResult.skipped > 0) {
            this.logger.warn(
              `${permissionResult.skipped} permission(s) for "${slug}" could not be deleted (may be assigned to roles)`
            );
          }
        } catch (error) {
          this.logger.warn(
            `Failed to cleanup permissions for single "${slug}": ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    } catch (error) {
      if (error instanceof ServiceError) {
        throw error;
      }
      throw ServiceError.fromDatabaseError(error);
    }
  }

  // ============================================================
  // Single-Specific: Code-First Sync
  // ============================================================

  /**
   * Sync code-first Singles with the registry.
   *
   * Compares schema hashes to detect changes and creates/updates
   * Singles as needed. Typically called during application startup.
   */
  async syncCodeFirstSingles(
    configs: CodeFirstSingleConfig[]
  ): Promise<SyncSingleResult> {
    this.logger.info("Syncing code-first Singles", {
      count: configs.length,
    });

    const result: SyncSingleResult = {
      created: [],
      updated: [],
      unchanged: [],
      errors: [],
    };

    for (const config of configs) {
      try {
        const existing = await this.getSingleBySlug(config.slug);
        const schemaHash = calculateSchemaHash(config.fields);

        if (!existing) {
          await this.registerSingle({
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
          await this.seedPermissionsForSingle(config.slug);
        } else if (!schemaHashesMatch(schemaHash, existing.schemaHash)) {
          await this.updateSingle(
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
          await this.seedPermissionsForSingle(config.slug);
        } else {
          // No changes — still ensure permissions exist (idempotent)
          await this.seedPermissionsForSingle(config.slug);
          result.unchanged.push(config.slug);
        }
      } catch (error) {
        const handled = await this.handleSyncError(config, error);
        if (handled.status === "unchanged") {
          result.unchanged.push(config.slug);
        } else if (handled.status === "created") {
          result.created.push(config.slug);
        } else {
          result.errors.push({ slug: config.slug, error: handled.error });
        }
      }
    }

    this.logger.info("Code-first Single sync completed", {
      created: result.created.length,
      updated: result.updated.length,
      unchanged: result.unchanged.length,
      errors: result.errors.length,
    });

    return result;
  }

  // ============================================================
  // Abstract Implementation
  // ============================================================

  /**
   * Deserialize a raw DB row into a typed {@link DynamicSingleRecord}.
   *
   * Handles snake_case-to-camelCase normalization and JSON column parsing
   * so callers always receive the canonical record shape regardless of
   * which adapter returned it.
   */
  protected deserializeRecord(
    record: DynamicSingleRecord | Record<string, unknown>
  ): DynamicSingleRecord {
    const r = record as Record<string, unknown>;

    const fields = r.fields as string | object;
    const admin = r.admin as string | object | null;
    const accessRules = (r.access_rules ?? r.accessRules) as
      | string
      | object
      | null;
    const tableName = (r.table_name ?? r.tableName) as string;
    const configPath = (r.config_path ?? r.configPath) as string | undefined;
    const schemaHash = (r.schema_hash ?? r.schemaHash) as string;
    const schemaVersion = (r.schema_version ?? r.schemaVersion) as number;
    const migrationStatus = (r.migration_status ?? r.migrationStatus) as string;
    const lastMigrationId = (r.last_migration_id ?? r.lastMigrationId) as
      | string
      | undefined;
    const createdBy = (r.created_by ?? r.createdBy) as string | undefined;
    const createdAt = (r.created_at ?? r.createdAt) as Date | string | number;
    const updatedAt = (r.updated_at ?? r.updatedAt) as Date | string | number;

    return {
      id: r.id as string,
      slug: r.slug as string,
      label: r.label as string,
      tableName,
      description: r.description as string | undefined,
      fields: typeof fields === "string" ? JSON.parse(fields) : fields,
      admin: admin
        ? typeof admin === "string"
          ? JSON.parse(admin)
          : admin
        : undefined,
      accessRules: accessRules
        ? typeof accessRules === "string"
          ? JSON.parse(accessRules)
          : accessRules
        : undefined,
      source: r.source as SingleSource,
      locked: Boolean(r.locked),
      configPath,
      schemaHash,
      schemaVersion,
      migrationStatus: migrationStatus as SingleMigrationStatus,
      lastMigrationId,
      createdBy,
      createdAt: this.normalizeDbTimestamp(createdAt) as unknown as Date,
      updatedAt: this.normalizeDbTimestamp(updatedAt) as unknown as Date,
    };
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Seed read/update permissions for a single and assign to super_admin.
   * Non-blocking — errors are logged but do not fail the parent operation.
   */
  private async seedPermissionsForSingle(slug: string): Promise<void> {
    if (!this.permissionSeedService) return;

    try {
      const result =
        await this.permissionSeedService.seedSinglePermissions(slug);

      if (result.newPermissionIds.length > 0) {
        await this.permissionSeedService.assignNewPermissionsToSuperAdmin(
          result.newPermissionIds
        );
      }

      if (result.created > 0) {
        this.logger.info(
          `Permissions seeded for single "${slug}": ${result.created} created, ${result.skipped} already existed`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to seed permissions for single "${slug}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Build the common insert record shape for registerSingle and
   * registerSingleInTransaction. Extracted so both flows stay in sync.
   */
  private buildInsertRecord(
    data: DynamicSingleInsert,
    fieldsJson: string,
    schemaHash: string
  ): Record<string, unknown> {
    const now = new Date();
    const tableName = this.ensureTableNamePrefix(data.tableName);
    return {
      id: this.generateId(),
      slug: data.slug,
      label: data.label,
      table_name: tableName,
      description: data.description,
      fields: fieldsJson,
      admin: data.admin ? JSON.stringify(data.admin) : null,
      access_rules: data.accessRules ? JSON.stringify(data.accessRules) : null,
      source: data.source,
      locked: (data.locked ?? data.source === "code") ? 1 : 0,
      config_path: data.configPath,
      schema_hash: schemaHash,
      schema_version: data.schemaVersion ?? 1,
      migration_status: data.migrationStatus ?? "pending",
      last_migration_id: data.lastMigrationId,
      created_by: data.createdBy,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Handle an error thrown during code-first sync. Disambiguates
   * duplicate-key errors (which are recoverable) from hard failures.
   */
  private async handleSyncError(
    config: CodeFirstSingleConfig,
    error: unknown
  ): Promise<
    | { status: "unchanged" }
    | { status: "created" }
    | { status: "error"; error: string }
  > {
    const message = error instanceof Error ? error.message : String(error);
    const isDuplicate =
      message.toLowerCase().includes("already exists") ||
      message.toLowerCase().includes("duplicate") ||
      message.toLowerCase().includes("unique constraint");

    if (!isDuplicate) {
      return { status: "error", error: message };
    }

    const refetched = await this.getSingleBySlug(config.slug).catch(() => null);
    if (refetched) {
      this.logger.warn(
        `Code-first sync: "${config.slug}" already in DB — treating as unchanged`,
        { slug: config.slug }
      );
      return { status: "unchanged" };
    }

    const disambiguatedTableName = `ds_${config.slug.replace(/-/g, "_")}_cf`;
    try {
      const schemaHash = calculateSchemaHash(config.fields);
      await this.registerSingle({
        slug: config.slug,
        label: config.label,
        tableName: disambiguatedTableName,
        description: config.description,
        fields: config.fields,
        admin: config.admin,
        source: "code",
        locked: true,
        configPath: config.configPath,
        schemaHash,
      });
      this.logger.warn(
        `Code-first sync: "${config.slug}" had table_name conflict — registered with table "${disambiguatedTableName}"`,
        { slug: config.slug, tableName: disambiguatedTableName }
      );
      return { status: "created" };
    } catch (retryError) {
      const retryMessage =
        retryError instanceof Error ? retryError.message : String(retryError);
      return {
        status: "error",
        error: `table_name conflict (tried "${disambiguatedTableName}"): ${retryMessage}`,
      };
    }
  }
}
