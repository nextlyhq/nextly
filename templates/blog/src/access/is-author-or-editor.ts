/**
 * Access control: user belongs to `admin`, `editor`, or `author` roles.
 *
 * Used on collections where any content role is acceptable but anonymous
 * readers are rejected. Category/Tag edits and post create/update fall
 * into this bucket.
 *
 * Fine-grained "own only" filters (e.g. authors editing only their own
 * posts) are enforced at the database permission layer, not here - the
 * AccessControlFunction signature doesn't receive the target document,
 * so row-level logic lives in the RBAC permission rules on the `author`
 * role (see seed/roles.ts).
 */
import type { AccessControlFunction } from "@revnixhq/nextly";

const CONTENT_ROLES = new Set(["admin", "editor", "author"]);

export const isAuthorOrEditor: AccessControlFunction = ({ roles }) =>
  roles.some(role => CONTENT_ROLES.has(role));
