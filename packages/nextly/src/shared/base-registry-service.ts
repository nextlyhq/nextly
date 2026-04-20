/**
 * Base Registry Service
 *
 * Abstract base class for domain registry services (collections, singles, components).
 * Extracts shared CRUD query patterns, migration tracking, filter building,
 * and utility methods that are duplicated across all three registry services.
 *
 * Domain-specific registries extend this class and implement the abstract members
 * to specialize behavior (table name prefix, search columns, deserialization).
 *
 * @module shared/base-registry-service
 * @since 1.0.0
 */

import crypto from "node:crypto";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { SqlParam, WhereCondition } from "@revnixhq/adapter-drizzle/types";

import { ServiceError } from "../errors";

import { BaseService } from "./base-service";
import type { Logger } from "./types";

// ============================================================
// Shared Types
// ============================================================

/**
 * Common fields for listing registry records with filters and pagination.
 * Domain-specific list options interfaces extend or mirror this shape.
 */
export interface BaseListOptions {
  /** Filter by source type (e.g., "code", "ui", "built-in") */
  source?: string;

  /** Filter by migration status */
  migrationStatus?: string;

  /** Include only locked or unlocked records */
  locked?: boolean;

  /** Search query for filtering by slug or label */
  search?: string;

  /** Maximum number of results */
  limit?: number;

  /** Number of results to skip */
  offset?: number;
}

/**
 * Paginated list result with total count.
 */
export interface BaseListResult<TRecord> {
  /** Records for the current page */
  data: TRecord[];

  /** Total count of matching records (before pagination) */
  total: number;
}

/**
 * Minimum shape that all registry records share.
 * Used as a constraint on the TRecord generic parameter.
 */
export interface BaseRegistryRecord {
  id: string;
  slug: string;
  tableName: string;
  locked: boolean;
  migrationStatus: string;
}

// ============================================================
// BaseRegistryService
// ============================================================

/**
 * Abstract base class for domain registry services.
 *
 * Provides shared implementations for:
 * - Query methods: getBySlug, getOrThrow, getAll, list
 * - Migration tracking: updateMigrationStatus, updateMigrationStatusWithVerification, getPendingMigrations
 * - Locking: isLocked
 * - Utilities: generateId, computeSimpleHash, generateTableName, ensureTableNamePrefix, adminConfigChanged
 * - Filter building: source, migrationStatus, locked, and search conditions
 *
 * @typeParam TRecord - The full record type (must extend BaseRegistryRecord)
 * @typeParam TMigrationStatus - The migration status union type for this domain
 */
export abstract class BaseRegistryService<
  TRecord extends BaseRegistryRecord,
  TMigrationStatus extends string = string,
> extends BaseService {
  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  // ============================================================
  // Abstract Members — subclasses must provide
  // ============================================================

  /** The metadata table name (e.g., "dynamic_collections"). */
  protected abstract readonly registryTableName: string;

  /** Human-readable resource type for error messages (e.g., "Collection"). */
  protected abstract readonly resourceType: string;

  /** Table name prefix for this domain (e.g., "dc_", "single_", "comp_"). */
  protected abstract readonly tableNamePrefix: string;

  /** Column names to search via ILIKE when `search` is provided in list options. */
  protected abstract getSearchColumns(): string[];

  /** Deserialize a raw DB row into the typed record. */
  protected abstract deserializeRecord(
    record: TRecord | Record<string, unknown>
  ): TRecord;

  // ============================================================
  // Shared Query Methods
  // ============================================================

  /**
   * Get a record by slug, returning null if not found.
   */
  protected async getRecordBySlug(slug: string): Promise<TRecord | null> {
    try {
      const result = await this.adapter.selectOne<TRecord>(
        this.registryTableName,
        {
          where: this.whereEq("slug", slug),
        }
      );

      return result ? this.deserializeRecord(result) : null;
    } catch (error) {
      throw ServiceError.fromDatabaseError(error);
    }
  }

  /**
   * Get a record by slug, throwing NOT_FOUND if missing.
   */
  protected async getRecordOrThrow(slug: string): Promise<TRecord> {
    const record = await this.getRecordBySlug(slug);

    if (!record) {
      throw ServiceError.notFound(`${this.resourceType} "${slug}" not found`, {
        slug,
      });
    }

    return record;
  }

  /**
   * Get all records, optionally filtered by source, migration status, and locked.
   */
  protected async getAllRecords(options?: BaseListOptions): Promise<TRecord[]> {
    try {
      const conditions = this.buildFilterConditions(options);

      const results = await this.adapter.select<TRecord>(
        this.registryTableName,
        {
          where: conditions.length > 0 ? { and: conditions } : undefined,
          orderBy: [{ column: "created_at", direction: "asc" }],
          limit: options?.limit,
          offset: options?.offset,
        }
      );

      return results.map(record => this.deserializeRecord(record));
    } catch (error) {
      throw ServiceError.fromDatabaseError(error);
    }
  }

  /**
   * List records with pagination, search, and total count.
   */
  protected async listRecords(
    options?: BaseListOptions
  ): Promise<BaseListResult<TRecord>> {
    try {
      const conditions = this.buildFilterConditions(options);

      // Add search filter (searches columns returned by getSearchColumns())
      if (options?.search) {
        const searchPattern = `%${options.search}%`;
        const searchColumns = this.getSearchColumns();
        conditions.push({
          or: searchColumns.map(column => ({
            column,
            op: "ILIKE" as const,
            value: searchPattern as SqlParam,
          })),
        });
      }

      const whereClause =
        conditions.length > 0 ? { and: conditions } : undefined;

      // Get total count (without pagination)
      const allResults = await this.adapter.select<{ id: string }>(
        this.registryTableName,
        {
          where: whereClause,
          columns: ["id"],
        }
      );
      const total = allResults.length;

      // Get paginated results
      const results = await this.adapter.select<TRecord>(
        this.registryTableName,
        {
          where: whereClause,
          orderBy: [{ column: "created_at", direction: "asc" }],
          limit: options?.limit,
          offset: options?.offset,
        }
      );

      return {
        data: results.map(record => this.deserializeRecord(record)),
        total,
      };
    } catch (error) {
      throw ServiceError.fromDatabaseError(error);
    }
  }

  // ============================================================
  // Shared Locking & Migration
  // ============================================================

  /**
   * Check if a record is locked (code-first resources are locked).
   */
  protected async checkIsLocked(slug: string): Promise<boolean> {
    const record = await this.getRecordBySlug(slug);
    return record?.locked ?? false;
  }

  /**
   * Update migration status for a record.
   */
  protected async updateRecordMigrationStatus(
    slug: string,
    status: TMigrationStatus,
    migrationId?: string
  ): Promise<void> {
    this.logger.debug("Updating migration status", { slug, status });

    try {
      const updateData: Record<string, unknown> = {
        migration_status: status,
        updated_at: this.formatDateForDb(),
      };

      if (migrationId) {
        updateData.last_migration_id = migrationId;
      }

      const results = await this.adapter.update(
        this.registryTableName,
        updateData,
        this.whereEq("slug", slug),
        { returning: "*" }
      );

      if (results.length === 0) {
        throw ServiceError.notFound(
          `${this.resourceType} "${slug}" not found`,
          { slug }
        );
      }

      this.logger.info("Migration status updated", { slug, status });
    } catch (error) {
      if (error instanceof ServiceError) {
        throw error;
      }
      throw ServiceError.fromDatabaseError(error);
    }
  }

  /**
   * Safely update migration status to 'applied' with table existence verification.
   *
   * CRITICAL: Use this instead of updateRecordMigrationStatus when setting status
   * to 'applied' to prevent the race condition where status is marked as 'applied'
   * but the table doesn't actually exist.
   */
  protected async updateMigrationStatusWithTableVerification(
    slug: string,
    tableName: string
  ): Promise<{ verified: boolean; status: TMigrationStatus }> {
    this.logger.debug("Updating migration status with verification", {
      slug,
      tableName,
    });

    try {
      const tableExists = await this.adapter.tableExists(tableName);

      if (tableExists) {
        await this.updateRecordMigrationStatus(
          slug,
          "applied" as TMigrationStatus
        );
        this.logger.info("Table verified, migration status set to 'applied'", {
          slug,
          tableName,
        });
        return { verified: true, status: "applied" as TMigrationStatus };
      } else {
        await this.updateRecordMigrationStatus(
          slug,
          "failed" as TMigrationStatus
        );
        this.logger.error(
          "Table verification failed - migration status set to 'failed'",
          { slug, tableName }
        );
        return { verified: false, status: "failed" as TMigrationStatus };
      }
    } catch (error) {
      if (error instanceof ServiceError) {
        throw error;
      }
      throw ServiceError.fromDatabaseError(error);
    }
  }

  /**
   * Get all records with pending migrations (status 'pending' or 'generated').
   */
  protected async getRecordsWithPendingMigrations(): Promise<TRecord[]> {
    try {
      const results = await this.adapter.select<TRecord>(
        this.registryTableName,
        {
          where: {
            and: [
              {
                column: "migration_status",
                op: "IN",
                value: ["pending", "generated"],
              },
            ],
          },
          orderBy: [{ column: "created_at", direction: "asc" }],
        }
      );

      return results.map(record => this.deserializeRecord(record));
    } catch (error) {
      throw ServiceError.fromDatabaseError(error);
    }
  }

  // ============================================================
  // Shared Utilities
  // ============================================================

  /**
   * Generate a unique ID using crypto.randomUUID().
   */
  protected generateId(): string {
    return crypto.randomUUID();
  }

  /**
   * Compute a simple hash from a string (for auto-generating schema_hash).
   * Uses a fast DJB2-style hash — not cryptographic, just for change detection.
   */
  protected computeSimpleHash(input: string): string {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  /**
   * Generate a table name from a slug.
   * Converts slug to snake_case, removes invalid characters, and adds the domain prefix.
   */
  protected generateTableName(slug: string): string {
    const normalized = slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return `${this.tableNamePrefix}${normalized}`;
  }

  /**
   * Ensure table name has the domain-specific prefix.
   */
  protected ensureTableNamePrefix(tableName: string): string {
    if (tableName.startsWith(this.tableNamePrefix)) {
      return tableName;
    }
    return `${this.tableNamePrefix}${tableName}`;
  }

  /**
   * Check if admin config has changed between code and database.
   * Uses JSON comparison to detect changes in admin properties.
   */
  protected adminConfigChanged(
    codeAdmin: unknown,
    existingAdmin: unknown
  ): boolean {
    if (!codeAdmin && !existingAdmin) {
      return false;
    }
    if (!codeAdmin || !existingAdmin) {
      return true;
    }
    return JSON.stringify(codeAdmin) !== JSON.stringify(existingAdmin);
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Build WHERE conditions for source, migrationStatus, and locked filters.
   * Returns a mutable array so callers can add additional conditions (e.g., search).
   */
  private buildFilterConditions(
    options?: BaseListOptions
  ): (WhereCondition | { or: WhereCondition[] })[] {
    const conditions: (WhereCondition | { or: WhereCondition[] })[] = [];

    if (options?.source) {
      conditions.push({
        column: "source",
        op: "=",
        value: options.source as SqlParam,
      });
    }

    if (options?.migrationStatus) {
      conditions.push({
        column: "migration_status",
        op: "=",
        value: options.migrationStatus as SqlParam,
      });
    }

    if (options?.locked !== undefined) {
      conditions.push({
        column: "locked",
        op: "=",
        value: options.locked as SqlParam,
      });
    }

    return conditions;
  }
}
