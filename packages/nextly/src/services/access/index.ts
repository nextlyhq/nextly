/**
 * Access Control Module
 *
 * Provides types, utilities, and services for collection-level access control.
 * Access rules can be stored in the database (UI collections) or
 * defined in code (code-first collections).
 *
 * @module services/access
 * @since 1.0.0
 *
 * @example Basic usage with AccessControlService
 * ```typescript
 * import {
 *   AccessControlService,
 *   type CollectionAccessRules,
 * } from '@nextly/services/access';
 *
 * const accessService = new AccessControlService();
 *
 * const rules: CollectionAccessRules = {
 *   create: { type: 'authenticated' },
 *   read: { type: 'public' },
 *   update: { type: 'owner-only' },
 *   delete: { type: 'role-based', allowedRoles: ['admin'] },
 * };
 *
 * const result = await accessService.evaluateAccess(
 *   rules,
 *   'read',
 *   { user: { id: 'user-123', role: 'editor' } }
 * );
 *
 * if (result.allowed) {
 *   // Proceed with operation
 * } else {
 *   // Access denied: result.reason
 * }
 * ```
 *
 * @example Type-only imports
 * ```typescript
 * import type {
 *   AccessRuleType,
 *   StoredAccessRule,
 *   CollectionAccessRules,
 *   AccessOperation,
 *   AccessEvaluationResult,
 * } from '@nextly/services/access';
 * ```
 */

export { AccessControlService } from "./access-control-service";
export type { CustomAccessFunction } from "./access-control-service";

export type {
  AccessRuleType,
  AccessOperation,
  StoredAccessRule,
  CollectionAccessRules,
  AccessEvaluationResult,
} from "./types";

export {
  ACCESS_RULE_TYPES,
  ACCESS_OPERATIONS,
  DEFAULT_OWNER_FIELD,
} from "./types";
