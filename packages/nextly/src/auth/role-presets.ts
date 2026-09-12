/**
 * What each built-in role MEANS, as predicates over the live permission list.
 *
 * Separated from the seeder that applies them (`database/seeders/role-presets`)
 * because two different callers need the declaration and only one of them may
 * have a database. The seeder writes role rows and so depends on the service
 * container; `auth/new-entity-access-policy` only needs to ASK a predicate what
 * it would grant, and importing the seeder to reach `ROLE_PRESETS` would pull
 * the container into an access-policy module that takes no I/O of its own.
 *
 * So the predicates live here, importing nothing but the system-resource list,
 * and the seeder imports them. The declaration is the shared thing; applying it
 * to a database is one use of it, not its definition.
 *
 * @module auth/role-presets
 */

import { isSystemResource } from "../schemas/_zod/rbac";

/**
 * What a preset is shown a permission alongside, so it can decide without
 * knowing which collections a project happens to have.
 */
export interface PresetContext {
  /** True when the resource is one of the framework's own (users, roles, …). */
  isSystem: boolean;
  /** True when a plugin declared the permission. */
  isPlugin: boolean;
}

/** One permission, as a preset sees it. */
export interface PresetPermission {
  action: string;
  resource: string;
  owner: string | null;
}

/**
 * A named starting point for a role.
 *
 * `grants` is a predicate rather than a list of slugs, and that is the whole
 * point: a project's permissions are not known when this file is written. Add
 * a collection and its permissions exist a boot later; a frozen list would
 * describe the project as it was the day someone typed it out, and every
 * preset would quietly fall behind the content it is supposed to govern.
 */
export interface RolePreset {
  slug: string;
  name: string;
  description: string;
  /** Ordering only; it grants nothing and implies nothing. */
  level: number;
  grants: (permission: PresetPermission, context: PresetContext) => boolean;
}

/** Resources whose write actions hand out access, rather than use it. */
const ESCALATION_RESOURCES = new Set(["roles", "permissions", "users"]);

/** Actions that only ever read. */
const READ_ONLY_ACTIONS = new Set(["read"]);

/**
 * The presets every project starts with.
 *
 * Deliberately few. These are starting points, not an attempt to name every
 * job: anything more specific is a custom role built on one of these, which
 * is what role inheritance is for.
 *
 * Only `admin` picks up a plugin's permissions. A plugin's verb is one this
 * file has never heard of and cannot reason about — it could be exporting a
 * CSV or emptying a bucket — so granting it to `editor` by default would mean
 * installing a plugin silently widened what every editor can do. `viewer` is
 * the exception that proves the rule: it grants a plugin's `read`, because
 * `read` is a verb we do know the meaning of.
 */
export const ROLE_PRESETS: RolePreset[] = [
  {
    slug: "admin",
    name: "Admin",
    description: "Everything except granting access to others",
    level: 90,
    // Everything but escalation. Someone who can edit roles can give
    // themselves anything, so an admin who is not a super admin stops there.
    // Reading them is fine — it is changing them that escalates.
    grants: ({ action, resource }) =>
      !(ESCALATION_RESOURCES.has(resource) && !READ_ONLY_ACTIONS.has(action)),
  },
  {
    slug: "editor",
    name: "Editor",
    description: "Full control of content and media, including publishing",
    level: 50,
    // Content, whatever the project's content turns out to be. A system
    // resource is the framework's own furniture and not an editor's business,
    // with media the exception because content needs images.
    grants: ({ resource }, { isSystem, isPlugin }) =>
      (!isSystem && !isPlugin) || resource === "media",
  },
  {
    slug: "author",
    name: "Author",
    description: "Write content, but not publish or delete it",
    level: 30,
    // The same reach as an editor, minus the actions that change what the
    // public sees. `unpublish` is excluded alongside `publish`: taking a live
    // page down is as visible as putting one up, and an author who cannot
    // publish but can unpublish is a strange half-authority. `manage` is
    // excluded because it is a superset we cannot see inside, which is exactly
    // what an author should not hold.
    grants: ({ action, resource }, { isSystem, isPlugin }) => {
      if (isPlugin) return false;
      if (isSystem && resource !== "media") return false;
      return !["delete", "publish", "unpublish", "manage"].includes(action);
    },
  },
  {
    slug: "viewer",
    name: "Viewer",
    description: "Read everything, change nothing",
    level: 10,
    grants: ({ action }) => READ_ONLY_ACTIONS.has(action),
  },
];

/** Which permissions a preset resolves to, against the live permission list. */
export function resolvePreset(
  preset: RolePreset,
  permissions: PresetPermission[]
): PresetPermission[] {
  return permissions.filter(permission =>
    preset.grants(permission, {
      isSystem: isSystemResource(permission.resource),
      isPlugin: permission.owner !== null,
    })
  );
}

/**
 * The preset roles that would end up holding `read-<slug>` for a collection
 * created under that slug.
 *
 * Asked of the predicates rather than answered by a list, for the reason
 * {@link RolePreset.grants} is a predicate at all: which presets cover a
 * collection is a function of rules that change, and a list beside them is a
 * second answer that goes stale the first time one is edited.
 *
 * The context is fixed and not a parameter. A collection somebody creates is
 * neither one of the framework's own resources nor a plugin's — a slug that
 * would collide with either is refused at creation — so those two flags are
 * facts about the question, not variables in it.
 */
export function presetsGrantingReadOf(slug: string): string[] {
  const permission: PresetPermission = {
    action: "read",
    resource: slug,
    owner: null,
  };
  return ROLE_PRESETS.filter(preset =>
    preset.grants(permission, { isSystem: false, isPlugin: false })
  ).map(preset => preset.slug);
}
