import {
  isSystemResource,
  permissionName,
  permissionSlug,
} from "../../schemas/_zod/rbac";
import type { PluginPermission } from "../contributions";
import { permissionCollisionError } from "../permission-error";
import type { PluginDefinition } from "../plugin-context";

/** A custom permission resolved to its concrete, seedable shape. */
export interface CollectedPermission {
  action: string;
  resource: string;
  /** `${action}-${resource}` — matches the existing CRUD slug convention. */
  slug: string;
  name: string;
  description?: string;
  /** Declaring plugin name ("app" for app-declared). Persisted on the row. */
  owner: string;
  /**
   * Which KIND of declaration this came from, host or plugin.
   *
   * Carried beside `owner` rather than read out of it, because `owner` cannot
   * answer the question: the host's sentinel is the literal string `"app"`, and
   * a plugin may legally be named `app`. Anything grouping these by plugin would
   * then file every host-declared permission under that plugin. Not persisted —
   * `owner` remains the stored attribution, so no row changes shape.
   */
  source: "app" | "plugin";
  /**
   * Heading within the owner's section. Defaulted here rather than left
   * undefined, so grouping never has to decide what an absent group means.
   */
  group: string;
  /** True for a permission the admin should warn before granting. */
  danger: boolean;
}

/** Where a permission lands when its plugin does not group its own. */
export const DEFAULT_PERMISSION_GROUP = "General";

// The actions the auto-seeder has always owned for a collection or single slug.
// A plugin declaring one of these on such a slug collides with the seeded row,
// and always would have, so the declaration is an authoring error and is
// rejected.
const CRUD_ACTIONS = new Set(["create", "read", "update", "delete"]);
const SINGLE_ACTIONS = new Set(["read", "update"]);

// Actions the seeder owns as of the publish lifecycle, but which were legal for
// a plugin to declare before it.
//
// These are ADOPTED rather than rejected. The seeder now emits exactly the same
// slug (`publish-posts`), so the declaration is redundant, not conflicting —
// and rejecting it would stop an already-installed app from booting the moment
// it upgraded, on a declaration that was valid when it was written. Dropping it
// here leaves the permission in place, seeded, under the same slug, with grants
// intact because rows are matched on action and resource.
//
// The distinction matters beyond politeness: a plugin-declared row carries an
// `owner`, and `markOrphanedPermissions` only considers owned rows. Letting the
// declaration through would put a permission the seeder depends on at risk of
// being swept the day the plugin is removed.
export const ADOPTED_LIFECYCLE_ACTIONS = new Set(["publish", "unpublish"]);

/**
 * The parts of a config a permission collector reads.
 *
 * Named rather than taking the whole service config: a caller holding a loaded
 * config has no image processor or adapter to offer, and widening the gap with
 * a cast would stop the compiler checking that the fields actually read are
 * runtime callers are unaffected.
 */
export interface PermissionConfigSource {
  collections?: ReadonlyArray<{ slug: string }>;
  singles?: ReadonlyArray<{ slug: string }>;
  permissions?: readonly PluginPermission[];
}

/**
 * Fold every plugin's `contributes.permissions` into a deduped, collision-
 * validated list of seedable custom permissions. Pure. Runs over ALL
 * plugins incl. disabled ones so declarative permissions stay deterministic
 * across environments (D49 — same policy as the schema fold). Throws
 * `NEXTLY_PERMISSION_COLLISION` on:
 *  - the same (action,resource) declared by two sources (duplicate-permission);
 *  - a resource that is a built-in system resource (system-resource-reserved);
 *  - a CRUD action on a collection slug / read|update on a single slug, which
 *    the auto-seeder already owns (crud-permission-reserved).
 *
 * `publish` and `unpublish` on such a slug are the exception: the seeder owns
 * them too, but only since the publish lifecycle landed, so a declaration is
 * silently dropped instead of rejected. See `ADOPTED_LIFECYCLE_ACTIONS`.
 */
export function collectCustomPermissions(
  config: PermissionConfigSource,
  plugins: PluginDefinition[]
): CollectedPermission[] {
  const collectionSlugs = new Set((config.collections ?? []).map(c => c.slug));
  const singleSlugs = new Set((config.singles ?? []).map(s => s.slug));
  const lowerCollectionSlugs = new Set(
    [...collectionSlugs].map(slug => slug.toLowerCase())
  );
  const lowerSingleSlugs = new Set(
    [...singleSlugs].map(slug => slug.toLowerCase())
  );
  const seen = new Map<string, string>(); // `${action}:${resource}` -> first owner
  const out: CollectedPermission[] = [];

  // One declared custom permission from a given owner ("app" or a plugin name).
  // Shared by the app and plugin passes so both validate + collide identically.
  const consider = (
    perm: PluginPermission,
    owner: string,
    source: "app" | "plugin"
  ): void => {
    const { action, resource } = perm;
    // Compared in lower case, because the SEEDER decides this same question
    // that way: `ensurePermission` matches an existing row with
    // `LOWER(action) = LOWER(action)` and `LOWER(resource) = LOWER(resource)`.
    // Left case-sensitive, `Export:Reports` and `export:reports` are collected
    // as two permissions from two owners while the database holds ONE row —
    // attributed to whichever was seeded last — so a plugin's detail page can
    // claim a permission the roles data gives to someone else. The stored
    // action and resource keep their declared casing; only the identity used
    // to dedupe is normalized.
    const key = `${action.toLowerCase()}:${resource.toLowerCase()}`;

    const prev = seen.get(key);
    if (prev !== undefined) {
      throw permissionCollisionError(
        action,
        resource,
        [prev, owner],
        "duplicate-permission"
      );
    }
    if (isSystemResource(resource)) {
      throw permissionCollisionError(
        action,
        resource,
        [owner],
        "system-resource-reserved"
      );
    }
    // Both halves read in lower case, because the seeder decides the same question that way:
    // `ensurePermission` matches an existing row with `LOWER(action) = LOWER(action)`. Left
    // case-sensitive here, `{ action: "Publish", resource: "Posts" }` is collected as a custom
    // permission while the seeder recognises it as the seeded `publish/posts` and withholds it —
    // so a role bundle and a generated type name a slug no row was ever written under.
    const entitySlug = resource.toLowerCase();
    const ownedByEntity =
      lowerCollectionSlugs.has(entitySlug) || lowerSingleSlugs.has(entitySlug);

    // Redundant with what the seeder now emits, and valid before it did. Drop
    // it and carry on rather than failing the boot of an app that upgraded.
    if (ADOPTED_LIFECYCLE_ACTIONS.has(action.toLowerCase()) && ownedByEntity) {
      return;
    }

    // Compared in lower case, like the lifecycle check above and like `ensurePermission`, which
    // matches an existing row with `LOWER(action) = LOWER(action)`. Left case-sensitive,
    // `{ action: "Delete", resource: "Posts" }` walks past this reservation and is collected as a
    // custom permission — and the seeder then patches an owner onto the collection's OWN
    // `delete-posts` row, which `role-presets.ts` grants Editor on `!isSystem && !isPlugin`. The
    // collection quietly stops being deletable by an editor.
    const lowerAction = action.toLowerCase();
    if (
      (CRUD_ACTIONS.has(lowerAction) && lowerCollectionSlugs.has(entitySlug)) ||
      (SINGLE_ACTIONS.has(lowerAction) && lowerSingleSlugs.has(entitySlug))
    ) {
      throw permissionCollisionError(
        action,
        resource,
        [owner],
        "crud-permission-reserved"
      );
    }

    seen.set(key, owner);
    out.push({
      action,
      resource,
      // Composed from the identity exactly as stored, not from a normalized copy of it. The slug
      // is what a route guard declares, and `parsePermissionSlug` turns that back into an action
      // and a resource which `hasPermission` matches with `eq()` — case-sensitively. Composing
      // from lower-cased halves while the row keeps the declared casing breaks that round trip,
      // and a role holding the grant is denied by a guard naming the permission it holds.
      slug: permissionSlug(action, resource),
      name: perm.label ?? permissionName(action, resource),
      description: perm.description,
      owner,
      source,
      // `group` was accepted and dropped: the interface documented it, the
      // canonical example set it, and nothing ever read it.
      group: perm.group?.trim() || DEFAULT_PERMISSION_GROUP,
      danger: perm.danger === true,
    });
  };

  eachDeclaredPermission(config, plugins, consider);

  return out;
}

/**
 * Every declared permission with the owner that declared it, app first then each plugin.
 *
 * One iterator, because two walks over the same declarations are two chances for them to
 * disagree about what was declared — and the second walk here decides whether a boot is refused.
 */
function eachDeclaredPermission(
  config: PermissionConfigSource,
  plugins: PluginDefinition[],
  visit: (
    perm: PluginPermission,
    owner: string,
    source: "app" | "plugin"
  ) => void
): void {
  for (const perm of config.permissions ?? []) visit(perm, "app", "app");
  for (const plugin of plugins) {
    for (const perm of plugin.contributes?.permissions ?? []) {
      visit(perm, plugin.name, "plugin");
    }
  }
}

/** A CRUD-shaped declaration whose resource the config cannot classify. */
export interface UnresolvedPermission {
  action: string;
  resource: string;
  owner: string;
}

/**
 * @experimental Collect every CRUD-shaped declaration whose resource is NOT a config entity,
 * WITHOUT throwing.
 *
 * A resource collected here may be a Schema Builder collection — which lives in
 * `dynamic_collections` and is unknowable at fold time — or it may be a genuine custom resource a
 * plugin owns outright, which is the ordinary case and entirely legal. The two are
 * indistinguishable until Builder slugs load, so the verdict is deferred to
 * {@link finalizePermissionTargets}.
 *
 * The same shape `collectUnresolvedRelationTargets` uses, for the same reason: config answers
 * part of the question and the database answers the rest.
 */
export function collectUnresolvedPermissionTargets(
  config: PermissionConfigSource,
  plugins: PluginDefinition[]
): UnresolvedPermission[] {
  const configEntities = new Set([
    ...(config.collections ?? []).map(c => c.slug.toLowerCase()),
    ...(config.singles ?? []).map(s => s.slug.toLowerCase()),
  ]);
  const unresolved: UnresolvedPermission[] = [];
  eachDeclaredPermission(config, plugins, (perm, owner) => {
    const action = perm.action.toLowerCase();
    if (!CRUD_ACTIONS.has(action) && !SINGLE_ACTIONS.has(action)) return;
    // A resource the config knows was already settled by `collectCustomPermissions`, which threw
    // if it collided. What is left is what only the database can classify.
    if (configEntities.has(perm.resource.toLowerCase())) return;
    unresolved.push({ action: perm.action, resource: perm.resource, owner });
  });
  return unresolved;
}

/**
 * @experimental Settle deferred permission collisions once Builder slugs are known.
 *
 * A declaration that survived {@link collectUnresolvedPermissionTargets} and names a Builder
 * entity is the same authoring error `crud-permission-reserved` already refuses for a config
 * entity: the seeder owns that entity's CRUD permissions, so the declaration cannot be honoured
 * as a custom permission. It is refused here rather than at fold time only because the config
 * cannot see the entity.
 *
 * REFUSED rather than dropped, and refused rather than merely stripped of ownership, because
 * both softer options end somewhere worse. Dropping it silently leaves the plugin's route
 * guarded by a permission the collection also grants, so every editor reaches it. Withholding
 * ownership does the same thing by a different route: `role-presets.ts` grants Editor on
 * `!isSystem && !isPlugin`, so an unowned row is a granted row.
 *
 * `allowOverride` exists for an application already running such a plugin, which would otherwise
 * have no way to boot while it waits for a fix. It is opt-in, and it says so in the warning.
 */
export function finalizePermissionTargets(
  unresolved: readonly UnresolvedPermission[],
  builderSlugs: Iterable<string>,
  opts?: {
    allowOverride?: boolean;
    logger?: { warn?(message: string): void };
  }
): void {
  if (unresolved.length === 0) return;
  const builder = new Set<string>();
  for (const slug of builderSlugs) builder.add(slug.toLowerCase());
  for (const declaration of unresolved) {
    if (!builder.has(declaration.resource.toLowerCase())) continue;
    if (opts?.allowOverride !== true) {
      throw permissionCollisionError(
        declaration.action,
        declaration.resource,
        [declaration.owner],
        "crud-permission-reserved"
      );
    }
    opts.logger?.warn?.(
      `[plugins] "${declaration.owner}" declares "${declaration.action}" on "${declaration.resource}", ` +
        `which is a Schema Builder entity whose CRUD permissions the seeder owns. ` +
        `Honouring it lets the plugin take that permission from the roles the presets grant it. ` +
        `(unset NEXTLY_ALLOW_PLUGIN_PERMISSION_OVERRIDE to refuse this at boot instead)`
    );
  }
}
