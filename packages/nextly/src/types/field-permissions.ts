/**
 * Field-level permissions types for granular access control.
 *
 * Enables administrators to control access to individual fields within collections,
 * supporting use cases like hiding sensitive data (SSN, salary, private notes)
 * from users without full access rights.
 *
 * @module types/field-permissions
 */

/**
 * Permission condition types for conditional field access.
 *
 * Ownership: Field access based on ownership (e.g., user can only see their own email)
 * Team: Field access based on team membership
 * Expression: Field access based on custom expression evaluation
 * Function: Field access based on custom function handler
 */
export type PermissionCondition =
  | {
      type: "ownership";
      ownerField: string; // Field path that contains the owner ID (e.g., "userId", "createdBy.id")
    }
  | {
      type: "team";
      teamField: string; // Field path that contains the team ID
    }
  | {
      type: "expression";
      expression: string; // Safe expression (e.g., "record.status === 'published' || record.authorId === userId")
    }
  | {
      type: "function";
      handler: (context: PermissionContext) => boolean | Promise<boolean>;
    };

/**
 * Context provided to permission condition evaluators.
 */
export interface PermissionContext {
  /** ID of the user requesting access */
  userId: string;
  /** Role IDs assigned to the user */
  roleIds: string[];
  /** The record being accessed */
  record: Record<string, unknown>;
  /** Action being performed ('read' or 'write') */
  action: "read" | "write";
  /** Path to the field being accessed */
  fieldPath: string;
}

/**
 * Field permission rule defining access to a specific field.
 *
 * @example
 * ```typescript
 * const rule: FieldPermissionRule = {
 *   id: "fp_1",
 *   roleId: "editor",
 *   collectionSlug: "users",
 *   fieldPath: "email",
 *   action: "read",
 *   condition: {
 *     type: "ownership",
 *     ownerField: "id"
 *   },
 *   createdAt: new Date(),
 *   updatedAt: new Date()
 * };
 * ```
 */
export interface FieldPermissionRule {
  /** Unique identifier */
  id: string;
  /** Role this permission applies to */
  roleId: string;
  /** Collection slug this permission applies to */
  collectionSlug: string;
  /** Field path (supports nested: "user.profile.email") */
  fieldPath: string;
  /** Permission action */
  action: "read" | "write" | "none";
  /** Optional conditional access rule */
  condition?: PermissionCondition;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Data required to create a new field permission rule.
 */
export interface FieldPermissionInsertData {
  roleId: string;
  collectionSlug: string;
  fieldPath: string;
  action: "read" | "write" | "none";
  condition?: Omit<PermissionCondition, "handler">; // Exclude function handler from DB storage
}

/**
 * Data allowed for updating a field permission rule.
 */
export interface FieldPermissionUpdateData {
  action?: "read" | "write" | "none";
  condition?: Omit<PermissionCondition, "handler">;
}

/**
 * Result of a field access check.
 */
export interface FieldAccessResult {
  /** Whether access is allowed */
  allowed: boolean;
  /** Reason for denial (if denied) */
  reason?: string;
  /** Applied rules (for debugging) */
  appliedRules?: FieldPermissionRule[];
}

/**
 * Cache key for field permission lookups.
 */
export interface FieldPermissionCacheKey {
  roleIds: string[]; // Sorted array of role IDs
  collectionSlug: string;
  fieldPath: string;
  action: "read" | "write";
}

/**
 * Cached field permission decision.
 */
export interface CachedFieldPermission {
  key: string; // Serialized cache key
  allowed: boolean;
  rules: FieldPermissionRule[];
  expiresAt: Date;
}
