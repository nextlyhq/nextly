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
import type {
  SqlParam,
  TransactionContext,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";

// PR 4 of unified-error-system migration: ServiceError → NextlyError.
// Subclasses (collection/single/field-group-registry-service) still throw
// ServiceError directly and check `instanceof ServiceError`; those are out
// of scope for this PR but inherit the throw-based contract automatically
// for all `getRecordOrThrow` / `updateRecordMigrationStatus` paths.
import { toDbError } from "../database/errors";
import { dashboardPinsPresent } from "../domains/dashboard/dashboard-pins";
import {
  cachedRegistryListing,
  cachedRegistryRow,
  clearRegistryRowCache,
  registryReadTransaction,
  registryRowOnTransaction,
} from "../domains/dynamic-collections/services/collection-row-cache";
import {
  countRegistryWriteOn,
  writeRegistryRows,
} from "../domains/schema/schema-version";
import {
  deleteEntityRegistryRow,
  type DeletedEntity,
  mediaUsageTablePresent,
} from "../domains/versions/entity-teardown";
import { NextlyError } from "../errors";

import { BaseService } from "./base-service";
import { canonicalJson } from "./lib/canonical-json";
import {
  registryPage,
  warnIfRegistryListingLarge,
} from "./lib/registry-listing-page";
import type { Logger } from "./types";

/**
 * The order every registry listing is read in: oldest first, and by slug
 * among rows created at the same instant. MySQL keeps `created_at` to the
 * second, so entities registered together (a start registering the config's
 * Singles) share one, and ordered by it alone they came back in whichever
 * order the server sorted them that time.
 */
const REGISTRY_ORDER = [
  { column: "createdAt", direction: "asc" },
  { column: "slug", direction: "asc" },
] as const;

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

  /**
   * Leave out records whose `slug` is in this list: the plugins' entities, on
   * the list of the site's own.
   *
   * A condition on the query, like the allowlist, so the `total` counts only
   * the rows the page can show. It only ever removes rows: with an allowlist
   * both apply, so nothing the allowlist leaves out comes back.
   *
   * Semantics:
   *  - `undefined` or `[]` means nothing is denied, and adds no condition
   *    (never a `NOT IN ()`, whose meaning differs by dialect).
   */
  slugDenylist?: string[];

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

/**
 * A registry list paginates or it does not: an `offset` that skips rows needs
 * the `limit` that bounds the page. The refusal lives before any query,
 * because the query builder emits `OFFSET` as its own clause: SQLite and MySQL
 * refuse a bare `OFFSET` in SQL — a dialect-grammar database error — while
 * PostgreSQL silently returns the unbounded tail. One contract, refused once,
 * on every dialect. An offset of 0 skips nothing and is not a refusal.
 *
 * Exported because a caller that reads the registry BEFORE its paginated list —
 * `findSingles` building a principal's allowlist, most notably — owes the same
 * refusal before those reads, so a refused call issues no query at all.
 */
export function assertPaginationIsComplete(
  options?: BaseListOptions,
  resourceType?: string
): void {
  if (
    options?.offset !== undefined &&
    options.offset !== 0 &&
    options.limit === undefined
  ) {
    throw NextlyError.invalidInput({
      message:
        "An offset requires a limit: pass limit alongside offset to paginate.",
      logContext: { resourceType, offset: options.offset },
    });
  }
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

  /** Column names the registry's search matches case-insensitively, as literal text, when `search` is provided in list options. */
  protected abstract getSearchColumns(): string[];

  /** Deserialize a raw DB row into the typed record. */
  protected abstract deserializeRecord(
    record: TRecord | Record<string, unknown>
  ): TRecord;

  // ============================================================
  // Shared Query Methods
  // ============================================================

  /**
   * Whether `getRecordBySlug` reads through the registry row cache. The Single and component
   * services do, since every read of a Single or a component looks its row up. A collection's
   * reads take its row from `getCollection`'s cache instead.
   */
  protected readonly readsRowsFromCache: boolean = false;

  /**
   * Get a record by slug, returning null if not found.
   *
   * Where the service reads rows from the cache (`readsRowsFromCache`), outside a transaction the
   * row comes from the registry row cache (`cachedRegistryRow`): a copy, read again once the
   * stored count of registry writes moves (a change made elsewhere is seen within
   * `REGISTRY_ROW_STALENESS_MS`), and current for one made here, since every registry write in
   * this process clears it. A Single's and a component's every read looks its
   * row up, a component's once per dynamic-zone row. Read on a transaction, it comes from that
   * transaction's memo (`registryRowOnTransaction`), so the transaction sees its own writes and
   * no other transaction does; inside one but through the pool, it is read every time.
   */
  protected async getRecordBySlug(
    slug: string,
    executor?: unknown
  ): Promise<TRecord | null> {
    try {
      const table = await this.resolveRegistryTableName();
      const read = async (): Promise<Record<string, unknown> | null> =>
        ((await this.adapter.selectOne<TRecord>(
          table,
          {
            where: this.whereEq("slug", slug),
          },
          // Supplied when the caller is inside a write transaction: without it the
          // lookup takes a second pooled connection while that transaction still
          // holds its own, which can stall against a small pool.
          executor
        )) as Record<string, unknown> | undefined) ?? null;
      // Read on a transaction, every service's lookup is held by that
      // transaction's memo, whether or not it caches outside one: the
      // transaction then reads each row once, and sees its own writes.
      const transaction = registryReadTransaction(this.adapter, executor);
      const result =
        transaction !== undefined
          ? await registryRowOnTransaction(
              transaction,
              `record:${table}`,
              slug,
              read
            )
          : this.readsRowsFromCache &&
              executor === undefined &&
              !this.adapter.transactionOpenInFlow()
            ? // Its own key space: `getCollection` caches collection rows of another shape.
              await cachedRegistryRow(
                this.adapter,
                `record:${table}`,
                slug,
                read
              )
            : await read();

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
   * The record as stored, read past the registry row cache, throwing NOT_FOUND if missing: for a
   * write that bases itself on the stored row, such as one that checks or advances its schema
   * version. A cached row from before another instance's change would let two changes made a
   * moment apart, on two instances, advance the version once between them.
   */
  protected async getRecordForWrite(slug: string): Promise<TRecord> {
    return this.getRecordOrThrow(slug, this.adapter.getDrizzle());
  }

  /**
   * The record as stored, read past the registry row cache, or null if missing: for a write or
   * delete that decides from the stored row, such as a register's duplicate check or a sync's
   * comparison. Every write path reads through this or `getRecordForWrite`, so none acts on a row
   * another instance changed a moment ago.
   */
  protected async findRecordForWrite(slug: string): Promise<TRecord | null> {
    return this.getRecordBySlug(slug, this.adapter.getDrizzle());
  }

  /** The registry list boundary's share of the pagination contract; see {@link assertPaginationIsComplete}. */
  protected assertPaginationIsComplete(options?: BaseListOptions): void {
    assertPaginationIsComplete(options, this.resourceType);
  }

  /**
   * Get all records, optionally filtered by source, migration status, and locked.
   */
  protected async getAllRecords(options?: BaseListOptions): Promise<TRecord[]> {
    this.assertPaginationIsComplete(options);
    const conditions = this.buildFilterConditions(options);
    return this.selectRecords({
      where: conditions.length > 0 ? { and: conditions } : undefined,
      limit: options?.limit,
      offset: options?.offset,
    });
  }

  /**
   * Every record as stored, oldest first, handed to `view` and answered with
   * what it returns: this registry's listing, from the registry cache outside
   * a transaction (`listStoredRegistry`, which says when it is read as
   * stored instead).
   */
  protected async listStored<T>(
    view: (rows: readonly Readonly<Record<string, unknown>>[]) => T,
    options: { forWrite?: boolean } = {}
  ): Promise<T> {
    const table = await this.resolveRegistryTableName().catch(
      (error: unknown) => {
        throw registryReadError(this.dialect, error);
      }
    );
    return listStoredRegistry(this.adapter, this.dialect, table, view, options);
  }

  /**
   * Every record, oldest first, from the registry cache outside a
   * transaction (`listStored`): for a read that decides no write, such as a
   * screen or a widget listing what the registry holds. A copy each, so a
   * change to one reaches no other caller.
   */
  protected getAllRecordsForRead(): Promise<TRecord[]> {
    return this.listStored(rows =>
      rows.map(row =>
        this.deserializeRecord(structuredClone(row) as Record<string, unknown>)
      )
    );
  }

  /**
   * Every registered slug, derived from the listing (`listStored`).
   *
   * For a caller that needs the registry as a CANDIDATE LIST -- names to
   * authorize one by one, a scope to bound a cross-entity read by -- and
   * nothing else about the records.
   */
  async getAllSlugs(): Promise<string[]> {
    return this.listStored(rows => rows.map(row => String(row.slug)));
  }

  /**
   * Every record with only its slug, whether it is translated, and its fields: what a run that
   * judges translations columns needs from each entity, without the rest of the row.
   */
  async getAllTranslationShapes(): Promise<TRecord[]> {
    // A migration decides from them, so they are read as stored.
    return this.getAllRecordsWithColumns(["localized", "fields"], {
      forWrite: true,
    });
  }

  /**
   * Every record with only its slug and `columns` (named as stored, each one
   * word), deserialized as a record is, derived from the listing
   * (`listStored`). For a caller that needs a few columns of every record
   * (its labels) and nothing else; every other field of the result is left at
   * the value its deserializer gives an absent column. `forWrite` reads them
   * as stored, for a caller that decides a write from them.
   */
  protected async getAllRecordsWithColumns(
    columns: readonly string[],
    options: { forWrite?: boolean } = {}
  ): Promise<TRecord[]> {
    const kept = ["slug", ...columns];
    return this.listStored(
      rows =>
        rows.map(row =>
          this.deserializeRecord(
            structuredClone(
              Object.fromEntries(
                kept.filter(name => name in row).map(name => [name, row[name]])
              )
            )
          )
        ),
      options
    );
  }

  /**
   * Run `write`, a write of this registry's rows, so the stored schema
   * version's count moves with it (`writeRegistryRows`): inside an open
   * registry write it runs there and counts towards that write's version;
   * otherwise in a transaction of its own beside the version, where the
   * service's own reads and writes run too. Another copy of the app follows
   * the registry by that count, so a write that left it where it was would
   * go unseen there. `wrote`, where given, says from what `write` answered
   * whether it changed a row; the count moves only then.
   */
  protected writeRegistry<T>(
    write: () => Promise<T>,
    wrote?: (result: T) => boolean
  ): Promise<T> {
    return writeRegistryRows(this.adapter, write, wrote ? { wrote } : {});
  }

  /**
   * Update `slug`'s row of the registry table `table` with `updateData`,
   * moving the stored schema version's count with it (`writeRegistry`), and
   * clear the cached rows. Answers the rows written: none where no row has
   * the slug, which each caller reports in its own words.
   */
  protected async updateRowBySlug<R>(
    table: string,
    slug: string,
    updateData: Record<string, unknown>
  ): Promise<R[]> {
    const results = await this.writeRegistry(() =>
      this.adapter.update<R>(table, updateData, this.whereEq("slug", slug), {
        returning: "*",
      })
    );
    // The cached registry row is now out of date.
    clearRegistryRowCache();
    return results;
  }

  /**
   * Delete `slug`'s registry row and what goes with it
   * (`deleteEntityRegistryRow`) in one transaction, with the stored schema
   * version's count, and clear the cached rows once it has committed. The
   * tables the sweep depends on are asked about before the transaction opens
   * (see `DashboardTables`).
   */
  protected async deleteEntityRow(
    kind: "collection" | "single",
    slug: string
  ): Promise<DeletedEntity> {
    const tables = {
      dashboardPinsPresent: await dashboardPinsPresent(this.adapter),
      mediaUsagePresent: await mediaUsageTablePresent(this.adapter),
    };
    // The registry write is counted by the delete itself.
    const deleted = await this.adapter.transaction(tx =>
      deleteEntityRegistryRow(tx, kind, slug, tables, this.dialect)
    );
    // Once the transaction has committed, so no read in between keeps the
    // row it is deleting.
    clearRegistryRowCache();
    return deleted;
  }

  /**
   * Count a write of this registry's rows made on `tx`, a transaction the
   * caller opened and commits (`countRegistryWriteOn`).
   */
  protected countWriteOn(tx: TransactionContext): Promise<void> {
    return countRegistryWriteOn(tx, this.dialect);
  }

  /**
   * List records with pagination, search, and total count.
   *
   * Derived from the listing (`listStored`), in memory: the registry is the
   * documented exception to paging in the database
   * (`shared/lib/registry-listing-page`). The filters, the allowlist and the
   * denylist apply before the total is counted, so it counts only the rows
   * the caller may see, and the page and its total come from one snapshot.
   */
  protected async listRecords(
    options?: BaseListOptions
  ): Promise<BaseListResult<TRecord>> {
    this.assertPaginationIsComplete(options);
    // An explicit empty allowlist (a user with no read permissions on any
    // record) sees nothing.
    if (options?.slugAllowlist && options.slugAllowlist.length === 0) {
      return { data: [], total: 0 };
    }
    return this.listStored(rows => {
      warnIfRegistryListingLarge(this.resourceType, rows.length, message =>
        this.logger.warn(message)
      );
      const page = registryPage(rows, {
        include: row => this.rowMatches(row, options),
        ...(options?.search
          ? {
              search: {
                text: options.search,
                columns: this.getSearchColumns(),
              },
            }
          : {}),
        // In REGISTRY_ORDER: rows a start registered within one second
        // (MySQL's created_at precision) keep one order, by slug.
        orderBy: "createdAt",
        thenBy: "slug",
        direction: "asc",
        ...(options?.offset === undefined ? {} : { offset: options.offset }),
        ...(options?.limit === undefined ? {} : { limit: options.limit }),
      });
      return {
        data: page.rows.map(row =>
          this.deserializeRecord(
            structuredClone(row) as Record<string, unknown>
          )
        ),
        total: page.total,
      };
    });
  }

  /**
   * Whether a stored row passes `options`' filters: the same conditions
   * {@link buildFilterConditions} puts in a query, applied to a row the
   * listing holds.
   */
  private rowMatches(
    row: Readonly<Record<string, unknown>>,
    options: BaseListOptions | undefined
  ): boolean {
    if (options?.source && row.source !== options.source) return false;
    if (
      options?.migrationStatus &&
      row.migrationStatus !== options.migrationStatus
    ) {
      return false;
    }
    if (
      options?.locked !== undefined &&
      (row.locked === true || row.locked === 1) !== options.locked
    ) {
      return false;
    }
    const slug = String(row.slug);
    if (options?.slugAllowlist && !options.slugAllowlist.includes(slug)) {
      return false;
    }
    if (options?.slugDenylist?.includes(slug)) return false;
    return true;
  }

  // ============================================================
  // Shared Locking & Migration
  // ============================================================

  /**
   * Check if a record is locked (code-first resources are locked).
   */
  protected async checkIsLocked(slug: string): Promise<boolean> {
    // A precondition of the write that asks it, so read as stored.
    const record = await this.findRecordForWrite(slug);
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

      const results = await this.updateRowBySlug(
        await this.resolveRegistryTableName(),
        slug,
        updateData
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
          orderBy: [...REGISTRY_ORDER],
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

    // The denylist the same way: a `NOT IN` only when it names a slug, since
    // an empty one denies nothing.
    if (options?.slugDenylist && options.slugDenylist.length > 0) {
      conditions.push({
        column: "slug",
        op: "NOT IN",
        value: options.slugDenylist as SqlParam[],
      });
    }

    return conditions;
  }
}

/**
 * Every row of the registry table `table` as stored, oldest first, handed to
 * `view` and answered with what it returns: the one listing every narrower
 * read of the whole registry derives from, so they cannot come to disagree.
 *
 * Outside a transaction it comes from the registry cache
 * (`cachedRegistryListing`), read again only once the registry has changed:
 * a change this process makes clears it, and one made elsewhere is seen once
 * the stored count of registry writes is read again. Inside a transaction,
 * or through an adapter that cannot say whether one is open, it is read
 * every time, on the transaction where the read is routed to one. So is a
 * read that decides a write (`forWrite`): one listing up to a read interval
 * old would let a write on this instance miss a change another made a
 * moment before, as `findRecordForWrite` keeps a row's.
 *
 * The registry services read it as `listStored`; a service that is not one
 * of them but reads a registry table (the dynamic collections' registry)
 * reads it here, through the same cache.
 */
export async function listStoredRegistry<T>(
  adapter: DrizzleAdapter,
  dialect: "postgresql" | "mysql" | "sqlite",
  table: string,
  view: (rows: readonly Readonly<Record<string, unknown>>[]) => T,
  { forWrite = false }: { forWrite?: boolean } = {}
): Promise<T> {
  try {
    const read = (): Promise<Record<string, unknown>[]> =>
      adapter.select<Record<string, unknown>>(table, {
        orderBy: [...REGISTRY_ORDER],
      });
    const flow = adapter as Partial<
      Pick<DrizzleAdapter, "transactionOpenInFlow">
    >;
    const cached =
      !forWrite &&
      typeof flow.transactionOpenInFlow === "function" &&
      !flow.transactionOpenInFlow();
    return cached
      ? await cachedRegistryListing(adapter, table, read, view)
      : view(await read());
  } catch (error) {
    throw registryReadError(dialect, error);
  }
}

/** A failed registry read as the error a caller is answered with. */
function registryReadError(
  dialect: "postgresql" | "mysql" | "sqlite",
  error: unknown
): NextlyError {
  return NextlyError.is(error)
    ? error
    : NextlyError.fromDatabaseError(toDbError(dialect, error));
}
