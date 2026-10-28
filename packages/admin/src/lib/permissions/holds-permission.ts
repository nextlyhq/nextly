/**
 * Whether a permission list holds a permission, as the server counts it.
 *
 * A permission is held only where the list names it. A retired `manage-`
 * permission on media, settings or the Email hub counts for nothing until
 * `nextly upgrade` has stored the plain permissions in its place, so a role
 * still holding one is shown what the server lets it do: none of them. Every
 * permission check in the admin asks this.
 *
 * @module lib/permissions/holds-permission
 */
export function holdsPermission(
  held: ReadonlySet<string>,
  permission: string
): boolean {
  return held.has(permission);
}
