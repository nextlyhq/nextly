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

import type { AccessControlFunction, CollectionAccessControl } from "nextly";

/**
 * A single rule, in either form every operation accepts. Not the read rule's
 * type: a read rule may also answer a filter, which create, update and delete
 * may not.
 */
type AccessRule = AccessControlFunction | boolean;

/** The subset of a collection's access declaration these defaults supply. */
export type AccessOverrides = Pick<
  CollectionAccessControl,
  "read" | "create" | "update" | "delete"
>;

/**
 * The caller holds the permission for this operation on this collection, as
 * the role screen grants it: `read-form-submissions` to read submissions,
 * `update-forms` to edit a form.
 *
 * The grant is checked before a collection's rule, and the rule only narrows
 * it, so this check repeats the gate's and keeps the default plain; a role
 * name here would refuse a custom role that holds the permission. The rule is given
 * the caller's permissions as the role screen spells them, `<action>-<slug>`,
 * for a session and an API key alike, and a visitor holds none. `collection` is the slug the host installed
 * the collection under, so a renamed collection is judged by its own
 * permissions. A super-admin is admitted before any rule runs.
 */
const permitted: AccessRule = ({ permissions, collection, operation }) =>
  permissions.includes(`${operation}-${collection}`);

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
    read: overrides?.read ?? defaults.read ?? permitted,
    create: overrides?.create ?? defaults.create ?? permitted,
    update: overrides?.update ?? permitted,
    delete: overrides?.delete ?? permitted,
  };
}
