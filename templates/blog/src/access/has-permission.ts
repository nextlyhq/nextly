/**
 * Access control: the caller's roles hold the permission for this operation
 * on this collection, as the admin's Roles screen grants it - `update-posts`
 * to edit a post, `create-tags` to add a tag.
 *
 * Decided by permission, never by a role's name. A rule that admitted the
 * `admin`, `editor` and `author` roles refused a custom role holding exactly
 * the permission it needed, and every API key whose roles carried none of
 * those names, while the Roles screen said both could act.
 *
 * The grant is checked before any rule a collection declares, and a rule
 * only narrows it, so this check repeats what the gate already asked; it
 * keeps the rule's meaning plain where it is read. Narrow it with a
 * condition of your own (`hasPermission(args) && ...`). Rules receive permissions as the Roles screen spells them,
 * for a session and an API key alike; a visitor holds none and is refused. Super-admins are
 * admitted before any rule runs.
 */
import type { AccessControlFunction } from "nextly";

export const hasPermission: AccessControlFunction = ({
  permissions,
  collection,
  operation,
}) => permissions.includes(`${operation}-${collection}`);
