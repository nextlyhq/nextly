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
  /**
   * True when a workflow seeded the permission: one of its steps' own actions, or
   * `publish-without-review`. No preset grants one: who may approve, or publish past review, is
   * each project's decision, made by granting it to a role.
   */
  isWorkflow: boolean;
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
 * System resources whose read the Viewer preset does not take: the staff
 * accounts and the API keys. Reading them tells who can sign in and what each
 * key may do, which is not content, and a person given Viewer to look at a
 * site's content has no need of it.
 */
const VIEWER_WITHHELD_READS = new Set(["users", "api-keys"]);

/**
 * The slugs of the built-in preset roles, the names a collection's
 * `grants.presets` and a declared permission's `presets` open them by.
 */
export const PRESET_ROLE_SLUGS = [
  "admin",
  "editor",
  "author",
  "viewer",
] as const;

/** One of the built-in preset roles, by slug. */
export type PresetRoleSlug = (typeof PRESET_ROLE_SLUGS)[number];

/**
 * Which presets a permission may reach at all, before each preset's own rule
 * is asked: `undefined` where every preset may, as each one's rule decides,
 * or the presets it is opened to, an empty set where it is opened to none.
 *
 * Kept apart from {@link RolePreset.grants}, which says what a role MEANS
 * (an author does not publish), because this says something else: whether a
 * resource has been opened to the preset roles at all. A collection is
 * reachable by a preset only once it is opened to it by name, so adding one
 * never widens what an existing role can do; the seeder works this out from
 * the configuration and the grants a site held before that rule
 * (`auth/preset-reach`).
 */
export interface PresetReach {
  presetsFor(permission: PresetPermission): ReadonlySet<string> | undefined;
}

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
    grants: ({ action, resource }, { isWorkflow }) =>
      !isWorkflow &&
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
    grants: ({ resource }, { isSystem, isPlugin, isWorkflow }) =>
      !isWorkflow && ((!isSystem && !isPlugin) || resource === "media"),
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
    grants: ({ action, resource }, { isSystem, isPlugin, isWorkflow }) => {
      if (isPlugin || isWorkflow) return false;
      if (isSystem && resource !== "media") return false;
      // The trash's two actions go with `delete`: an author neither brings a
      // deleted entry back nor removes one for good.
      return ![
        "delete",
        "publish",
        "unpublish",
        "manage",
        "restore",
        "empty",
      ].includes(action);
    },
  },
  {
    slug: "viewer",
    name: "Viewer",
    description: "Read content, change nothing",
    level: 10,
    // Every read but the staff accounts' and the API keys'.
    grants: ({ action, resource }) =>
      READ_ONLY_ACTIONS.has(action) && !VIEWER_WITHHELD_READS.has(resource),
  },
];

/**
 * Which permissions a preset resolves to, against the live permission list: those `reach` lets the
 * preset hold at all, and of them those its own rule grants. `isWorkflow` says which ones a workflow
 * seeded (`workflowSeededPermissions`), which only the seeder, reading the attached workflows, can
 * tell.
 *
 * `reach` is required rather than defaulted to "every preset": a caller that forgot it would hand
 * every preset each new collection, which is the widening it exists to prevent.
 */
export function resolvePreset<P extends PresetPermission>(
  preset: RolePreset,
  permissions: P[],
  reach: PresetReach,
  isWorkflow: (permission: P) => boolean = () => false
): P[] {
  return permissions.filter(permission => {
    const opened = reach.presetsFor(permission);
    if (opened !== undefined && !opened.has(preset.slug)) return false;
    return preset.grants(permission, {
      isSystem: isSystemResource(permission.resource),
      isPlugin: permission.owner !== null,
      isWorkflow: isWorkflow(permission),
    });
  });
}

/**
 * The preset roles that would end up holding `read-<slug>` for a collection
 * created under that slug, where it is opened to the presets `openedTo` names:
 * none of them by default, since a new collection reaches a preset only once
 * it is opened to it by name.
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
export function presetsGrantingReadOf(
  slug: string,
  openedTo: readonly string[] = []
): string[] {
  const permission: PresetPermission = {
    action: "read",
    resource: slug,
    owner: null,
  };
  const opened = new Set(openedTo);
  return ROLE_PRESETS.filter(
    preset =>
      opened.has(preset.slug) &&
      preset.grants(permission, {
        isSystem: false,
        isPlugin: false,
        isWorkflow: false,
      })
  ).map(preset => preset.slug);
}
