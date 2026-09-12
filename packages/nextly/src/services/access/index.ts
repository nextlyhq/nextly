/**
 * Access Control Module
 *
 * The operation vocabulary collection and Single access gates are keyed on,
 * plus the super-admin predicate every transport honours. Who may perform an
 * operation is decided by the code-defined `access` on a collection's own
 * config; nothing here stores or evaluates rules of its own.
 *
 * @module services/access
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   ACCESS_OPERATIONS,
 *   isSuperAdminContext,
 *   type AccessOperation,
 * } from '@nextly/services/access';
 *
 * const op: AccessOperation = 'read';
 * if (isSuperAdminContext(user)) {
 *   // Bypass the coarse gate
 * }
 * ```
 */

export type { AccessOperation } from "./types";

export { ACCESS_OPERATIONS } from "./types";

export { SUPER_ADMIN_SLUG, isSuperAdminContext } from "./super-admin";
