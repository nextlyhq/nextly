/**
 * Access Control Module
 *
 * The operation vocabulary collection and Single access gates are keyed on,
 * plus the super-admin role's slug. Who may perform an operation is decided
 * by the code-defined `access` on a collection's own config; nothing here
 * stores or evaluates rules of its own. Whether a caller holds super-admin
 * authority is decided from their actor (`auth/access/resolve-actor`), never
 * from role names handed in with them.
 *
 * @module services/access
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   ACCESS_OPERATIONS,
 *   type AccessOperation,
 * } from '@nextly/services/access';
 *
 * const op: AccessOperation = 'read';
 * ```
 */

export type { AccessOperation } from "./types";

export { ACCESS_OPERATIONS } from "./types";

export { SUPER_ADMIN_SLUG } from "./super-admin";
