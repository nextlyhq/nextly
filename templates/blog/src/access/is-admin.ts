/**
 * Access control: user belongs to the `admin` role.
 *
 * Narrower than {@link isAuthorOrEditor}; reserve for destructive or
 * configuration-level operations. Super-admins bypass access checks in
 * core, so this lets the `admin` custom role act as a regular admin
 * without needing super-admin privileges.
 */
import type { AccessControlFunction } from "@revnixhq/nextly";

export const isAdmin: AccessControlFunction = ({ roles }) =>
  roles.includes("admin");
