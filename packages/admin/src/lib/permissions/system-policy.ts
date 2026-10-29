/**
 * The permissions core asks of each settings and Email hub action, as the
 * admin's guards and navigation ask them.
 *
 * Read from core's own declaration (`SYSTEM_READ_POLICY`,
 * `SYSTEM_WRITE_POLICY`), imported from its source file: it is plain data
 * with no imports, so it bundles safely into the client, and the admin cannot
 * come to ask for one permission while the server asks for another.
 * `system-policy.test.ts` holds that file free of imports.
 *
 * @module lib/permissions/system-policy
 */
import {
  SYSTEM_READ_POLICY,
  SYSTEM_WRITE_POLICY,
  type RouteGrant,
} from "../../../../nextly/src/domains/auth/system-write-policy";

/** The permission slugs a grant names, any one of which satisfies it. */
export function slugsOf(grant: RouteGrant): string[] {
  const permissions = "anyOf" in grant ? grant.anyOf : [grant];
  return permissions.map(
    permission => `${permission.action}-${permission.resource}`
  );
}

/** The one permission slug a grant of a single permission names. */
function onlySlugOf(grant: RouteGrant): string {
  const [slug, ...others] = slugsOf(grant);
  if (slug === undefined || others.length > 0) {
    throw new Error("Expected a grant of exactly one permission");
  }
  return slug;
}

/** Seeing any settings page: `read-settings`. */
export const READ_SETTINGS = onlySlugOf(SYSTEM_READ_POLICY.settings.read);

/** Adding, changing and removing settings, as their routes ask it. */
export const CREATE_SETTINGS = onlySlugOf(SYSTEM_WRITE_POLICY.imageSizes.create);
export const UPDATE_SETTINGS = onlySlugOf(SYSTEM_WRITE_POLICY.settings.update);
export const DELETE_SETTINGS = onlySlugOf(SYSTEM_WRITE_POLICY.imageSizes.delete);

/** Any change to settings: the plugins area, which configures them. */
export const CHANGE_SETTINGS: readonly string[] = [
  CREATE_SETTINGS,
  UPDATE_SETTINGS,
  DELETE_SETTINGS,
];

export { SYSTEM_READ_POLICY, SYSTEM_WRITE_POLICY };
