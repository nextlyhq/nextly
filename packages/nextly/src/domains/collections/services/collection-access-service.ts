/**
 * CollectionAccessService — Collection-level access control for entry operations.
 *
 * Extracted from CollectionEntryService (6,490-line god file) as a leaf dependency
 * with no deps on other new split services.
 *
 * Responsibilities:
 * - Evaluate collection-level access rules (public, authenticated, role-based, owner-only, custom)
 * - RBAC gate (super-admin bypass → code-defined → DB permissions)
 * - Query constraint generation for owner-only read filtering
 * - Request context building from UserContext
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import type { RequestContext } from "@nextly/collections/fields/types/base";

import type {
  AccessControlService,
  CollectionAccessRules,
  AccessOperation,
} from "../../../services/access";
import type { RBACAccessControlService } from "../../../services/auth/rbac-access-control-service";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import type { DynamicCollectionService } from "../../dynamic-collections";

import type { CollectionServiceResult, UserContext } from "./collection-types";

export class CollectionAccessService extends BaseService {
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly collectionService: DynamicCollectionService,
    private readonly accessControlService: AccessControlService,
    private readonly rbacAccessControlService?: RBACAccessControlService
  ) {
    super(adapter, logger);
  }

  /**
   * Build RequestContext from UserContext for access control evaluation.
   */
  buildRequestContext(user?: UserContext): RequestContext {
    if (!user) {
      return {};
    }

    return {
      user: {
        id: user.id,
        role: user.role,
        email: user.email,
      },
    };
  }

  /**
   * Extract access rules from collection metadata.
   *
   * Access rules can be stored in:
   * 1. `collection.accessRules` - Direct property (new format)
   * 2. `collection.schemaDefinition.accessRules` - Inside schema (legacy format)
   */
  getAccessRules(
    collection: Record<string, unknown>
  ): CollectionAccessRules | undefined {
    const collectionRecord = collection as Record<string, unknown>;

    // Try direct property first (new format)
    if (collectionRecord.accessRules) {
      return collectionRecord.accessRules as CollectionAccessRules;
    }

    // Fall back to schemaDefinition (legacy format)
    const schemaDef = collectionRecord.schemaDefinition as
      | Record<string, unknown>
      | undefined;
    if (schemaDef?.accessRules) {
      return schemaDef.accessRules as CollectionAccessRules;
    }

    // No access rules defined - will default to public access
    return undefined;
  }

  /**
   * Check collection-level access for an operation.
   *
   * Called FIRST before any other security checks (hooks).
   * Returns early with 403 if access is denied.
   *
   * When `overrideAccess` is true, access control is bypassed entirely (returns null).
   */
  async checkCollectionAccess<T>(
    collectionName: string,
    operation: AccessOperation,
    user?: UserContext,
    documentId?: string,
    document?: Record<string, unknown>,
    overrideAccess?: boolean
  ): Promise<CollectionServiceResult<T> | null> {
    // When overrideAccess is true, bypass all access control checks
    if (overrideAccess) {
      return null;
    }

    // RBAC check: super-admin bypass → code-defined access → DB permissions.
    if (this.rbacAccessControlService && user) {
      try {
        const allowed = await this.rbacAccessControlService.checkAccess({
          userId: user.id,
          operation,
          resource: collectionName,
        });
        if (!allowed) {
          return {
            success: false,
            statusCode: 403,
            message: `Access denied: insufficient permissions for ${operation} on ${collectionName}`,
            data: null as unknown as T,
          };
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error("RBAC access check failed", {
          collectionName,
          operation,
          userId: user.id,
          error: errorMessage,
        });
        // Fail-secure: deny on unexpected RBAC errors
        return {
          success: false,
          statusCode: 500,
          message: "Failed to verify RBAC permissions",
          data: null as unknown as T,
        };
      }
    }

    try {
      // Get collection metadata to retrieve access rules
      const collection =
        await this.collectionService.getCollection(collectionName);
      const accessRules = this.getAccessRules(
        collection as Record<string, unknown>
      );

      // Build request context from user
      const requestContext = this.buildRequestContext(user);

      // Evaluate access
      const result = await this.accessControlService.evaluateAccess(
        accessRules,
        operation,
        requestContext,
        documentId,
        document
      );

      if (!result.allowed) {
        return {
          success: false,
          statusCode: 403,
          message: result.reason || "Access denied",
          data: null as unknown as T,
        };
      }

      // Access allowed - return null to continue
      return null;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // If collection not found, let other code handle it
      if (errorMessage?.includes("not found")) {
        return null;
      }

      this.logger.error("Error checking collection access", {
        collectionName,
        operation,
        error: errorMessage,
      });

      // On unexpected errors, deny access for safety
      return {
        success: false,
        statusCode: 500,
        message: "Failed to verify access permissions",
        data: null as unknown as T,
      };
    }
  }

  /**
   * Get access query constraint for read operations.
   *
   * For owner-only access rules on read operations, the AccessControlService
   * returns a query constraint instead of a boolean.
   */
  async getAccessQueryConstraint(
    collectionName: string,
    user?: UserContext,
    overrideAccess?: boolean
  ): Promise<Record<string, unknown> | null> {
    if (overrideAccess || !user) {
      return null;
    }

    try {
      const collection =
        await this.collectionService.getCollection(collectionName);
      const accessRules = this.getAccessRules(
        collection as Record<string, unknown>
      );
      const requestContext = this.buildRequestContext(user);

      const result = await this.accessControlService.evaluateAccess(
        accessRules,
        "read",
        requestContext
      );

      // Return query constraint if present
      return (result.query as Record<string, unknown>) ?? null;
    } catch {
      return null;
    }
  }
}
