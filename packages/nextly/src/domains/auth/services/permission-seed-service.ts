import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql, eq, and } from "drizzle-orm";

import type { RBACDatabaseInstance } from "@nextly/types/rbac-operations";

import type { CollectedPermission } from "../../../plugins/permissions/collect-permissions";
import { ADOPTED_LIFECYCLE_ACTIONS } from "../../../plugins/permissions/collect-permissions";
import { SYSTEM_RESOURCES, permissionSlug } from "../../../schemas/_zod/rbac";
import { BaseService } from "../../../services/base-service";
import type { Logger } from "../../../services/shared";
import { resolveRegistryTableName } from "../../field-groups/storage/resolve-storage-names";

import { PermissionService } from "./permission-service";
import { RolePermissionService } from "./role-permission-service";

/**
 * Result from a seeding operation.
 */
export interface SeedResult {
  /** Number of permissions newly created */
  created: number;
  /** Number of permissions that already existed (skipped) */
  skipped: number;
  /** Number of errors encountered */
  errors: number;
  /** Total permissions processed */
  total: number;
  /** IDs of newly created permissions (for super_admin assignment) */
  newPermissionIds: string[];
}

/**
 * Definition for a single system permission.
 */
interface SystemPermissionDef {
  name: string;
  slug: string;
  action: string;
  resource: string;
  description: string;
}

/**
 * System permissions that are always seeded regardless of dynamic collections.
 * These represent core Nextly entity permissions.
 */
const SYSTEM_PERMISSIONS: SystemPermissionDef[] = [
  {
    name: "Create Users",
    slug: "create-users",
    action: "create",
    resource: "users",
    description: "Permission to create users",
  },
  {
    name: "Read Users",
    slug: "read-users",
    action: "read",
    resource: "users",
    description: "Permission to read users",
  },
  {
    name: "Update Users",
    slug: "update-users",
    action: "update",
    resource: "users",
    description: "Permission to update users",
  },
  {
    name: "Delete Users",
    slug: "delete-users",
    action: "delete",
    resource: "users",
    description: "Permission to delete users",
  },
  {
    name: "Create Roles",
    slug: "create-roles",
    action: "create",
    resource: "roles",
    description: "Permission to create roles",
  },
  {
    name: "Read Roles",
    slug: "read-roles",
    action: "read",
    resource: "roles",
    description: "Permission to read roles",
  },
  {
    name: "Update Roles",
    slug: "update-roles",
    action: "update",
    resource: "roles",
    description: "Permission to update roles",
  },
  {
    name: "Delete Roles",
    slug: "delete-roles",
    action: "delete",
    resource: "roles",
    description: "Permission to delete roles",
  },
  {
    name: "Manage Media",
    slug: "manage-media",
    action: "manage",
    resource: "media",
    description: "Permission to upload and manage media files",
  },
  {
    name: "Create Media",
    slug: "create-media",
    action: "create",
    resource: "media",
    description: "Permission to upload media files",
  },
  {
    name: "Read Media",
    slug: "read-media",
    action: "read",
    resource: "media",
    description: "Permission to view media files",
  },
  {
    name: "Update Media",
    slug: "update-media",
    action: "update",
    resource: "media",
    description: "Permission to edit media metadata and move files",
  },
  {
    name: "Delete Media",
    slug: "delete-media",
    action: "delete",
    resource: "media",
    description: "Permission to delete media files",
  },
  {
    name: "Manage Settings",
    slug: "manage-settings",
    action: "manage",
    resource: "settings",
    description: "Permission to manage system settings",
  },
  {
    name: "Read Settings",
    slug: "read-settings",
    action: "read",
    resource: "settings",
    description: "Permission to read system settings",
  },
  {
    name: "Manage Email Providers",
    slug: "manage-email-providers",
    action: "manage",
    resource: "email-providers",
    description: "Permission to manage email providers",
  },
  {
    name: "Create Email Providers",
    slug: "create-email-providers",
    action: "create",
    resource: "email-providers",
    description: "Permission to create email providers",
  },
  {
    name: "Read Email Providers",
    slug: "read-email-providers",
    action: "read",
    resource: "email-providers",
    description: "Permission to read email providers",
  },
  {
    name: "Delete Email Providers",
    slug: "delete-email-providers",
    action: "delete",
    resource: "email-providers",
    description: "Permission to delete email providers",
  },
  {
    name: "Manage Email Templates",
    slug: "manage-email-templates",
    action: "manage",
    resource: "email-templates",
    description: "Permission to manage email templates",
  },
  {
    name: "Create Email Templates",
    slug: "create-email-templates",
    action: "create",
    resource: "email-templates",
    description: "Permission to create email templates",
  },
  {
    name: "Read Email Templates",
    slug: "read-email-templates",
    action: "read",
    resource: "email-templates",
    description: "Permission to read email templates",
  },
  {
    name: "Delete Email Templates",
    slug: "delete-email-templates",
    action: "delete",
    resource: "email-templates",
    description: "Permission to delete email templates",
  },
  {
    name: "Update API Keys",
    slug: "update-api-keys",
    action: "update",
    resource: "api-keys",
    description: "Permission to update API keys",
  },
  {
    name: "Create API Keys",
    slug: "create-api-keys",
    action: "create",
    resource: "api-keys",
    description: "Permission to create API keys",
  },
  {
    name: "Read API Keys",
    slug: "read-api-keys",
    action: "read",
    resource: "api-keys",
    description: "Permission to read API keys",
  },
  {
    name: "Delete API Keys",
    slug: "delete-api-keys",
    action: "delete",
    resource: "api-keys",
    description: "Permission to delete API keys",
  },
  // Webhook endpoints. Four flat entries with no `manage-*` umbrella, matching
  // api-keys: `update-webhooks` serves that role. Slugs must stay exactly
  // `${action}-${resource}` — a seed test asserts it for every entry.
  {
    name: "Update Webhooks",
    slug: "update-webhooks",
    action: "update",
    resource: "webhooks",
    description: "Permission to update webhook endpoints",
  },
  {
    name: "Create Webhooks",
    slug: "create-webhooks",
    action: "create",
    resource: "webhooks",
    description: "Permission to register webhook endpoints",
  },
  {
    name: "Read Webhooks",
    slug: "read-webhooks",
    action: "read",
    resource: "webhooks",
    description: "Permission to view webhook endpoints",
  },
  {
    name: "Delete Webhooks",
    slug: "delete-webhooks",
    action: "delete",
    resource: "webhooks",
    description: "Permission to delete webhook endpoints",
  },
  // Content releases. Three authorities, not a CRUD set: a release is
  // assembled and then COMMITTED, and those are different powers.
  //
  // The resource is `content-releases` rather than `releases` because
  // registering one RESERVES the name, and "press releases" is a collection
  // real sites already have.
  //
  // `publish-releases` is separate from `create-releases` on purpose. Creating
  // a release and choosing what goes in it changes nothing a reader can see;
  // scheduling it is the act that puts content live later, and it is the one
  // that needs holding back. That is the same split the content lifecycle
  // already makes, where `publish` and `unpublish` are distinct from `update`.
  //
  // `update` and `delete` are deliberately NOT seeded. A permission nothing
  // enforces teaches the admin a vocabulary the server ignores; they arrive
  // with the surfaces that check them.
  {
    name: "Read Releases",
    slug: "read-content-releases",
    action: "read",
    resource: "content-releases",
    description: "Permission to view content releases and their members",
  },
  {
    name: "Create Releases",
    slug: "create-content-releases",
    action: "create",
    resource: "content-releases",
    description:
      "Permission to create a content release and choose its members",
  },
  {
    name: "Publish Releases",
    slug: "publish-content-releases",
    action: "publish",
    resource: "content-releases",
    description:
      "Permission to schedule or cancel a content release, which is what makes its content go live",
  },
];

/**
 * PermissionSeedService auto-generates CRUD permissions for collections,
 * singles, and system resources.
 *
 * All operations are idempotent — permissions are checked for existence
 * before insertion. Newly created permissions are returned so they can
 * be assigned to the super_admin role.
 *
 * @example
 * ```typescript
 * const seedService = new PermissionSeedService(db, tables);
 * const result = await seedService.seedAllCollectionPermissions();
 * await seedService.assignNewPermissionsToSuperAdmin(result.newPermissionIds);
 * ```
 */
/**
 * The actions the built-in seeder creates for every collection and every single.
 *
 * Stated once because two things read them: the seeding loops below, and the check that decides
 * whether a plugin may claim a permission. A second copy is how the reservation drifted from what
 * is actually seeded in the first place.
 */
const COLLECTION_SEEDED_ACTIONS = [
  "create",
  "read",
  "update",
  "delete",
  "publish",
  "unpublish",
] as const;

const SINGLE_SEEDED_ACTIONS = [
  "read",
  "update",
  "publish",
  "unpublish",
] as const;

export class PermissionSeedService extends BaseService {
  private _permissionService?: PermissionService;
  private _rolePermissionService?: RolePermissionService;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);
  }

  private get permissionService(): PermissionService {
    if (!this._permissionService) {
      this._permissionService = new PermissionService(
        this.adapter,
        this.logger
      );
    }
    return this._permissionService;
  }

  private get rolePermissionService(): RolePermissionService {
    if (!this._rolePermissionService) {
      this._rolePermissionService = new RolePermissionService(
        this.adapter,
        this.logger
      );
    }
    return this._rolePermissionService;
  }

  /**
   * Seed all system resource permissions.
   *
   * Ensures all permissions from the SYSTEM_PERMISSIONS constant exist.
   * System permissions cover: users, roles, permissions, media, settings,
   * email-providers, email-templates.
   */
  async seedSystemPermissions(): Promise<SeedResult> {
    const result = this.emptySeedResult();

    // Before seeding, repair rows an older version wrote with the two halves
    // of the slug the wrong way round. Here because this is the one method
    // every boot path already calls — the CLI build, post-init and the auth
    // handler — so no call site has to remember it. Ensuring a permission
    // heals a DECLARED slug, but the rows this reaches were never declared:
    // they came from the REST grant path, so nothing else revisits them.
    await this.normalizeReversedSlugs();

    for (const perm of SYSTEM_PERMISSIONS) {
      result.total++;
      try {
        // PR 4 migration: ensurePermission now returns `{ id, created }`
        // and throws NextlyError on failure instead of the legacy
        // `{success, statusCode, data}` shape.
        const ensureResult = await this.permissionService.ensurePermission(
          perm.action,
          perm.resource,
          perm.name,
          perm.slug,
          perm.description
        );

        if (ensureResult.created) {
          result.created++;
          result.newPermissionIds.push(ensureResult.id);
        } else {
          result.skipped++;
        }
      } catch {
        result.errors++;
      }
    }

    return result;
  }

  /**
   * Seed CRUD permissions for a single collection.
   *
   * Creates 6 permissions: create, read, update, delete, publish, unpublish.
   *
   * Publishing is seeded for every collection, not only those with the
   * draft/published lifecycle enabled. A collection can gain `status: true`
   * later, and a permission that appears only once someone flips a flag is one
   * nobody has granted at the moment it starts being enforced.
   *
   * @param collectionSlug - The collection slug (e.g., "posts", "products")
   */
  async seedCollectionPermissions(collectionSlug: string): Promise<SeedResult> {
    const result = this.emptySeedResult();
    const label = this.slugToLabel(collectionSlug);
    const actions = COLLECTION_SEEDED_ACTIONS;

    for (const action of actions) {
      const actionLabel = action.charAt(0).toUpperCase() + action.slice(1);
      const name = `${actionLabel} ${label}`;
      const slug = permissionSlug(action, collectionSlug);
      const description = `Permission to ${action} ${label.toLowerCase()}`;

      result.total++;
      try {
        const ensureResult = await this.permissionService.ensurePermission(
          action,
          collectionSlug,
          name,
          slug,
          description
        );

        if (ensureResult.created) {
          result.created++;
          result.newPermissionIds.push(ensureResult.id);
        } else {
          result.skipped++;
        }
      } catch {
        result.errors++;
      }
    }

    return result;
  }

  /**
   * Seed read/update permissions for a single (global document).
   *
   * Singles have no create/delete lifecycle — they are auto-created on first
   * access and cannot be deleted. They DO have a publish lifecycle: a Single
   * carries the same `status` column and is published today by an ordinary
   * update, so it needs the same publish permissions a collection does.
   *
   * @param singleSlug - The single slug (e.g., "site-settings", "header")
   */
  async seedSinglePermissions(singleSlug: string): Promise<SeedResult> {
    const result = this.emptySeedResult();
    const label = this.slugToLabel(singleSlug);
    const actions = SINGLE_SEEDED_ACTIONS;

    for (const action of actions) {
      const actionLabel = action.charAt(0).toUpperCase() + action.slice(1);
      const name = `${actionLabel} ${label}`;
      const slug = permissionSlug(action, singleSlug);
      const description = `Permission to ${action} ${label.toLowerCase()}`;

      result.total++;
      try {
        const ensureResult = await this.permissionService.ensurePermission(
          action,
          singleSlug,
          name,
          slug,
          description
        );

        if (ensureResult.created) {
          result.created++;
          result.newPermissionIds.push(ensureResult.id);
        } else {
          result.skipped++;
        }
      } catch {
        result.errors++;
      }
    }

    return result;
  }

  /**
   * Seed permissions for ALL dynamic collections.
   *
   * Reads all collection slugs from the `dynamic_collections` table
   * (including plugin-registered collections) and seeds the six CRUD and
   * publish-lifecycle permissions for each.
   */
  async seedAllCollectionPermissions(): Promise<SeedResult> {
    const result = this.emptySeedResult();

    try {
      const slugs = await this.getAllCollectionSlugs();

      for (const slug of slugs) {
        // Skip system resources — they have their own permissions via seedSystemPermissions()
        if ((SYSTEM_RESOURCES as readonly string[]).includes(slug)) {
          continue;
        }

        const collectionResult = await this.seedCollectionPermissions(slug);
        this.mergeSeedResult(result, collectionResult);
      }
    } catch {
      // Table may not exist yet (fresh DB). Return empty result.
      this.logger.warn(
        "Could not read dynamic_collections table — skipping collection permission seeding."
      );
    }

    return result;
  }

  /**
   * Seed permissions for ALL registered singles.
   *
   * Reads all single slugs from the `dynamic_singles` table and seeds
   * read, update, publish and unpublish permissions for each.
   */
  async seedAllSinglePermissions(): Promise<SeedResult> {
    const result = this.emptySeedResult();

    try {
      const slugs = await this.getAllSingleSlugs();

      for (const slug of slugs) {
        const singleResult = await this.seedSinglePermissions(slug);
        this.mergeSeedResult(result, singleResult);
      }
    } catch {
      // Table may not exist yet (fresh DB). Return empty result.
      this.logger.warn(
        "Could not read dynamic_singles table — skipping single permission seeding."
      );
    }

    return result;
  }

  /**
   * Seed plugin-declared custom permissions (D36). Idempotent — the existing
   * `(action, resource)` unique index + `ensurePermission` make re-seeding a
   * no-op. New IDs are returned for super-admin assignment by the caller.
   */
  /**
   * Give a built-in permission back to the presets, on a database that already got it wrong.
   *
   * Ownership is what `role-presets.ts` reads to decide a permission is a plugin's, so a row left
   * attributed goes on being withheld from Editor however the declaration is treated now. Matched
   * case-insensitively, the way `ensurePermission` matches.
   *
   * `orphanedAt` is cleared with it, and has to be: the orphan sweep skips a row with no owner, so
   * a permission marked while it was misattributed — declared, then absent for one boot, then
   * declared again — would never be unmarked by anything, and `listPermissions` filters marked
   * rows out before the presets are seeded. The permission would exist, and its collection would
   * exist, and Editor would still not be granted it. This is the same reconciliation
   * `ensurePermission` performs for a row it writes; a row withheld from it needs it too.
   */
  private async returnPermissionToPresets(
    action: string,
    resource: string
  ): Promise<void> {
    const { permissions } = this.tables;
    try {
      await (this.db as RBACDatabaseInstance)
        .update(permissions)
        .set({ owner: null, orphanedAt: null })
        .where(
          and(
            sql`LOWER(${permissions.action}) = LOWER(${action})`,
            sql`LOWER(${permissions.resource}) = LOWER(${resource})`
          )
        );
    } catch {
      // The table may predate the column on a partially migrated database. Nothing is written and
      // the permission keeps whatever it had, which is the state this repair found it in.
    }
  }

  async seedCustomPermissions(
    perms: CollectedPermission[]
  ): Promise<SeedResult> {
    const result = this.emptySeedResult();
    const builtIn = await this.builtInOwnedPermissions();

    for (const perm of perms) {
      result.total++;
      // A permission the built-in seeder owns is not a plugin's to claim, however it was
      // declared. `collectCustomPermissions` refuses these from the CONFIG, but it decides what
      // an entity is from the config alone, so a Schema Builder collection — which exists only in
      // `dynamic_collections` — is invisible to it and its permissions were collected as custom.
      //
      // The consequence is not cosmetic. Attaching an owner makes the row look plugin-provided,
      // and the role presets grant Editor on `!isSystem && !isPlugin`, so a Builder collection's
      // publish permission silently stopped being granted — and became eligible for the orphan
      // sweep the day the plugin was removed.
      //
      // Decided here rather than at collection time because this is the layer that knows: the
      // list below is read from the database, which the pure collector deliberately cannot touch.
      // Compared in lower case, because `ensurePermission` matches an existing row with
      // `LOWER(action) = LOWER(action)`. An exact-match guard here is bypassed by a declaration
      // that differs only in case — `{ action: "Publish", resource: "Reports" }` walks straight
      // past it and then patches the seeded `publish/reports` row anyway.
      //
      // Only the ADOPTED LIFECYCLE actions are held back, which is the same line the collector
      // draws for entities it can see. Held back because ownership is what withholds the Editor
      // grant: the presets grant on `!isSystem && !isPlugin`, so a `publish` declaration landing
      // on a Builder collection's own row stops that collection being publishable by an editor.
      //
      // A CRUD collision is deliberately left owned by its declarer. Withholding ownership there
      // would leave the row unowned and therefore granted to Editor by the presets, reaching a
      // plugin route guarded by `delete-reports` that is protected today precisely because the
      // plugin owns it. Refusing such a declaration outright belongs at boot validation, before
      // anything is served, rather than here where the rows are being written.
      if (
        ADOPTED_LIFECYCLE_ACTIONS.has(perm.action.toLowerCase()) &&
        builtIn.has(
          `${perm.action.toLowerCase()}:${perm.resource.toLowerCase()}`
        )
      ) {
        // Repaired, not merely skipped. On a database seeded by the old behaviour the row already
        // carries `owner = <plugin>`, and nothing else revisits it: `markOrphanedPermissions`
        // leaves an attribution alone while the declaration is still there. Withholding ownership
        // from here on would fix new installs and leave every upgraded one exactly as broken —
        // the Editor grant still missing, for the same reason.
        await this.returnPermissionToPresets(perm.action, perm.resource);
        result.skipped++;
        continue;
      }
      try {
        const ensured = await this.permissionService.ensurePermission(
          perm.action,
          perm.resource,
          perm.name,
          perm.slug,
          perm.description,
          // Everything the declaration said about the permission that is not
          // its identity. Provenance was collected and thrown away, so a
          // plugin's permission arrived indistinguishable from a collection's
          // and the admin drew a content type that does not exist; `group` was
          // documented, set by the canonical example, and read by nothing.
          { owner: perm.owner, group: perm.group, danger: perm.danger }
        );
        if (ensured.created) {
          result.created++;
          result.newPermissionIds.push(ensured.id);
        } else {
          result.skipped++;
        }
      } catch {
        result.errors++;
      }
    }

    return result;
  }

  /**
   * Mark permissions whose declaring package has stopped declaring them, and
   * unmark any that are declared again.
   *
   * `ensurePermission` writes `owner` only for a permission that is declared,
   * so once a declaration goes the attribution freezes at whatever was last
   * true. That was cosmetic until presets began reading `owner` to decide
   * whether a permission is a plugin's; a stale attribution now silently
   * changes what a preset grants.
   *
   * Marked, not deleted, and grants are left alone. Absence from config is not
   * an uninstall: a plugin can be disabled and still declare its permissions,
   * a config can be edited by mistake, and there is no uninstall event to tell
   * the difference. Deleting on that evidence would revoke access as a side
   * effect of a config change. `cleanupOrphanedPermissions` retires them later,
   * on purpose.
   *
   * Only permissions with an `owner` are considered: a collection's CRUD seeds
   * have no declaring package, and their lifecycle follows the collection.
   *
   * @param declared - Every custom permission currently declared, from every
   *   plugin, including disabled ones.
   */
  async markOrphanedPermissions(
    declared: CollectedPermission[]
  ): Promise<SeedResult> {
    const result = this.emptySeedResult();
    const { permissions } = this.tables;

    const declaredKeys = new Set(
      declared.map(p => `${p.action.toLowerCase()}|${p.resource.toLowerCase()}`)
    );

    try {
      const rows = (await this.db
        .select({
          id: permissions.id,
          action: permissions.action,
          resource: permissions.resource,
          owner: permissions.owner,
          orphanedAt: permissions.orphanedAt,
        })
        .from(permissions)) as Array<{
        id: string;
        action: string;
        resource: string;
        owner: string | null;
        orphanedAt: Date | null;
      }>;

      for (const row of rows) {
        if (!row.owner) continue;

        const key = `${String(row.action).toLowerCase()}|${String(
          row.resource
        ).toLowerCase()}`;
        const isDeclared = declaredKeys.has(key);
        const isMarked = row.orphanedAt !== null;

        if (isDeclared === !isMarked) continue;

        result.total++;
        await this.db
          .update(permissions)
          .set({ orphanedAt: isDeclared ? null : new Date() })
          .where(eq(permissions.id, String(row.id)));
        result.created++;

        this.logger.info?.(
          isDeclared
            ? `Permission "${row.action}-${row.resource}" is declared again by ${row.owner}.`
            : `Permission "${row.action}-${row.resource}" is no longer declared by ${row.owner}; marked as orphaned. Grants are unchanged.`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to mark orphaned permissions: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      result.errors++;
    }

    return result;
  }

  /**
   * Assign newly created permissions to the super_admin role.
   *
   * Ensures the super_admin role retains full access when new permissions
   * are generated. Only assigns permissions that aren't already assigned.
   *
   * @param permissionIds - IDs of newly created permissions to assign
   */
  async assignNewPermissionsToSuperAdmin(
    permissionIds: string[]
  ): Promise<void> {
    if (permissionIds.length === 0) return;

    try {
      const { roles } = this.tables;

      const superAdminRole = await this.db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.slug, "super-admin"))
        .limit(1)
        .then(
          (rows: unknown[]) => (rows[0] as { id: unknown } | undefined) ?? null
        );

      if (!superAdminRole) {
        // On a fresh database the super-admin role is created during the
        // first-time onboarding flow (seedSuperAdmin), not during permission
        // sync. Log at debug level instead of warn so a clean dev boot
        // doesn't look like something broke.
        this.logger.debug(
          "super-admin role not found yet — permissions will be assigned during onboarding."
        );
        return;
      }

      const roleId = String(superAdminRole.id);

      for (const permissionId of permissionIds) {
        const existing = await (
          this.db as RBACDatabaseInstance
        ).query.rolePermissions.findFirst({
          // Required by Drizzle ORM: relational query `where` callback is not
          // narrowly typed without importing internal Drizzle helper types.

          where: { roleId, permissionId },
          columns: { id: true },
        });

        if (!existing) {
          // PR 4 migration: getPermissionById now returns the data directly
          // and throws NextlyError(NOT_FOUND) for missing/hidden permissions.
          // Wrap in try/catch so a missing permission silently skips the
          // assignment (preserves the legacy "no-op on miss" behavior).
          try {
            const perm =
              await this.permissionService.getPermissionById(permissionId);

            await this.rolePermissionService.addPermissionToRole(roleId, {
              action: perm.action,
              resource: perm.resource,
              name: perm.name,
              slug: perm.slug,
            });
          } catch {
            // Permission missing or hidden — skip without error, matching
            // the legacy `if (permResult.success && permResult.data)` guard.
          }
        }
      }

      this.logger.info?.(
        `Assigned ${permissionIds.length} new permission(s) to super-admin role.`
      );
    } catch (error) {
      this.logger.warn(
        `Failed to assign permissions to super-admin: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Delete all permissions for a specific collection or single.
   *
   * Removes all permissions where the resource matches the given slug.
   * First removes the permissions from all roles, then deletes the permissions.
   * This is typically called when a collection or single is deleted.
   *
   * @param resourceSlug - The collection or single slug (e.g., "posts", "site-settings")
   * @returns Result with count of deleted permissions
   */
  async deletePermissionsForResource(
    resourceSlug: string
  ): Promise<SeedResult> {
    const result = this.emptySeedResult();

    try {
      // PR 4 migration: listPermissions now returns `{data, meta}` directly
      // and throws on DB errors instead of wrapping in `{success, data}`.
      const allPerms = await this.permissionService.listPermissions({
        page: 1,
        limit: 10000,
      });

      const { rolePermissions, permissions } = this.tables;

      for (const perm of allPerms.data) {
        if (perm.resource === resourceSlug) {
          result.total++;

          try {
            await this.db
              .delete(rolePermissions)
              .where(eq(rolePermissions.permissionId, perm.id));

            // Delete the permission itself directly (bypass the role check)

            await this.db
              .delete(permissions)
              .where(eq(permissions.id, perm.id));

            result.created++;
            this.logger.info?.(
              `Deleted permission "${perm.slug}" for resource "${resourceSlug}"`
            );
          } catch (error) {
            result.skipped++;
            this.logger.warn?.(
              `Error deleting permission "${perm.slug}": ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }

      if (result.created > 0) {
        this.logger.info?.(
          `Deleted ${result.created} permission(s) for resource "${resourceSlug}"`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to delete permissions for resource "${resourceSlug}": ${error instanceof Error ? error.message : String(error)}`
      );
      result.errors++;
    }

    return result;
  }

  /**
   * Remove permissions for dynamic resources that no longer exist.
   *
   * This is NOT auto-run — it must be called explicitly to prevent
   * accidental permission loss. Removes permissions whose resource is not a
   * system resource, not found in dynamic_collections, dynamic_singles or
   * dynamic_components, **and** which no package declared.
   *
   * Plugin-declared permissions (`owner` set) are never removed here. Their
   * resource is a name the plugin chose and is not expected to appear in any
   * of those tables, so the resource check cannot judge them. Retiring one
   * whose plugin has genuinely gone needs a signal this does not have —
   * absence from config is not an uninstall, and disabled plugins still
   * declare their permissions.
   *
   * First removes permissions from all roles, then deletes the permissions.
   */
  /**
   * Rename permissions whose slug is exactly its own `resource-action`.
   *
   * A slug is what every authorization check resolves — the middleware, the
   * guards, `hasPermission`, and the scopes an API key is issued with — so a
   * row written the other way round is a permission nothing can find. It
   * denies rather than escalates, which is why it goes unnoticed: the grant is
   * listed as assigned and simply never applies.
   *
   * Renaming revokes nothing. Identity is `(action, resource)` and grants
   * reference the row by id, so this brings a label into line and leaves every
   * assignment intact.
   *
   * Only the exactly-reversed form. A slug that merely differs from the
   * convention was chosen by whoever declared it — `manage-api-keys` on action
   * `update` is in the seed set on purpose — and renaming those would break
   * the declarations that use them.
   *
   * A rename can still collide, because `slug` is unique and some other row
   * may already hold the canonical name. That is left in place rather than
   * resolved: guessing which of two permissions should own a name is not
   * something a boot-time repair should decide, and failing the boot over it
   * would be worse than the stale slug.
   */
  private async normalizeReversedSlugs(): Promise<number> {
    const { permissions } = this.tables;
    let repaired = 0;

    const rows = (await this.db
      .select({
        id: permissions.id,
        slug: permissions.slug,
        action: permissions.action,
        resource: permissions.resource,
      })
      .from(permissions)) as Array<{
      id: string;
      slug: string;
      action: string;
      resource: string;
    }>;

    for (const row of rows) {
      const canonical = permissionSlug(row.action, row.resource);
      const reversed = permissionSlug(row.resource, row.action);
      // A palindrome pair has nothing to repair, and comparing them keeps a
      // one-word action on a same-named resource from being "fixed" in place.
      if (canonical === reversed) continue;
      if (row.slug !== reversed) continue;

      try {
        await (this.db as RBACDatabaseInstance)
          .update(permissions)
          .set({ slug: canonical })
          .where(eq(permissions.id, row.id));
        repaired++;
      } catch {
        // Almost certainly the unique index: another row already answers to
        // the canonical name. Left as it is, for the reason above.
      }
    }

    return repaired;
  }

  async cleanupOrphanedPermissions(): Promise<SeedResult> {
    const result = this.emptySeedResult();

    try {
      const collectionSlugs = await this.getAllCollectionSlugs();
      const singleSlugs = await this.getAllSingleSlugs();
      const componentSlugs = await this.getAllComponentSlugs();
      const knownResources = new Set([
        ...(SYSTEM_RESOURCES as readonly string[]),
        ...collectionSlugs,
        ...singleSlugs,
        ...componentSlugs,
      ]);

      // PR 4 migration: listPermissions now returns `{data, meta}` directly
      // and throws on DB errors. Failures bubble up to the outer catch
      // below, matching the legacy "if (!allPerms.data) return result"
      // graceful-degradation behavior.
      const allPerms = await this.permissionService.listPermissions({
        page: 1,
        limit: 10000,
        // The whole point of this pass is to find what the rest of the app is
        // deliberately not shown.
        includeOrphaned: true,
      });

      const { rolePermissions, permissions } = this.tables;

      for (const perm of allPerms.data) {
        // Two ways to be rubbish, and they need different evidence.
        //
        // A permission with no owner belongs to a content type, so a resource
        // that is no longer a collection, single or component means the type
        // is gone and the permission with it.
        //
        // A permission with an owner belongs to a package, and its resource is
        // a name that package chose — it matches no collection and never did,
        // so the resource check says nothing about it. `orphanedAt` is its
        // evidence: it is set only once the package stops declaring it.
        const isVanishedContentType =
          !perm.owner && !knownResources.has(perm.resource);
        const isRetiredDeclaration = Boolean(perm.owner) && perm.orphaned;

        if (isVanishedContentType || isRetiredDeclaration) {
          result.total++;

          try {
            await this.db
              .delete(rolePermissions)
              .where(eq(rolePermissions.permissionId, perm.id));

            // Delete the permission itself directly (bypass the role check)

            await this.db
              .delete(permissions)
              .where(eq(permissions.id, perm.id));

            result.created++;
            this.logger.info?.(
              `Cleaned up orphaned permission "${perm.slug}" (resource: ${perm.resource})`
            );
          } catch (error) {
            result.skipped++;
            this.logger.warn?.(
              `Error cleaning up permission "${perm.slug}": ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }

      if (result.created > 0) {
        this.logger.info?.(
          `Cleaned up ${result.created} orphaned permission(s)`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to cleanup orphaned permissions: ${error instanceof Error ? error.message : String(error)}`
      );
      result.errors++;
    }

    return result;
  }

  /**
   * The `${action}:${resource}` pairs the built-in seeders own.
   *
   * Read from the same slug sources the seeding passes read — which include entities that exist
   * only in the database — and the same action lists they seed. Deriving it any other way is what
   * let the reservation and the seeder disagree about which entities exist.
   *
   * A database that cannot answer yields an empty set, leaving today's behaviour rather than
   * refusing every declared permission on a fresh or half-migrated install.
   */
  private async builtInOwnedPermissions(): Promise<Set<string>> {
    const owned = new Set<string>();
    try {
      // Keyed in lower case, matching how `ensurePermission` finds an existing row.
      for (const slug of await this.getAllCollectionSlugs()) {
        for (const action of COLLECTION_SEEDED_ACTIONS) {
          owned.add(`${action}:${slug.toLowerCase()}`);
        }
      }
      for (const slug of await this.getAllSingleSlugs()) {
        for (const action of SINGLE_SEEDED_ACTIONS) {
          owned.add(`${action}:${slug.toLowerCase()}`);
        }
      }
    } catch {
      this.logger.warn(
        "Could not read the entity tables — plugin permissions were not checked against built-in ones."
      );
    }
    return owned;
  }

  private async getAllCollectionSlugs(): Promise<string[]> {
    if (!this.tables?.dynamicCollections) return [];

    const rows = await this.db
      .select({ slug: this.tables.dynamicCollections.slug })
      .from(this.tables.dynamicCollections);

    return rows.map((row: { slug: string }) => String(row.slug));
  }

  private async getAllSingleSlugs(): Promise<string[]> {
    if (!this.tables?.dynamicSingles) return [];

    const rows = await this.db
      .select({ slug: this.tables.dynamicSingles.slug })
      .from(this.tables.dynamicSingles);

    return rows.map((row: { slug: string }) => String(row.slug));
  }

  /**
   * Every field-group slug the registry knows about.
   *
   * 🔴 Addressed by the resolved name rather than through
   * `getDialectTables().dynamicFieldGroups`, whose Drizzle object carries the
   * legacy table name. On a database whose storage migration has run, that
   * object names a table that is gone; the missing-table error is caught by
   * `cleanupOrphanedPermissions`, which then reports no removals while every
   * field-group permission is silently treated as orphaned.
   *
   * Issued as a statement rather than through the query builder for the same
   * reason the migration reads the registry that way: the builder resolves a
   * table through the schema registry, and the name to address here is the one
   * the catalog reports.
   */
  private async getAllComponentSlugs(): Promise<string[]> {
    if (!this.tables?.dynamicFieldGroups) return [];

    const registryTable = await resolveRegistryTableName(this.adapter);
    const rows = await this.adapter.queryStatement<{ slug: string }>(
      sql`SELECT ${sql.identifier("slug")} FROM ${sql.identifier(registryTable)}`
    );

    return rows.map(row => String(row.slug));
  }

  private slugToLabel(slug: string): string {
    return slug
      .split("-")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  private emptySeedResult(): SeedResult {
    return {
      created: 0,
      skipped: 0,
      errors: 0,
      total: 0,
      newPermissionIds: [],
    };
  }

  private mergeSeedResult(parent: SeedResult, child: SeedResult): void {
    parent.created += child.created;
    parent.skipped += child.skipped;
    parent.errors += child.errors;
    parent.total += child.total;
    parent.newPermissionIds.push(...child.newPermissionIds);
  }
}

export { SYSTEM_PERMISSIONS };
