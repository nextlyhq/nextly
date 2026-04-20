/**
 * RBAC Access Control Service
 *
 * Unified access control evaluation that merges code-defined access functions
 * (from `defineCollection({ access })` / `defineSingle({ access })`) with
 * database role/permission checks.
 *
 * Evaluation priority:
 * 1. **Super-admin bypass** — always returns `true`
 * 2. **Code-defined access** — function or boolean from collection/single config
 * 3. **Database permission** — checks RBAC tables via `hasPermission()`
 *
 * Default behavior: **deny** (fail-secure). If no code access is defined and
 * the user has no database permission for the resource+action, access is denied.
 *
 * Code-defined access configs are registered at startup via `registerCollectionAccess()`
 * and `registerSingleAccess()`. The service auto-resolves them during `checkAccess()`
 * when no explicit `codeAccess` parameter is provided.
 *
 * @module services/auth/rbac-access-control-service
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const rbac = new RBACAccessControlService();
 *
 * // Register code-defined access at startup
 * rbac.registerCollectionAccess('posts', {
 *   create: ({ roles }) => roles.includes('editor'),
 *   read: true,
 * });
 *
 * // Simple check — auto-resolves registered access, then DB permissions
 * const canRead = await rbac.checkAccess({
 *   userId: 'user-123',
 *   operation: 'read',
 *   resource: 'posts',
 * });
 * ```
 */

import {
  hasPermission,
  isSuperAdmin,
  listEffectivePermissions,
  listRoleSlugsForUser,
} from "../../../services/lib/permissions";

import type {
  AccessControlContext,
  AccessControlFunction,
  CheckAccessParams,
  CollectionAccessControl,
  SingleAccessControl,
} from "./access-control-types";

/**
 * Unified RBAC access control service.
 *
 * Orchestrates the three-tier access evaluation:
 * 1. Super-admin bypass
 * 2. Code-defined access functions/booleans (from in-memory registry or explicit param)
 * 3. Database role/permission checks
 *
 * Holds an in-memory registry of code-defined access configs registered
 * at startup from `defineCollection({ access })` and `defineSingle({ access })`.
 */
export class RBACAccessControlService {
  private readonly collectionAccessMap = new Map<
    string,
    CollectionAccessControl
  >();

  private readonly singleAccessMap = new Map<string, SingleAccessControl>();

  /**
   * Register code-defined access control for a collection.
   * Called during `syncCodeFirstCollections()` for each collection
   * that has an `access` property in its config.
   *
   * @param slug - The collection slug
   * @param access - The access control config from `defineCollection()`
   */
  registerCollectionAccess(
    slug: string,
    access: CollectionAccessControl
  ): void {
    this.collectionAccessMap.set(slug, access);
  }

  /**
   * Register code-defined access control for a single.
   * Called during `syncCodeFirstSingles()` for each single
   * that has an `access` property in its config.
   *
   * @param slug - The single slug
   * @param access - The access control config from `defineSingle()`
   */
  registerSingleAccess(slug: string, access: SingleAccessControl): void {
    this.singleAccessMap.set(slug, access);
  }

  /**
   * Get the registered code-defined access for a resource.
   * Checks collection map first, then single map.
   *
   * @param slug - The collection or single slug
   * @returns The registered access config, or `undefined` if none registered
   */
  getRegisteredAccess(
    slug: string
  ): CollectionAccessControl | SingleAccessControl | undefined {
    return this.collectionAccessMap.get(slug) ?? this.singleAccessMap.get(slug);
  }

  /**
   * Clear all registered access configs.
   * Useful for re-sync scenarios (e.g., watch-mode re-sync in dev).
   */
  clearRegisteredAccess(): void {
    this.collectionAccessMap.clear();
    this.singleAccessMap.clear();
  }

  /**
   * Check if a user is allowed to perform an operation on a resource.
   *
   * If no explicit `codeAccess` is provided, auto-resolves from the
   * in-memory registry (populated at startup from `defineCollection`/`defineSingle`).
   *
   * @param params - Access check parameters
   * @returns `true` if access is allowed, `false` if denied
   *
   * @example
   * ```typescript
   * const allowed = await rbac.checkAccess({
   *   userId: 'user-123',
   *   operation: 'update',
   *   resource: 'posts',
   * });
   * ```
   */
  async checkAccess(params: CheckAccessParams): Promise<boolean> {
    const { userId, operation, resource } = params;

    if (!userId) {
      return false;
    }

    if (await isSuperAdmin(userId)) {
      return true;
    }

    const codeAccess = params.codeAccess ?? this.getRegisteredAccess(resource);

    const operationAccess = codeAccess?.[
      operation as keyof (CollectionAccessControl | SingleAccessControl)
    ] as AccessControlFunction | boolean | undefined;

    if (operationAccess !== undefined) {
      if (typeof operationAccess === "boolean") {
        return operationAccess;
      }

      if (typeof operationAccess === "function") {
        const ctx = await this.buildContext(userId, operation, resource);
        try {
          return await operationAccess(ctx);
        } catch (error) {
          // Code access function threw — fail-secure
          console.error(
            `[rbac] Code access function for ${operation}:${resource} threw:`,
            error
          );
          return false;
        }
      }
    }

    return hasPermission(userId, operation, resource);
  }

  /**
   * Build the full access control context for code-defined functions.
   *
   * Resolves role slugs and effective permissions from the database.
   * This is only called when a code-defined access function needs
   * the full context — simple boolean checks and DB permission
   * fallbacks skip this entirely.
   *
   * @param userId - The authenticated user's ID
   * @param operation - The CRUD operation
   * @param resource - The collection/single slug
   * @returns Fully resolved AccessControlContext
   */
  async buildContext(
    userId: string,
    operation: "create" | "read" | "update" | "delete",
    resource: string
  ): Promise<AccessControlContext> {
    const [roleSlugs, permissions] = await Promise.all([
      listRoleSlugsForUser(userId),
      listEffectivePermissions(userId),
    ]);

    return {
      user: { id: userId },
      roles: roleSlugs,
      permissions,
      operation,
      collection: resource,
    };
  }
}
