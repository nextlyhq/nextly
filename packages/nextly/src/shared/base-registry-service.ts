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

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SqlParam, WhereCondition } from "@nextlyhq/adapter-drizzle/types";

// PR 4 of unified-error-system migration: ServiceError → NextlyError.
// Subclasses (collection/single/field-group-registry-service) still throw
// ServiceError directly and check `instanceof ServiceError`; those are out
// of scope for this PR but inherit the throw-based contract automatically
// for all `getRecordOrThrow` / `updateRecordMigrationStatus` paths.
import { toDbError } from "../database/errors";
import { NextlyError } from "../errors";

import { BaseService } from "./base-service";
import { canonicalJson } from "./lib/canonical-json";
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

  /**
   * Restrict results to records whose `slug` is in this list.
   *
   * Used to scope queries to a per-user permission allowlist so that both
   * the row results AND the `total` count reflect what the caller is
   * actually allowed to see. Without this, callers that filter rows in
   * application code after a paginated fetch end up with an inflated
   * `total` (leaks counts of hidden records) and `hasNext` flags that drive
   * clients into wasted pagination loops.
   *
   * Semantics:
   *  - `undefined` (default) means "no allowlist filter applied".
   *  - `[]` means "no records are visible" and short-circuits to an empty
   *    result with `total: 0`. This is preferred over relying on
   *    dialect-specific `IN ()` behaviour.
   */
  slugAllowlist?: string[];

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
/**
 * Whether two config values are the same as far as storage is concerned.
 *
 * `?? null` on both sides because a column holding no value arrives as `null`
 * while a config declaring none has `undefined`: they mean the same thing, and
 * a comparison telling them apart would report a change on every boot — a write
 * per startup, per resource, that nothing downstream would report as spurious.
 */
function sameStoredValue(a: unknown, b: unknown): boolean {
  return canonicalJson(a ?? null) === canonicalJson(b ?? null);
}

/*
 * `canonicalJson` is imported rather than defined here. This file carried its
 * own copy, written for the registry's jsonb key-order problem; the version
 * diff had written another for the same question. Two implementations of one
 * question agree on the day they are written and drift after, and the drift is
 * silent because each looks correct beside its own caller.
 *
 * The shared one also answers a case this copy did not: a cyclic value returns
 * `undefined` rather than throwing, so a comparison over one cannot take the
 * whole sync down.
 */

/**
 * The fields {@link BaseRegistryService.schemaSyncNeeded} compares.
 *
 * Structural rather than a union of the two record types, because the question
 * is about these fields and nothing else: a registry gains a column without
 * this having an opinion, and neither domain's record has to be imported here
 * to ask it.
 */
export interface SchemaSyncSubject {
  status?: boolean;
  localized?: boolean;
  versions?: unknown;
  revalidate?: unknown;
  webhooks?: unknown;
}

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

  /**
   * The metadata table to address for this call.
   *
   * Separate from {@link registryTableName} because one registry's table can be
   * renamed under a running database: the field-group storage migration moves
   * it, so its name is an observation rather than a constant there. Every query
   * below goes through this, and the default answers with the declared name, so
   * a registry whose table never moves costs nothing and reads identically.
   */
  protected resolveRegistryTableName(): Promise<string> {
    // Not `async`: the default has nothing to await, and a registry whose table
    // never moves should not pay a microtask per query for a constant. The
    // field-group override is `async` because its answer comes from the catalog.
    return Promise.resolve(this.registryTableName);
  }

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
  protected async getRecordBySlug(
    slug: string,
    executor?: unknown
  ): Promise<TRecord | null> {
    try {
      const result = await this.adapter.selectOne<TRecord>(
        await this.resolveRegistryTableName(),
        {
          where: this.whereEq("slug", slug),
        },
        // Supplied when the caller is inside a write transaction: without it the
        // lookup takes a second pooled connection while that transaction still
        // holds its own, which can stall against a small pool.
        executor
      );

      return result ? this.deserializeRecord(result) : null;
    } catch (error) {
      // Re-throw NextlyError from nested calls; only DB-layer errors get wrapped.
      if (NextlyError.is(error)) throw error;
      // Normalise raw driver errors (PG/MySQL/SQLite codes) to DbError so
      // fromDatabaseError can map them to the right NextlyError kind. Without
      // this, a real unique-violation collapses to INTERNAL_ERROR.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /**
   * Get a record by slug, throwing NOT_FOUND if missing.
   *
   * §13.8: public message is generic; identifying details (slug, resource
   * type) flow through `logContext`, not the wire.
   */
  protected async getRecordOrThrow(
    slug: string,
    executor?: unknown
  ): Promise<TRecord> {
    const record = await this.getRecordBySlug(slug, executor);

    if (!record) {
      throw NextlyError.notFound({
        logContext: { entity: this.resourceType, slug },
      });
    }

    return record;
  }

  /**
   * Get all records, optionally filtered by source, migration status, and locked.
   */
  protected async getAllRecords(options?: BaseListOptions): Promise<TRecord[]> {
    const conditions = this.buildFilterConditions(options);
    return this.selectRecords({
      where: conditions.length > 0 ? { and: conditions } : undefined,
      limit: options?.limit,
      offset: options?.offset,
    });
  }

  /**
   * List records with pagination, search, and total count.
   */
  protected async listRecords(
    options?: BaseListOptions
  ): Promise<BaseListResult<TRecord>> {
    // Short-circuit when the caller passed an explicit empty allowlist
    // (e.g. a user with no read permissions on any record). Returning early
    // keeps `total` honest, avoids hitting the DB with a no-op query, and
    // sidesteps the dialect-specific footgun of emitting `WHERE slug IN ()`.
    if (options?.slugAllowlist && options.slugAllowlist.length === 0) {
      return { data: [], total: 0 };
    }
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
            value: searchPattern,
          })),
        });
      }

      const whereClause =
        conditions.length > 0 ? { and: conditions } : undefined;

      // Get total count (without pagination)
      const allResults = await this.adapter.select<{ id: string }>(
        await this.resolveRegistryTableName(),
        {
          where: whereClause,
          columns: ["id"],
        }
      );
      const total = allResults.length;

      // Get paginated results
      const results = await this.adapter.select<TRecord>(
        await this.resolveRegistryTableName(),
        {
          where: whereClause,
          orderBy: [{ column: "createdAt", direction: "asc" }],
          limit: options?.limit,
          offset: options?.offset,
        }
      );

      return {
        data: results.map(record => this.deserializeRecord(record)),
        total,
      };
    } catch (error) {
      if (NextlyError.is(error)) throw error;
      // Normalise raw driver errors so listRecords surfaces the correct
      // NextlyError kind instead of a generic 500.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
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
        await this.resolveRegistryTableName(),
        updateData,
        this.whereEq("slug", slug),
        { returning: "*" }
      );

      if (results.length === 0) {
        // §13.8: generic public message; resource type + slug go to logContext.
        throw NextlyError.notFound({
          logContext: { entity: this.resourceType, slug },
        });
      }

      this.logger.info("Migration status updated", { slug, status });
    } catch (error) {
      // Re-throw NextlyError unchanged; wrap raw DB errors via fromDatabaseError.
      if (NextlyError.is(error)) throw error;
      // Normalise raw driver errors first so fromDatabaseError gets a DbError
      // and can pick the right kind (unique-violation, deadlock, etc.).
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
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
      if (NextlyError.is(error)) throw error;
      // Normalise raw driver errors before mapping to NextlyError kind.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /**
   * Get all records with pending migrations (status 'pending' or 'generated').
   *
   * 🔴 Named by Drizzle SCHEMA PROPERTY, not by physical column.
   * `adapter.select` resolves each `column` against the table's property names,
   * so `migration_status` and `created_at` -- the names in the DDL -- do not
   * resolve at all: the adapter refuses with "Column not found in table",
   * listing `migrationStatus` and `createdAt` among what it does have.
   *
   * This threw for every caller, which is precisely why it had none. The method
   * was written alongside `updateMigrationStatusWithTableVerification` for a
   * reconciliation pass that was never wired up, so nothing ever ran it and the
   * mistake could not surface. The identical defect is recorded in
   * `activity-log-service`, where a physical name silently dropped an ORDER BY
   * and made a filtered query fail outright.
   */
  protected async getRecordsWithPendingMigrations(): Promise<TRecord[]> {
    return this.selectRecords({
      where: {
        and: [
          {
            column: "migrationStatus",
            op: "IN",
            value: ["pending", "generated"],
          },
        ],
      },
    });
  }

  /**
   * Read registry rows, oldest first, deserialized — with driver errors mapped.
   *
   * 🔴 ONE reader for every list this service performs, because the three
   * things it does are each easy to get subtly wrong and were previously
   * written out per method. The ordering names `createdAt`, the SCHEMA
   * PROPERTY: `adapter.select` resolves columns against the table's property
   * names, and a physical `created_at` is not rejected in an `orderBy` — it is
   * silently ignored, so the caller believes it asked for an order it never
   * got. The error mapping keeps a unique or foreign-key violation classified
   * rather than collapsing to INTERNAL_ERROR. And `deserializeRecord` is what
   * turns stored JSON columns back into values.
   *
   * A method that skipped any one of those looked correct beside the others.
   */
  private async selectRecords(query: {
    where?: { and: (WhereCondition | { or: WhereCondition[] })[] };
    limit?: number;
    offset?: number;
  }): Promise<TRecord[]> {
    try {
      const results = await this.adapter.select<TRecord>(
        await this.resolveRegistryTableName(),
        {
          ...query,
          orderBy: [{ column: "createdAt", direction: "asc" }],
        }
      );
      return results.map(record => this.deserializeRecord(record));
    } catch (error) {
      if (NextlyError.is(error)) throw error;
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
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
    // Canonical for the reason `sameStoredValue` is: a `jsonb` column hands
    // back its own key order, and an admin block that compared unequal on that
    // alone would re-sync every resource on every boot.
    return canonicalJson(codeAdmin) !== canonicalJson(existingAdmin);
  }

  /**
   * Whether a code-first config differs from its stored row in a way that has
   * to be written THROUGH the schema path.
   *
   * Shared by the collection and Single registries because it is one question,
   * not two that resemble each other: each clause here either moves a column or
   * changes how the row's document is read, so a write answering it also
   * carries the schema hash and re-opens the migration bookkeeping. Two copies
   * agreed until someone edited one, and the half that went unedited would then
   * leave its domain silently stale.
   *
   * A caller with clauses of its own ORs them onto this — a collection's
   * physical table name, say — rather than restating these.
   *
   * Naming (label, description, the admin block) is deliberately NOT here.
   * Those move no column, and routing them through this path would flag a
   * migration for an edit that touches none.
   *
   * The JSON-shaped columns go through {@link sameStoredValue}, which is where
   * the absent-versus-null reading lives.
   */
  protected schemaSyncNeeded(
    config: SchemaSyncSubject,
    existing: SchemaSyncSubject,
    /*
     * Decided by the caller rather than here. Comparing the hashes is one `===`
     * behind a named function that belongs to the schema domain, and reaching
     * for it from `shared` would point a dependency the wrong way down the
     * layering for no shared logic at all — while the five comparisons below
     * are the part both registries were actually keeping in step by hand.
     */
    schemaHashChanged: boolean
  ): boolean {
    return (
      schemaHashChanged ||
      (config.status === true) !== (existing.status === true) ||
      !sameStoredValue(config.versions, existing.versions) ||
      !sameStoredValue(config.revalidate, existing.revalidate) ||
      !sameStoredValue(config.webhooks, existing.webhooks) ||
      (config.localized === true) !== (existing.localized === true)
    );
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
        // The SCHEMA PROPERTY, as everywhere else here: `adapter.select`
        // resolves against the table's property names, so the physical
        // `migration_status` refuses outright with "Column not found in table".
        column: "migrationStatus",
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

    // Apply slug allowlist as an IN filter. The empty-array case is handled
    // by callers (see listRecords short-circuit) so we only emit an IN when
    // there's at least one slug; otherwise we'd rely on dialect-specific
    // behaviour of `IN ()` which is brittle.
    if (options?.slugAllowlist && options.slugAllowlist.length > 0) {
      conditions.push({
        column: "slug",
        op: "IN",
        value: options.slugAllowlist as SqlParam[],
      });
    }

    return conditions;
  }
}
