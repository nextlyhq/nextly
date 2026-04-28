/**
 * API Key Service
 *
 * Manages the full lifecycle of API keys — generation, hashing, CRUD,
 * validation, and permission resolution. Keys use a three-tier token type
 * model (Read-only / Full access / Role-based) backed by Nextly's RBAC
 * system as the single source of truth for permissions.
 *
 * ## Security Invariants
 *
 * - Raw keys are NEVER stored. Only a SHA-256 hex digest (`keyHash`) is
 *   persisted. The full key is returned exactly once on creation and must
 *   be surfaced to the caller immediately.
 * - Keys are cryptographically random (32 bytes = 256-bit entropy).
 * - The `sk_live_` prefix allows instant identification in logs/configs.
 * - Expiry is enforced at validation time; expired keys return `null` from
 *   `authenticateApiKey()` and result in a `401` response.
 *
 * ## Key Format
 *
 * ```
 * sk_live_<base64url-32-bytes>
 * └──────┘ └───────────────────┘
 *  prefix   43-char base64url secret (256 bits)
 *
 * Full key example : sk_live_abc123XYZ...  (51 chars total)
 * Stored hash      : sha256(fullKey) as hex string (64 chars)
 * Display prefix   : first 16 chars ("sk_live_abcdefgh") for masked UI display
 * ```
 *
 * @module services/auth/api-key-service
 * @since 1.0.0
 */

import { createHash, randomBytes, randomUUID } from "crypto";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { and, desc, eq, inArray } from "drizzle-orm";

import {
  apiKeys as apiKeysMysql,
  permissions as permissionsMysql,
  rolePermissions as rolePermissionsMysql,
  roles as rolesMysql,
  userRoles as userRolesMysql,
} from "../../../database/schema/mysql";
import {
  apiKeys as apiKeysPg,
  permissions as permissionsPg,
  rolePermissions as rolePermissionsPg,
  roles as rolesPg,
  userRoles as userRolesPg,
} from "../../../database/schema/postgres";
import {
  apiKeys as apiKeysSqlite,
  permissions as permissionsSqlite,
  rolePermissions as rolePermissionsSqlite,
  roles as rolesSqlite,
  userRoles as userRolesSqlite,
} from "../../../database/schema/sqlite";
// PR 4 migration: switch from legacy ServiceError to NextlyError unified system.
// ServiceError throw sites are replaced with NextlyError factory calls; identifying
// info (key id, role id, exceeded permission) moves from public message to logContext
// per spec §13.8 (no identifiers/values in publicMessage).
import { NextlyError } from "../../../errors/nextly-error";
import { BaseService } from "../../../services/base-service";
import { listRoleSlugsForUser } from "../../../services/lib/permissions";
import type { Logger } from "../../../services/shared";

/** The three token types that determine how permissions are resolved at request time. */
export type ApiKeyTokenType = "read-only" | "full-access" | "role-based";

/** Token duration options for key expiry. "unlimited" means the key never expires. */
export type ExpiresIn = "7d" | "30d" | "90d" | "unlimited";

/** The key value returned by generateApiKey(). fullKey is shown once and never stored. */
export interface GeneratedApiKey {
  /** The full raw key — e.g. "sk_live_abc123...". Show to the user once, then discard. */
  fullKey: string;
  /** SHA-256 hex digest of fullKey. Stored in the database for lookup. */
  keyHash: string;
  /** First 16 characters of fullKey — stored for masked display in the UI. */
  keyPrefix: string;
}

/**
 * Metadata returned by all API key endpoints.
 * The raw key hash and secret are NEVER returned.
 */
export interface ApiKeyMeta {
  id: string;
  name: string;
  description: string | null;
  /** First 16 chars of the key (e.g. "sk_live_abcdefgh") — for masked UI display. */
  keyPrefix: string;
  tokenType: ApiKeyTokenType;
  /** Populated only for role-based keys. Null if no role is set or role was deleted. */
  role: { id: string; name: string; slug: string } | null;
  /** ISO 8601 string, or null for unlimited keys. */
  expiresAt: string | null;
  /** ISO 8601 string of the last request that used this key, or null if never used. */
  lastUsedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Input for creating a new API key. */
export interface CreateApiKeyInput {
  /** Human-readable label, e.g. "Frontend App Key". 1–255 characters. */
  name: string;
  /** Optional documentation about this key's intended use. */
  description?: string | null;
  tokenType: ApiKeyTokenType;
  /** Required when tokenType is "role-based". Must be absent for other token types. */
  roleId?: string | null;
  expiresIn: ExpiresIn;
}

/** Input for updating an existing API key. Only name and description can change. */
export interface UpdateApiKeyInput {
  name?: string;
  description?: string | null;
}

const KEY_PREFIX = "sk_live_";

/**
 * Generate a new cryptographically-random API key.
 *
 * Returns the full raw key along with its SHA-256 hash and the 16-character
 * display prefix. The full key must be shown to the user immediately — it is
 * NOT stored and cannot be retrieved later.
 *
 * Key format: `sk_live_<base64url-32-bytes>`
 * - 32 random bytes encoded as base64url = 43 characters (no padding)
 * - Total key length: 8 (prefix) + 43 (secret) = 51 characters
 * - Entropy: 256 bits (same as a 32-byte AES key)
 *
 * @returns Object containing the raw key, its SHA-256 hash, and the display prefix
 *
 * @example
 * ```typescript
 * const { fullKey, keyHash, keyPrefix } = generateApiKey();
 * // fullKey   → "sk_live_abc123XYZ..." (return to user, never store)
 * // keyHash   → "a3f2c1..." (store in DB for lookup)
 * // keyPrefix → "sk_live_abcdefgh" (store in DB for UI display)
 * ```
 */
export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(32).toString("base64url");
  const fullKey = `${KEY_PREFIX}${secret}`;

  return {
    fullKey,
    keyHash: hashApiKey(fullKey),
    keyPrefix: fullKey.slice(0, 16),
  };
}

/**
 * Compute the SHA-256 hex digest of a raw API key.
 *
 * This function is deterministic: the same input always produces the same
 * output, enabling constant-time lookup by hash without storing the raw key.
 *
 * **Why SHA-256 instead of bcrypt?**
 * API keys are high-entropy random strings (256 bits). bcrypt is designed for
 * low-entropy passwords and its intentional slowness (100 ms+) would add
 * latency to every authenticated API request. SHA-256 is fast (microseconds),
 * sufficient for high-entropy secrets, and the approach used by GitHub and
 * Stripe for their API key hashing.
 *
 * @param rawKey - The full API key string (e.g. "sk_live_abc123...")
 * @returns 64-character lowercase hex string (SHA-256 digest)
 *
 * @example
 * ```typescript
 * const hash = hashApiKey("sk_live_abc123...");
 * // → "a3f2c1d9e8b7..." (64 hex chars, deterministic)
 *
 * // Lookup by hash in the database:
 * const key = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash));
 * ```
 */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Determine whether an API key has expired.
 *
 * A key with `expiresAt = null` is considered unlimited and never expires.
 * A key with a past `expiresAt` is considered expired regardless of its
 * `isActive` flag — expiry takes precedence and is checked first.
 *
 * @param expiresAt - The key's expiry timestamp, or `null` for unlimited
 * @returns `true` if the key is expired, `false` if still valid or unlimited
 *
 * @example
 * ```typescript
 * isKeyExpired(null);                          // → false (unlimited)
 * isKeyExpired(new Date("2099-01-01"));        // → false (future)
 * isKeyExpired(new Date("2020-01-01"));        // → true  (past)
 * isKeyExpired(new Date(Date.now() - 1000));   // → true  (1 second ago)
 * ```
 */
export function isKeyExpired(expiresAt: Date | null): boolean {
  if (expiresAt === null) {
    return false;
  }
  return expiresAt.getTime() < Date.now();
}

/**
 * ApiKeyService handles the full API key lifecycle.
 *
 * Responsibilities:
 * - Key generation and SHA-256 hashing (via module-level helpers)
 * - Key CRUD (create, list, get, update name/description, revoke)
 * - Incoming key authentication (hash lookup + expiry + rate limiting)
 * - Permission resolution per token type (read-only / full-access / role-based)
 *
 * Extends BaseService for multi-database adapter support (PostgreSQL, MySQL, SQLite).
 *
 * @example
 * ```typescript
 * const service = new ApiKeyService(adapter, logger);
 *
 * // Generate a new key
 * const { meta, key } = await service.createApiKey(userId, {
 *   name: "Frontend App Key",
 *   tokenType: "read-only",
 *   expiresIn: "30d",
 * });
 * // key is the raw "sk_live_..." — surface to user immediately, never stored
 *
 * // Validate an incoming request key
 * const result = await service.authenticateApiKey(rawKeyFromHeader);
 * if (!result) return Response.json({ error: "Unauthorized" }, { status: 401 });
 * ```
 */

// Module-level (rather than per-instance) so that UserRoleService can invalidate
// entries via invalidateApiKeyPermissionsCache() without holding a reference to
// an ApiKeyService instance — same pattern as services/lib/permissions.ts.
const _apiKeyPermissionsCache = new Map<
  string,
  { slugs: string[]; cachedAt: number }
>();
const _PERMISSIONS_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Evict a single API key's resolved permissions from the shared in-memory cache.
 *
 * Call this when:
 * - The key creator's role assignments change (read-only / full-access keys) — via UserRoleService
 * - The key's referenced role changes permissions (role-based keys) — via RolePermissionService
 *
 * @param keyId - The API key ID whose cache entry should be evicted
 */
export function invalidateApiKeyPermissionsCache(keyId: string): void {
  _apiKeyPermissionsCache.delete(`apikey:${keyId}`);
}

interface ApiKeyRow {
  id: string;
  name: string;
  description: string | null;
  keyPrefix: string;
  tokenType: string;
  roleId: string | null;
  roleName: string | null;
  roleSlug: string | null;
  expiresAt: Date | number | null;
  lastUsedAt: Date | number | null;
  isActive: boolean | number;
  createdAt: Date | number | string;
  updatedAt: Date | number | string;
}

export class ApiKeyService extends BaseService {
  private apiKeysTable:
    | typeof apiKeysPg
    | typeof apiKeysMysql
    | typeof apiKeysSqlite;
  private rolesTable: typeof rolesPg | typeof rolesMysql | typeof rolesSqlite;
  private userRolesTable:
    | typeof userRolesPg
    | typeof userRolesMysql
    | typeof userRolesSqlite;
  private rolePermissionsTable:
    | typeof rolePermissionsPg
    | typeof rolePermissionsMysql
    | typeof rolePermissionsSqlite;
  private permissionsTable:
    | typeof permissionsPg
    | typeof permissionsMysql
    | typeof permissionsSqlite;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);

    switch (this.dialect) {
      case "postgresql":
        this.apiKeysTable = apiKeysPg;
        this.rolesTable = rolesPg;
        this.userRolesTable = userRolesPg;
        this.rolePermissionsTable = rolePermissionsPg;
        this.permissionsTable = permissionsPg;
        break;
      case "mysql":
        this.apiKeysTable = apiKeysMysql;
        this.rolesTable = rolesMysql;
        this.userRolesTable = userRolesMysql;
        this.rolePermissionsTable = rolePermissionsMysql;
        this.permissionsTable = permissionsMysql;
        break;
      case "sqlite":
        this.apiKeysTable = apiKeysSqlite;
        this.rolesTable = rolesSqlite;
        this.userRolesTable = userRolesSqlite;
        this.rolePermissionsTable = rolePermissionsSqlite;
        this.permissionsTable = permissionsSqlite;
        break;
      default:
        // `this.dialect` is narrowed to `never` here after the exhaustive switch;
        // wrap in String() to satisfy @typescript-eslint/restrict-template-expressions.
        throw new Error(`Unsupported dialect: ${String(this.dialect)}`);
    }
  }

  /**
   * Create a new API key for a user.
   *
   * The raw key is returned exactly once in the result. It is NOT stored and
   * cannot be retrieved again — the caller must surface it to the user immediately.
   *
   * For role-based keys, validates that the target role's permissions are a
   * subset of the creator's permissions (permission ceiling enforcement).
   *
   * @param userId - ID of the user creating the key
   * @param input - Key creation parameters
   * @returns Object containing the key metadata and the raw key string
   *
   * @throws NextlyError(VALIDATION_ERROR) if roleId is missing/extraneous for the token type
   * @throws NextlyError(FORBIDDEN) if the role's permissions exceed the creator's
   * @throws NextlyError via fromDatabaseError on DB constraint violations
   */
  async createApiKey(
    userId: string,
    input: CreateApiKeyInput
  ): Promise<{ meta: ApiKeyMeta; key: string }> {
    if (input.tokenType === "role-based" && !input.roleId) {
      // §13.8: validation messages name the field, never the value. The bad
      // tokenType context goes to logContext for operators to debug.
      throw NextlyError.validation({
        errors: [
          {
            path: "roleId",
            code: "REQUIRED",
            message: "roleId is required when tokenType is 'role-based'.",
          },
        ],
        logContext: { tokenType: input.tokenType },
      });
    }
    if (input.tokenType !== "role-based" && input.roleId) {
      throw NextlyError.validation({
        errors: [
          {
            path: "roleId",
            code: "INVALID",
            message:
              "roleId must not be set when tokenType is not 'role-based'.",
          },
        ],
        logContext: { tokenType: input.tokenType },
      });
    }

    await this.checkPermissionCeiling(
      userId,
      input.tokenType,
      input.roleId ?? null
    );

    const { fullKey, keyHash, keyPrefix } = generateApiKey();
    const id = randomUUID();
    const now = new Date();
    const expiresAt = this.resolveExpiresAt(input.expiresIn);

    try {
      await this.db.insert(this.apiKeysTable).values({
        id,
        name: input.name,
        description: input.description ?? null,
        keyHash,
        keyPrefix,
        tokenType: input.tokenType,
        roleId: input.roleId ?? null,
        userId,
        expiresAt,
        lastUsedAt: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      // Map any DB error (unique-violation on keyHash, etc.) to a generic
      // NextlyError. Driver text never leaks to the wire.
      throw NextlyError.fromDatabaseError(error);
    }

    const meta = await this.getApiKeyById(id, userId, { allUsers: true });
    if (!meta) {
      // This is an internal invariant violation: we just inserted the row
      // but cannot read it back. Identifier (id, userId) goes to logContext.
      throw NextlyError.internal({
        logContext: {
          message: "Failed to retrieve created API key",
          keyId: id,
          userId,
        },
      });
    }

    return { meta, key: fullKey };
  }

  /**
   * List API keys for a user, ordered by creation date (newest first).
   *
   * @param userId - The requesting user's ID (used to filter keys when not allUsers)
   * @param opts.allUsers - When true, returns keys for all users (for super-admin callers)
   * @returns Array of key metadata (raw key and hash are never returned)
   */
  async listApiKeys(
    userId: string,
    opts?: { allUsers?: boolean }
  ): Promise<ApiKeyMeta[]> {
    let query = this.db
      .select({
        id: this.apiKeysTable.id,
        name: this.apiKeysTable.name,
        description: this.apiKeysTable.description,
        keyPrefix: this.apiKeysTable.keyPrefix,
        tokenType: this.apiKeysTable.tokenType,
        roleId: this.apiKeysTable.roleId,
        roleName: this.rolesTable.name,
        roleSlug: this.rolesTable.slug,
        expiresAt: this.apiKeysTable.expiresAt,
        lastUsedAt: this.apiKeysTable.lastUsedAt,
        isActive: this.apiKeysTable.isActive,
        createdAt: this.apiKeysTable.createdAt,
        updatedAt: this.apiKeysTable.updatedAt,
      })
      .from(this.apiKeysTable)
      .leftJoin(
        this.rolesTable,
        eq(this.apiKeysTable.roleId, this.rolesTable.id)
      );

    if (!opts?.allUsers) {
      query = query.where(eq(this.apiKeysTable.userId, userId));
    }

    const rows = await query.orderBy(desc(this.apiKeysTable.createdAt));
    return (rows as ApiKeyRow[]).map(row => this.toMeta(row));
  }

  /**
   * Get a single API key by ID.
   *
   * @param id - The API key ID
   * @param userId - The requesting user's ID
   * @param opts.allUsers - When true, skips ownership check (for super-admin callers)
   * @returns Key metadata, or null if not found (or not owned by userId)
   */
  async getApiKeyById(
    id: string,
    userId: string,
    opts?: { allUsers?: boolean }
  ): Promise<ApiKeyMeta | null> {
    const whereClause = opts?.allUsers
      ? eq(this.apiKeysTable.id, id)
      : and(eq(this.apiKeysTable.id, id), eq(this.apiKeysTable.userId, userId));

    const rows = await this.db
      .select({
        id: this.apiKeysTable.id,
        name: this.apiKeysTable.name,
        description: this.apiKeysTable.description,
        keyPrefix: this.apiKeysTable.keyPrefix,
        tokenType: this.apiKeysTable.tokenType,
        roleId: this.apiKeysTable.roleId,
        roleName: this.rolesTable.name,
        roleSlug: this.rolesTable.slug,
        expiresAt: this.apiKeysTable.expiresAt,
        lastUsedAt: this.apiKeysTable.lastUsedAt,
        isActive: this.apiKeysTable.isActive,
        createdAt: this.apiKeysTable.createdAt,
        updatedAt: this.apiKeysTable.updatedAt,
      })
      .from(this.apiKeysTable)
      .leftJoin(
        this.rolesTable,
        eq(this.apiKeysTable.roleId, this.rolesTable.id)
      )
      .where(whereClause)
      .limit(1);

    if ((rows as ApiKeyRow[]).length === 0) return null;
    return this.toMeta((rows as ApiKeyRow[])[0]);
  }

  /**
   * Update an API key's name and/or description.
   *
   * Token type, role, and duration cannot be changed after creation.
   * To change those fields, revoke the key and create a new one.
   *
   * Ownership is enforced — only the key's creator can update it.
   *
   * @param id - The API key ID
   * @param userId - The requesting user's ID (must be the key owner)
   * @param input - Fields to update (name, description)
   * @returns Updated key metadata
   *
   * @throws NextlyError(NOT_FOUND) if key doesn't exist or is not owned by userId
   */
  async updateApiKey(
    id: string,
    userId: string,
    input: UpdateApiKeyInput
  ): Promise<ApiKeyMeta> {
    const existing = await this.getApiKeyById(id, userId);
    if (!existing) {
      // §13.8: never leak entity identifiers in publicMessage. Generic "Not found."
      // is provided by the factory; the id moves to logContext for operators.
      throw NextlyError.notFound({ logContext: { keyId: id, userId } });
    }

    const now = new Date();
    const updateData: Record<string, unknown> = { updatedAt: now };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined)
      updateData.description = input.description;

    try {
      await this.db
        .update(this.apiKeysTable)
        .set(updateData)
        .where(
          and(
            eq(this.apiKeysTable.id, id),
            eq(this.apiKeysTable.userId, userId)
          )
        );
    } catch (error) {
      throw NextlyError.fromDatabaseError(error);
    }

    const updated = await this.getApiKeyById(id, userId);
    if (!updated) {
      // Internal invariant: row existed before update but reads back as null.
      throw NextlyError.internal({
        logContext: {
          message: "Failed to retrieve updated API key",
          keyId: id,
          userId,
        },
      });
    }
    return updated;
  }

  /**
   * Revoke an API key by setting isActive = false (soft delete).
   *
   * The row is preserved for audit trail purposes. Revoked keys are
   * rejected at authentication time with a 401 response.
   *
   * Ownership is enforced — only the key's creator can revoke it.
   *
   * @param id - The API key ID
   * @param userId - The requesting user's ID (must be the key owner)
   *
   * @throws NextlyError(NOT_FOUND) if key doesn't exist or is not owned by userId
   */
  async revokeApiKey(id: string, userId: string): Promise<void> {
    const existing = await this.getApiKeyById(id, userId);
    if (!existing) {
      // Identifier moves to logContext — generic "Not found." in publicMessage.
      throw NextlyError.notFound({ logContext: { keyId: id, userId } });
    }

    const now = new Date();
    try {
      await this.db
        .update(this.apiKeysTable)
        .set({ isActive: false, updatedAt: now })
        .where(
          and(
            eq(this.apiKeysTable.id, id),
            eq(this.apiKeysTable.userId, userId)
          )
        );
    } catch (error) {
      throw NextlyError.fromDatabaseError(error);
    }
  }

  /**
   * Resolve the effective permission slugs for an authenticated API key.
   *
   * Called by auth middleware immediately after {@link authenticateApiKey}
   * to determine what actions the key is permitted to perform. Results are
   * cached in-memory for {@link PERMISSIONS_CACHE_TTL_MS} (5 min) keyed by
   * `"apikey:{keyId}"`. Call {@link invalidatePermissionsCache} to evict.
   *
   * Token type semantics:
   * - **read-only** — creator's full permission set, filtered to `read-*` slugs only
   * - **full-access** — creator's full permission set (all slugs)
   * - **role-based** — the assigned role's permission set.
   *   If the role has been deleted (`roleId === null`), returns `[]` and logs a warning.
   *
   * @param tokenType - The key's token type
   * @param roleId - The assigned role ID (only relevant for "role-based" keys)
   * @param userId - The key creator's user ID
   * @param keyId - The API key's own ID (used for cache keying and log messages)
   * @returns Array of permission slugs (e.g. `["read-posts", "read-users"]`)
   *
   * @example
   * ```typescript
   * const auth = await apiKeyService.authenticateApiKey(rawKey);
   * if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
   * const permissions = await apiKeyService.resolveApiKeyPermissions(
   *   auth.tokenType, auth.roleId, auth.userId, auth.id
   * );
   * // permissions → ["read-posts", "read-users", ...]
   * ```
   */
  async resolveApiKeyPermissions(
    tokenType: ApiKeyTokenType,
    roleId: string | null,
    userId: string,
    keyId: string
  ): Promise<string[]> {
    const cacheKey = `apikey:${keyId}`;
    const now = Date.now();

    const cached = _apiKeyPermissionsCache.get(cacheKey);
    if (cached && now - cached.cachedAt < _PERMISSIONS_CACHE_TTL_MS) {
      return cached.slugs;
    }

    let slugs: string[];

    if (tokenType === "role-based") {
      // Guard: referenced role was deleted via onDelete: "set null"
      if (!roleId) {
        this.logger.warn(
          `API key ${keyId} is role-based but its role has been deleted — all requests will be denied`,
          { keyId }
        );
        return [];
      }
      slugs = await this.resolveRolePermissionSlugs(roleId);
    } else {
      const allSlugs = await this.resolveUserPermissionSlugs(userId);
      slugs =
        tokenType === "read-only"
          ? allSlugs.filter(slug => slug.startsWith("read-"))
          : allSlugs;
    }

    _apiKeyPermissionsCache.set(cacheKey, { slugs, cachedAt: now });
    return slugs;
  }

  /**
   * Evict a single API key's resolved permissions from the shared in-memory cache.
   *
   * Delegates to the module-level {@link invalidateApiKeyPermissionsCache} so that
   * callers who hold a service reference (e.g. REST handlers) can use either form.
   *
   * @param keyId - The API key ID whose cache entry should be evicted
   */
  invalidatePermissionsCache(keyId: string): void {
    invalidateApiKeyPermissionsCache(keyId);
  }

  /**
   * Resolve the role slugs that apply to an authenticated API key.
   *
   * Called by auth middleware alongside {@link resolveApiKeyPermissions} to
   * populate `AuthContext.roles` for API key requests. This ensures that
   * code-defined access functions checking `ctx.roles.includes('editor')`
   * work identically for both session and API key auth.
   *
   * Token type semantics:
   * - **role-based** — `[selectedRole.slug]`. Single lookup by the assigned `roleId`.
   *   If the role has been deleted (`roleId === null`), returns `[]`.
   * - **full-access / read-only** — creator's full assigned role slugs, resolved
   *   via `listRoleSlugsForUser()`. Same set the user would see in a session context.
   *
   * @param tokenType - The key's token type
   * @param roleId - The assigned role ID (only relevant for "role-based" keys)
   * @param userId - The key creator's user ID
   * @returns Array of role slugs (e.g. `["editor"]` or `["super-admin", "editor"]`)
   */
  async resolveApiKeyRoles(
    tokenType: ApiKeyTokenType,
    roleId: string | null,
    userId: string
  ): Promise<string[]> {
    if (tokenType === "role-based") {
      if (!roleId) return [];

      const rows = await this.db
        .select({ slug: this.rolesTable.slug })
        .from(this.rolesTable)
        .where(eq(this.rolesTable.id, roleId))
        .limit(1);
      return rows.length > 0
        ? [(rows[0] as Record<string, unknown>).slug as string]
        : [];
    }

    return listRoleSlugsForUser(userId);
  }

  private async resolveRolePermissionSlugs(roleId: string): Promise<string[]> {
    const rows = await this.db
      .select({ slug: this.permissionsTable.slug })
      .from(this.rolePermissionsTable)
      .innerJoin(
        this.permissionsTable,
        eq(this.rolePermissionsTable.permissionId, this.permissionsTable.id)
      )
      .where(eq(this.rolePermissionsTable.roleId, roleId));

    const seen = new Set<string>();
    for (const row of rows as Array<{ slug: string }>) {
      seen.add(row.slug);
    }
    return Array.from(seen);
  }

  private async resolveUserPermissionSlugs(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ slug: this.permissionsTable.slug })
      .from(this.userRolesTable)
      .innerJoin(
        this.rolePermissionsTable,
        eq(this.userRolesTable.roleId, this.rolePermissionsTable.roleId)
      )
      .innerJoin(
        this.permissionsTable,
        eq(this.rolePermissionsTable.permissionId, this.permissionsTable.id)
      )
      .where(eq(this.userRolesTable.userId, userId));

    const seen = new Set<string>();
    for (const row of rows as Array<{ slug: string }>) {
      seen.add(row.slug);
    }
    return Array.from(seen);
  }

  /**
   * Validate an incoming raw API key from a request header.
   *
   * Called by auth middleware on every request that presents a
   * `Authorization: Bearer sk_live_...` header. Designed for the hot path:
   * - Single SELECT with 5 columns, no JOIN
   * - Unique index hit on `keyHash` (O(1) lookup)
   * - Fire-and-forget `lastUsedAt` update (not awaited)
   *
   * Returns `null` for any failure case (not found, revoked, expired) so the
   * middleware can respond with a uniform 401 without leaking the reason.
   *
   * @param rawKey - The full raw key from the `Authorization: Bearer` header
   * @returns Auth tuple `{ id, userId, tokenType, roleId }` on success, or `null`
   *
   * @example
   * ```typescript
   * const result = await apiKeyService.authenticateApiKey(rawKey);
   * if (!result) return Response.json({ error: "Unauthorized" }, { status: 401 });
   * const permissions = await apiKeyService.resolveApiKeyPermissions(
   *   result.tokenType, result.roleId, result.userId, result.id
   * );
   * ```
   */
  async authenticateApiKey(rawKey: string): Promise<{
    id: string;
    userId: string;
    tokenType: ApiKeyTokenType;
    roleId: string | null;
  } | null> {
    const keyHash = hashApiKey(rawKey);

    const rows = await this.db
      .select({
        id: this.apiKeysTable.id,
        userId: this.apiKeysTable.userId,
        tokenType: this.apiKeysTable.tokenType,
        roleId: this.apiKeysTable.roleId,
        expiresAt: this.apiKeysTable.expiresAt,
      })
      .from(this.apiKeysTable)
      .where(
        and(
          eq(this.apiKeysTable.keyHash, keyHash),
          eq(this.apiKeysTable.isActive, true)
        )
      )
      .limit(1);

    type AuthRow = {
      id: string;
      userId: string;
      tokenType: string;
      roleId: string | null;
      expiresAt: Date | number | null;
    };
    if ((rows as AuthRow[]).length === 0) return null;

    const row = (rows as AuthRow[])[0];

    // Normalise expiresAt — SQLite returns numeric timestamps, PG/MySQL return Date objects
    const expiresAt: Date | null =
      row.expiresAt instanceof Date
        ? row.expiresAt
        : row.expiresAt != null
          ? new Date(row.expiresAt)
          : null;

    if (isKeyExpired(expiresAt)) return null;

    // Fire-and-forget lastUsedAt update — not awaited; latency on every auth
    // request is unacceptable, and a missed update is non-critical.

    void this.db
      .update(this.apiKeysTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(this.apiKeysTable.id, row.id));

    return {
      id: row.id,
      userId: row.userId,
      tokenType: row.tokenType as ApiKeyTokenType,
      roleId: row.roleId ?? null,
    };
  }

  private toMeta(row: ApiKeyRow): ApiKeyMeta {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      keyPrefix: row.keyPrefix,
      tokenType: row.tokenType as ApiKeyTokenType,
      role:
        row.roleId != null && row.roleName != null
          ? {
              id: row.roleId,
              name: row.roleName,
              slug: row.roleSlug as string,
            }
          : null,
      expiresAt:
        row.expiresAt != null
          ? row.expiresAt instanceof Date
            ? row.expiresAt.toISOString()
            : String(row.expiresAt)
          : null,
      lastUsedAt:
        row.lastUsedAt != null
          ? row.lastUsedAt instanceof Date
            ? row.lastUsedAt.toISOString()
            : String(row.lastUsedAt)
          : null,
      isActive: Boolean(row.isActive),
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : String(row.createdAt),
      updatedAt:
        row.updatedAt instanceof Date
          ? row.updatedAt.toISOString()
          : String(row.updatedAt),
    };
  }

  private resolveExpiresAt(expiresIn: ExpiresIn): Date | null {
    if (expiresIn === "unlimited") return null;
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysMap: Record<string, number> = {
      "7d": 7,
      "30d": 30,
      "90d": 90,
    };
    const days = daysMap[expiresIn];
    if (!days) return null;
    return new Date(Date.now() + days * msPerDay);
  }

  private async checkPermissionCeiling(
    creatorId: string,
    tokenType: ApiKeyTokenType,
    roleId: string | null
  ): Promise<void> {
    if (tokenType !== "role-based") return;
    if (!roleId) return;

    // Super-admin bypass: a super-admin can assign any role

    const superAdminCheck = await this.db
      .select({ id: this.rolesTable.id })
      .from(this.userRolesTable)
      .innerJoin(
        this.rolesTable,
        eq(this.userRolesTable.roleId, this.rolesTable.id)
      )
      .where(
        and(
          eq(this.userRolesTable.userId, creatorId),
          eq(this.rolesTable.slug, "super-admin")
        )
      )
      .limit(1);

    if ((superAdminCheck as unknown[]).length > 0) return;

    const creatorRoleRows = await this.db
      .select({ roleId: this.userRolesTable.roleId })
      .from(this.userRolesTable)
      .where(eq(this.userRolesTable.userId, creatorId));

    const creatorRoleIds = (creatorRoleRows as Array<{ roleId: string }>).map(
      r => r.roleId
    );

    const creatorPerms = new Set<string>();
    if (creatorRoleIds.length > 0) {
      const creatorPermRows = await this.db
        .select({
          action: this.permissionsTable.action,
          resource: this.permissionsTable.resource,
        })
        .from(this.rolePermissionsTable)
        .innerJoin(
          this.permissionsTable,
          eq(this.rolePermissionsTable.permissionId, this.permissionsTable.id)
        )
        .where(inArray(this.rolePermissionsTable.roleId, creatorRoleIds));

      for (const row of creatorPermRows as Array<{
        action: string;
        resource: string;
      }>) {
        creatorPerms.add(`${row.resource}:${row.action}`);
      }
    }

    const rolePermRows = await this.db
      .select({
        action: this.permissionsTable.action,
        resource: this.permissionsTable.resource,
      })
      .from(this.rolePermissionsTable)
      .innerJoin(
        this.permissionsTable,
        eq(this.rolePermissionsTable.permissionId, this.permissionsTable.id)
      )
      .where(eq(this.rolePermissionsTable.roleId, roleId));

    for (const row of rolePermRows as Array<{
      action: string;
      resource: string;
    }>) {
      const slug = `${row.resource}:${row.action}`;
      if (!creatorPerms.has(slug)) {
        // §13.8: forbidden messages must not reveal *which* permission was
        // missing — that would leak the policy. Generic "You don't have
        // permission..." comes from the factory; the offending slug and
        // creator/role context move to logContext for operators.
        throw NextlyError.forbidden({
          logContext: {
            reason: "permission-ceiling-exceeded",
            exceededPermission: slug,
            roleId,
            creatorId,
          },
        });
      }
    }
  }
}
