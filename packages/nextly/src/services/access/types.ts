/**
 * Access Control Type Definitions
 *
 * The operation vocabulary every collection and Single access gate is keyed
 * on. Who may perform an operation is decided by the code-defined `access` on
 * the entity's own config; nothing here stores or evaluates a rule.
 *
 * @module services/access/types
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { ACCESS_OPERATIONS, type AccessOperation } from '@nextly/services/access';
 *
 * for (const op of ACCESS_OPERATIONS) {
 *   // build a permission matrix
 * }
 * ```
 */

/**
 * Operations that can be access-controlled.
 *
 * - `create` - Creating new documents
 * - `read` - Reading/listing documents
 * - `update` - Modifying existing documents
 * - `delete` - Removing documents
 * - `publish` / `unpublish` - Moving a document in or out of the published state
 *
 * @example
 * ```typescript
 * const operation: AccessOperation = 'read';
 * ```
 */
export type AccessOperation =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "publish"
  | "unpublish";

/**
 * All supported access operations.
 *
 * Useful for validation and iteration.
 *
 * @example
 * ```typescript
 * for (const op of ACCESS_OPERATIONS) {
 *   // ...
 * }
 * ```
 */
export const ACCESS_OPERATIONS = [
  "create",
  "read",
  "update",
  "delete",
  "publish",
  "unpublish",
] as const satisfies readonly AccessOperation[];

// The runtime list must name every member of the type; a consumer that
// enumerates it to build a matrix or validate an input would otherwise silently
// omit an operation the type accepts. This fails to compile the moment
// `AccessOperation` gains a value this array does not.
type _UnlistedAccessOperation = Exclude<
  AccessOperation,
  (typeof ACCESS_OPERATIONS)[number]
>;
const _accessOperationsAreComplete: [_UnlistedAccessOperation] extends [never]
  ? true
  : never = true;
void _accessOperationsAreComplete;
