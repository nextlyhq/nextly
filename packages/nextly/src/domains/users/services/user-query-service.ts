/**
 * UserQueryService - Read operations for users
 *
 * Handles user listing, retrieval, and search operations with
 * filtering, pagination, and sorting capabilities.
 *
 * This service uses the database adapter pattern for multi-database support
 * (PostgreSQL, MySQL, SQLite). For complex queries like JOINs and relational
 * lookups, it uses direct Drizzle access via the compatibility layer until
 * the adapter is enhanced to support these features.
 *
 * When `UserConfig.fields` is configured, the service automatically LEFT JOINs
 * the `user_ext` table to include custom fields in user responses. Custom fields
 * appear as top-level properties in the response (transparent to consumers).
 *
 * @example
 * ```typescript
 * const queryService = new UserQueryService(adapter, logger);
 *
 * const users = await queryService.listUsers({ page: 1, pageSize: 10 });
 * const user = await queryService.getUserById('user-id');
 * ```
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import type { SQL, Table, Column } from "drizzle-orm";
import { and, eq, ne, or, asc, desc, count, sql, inArray } from "drizzle-orm";

import { GetUserByIdSchema } from "@nextly/schemas/user";
import { EmailSchema } from "@nextly/schemas/validation";
import type { MinimalUser } from "@nextly/types/auth";

import { container } from "../../../di/container";
// PR 4 of unified-error-system migration: ServiceError result-shapes →
// NextlyError throws. Service methods now return the data type directly
// or throw a NextlyError on failure (no more `{ success, data, ... }`).
import { NextlyError } from "../../../errors";
import { BaseService } from "../../../services/base-service";
import { ServiceContainer } from "../../../services/index";
import type { Logger } from "../../../services/shared";
import type { UserConfig, UserFieldConfig } from "../../../users/config/types";

import type { UserExtSchemaService } from "./user-ext-schema-service";

// ============================================================
// Drizzle Runtime Types
// ============================================================

/**
 * Runtime-generated Drizzle table object (e.g., from `pgTable()` / `mysqlTable()` / `sqliteTable()`).
 * The exact type depends on the dialect; property access (e.g., `table.user_id`) is needed,
 * so we use `Record<string, unknown>` with an intersection of `Table` for Drizzle API compat.
 */
type DrizzleRuntimeTable = Table & Record<string, unknown>;

/**
 * Lint-safe replacement for the unsafe built-in `Function` type used as a
 * callable property holder. The Drizzle query builder methods we access
 * (select/from/leftJoin/where/...) return chainable thenables whose static
 * types we deliberately drop. The method type returns the same chainable
 * shape so dot-chaining (e.g., `.select(...).from(...)`) keeps typing,
 * and awaits resolve to `Record<string, unknown>[]` (a row list) since
 * that is the only shape we ever consume here.
 */
interface DrizzleChain {
  [key: string]: DrizzleChainMethod;
}
type DrizzleChainMethod = (
  ...args: unknown[]
) => DrizzleChain & PromiseLike<Record<string, unknown>[]>;

// ============================================================
// Text-like field types for search matching
// ============================================================

/** Field types that should be included in text search (LIKE matching) */
const SEARCHABLE_FIELD_TYPES = new Set(["text", "textarea", "email"]);

/**
 * Options for listing users with pagination, filtering, and sorting
 */
export interface ListUsersOptions {
  // Pagination
  page?: number;
  pageSize?: number;
  // Search
  search?: string;
  // Filters
  emailVerified?: boolean;
  hasPassword?: boolean;
  createdAtFrom?: Date;
  createdAtTo?: Date;
  // Sorting — built-in fields have autocomplete, custom field names also accepted
  sortBy?: "createdAt" | "name" | "email" | (string & {});
  sortOrder?: "asc" | "desc";
}

/**
 * Response type for paginated user lists.
 *
 * Post-migration (PR 4): no `success`/`statusCode`/`message` envelope —
 * methods throw NextlyError on failure and return data directly on success.
 */
export interface ListUsersResponse {
  data: MinimalUser[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

/**
 * Response type for single user operations.
 *
 * Post-migration (PR 4): callers receive the user directly; missing users
 * surface via thrown NextlyError(NOT_FOUND) rather than a null `data`.
 */
export type GetUserResponse = MinimalUser;

export class UserQueryService extends BaseService {
  private readonly userConfig?: UserConfig;
  private readonly userExtSchemaService?: UserExtSchemaService;
  private readonly _dialect: string;

  /** Last known merged field count — used to detect stale caches */
  private lastMergedFieldCount = -1;

  /** Cached runtime Drizzle table object for user_ext (regenerated when fields change) */
  private userExtTable: DrizzleRuntimeTable | null = null;

  /** Cached map of custom field names for quick lookup (regenerated when fields change) */
  private customFieldNames: Set<string> | null = null;

  /** Set to true when a user_ext query fails, disabling ext joins until fields change */
  private userExtDisabled = false;

  /**
   * Creates a new UserQueryService instance.
   *
   * @param adapter - Database adapter
   * @param logger - Logger instance
   * @param userConfig - Optional user extension configuration
   * @param userExtSchemaService - Optional schema service for generating runtime user_ext table
   */
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    userConfig?: UserConfig,
    userExtSchemaService?: UserExtSchemaService
  ) {
    super(adapter, logger);
    this.userConfig = userConfig;
    this.userExtSchemaService = userExtSchemaService;

    // Resolve dialect for case-sensitivity handling (e.g. ILIKE on PG vs LIKE LOWER on others)
    this._dialect = adapter.getCapabilities().dialect;
  }

  // ============================================================
  // User Extension Helpers
  // ============================================================

  /**
   * Get the effective custom fields for this service.
   *
   * Prefers merged fields from `UserExtSchemaService` (code + UI sources,
   * loaded via `loadMergedFields()` at startup) and falls back to
   * `userConfig.fields` (code-only from `defineConfig()`).
   */
  private getEffectiveFields(): UserFieldConfig[] {
    if (this.userExtSchemaService?.hasMergedFields()) {
      return this.userExtSchemaService.getMergedFieldConfigs();
    }
    return this.userConfig?.fields ?? [];
  }

  /**
   * Check if custom user fields are configured (from either source).
   */
  private hasCustomFields(): boolean {
    return this.getEffectiveFields().length > 0;
  }

  /**
   * Check if cached ext data is stale (merged fields changed since last cache).
   * If stale, clear caches so they are regenerated on next access.
   */
  private ensureCachesFresh(): void {
    const currentCount = this.getEffectiveFields().length;
    if (currentCount !== this.lastMergedFieldCount) {
      this.userExtTable = null;
      this.customFieldNames = null;
      this.userExtDisabled = false;
      this.lastMergedFieldCount = currentCount;
    }
  }

  /**
   * Get or lazily create the runtime Drizzle table object for user_ext.
   * Automatically invalidated when merged fields change.
   */
  private getUserExtTable(): DrizzleRuntimeTable | null {
    this.ensureCachesFresh();
    if (this.userExtDisabled) return null;
    if (this.userExtTable) return this.userExtTable;
    if (!this.hasCustomFields() || !this.userExtSchemaService) return null;

    this.userExtTable = this.userExtSchemaService.generateRuntimeSchema(
      this.getEffectiveFields()
    );
    return this.userExtTable;
  }

  /**
   * Get the set of custom field names for quick lookup.
   * Automatically invalidated when merged fields change.
   */
  private getCustomFieldNames(): Set<string> {
    this.ensureCachesFresh();
    if (this.customFieldNames) return this.customFieldNames;

    this.customFieldNames = new Set<string>();
    for (const field of this.getEffectiveFields()) {
      if ("name" in field && field.name) {
        this.customFieldNames.add(field.name);
      }
    }
    return this.customFieldNames;
  }

  /**
   * Build the select columns object for custom fields from user_ext.
   * Maps each custom field to its Drizzle column reference.
   */
  private buildCustomFieldSelect(
    userExtTable: DrizzleRuntimeTable
  ): Record<string, unknown> {
    const select: Record<string, unknown> = {};
    for (const fieldName of this.getCustomFieldNames()) {
      if (userExtTable[fieldName]) {
        select[fieldName] = userExtTable[fieldName];
      }
    }
    return select;
  }

  /**
   * Build search conditions for custom text-type fields.
   * Only text, textarea, and email fields are included in LIKE search.
   */
  private buildCustomSearchConditions(
    userExtTable: DrizzleRuntimeTable,
    searchTerm: string
  ): SQL[] {
    const conditions: SQL[] = [];
    const fields = this.getEffectiveFields();
    if (fields.length === 0) return conditions;

    for (const field of fields) {
      if (!("name" in field) || !field.name) continue;
      if (!SEARCHABLE_FIELD_TYPES.has(field.type)) continue;

      const column = userExtTable[field.name];
      if (column) {
        conditions.push(sql`LOWER(${column}) LIKE LOWER(${`%${searchTerm}%`})`);
      }
    }
    return conditions;
  }

  /**
   * Resolve the order-by clause, supporting both built-in and custom field names.
   */
  private resolveOrderByClause(
    sortBy: string,
    sortOrder: "asc" | "desc",
    usersTable: Record<string, unknown>,
    userExtTable: DrizzleRuntimeTable | null
  ): unknown {
    const orderFn = sortOrder === "asc" ? asc : desc;

    // Built-in fields — cast to Column since these are known Drizzle table columns
    switch (sortBy) {
      case "name":
        return orderFn(usersTable.name as Column);
      case "email":
        return orderFn(usersTable.email as Column);
      case "createdAt":
        return orderFn(usersTable.createdAt as Column);
    }

    // Custom field sorting — check if sortBy matches a custom field name
    if (userExtTable && this.getCustomFieldNames().has(sortBy)) {
      const column = userExtTable[sortBy] as Column | undefined;
      if (column) {
        return orderFn(column);
      }
    }

    // Fallback to email
    return orderFn(usersTable.email as Column);
  }

  /**
   * Extract custom field values from a query result row and return as flat object.
   */
  private extractCustomFields(
    row: Record<string, unknown>
  ): Record<string, unknown> {
    const customFields: Record<string, unknown> = {};
    for (const fieldName of this.getCustomFieldNames()) {
      if (fieldName in row && row[fieldName] !== undefined) {
        customFields[fieldName] = row[fieldName];
      }
    }
    return customFields;
  }

  // ============================================================
  // Query Methods
  // ============================================================

  /**
   * List users with pagination, filtering, and sorting.
   *
   * @throws NextlyError on database errors (mapped via fromDatabaseError).
   */
  async listUsers(options?: ListUsersOptions): Promise<ListUsersResponse> {
    const extTable = this.getUserExtTable();
    try {
      return await this._listUsersInternal(options, extTable);
    } catch (err) {
      // If the query failed and user_ext was involved, retry without it.
      // This handles cases where user_ext table or columns don't exist yet.
      // NOTE: We do NOT set userExtDisabled=true here; that would permanently
      // suppress ext queries for transient failures or race conditions at startup.
      if (extTable) {
        try {
          return await this._listUsersInternal(options, null);
        } catch (retryErr) {
          if (NextlyError.is(retryErr)) throw retryErr;
          throw NextlyError.fromDatabaseError(retryErr);
        }
      }
      if (NextlyError.is(err)) throw err;
      throw NextlyError.fromDatabaseError(err);
    }
  }

  private async _listUsersInternal(
    options: ListUsersOptions | undefined,
    userExtTable: DrizzleRuntimeTable | null
  ): Promise<ListUsersResponse> {
    const {
      page = 1,
      pageSize = 10,
      search,
      emailVerified,
      hasPassword,
      sortBy = "email",
      sortOrder = "asc",
    } = options || {};

    const { users, userRoles, roles } = this.tables;

    const hasExt = !!userExtTable;

    // When search is provided and custom fields exist, pre-query user_ext to
    // find IDs of users whose custom fields match the search term.
    // This avoids including user_ext in the main WHERE clause, which would
    // combine it with userRoles/roles JOINs and trigger Drizzle ORM runtime-table issues.
    let customFieldMatchIds: string[] = [];
    if (hasExt && search) {
      try {
        const customSearchConditions = this.buildCustomSearchConditions(
          userExtTable,
          search
        );
        if (customSearchConditions.length > 0) {
          // Safe pattern: FROM users LEFT JOIN user_ext WHERE (custom field conditions)
          // Required by Drizzle ORM — runtime-generated tables need untyped db access.
          // DrizzleChain await already resolves to Record<string, unknown>[],
          // so the previous explicit assertion is now redundant.
          const extMatches = await (this.db as unknown as DrizzleChain)
            .select({ id: users.id })
            .from(users)
            .leftJoin(userExtTable, eq(users.id, userExtTable.user_id))
            .where(or(...customSearchConditions));
          customFieldMatchIds = extMatches
            .map(r => String(r.id))
            .filter(Boolean);
        }
      } catch (extSearchErr) {
        console.error(
          "[UserQueryService] Failed to search user_ext fields:",
          extSearchErr
        );
      }
    }

    // Only join user_ext in the main query when sorting by a custom field.
    // Filtering via user_ext is handled above via customFieldMatchIds (inArray).
    // This prevents combining user_ext with userRoles/roles JOINs in a single query.
    const needsExtJoinForSort =
      hasExt && !!sortBy && this.getCustomFieldNames().has(sortBy);

    // Build WHERE conditions
    const conditions = [];

    if (search) {
      // SQLite's LIKE is case-insensitive by default for ASCII
      // PostgreSQL uses ILIKE for case-insensitive, MySQL LIKE is case-insensitive by default
      // Use LOWER for cross-database compatibility
      const searchConditions: (SQL | undefined)[] = [
        sql`LOWER(${users.name}) LIKE LOWER(${`%${search}%`})`,
        sql`LOWER(${users.email}) LIKE LOWER(${`%${search}%`})`,
      ];

      // Include users whose custom fields matched (pre-queried above)
      if (customFieldMatchIds.length > 0) {
        searchConditions.push(inArray(users.id, customFieldMatchIds));
      }

      conditions.push(or(...searchConditions));
    }

    if (emailVerified !== undefined) {
      conditions.push(
        emailVerified
          ? ne(users.emailVerified, null)
          : eq(users.emailVerified, null)
      );
    }

    if (hasPassword !== undefined) {
      conditions.push(
        hasPassword
          ? ne(users.passwordHash, null)
          : eq(users.passwordHash, null)
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Sorting (supports custom field names via JOIN for sort-only, not for WHERE/SELECT)
    const orderByClause = this.resolveOrderByClause(
      sortBy,
      sortOrder,
      users,
      needsExtJoinForSort ? userExtTable : null
    );

    // Pagination
    const offset = (page - 1) * pageSize;

    // Total count — join user_ext only when sorting by a custom field
    // (not for filtering, since that is handled via inArray above)
    // Required by Drizzle ORM — runtime-generated tables need untyped db access
    let countQuery = (this.db as unknown as DrizzleChain)
      .select({ value: count() })
      .from(users);
    if (needsExtJoinForSort && userExtTable) {
      countQuery = countQuery.leftJoin(
        userExtTable,
        eq(users.id, userExtTable.user_id)
      );
    }
    const countResult = await countQuery.where(whereClause);
    const total = Number(countResult[0]?.value ?? 0);

    // Build select columns — custom field columns are intentionally excluded
    // here; they are fetched via a dedicated query below to avoid Drizzle ORM
    // issues when a runtime-generated table is combined with multiple JOINs.
    const selectColumns: Record<string, unknown> = {
      userId: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
      name: users.name,
      image: users.image,
      isActive: users.isActive,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      roleId: roles.id,
      roleName: roles.name,
    };

    // Required by Drizzle ORM — runtime-generated tables need untyped db access
    let query = (this.db as unknown as DrizzleChain)
      .select(selectColumns)
      .from(users);

    if (needsExtJoinForSort && userExtTable) {
      query = query.leftJoin(userExtTable, eq(users.id, userExtTable.user_id));
    }

    // LEFT JOIN roles
    query = query
      .leftJoin(userRoles, eq(users.id, userRoles.userId))
      .leftJoin(roles, eq(userRoles.roleId, roles.id))
      .where(whereClause)
      .orderBy(orderByClause)
      .limit(pageSize)
      .offset(offset);

    const userListWithRoles: Record<string, unknown>[] = await query;

    const totalPages = Math.ceil(total / pageSize);

    // Group results by user to handle multiple roles per user
    const usersMap = new Map<
      string,
      {
        id: string;
        email: string;
        emailVerified: Date | null;
        name: string | null;
        image: string | null;
        isActive?: boolean;
        createdAt?: Date | null;
        updatedAt?: Date | null;
        roles: Array<{ id: string; name: string }>;
        [key: string]: unknown;
      }
    >();

    for (const row of userListWithRoles) {
      const userId = row.userId as string;
      if (!usersMap.has(userId)) {
        usersMap.set(userId, {
          id: userId,
          email: row.email as string,
          emailVerified: (row.emailVerified as Date | null) ?? null,
          name: (row.name as string | null) ?? null,
          image: (row.image as string | null) ?? null,
          isActive: (row.isActive as boolean | undefined) ?? undefined,
          createdAt: (row.createdAt as Date | null | undefined) ?? undefined,
          updatedAt: (row.updatedAt as Date | null | undefined) ?? undefined,
          roles: [],
        });
      }
      // Add role if it exists (LEFT JOIN may return null for users without roles)
      if (row.roleId && row.roleName) {
        // Type-narrow row.roleId before stringification — avoids
        // Object#toString fallthrough on unknown driver values.
        const rawRoleId = row.roleId;
        const roleId =
          typeof rawRoleId === "string" || typeof rawRoleId === "number"
            ? String(rawRoleId)
            : "";
        usersMap.get(userId)!.roles.push({
          id: roleId,
          name: row.roleName as string,
        });
      }
    }

    // Fetch custom fields in a separate query using the same JOIN pattern
    // that works in _getUserByIdInternal (runtime table as LEFT JOIN, not main FROM).
    // Querying the runtime-generated table as a main FROM can fail silently in
    // some Drizzle ORM + driver combinations; using it only as a JOIN target is reliable.
    if (hasExt && usersMap.size > 0) {
      try {
        const userIds = Array.from(usersMap.keys());
        const extSelectColumns: Record<string, unknown> = {
          extUserId: users.id,
          ...this.buildCustomFieldSelect(userExtTable),
        };
        // Required by Drizzle ORM — runtime-generated tables need untyped
        // db access. DrizzleChain await already resolves to
        // Record<string, unknown>[], so no trailing assertion is needed.
        const extRows = await (this.db as unknown as DrizzleChain)
          .select(extSelectColumns)
          .from(users)
          .leftJoin(userExtTable, eq(users.id, userExtTable.user_id))
          .where(inArray(users.id, userIds));

        for (const extRow of extRows) {
          const uid = String(extRow.extUserId);
          if (usersMap.has(uid)) {
            Object.assign(usersMap.get(uid)!, this.extractCustomFields(extRow));
          }
        }
      } catch (extErr) {
        // Log the error so it's visible in server logs; do not permanently
        // disable ext lookups for a transient failure.
        console.error(
          "[UserQueryService] Failed to fetch user_ext fields:",
          extErr
        );
      }
    }

    const result = Array.from(usersMap.values());

    return {
      data: result as unknown as MinimalUser[],
      meta: {
        total,
        page,
        pageSize,
        totalPages,
      },
    };
  }

  /**
   * Get a user by ID with their roles.
   *
   * §13.8: §"User abc not found" replaced with generic NOT_FOUND because
   * user-existence info is account-enumeration-sensitive — the id stays in
   * logContext only.
   *
   * @throws NextlyError(VALIDATION_ERROR) when the userId fails Zod schema.
   * @throws NextlyError(NOT_FOUND) when the user does not exist.
   * @throws NextlyError on database errors (mapped via fromDatabaseError).
   */
  async getUserById(userId: number | string): Promise<GetUserResponse> {
    // Validate input using Zod schema. §13.8: per-error messages may name the
    // field but never the value; the bad value goes to logContext.
    const validation = GetUserByIdSchema.safeParse({ userId });
    if (!validation.success) {
      throw NextlyError.validation({
        errors: validation.error.issues.map(i => ({
          path: i.path.join("."),
          code: i.code.toUpperCase(),
          message: i.message,
        })),
        logContext: { userId },
      });
    }

    const extTable = this.getUserExtTable();
    try {
      return await this._getUserByIdInternal(userId, extTable);
    } catch (err) {
      // If the query failed and user_ext was involved, retry without it.
      // NOTE: We do NOT set userExtDisabled=true here; that would permanently
      // suppress ext queries for transient failures or race conditions at startup.
      if (extTable) {
        try {
          return await this._getUserByIdInternal(userId, null);
        } catch (retryErr) {
          // Re-throw NextlyError unchanged (e.g. NOT_FOUND from the not-found
          // branch); only wrap raw DB errors via fromDatabaseError.
          if (NextlyError.is(retryErr)) throw retryErr;
          throw NextlyError.fromDatabaseError(retryErr);
        }
      }
      if (NextlyError.is(err)) throw err;
      throw NextlyError.fromDatabaseError(err);
    }
  }

  private async _getUserByIdInternal(
    userId: number | string,
    userExtTable: DrizzleRuntimeTable | null
  ): Promise<GetUserResponse> {
    const { users } = this.tables;
    const hasExt = !!userExtTable;

    // Build select columns — custom fields are intentionally excluded here;
    // they are fetched via a dedicated inner query below, avoiding Drizzle ORM
    // issues when a runtime-generated table is combined with other JOINs.
    const selectColumns: Record<string, unknown> = {
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
      name: users.name,
      image: users.image,
      isActive: users.isActive,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    };

    // Required by Drizzle ORM — runtime-generated tables need untyped db access.
    // Await of DrizzleChain resolves to Record<string, unknown>[] already.
    const rows = await (this.db as unknown as DrizzleChain)
      .select(selectColumns)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!rows.length) {
      // §13.8 + spec note: user existence is sensitive (account
      // enumeration), so the public message stays generic and the id flows
      // only through logContext.
      throw NextlyError.notFound({
        logContext: { entity: "user", id: userId },
      });
    }

    const row = rows[0];

    // Fetch user's roles via UserRoleService
    let roles: string[] | null = null;
    try {
      const svcAdapter =
        this.adapter ?? container.get<DrizzleAdapter>("adapter");
      const services = new ServiceContainer(svcAdapter);
      roles = await services.userRoles.listUserRoles(String(row.id));
    } catch {
      roles = null;
    }

    const userData: Record<string, unknown> = {
      id: row.id,
      email: row.email,
      emailVerified: row.emailVerified ?? null,
      name: row.name ?? null,
      image: row.image ?? null,
      roles,
      isActive: row.isActive ?? undefined,
      createdAt: row.createdAt ?? undefined,
      updatedAt: row.updatedAt ?? undefined,
    };

    // Fetch custom fields in a separate query using the same JOIN pattern as
    // _listUsersInternal. The runtime-generated table is used only as a JOIN
    // target against the static users table to ensure reliable column resolution.
    if (hasExt) {
      try {
        // Required by Drizzle ORM — runtime-generated tables need untyped
        // db access. Await of DrizzleChain resolves to row list directly.
        const extRows = await (this.db as unknown as DrizzleChain)
          .select({
            extUserId: users.id,
            ...this.buildCustomFieldSelect(userExtTable),
          })
          .from(users)
          .leftJoin(userExtTable, eq(users.id, userExtTable.user_id))
          .where(eq(users.id, row.id))
          .limit(1);

        if (extRows.length > 0) {
          Object.assign(userData, this.extractCustomFields(extRows[0]));
        }
      } catch (extErr) {
        console.error(
          "[UserQueryService] Failed to fetch user_ext fields for user:",
          extErr
        );
      }
    }

    return userData as MinimalUser;
  }

  /**
   * Find a user by email address.
   *
   * Returns null when the email is not registered (callers explicitly need
   * to distinguish missing vs. found here, e.g. for the silent-success
   * password-reset flow).
   *
   * @throws NextlyError(VALIDATION_ERROR) when the email fails the Zod check.
   */
  async findByEmail(email: string): Promise<MinimalUser | null> {
    // Validate input using Zod schema. §13.8: messages name the field, not
    // the value; the bad value goes to logContext.
    const validation = EmailSchema.safeParse(email);
    if (!validation.success) {
      throw NextlyError.validation({
        errors: validation.error.issues.map(i => ({
          path: "email",
          code: i.code.toUpperCase(),
          message: i.message,
        })),
        logContext: { email },
      });
    }

    const { users } = this.tables;

    // Resolve user_ext table (null if no custom fields)
    const userExtTable = this.getUserExtTable();
    const hasExt = !!userExtTable;

    // Build select columns — custom fields fetched separately below
    const selectColumns: Record<string, unknown> = {
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
      name: users.name,
      image: users.image,
      isActive: users.isActive,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    };

    // Required by Drizzle ORM — runtime-generated tables need untyped db access.
    // Await of DrizzleChain resolves to Record<string, unknown>[] already.
    const rows = await (this.db as unknown as DrizzleChain)
      .select(selectColumns)
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!rows.length) return null;

    const row = rows[0];
    const userData: Record<string, unknown> = {
      id: row.id,
      email: row.email,
      emailVerified: row.emailVerified ?? null,
      name: row.name ?? null,
      image: row.image ?? null,
      isActive: row.isActive ?? undefined,
      createdAt: row.createdAt ?? undefined,
      updatedAt: row.updatedAt ?? undefined,
    };

    // Fetch custom fields in a separate inner query to avoid Drizzle ORM
    // issues with runtime-generated tables combined with other JOINs.
    if (hasExt) {
      try {
        // Required by Drizzle ORM — runtime-generated tables need untyped
        // db access. Await of DrizzleChain resolves to row list directly.
        const extRows = await (this.db as unknown as DrizzleChain)
          .select({
            extUserId: users.id,
            ...this.buildCustomFieldSelect(userExtTable),
          })
          .from(users)
          .leftJoin(userExtTable, eq(users.id, userExtTable.user_id))
          .where(eq(users.email, email))
          .limit(1);

        if (extRows.length > 0) {
          Object.assign(userData, this.extractCustomFields(extRows[0]));
        }
      } catch (extErr) {
        console.error(
          "[UserQueryService] Failed to fetch user_ext fields for user by email:",
          extErr
        );
      }
    }

    return userData as MinimalUser;
  }
}
