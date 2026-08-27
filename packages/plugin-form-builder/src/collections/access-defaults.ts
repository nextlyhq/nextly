/**
 * The access rules both collections this plugin contributes fall back to.
 *
 * Written out per collection they were byte-identical apart from `read`, and
 * two copies of an access policy is the copy that matters most: they agree
 * today, one gets tightened later, and the other silently keeps the old rule
 * while looking deliberate.
 *
 * `read` and `create` are the axes they genuinely differ on, so both are
 * parameters: a form is publicly READABLE because a site renders it, and a
 * submission is publicly CREATABLE because a visitor makes it. Update and
 * delete are the same policy in both collections.
 *
 * @module collections/access-defaults
 */

import type { CollectionAccessControl } from "nextly";

/** A single rule, in either form the collection config accepts. */
type AccessRule = NonNullable<CollectionAccessControl["read"]>;

/** The subset of a collection's access declaration these defaults supply. */
export type AccessOverrides = Pick<
  CollectionAccessControl,
  "read" | "create" | "update" | "delete"
>;

/** Signed in. */
const authenticated: AccessRule = ({ user }) => !!user;

/** Signed in AND holding an administrative role. */
const administrative: AccessRule = ({ roles }) =>
  roles.includes("admin") || roles.includes("super-admin");

/**
 * Host overrides applied over this plugin's defaults, per operation.
 *
 * Each override is taken with `??`, so a host may pass `false` to close an
 * operation it would otherwise be given — which `||` would have silently
 * replaced with the default.
 */
export function accessWithDefaults(
  overrides: AccessOverrides | undefined,
  defaults: { read?: AccessRule; create?: AccessRule } = {}
): AccessOverrides {
  return {
    read: overrides?.read ?? defaults.read ?? authenticated,
    create: overrides?.create ?? defaults.create ?? authenticated,
    update: overrides?.update ?? authenticated,
    // Deleting is administrative in both collections; the DB permission layer
    // remains the backstop underneath it.
    delete: overrides?.delete ?? administrative,
  };
}
