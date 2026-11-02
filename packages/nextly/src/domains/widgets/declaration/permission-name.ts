/**
 * A permission as core stores and seeds it, `action-resource` (`read-orders`).
 *
 * One rule for every declaration that names a permission (a widget's access,
 * an attention item's), so a spelling one refuses the other cannot accept: a
 * sentence, or the earlier `orders:read`, names no permission at all and would
 * hide what it gates from every reader with no fault anywhere.
 *
 * @module domains/widgets/declaration/permission-name
 */

const PERMISSION_NAME = /^[a-z][a-z0-9_]*-[a-z0-9][a-z0-9_-]*$/;

/** Whether `value` is a permission in its stored form. */
export function isPermissionName(value: unknown): value is string {
  return typeof value === "string" && PERMISSION_NAME.test(value);
}
