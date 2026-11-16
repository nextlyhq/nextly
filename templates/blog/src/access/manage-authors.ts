/**
 * Access control: who may see the account an author profile belongs to.
 *
 * A profile is public (anyone reads `authors`), but the account it belongs to
 * is a private user id: shown to a visitor, every profile would name the
 * account behind it, and a filter on it would map accounts to profiles. So the
 * field is read only by a caller who may change profiles (`update-authors`),
 * the editors who link a profile to its account. Like the posts rules, the
 * line is a grant the Roles screen shows, never a role's name.
 *
 * The template's own reads of the field (crediting a post to its writer's
 * profile, the seed finding a profile by its account) go through the Direct
 * API on the server, which field rules do not limit.
 */
import type { AccessControlFunction } from "nextly";

/** Whether the caller may change author profiles, and so see their accounts. */
export const mayManageAuthors: AccessControlFunction = ({ permissions }) =>
  permissions.includes("update-authors");
