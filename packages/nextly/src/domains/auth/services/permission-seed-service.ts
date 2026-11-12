import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql, eq, and } from "drizzle-orm";

import type {
  PermissionInsertData,
  RBACDatabaseInstance,
  RolePermissionInsertData,
} from "@nextly/types/rbac-operations";

import { NEW_ENTITY_PERMISSION_ROLE } from "../../../auth/new-entity-access-policy";
import type { CollectedPermission } from "../../../plugins/permissions/collect-permissions";
import { ADOPTED_LIFECYCLE_ACTIONS } from "../../../plugins/permissions/collect-permissions";
import { SYSTEM_RESOURCES, permissionSlug } from "../../../schemas/_zod/rbac";
import { BaseService } from "../../../services/base-service";
import {
  inPermissionSweep,
  writingPermissions,
} from "../../../services/lib/permissions";
import type { Logger } from "../../../services/shared";
import { isUniqueViolation } from "../../../shared/lib/unique-violation";
import { isMissingTable } from "../../field-groups/migration/session";
import { resolveRegistryTableName } from "../../field-groups/storage/resolve-storage-names";

import {
  builtInEntityPermissions,
  COLLECTION_SEEDED_ACTIONS,
  SINGLE_SEEDED_ACTIONS,
  workflowEntityPermissions,
} from "./entity-permission-spelling";
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
 * The owners a declaration of permissions speaks for, for
 * `markOrphanedPermissions`: by name (`app` for the app's own, a plugin by its
 * name), and each owner of a permission whose slug `heldSlugs` names.
 */
export interface OrphanMarkScope {
  owners: ReadonlySet<string>;
  heldSlugs?: ReadonlySet<string>;
  /**
   * Permissions another owner declares, whose rows the pass leaves as they are,
   * neither marked nor cleared, whatever owner key they are stored under. The
   * app's own are stored under `app`, which a plugin may also be named, so an
   * owner key alone cannot tell the plugin's rows from the app's.
   */
  kept?: readonly { action: string; resource: string }[];
}

/** A permission row as the orphan pass reads it, and as a rollback's undo of its marks is judged. */
export interface OrphanPassRow {
  id: string;
  slug: string;
  action: string;
  resource: string;
  owner: string | null;
  orphanedAt: Date | null;
}

/** A permission's identity as the orphan pass compares it: action and resource, in any case. */
function orphanPassKey(p: { action: string; resource: string }): string {
  return `${String(p.action).toLowerCase()}|${String(p.resource).toLowerCase()}`;
}

/**
 * The owners a pass speaks for: those `scope` names, and each owner of a
 * permission the point before held, read from the same rows the pass walks.
 */
function ownersSpokenFor(
  rows: readonly OrphanPassRow[],
  scope: OrphanMarkScope
): Set<string> {
  const spokenFor = new Set(scope.owners);
  for (const row of rows) {
    if (row.owner && scope.heldSlugs?.has(String(row.slug))) {
      spokenFor.add(row.owner);
    }
  }
  return spokenFor;
}

/**
 * The orphan mark the pass gives `row`: true to mark it, false to clear it, or
 * undefined to leave it as it is. A row with no owner is core's or an
 * entity's, and one another owner declares (`kept`) is not the pass's. A mark
 * is set only for an owner the declaration speaks for; one it does not speak
 * for may have added the permission outside it. A permission it declares is
 * live whoever is recorded as its owner, so its mark is cleared.
 */
function orphanMarkFor(
  row: OrphanPassRow,
  judged: {
    declared: ReadonlySet<string>;
    kept: ReadonlySet<string>;
    spokenFor: ReadonlySet<string>;
  }
): boolean | undefined {
  if (!row.owner) return undefined;
  const key = orphanPassKey(row);
  if (judged.kept.has(key)) return undefined;
  const isDeclared = judged.declared.has(key);
  if (isDeclared === (row.orphanedAt === null)) return undefined;
  if (!isDeclared && !judged.spokenFor.has(row.owner)) return undefined;
  return !isDeclared;
}

/**
 * What the seed does inside its own transaction: an insert, and a select of
 * the rows it reads back. `withTransaction` hands the transaction over as
 * `unknown`, since its concrete type differs per dialect, and every dialect's
 * Drizzle transaction has these two.
 */
interface SeedTransaction {
  insert(table: unknown): { values(row: unknown): Promise<unknown> };
  select<T extends Record<string, unknown>>(
    fields: T
  ): {
    from(table: unknown): {
      where(condition: unknown): Promise<Array<Record<keyof T, unknown>>>;
    };
  };
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
  /**
   * When THIS boot creates the permission, also grant it to every role that
   * then holds the named one.
   *
   * For a permission that splits a power an existing permission used to carry,
   * so an installation that upgrades keeps every ability it had: the roles that
   * could do the thing before can still do it after. Applied once, on
   * creation, and never again. A later boot finds the permission already there
   * and grants nothing, so a role an administrator has since taken it from
   * keeps the choice they made. Super-admin receives every new permission
   * anyway (`assignNewPermissionsToSuperAdmin`); this is for everyone else.
   *
   * The permission and these grants are written in one transaction, so a
   * boot that fails part-way leaves neither: the failure is counted as a
   * seeding error, which the boot logs, and the next boot finds the
   * permission missing and creates and grants it whole.
   */
  grantOnCreationToHoldersOf?: { action: string; resource: string };
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
  // No `manage-` permission is seeded on media, settings, email providers or
  // email templates: each is retired in favour of the plain read, create,
  // update and delete below. An install that seeded one keeps its row, so
  // `nextly upgrade` can still find the roles holding it and convert them.
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
    name: "Read Settings",
    slug: "read-settings",
    action: "read",
    resource: "settings",
    description: "Permission to read system settings",
  },
  {
    name: "Create Settings",
    slug: "create-settings",
    action: "create",
    resource: "settings",
    // Named by the settings a person adds and removes one by one.
    description:
      "Permission to add settings such as user fields and field groups",
  },
  {
    name: "Update Settings",
    slug: "update-settings",
    action: "update",
    resource: "settings",
    description: "Permission to change system settings",
  },
  {
    name: "Delete Settings",
    slug: "delete-settings",
    action: "delete",
    resource: "settings",
    // Named by the settings a person adds and removes one by one.
    description:
      "Permission to remove settings such as user fields and field groups",
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
    name: "Update Email Providers",
    slug: "update-email-providers",
    action: "update",
    resource: "email-providers",
    description: "Permission to change email providers",
  },
  {
    name: "Delete Email Providers",
    slug: "delete-email-providers",
    action: "delete",
    resource: "email-providers",
    description: "Permission to delete email providers",
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
    name: "Update Email Templates",
    slug: "update-email-templates",
    action: "update",
    resource: "email-templates",
    description: "Permission to change email templates",
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
  // `update` (rename, description) and `delete` (a draft or cancelled release)
  // follow, each granted on creation to the roles that already held the power
  // it splits off, so an upgrade neither gives nor takes away anything.
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
  // After `create` and `publish` in this list, so on a fresh install the
  // permission each is granted alongside already exists when it is created:
  // there it has no holders yet, and the role presets decide the grants.
  {
    name: "Update Releases",
    slug: "update-content-releases",
    action: "update",
    resource: "content-releases",
    description:
      "Permission to rename a content release and change its description",
    // Renaming was part of assembling a release before this permission
    // existed, so whoever could assemble one keeps the power to rename it.
    grantOnCreationToHoldersOf: {
      action: "create",
      resource: "content-releases",
    },
  },
  {
    name: "Delete Releases",
    slug: "delete-content-releases",
    action: "delete",
    resource: "content-releases",
    description:
      "Permission to delete a draft or cancelled content release; one that is scheduled, stopped or published stays",
    // Before this permission existed, a release nobody wanted was abandoned
    // by cancelling it, which `publish` grants; deleting the draft is the
    // same decision carried further.
    grantOnCreationToHoldersOf: {
      action: "publish",
      resource: "content-releases",
    },
  },
  // Background jobs. ONE permission, not a CRUD set: the only surface that
  // checks anything today is the trigger that runs a drain pass by hand, and a
  // permission nothing enforces teaches the admin a vocabulary the server
  // ignores. `read-background-jobs` arrives with the queue view that reads it.
  //
  // Pulling the trigger confers no authority over the work itself. Every job
  // runs as the identity it was queued with, reconstructed at execution, so a
  // holder of this permission makes already-queued, already-authorized work
  // happen NOW — they do not gain the power to perform it.
  {
    name: "Manage Background Jobs",
    slug: "manage-background-jobs",
    action: "manage",
    resource: "background-jobs",
    description:
      "Permission to run the background job queue by hand, outside its schedule",
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
 * Does this permission still answer for anything?
 *
 * Two ways to be rubbish, and they need different evidence.
 *
 * A permission with no owner belongs to a content type, so a resource that is
 * no longer a collection, single or component means the type is gone and the
 * permission with it.
 *
 * A permission with an owner belongs to a package, and its resource is a name
 * that package chose — it matches no collection and never did, so the resource
 * check says nothing about it. `orphanedAt` is its evidence: it is set only
 * once the package stops declaring it.
 */
function isRubbish(
  perm: { owner: string | null; resource: string; orphaned: boolean },
  knownResources: ReadonlySet<string>
): boolean {
  if (!perm.owner) return !knownResources.has(perm.resource);
  return perm.orphaned;
}

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
    return inPermissionSweep(() => this.seedSystemPermissionsRows());
  }

  private async seedSystemPermissionsRows(): Promise<SeedResult> {
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
        const ensureResult = perm.grantOnCreationToHoldersOf
          ? await this.ensureWithCreationGrants(
              perm,
              perm.grantOnCreationToHoldersOf
            )
          : await this.permissionService.ensurePermission(
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
   * Ensure a permission that is granted on creation, creating it and its
   * grants in ONE transaction.
   *
   * See {@link SystemPermissionDef.grantOnCreationToHoldersOf}. One
   * transaction, so a boot that fails part-way leaves neither the permission
   * nor any of its grants, and the next boot finds it missing and does both
   * again. Were the two written separately, a failure between them would
   * leave a permission every later boot takes as already handled.
   *
   * A permission that already exists goes through `ensurePermission`, which
   * brings its slug and provenance in line and grants nothing. The insert is
   * a plain one, so a concurrent boot that created the row first makes this
   * one fail and roll back rather than grant a permission id that was never
   * stored. That boot made the grants too, so this one then takes the
   * permission as existing.
   */
  private async ensureWithCreationGrants(
    perm: SystemPermissionDef,
    source: { action: string; resource: string }
  ): Promise<{ id: string; created: boolean }> {
    const existing = await (
      this.db as RBACDatabaseInstance
    ).query.permissions.findFirst({
      where: { action: perm.action, resource: perm.resource },
      columns: { id: true },
    });
    if (existing) {
      return this.permissionService.ensurePermission(
        perm.action,
        perm.resource,
        perm.name,
        perm.slug,
        perm.description
      );
    }

    const id = randomUUID();
    try {
      await this.createWithGrants(id, perm, source);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.permissionService.ensurePermission(
        perm.action,
        perm.resource,
        perm.name,
        perm.slug,
        perm.description
      );
    }
    return { id, created: true };
  }

  /** Insert the permission and its creation grants in one transaction. */
  private async createWithGrants(
    id: string,
    perm: SystemPermissionDef,
    source: { action: string; resource: string }
  ): Promise<void> {
    const { rolePermissions } = this.tables;
    // The gate retires the permission caches once the transaction has
    // finished, committed or not, as every permission write does.
    await writingPermissions(this.tables.permissions, permissions =>
      this.withTransaction(async txRaw => {
        const tx = txRaw as SeedTransaction;
        const row: PermissionInsertData = {
          id,
          name: perm.name,
          slug: perm.slug,
          action: perm.action,
          resource: perm.resource,
          description: perm.description,
          owner: null,
          permissionGroup: null,
          danger: false,
        };
        await tx.insert(permissions).values(row);
        const held = await tx
          .select({ id: permissions.id })
          .from(permissions)
          .where(
            and(
              eq(permissions.action, source.action),
              eq(permissions.resource, source.resource)
            )
          );
        if (held.length === 0) return;
        const holders = await tx
          .select({ roleId: rolePermissions.roleId })
          .from(rolePermissions)
          .where(eq(rolePermissions.permissionId, String(held[0].id)));
        for (const { roleId } of holders) {
          await this.writeGrant(tx, String(roleId), id);
        }
      })
    );
  }

  /** Write one grant inside the creating transaction. */
  private async writeGrant(
    tx: SeedTransaction,
    roleId: string,
    permissionId: string
  ): Promise<void> {
    const row: RolePermissionInsertData = {
      id: randomUUID(),
      roleId,
      permissionId,
    };
    await tx.insert(this.tables.rolePermissions).values(row);
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
    return inPermissionSweep(() =>
      this.seedCollectionPermissionsRows(collectionSlug)
    );
  }

  private async seedCollectionPermissionsRows(
    collectionSlug: string
  ): Promise<SeedResult> {
    const result = this.emptySeedResult();

    // The permissions every collection gets, as a migration snapshot records them, each spelled by
    // the one function a rename also spells them with.
    for (const { action, name, slug, description } of builtInEntityPermissions(
      "collection",
      collectionSlug
    )) {
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

    await this.seedWorkflowPermissions("collection", collectionSlug, result);
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
    return inPermissionSweep(() => this.seedSinglePermissionsRows(singleSlug));
  }

  private async seedSinglePermissionsRows(
    singleSlug: string
  ): Promise<SeedResult> {
    const result = this.emptySeedResult();

    // The permissions every Single gets, as a migration snapshot records them, each spelled by the
    // one function a rename also spells them with.
    for (const { action, name, slug, description } of builtInEntityPermissions(
      "single",
      singleSlug
    )) {
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

    await this.seedWorkflowPermissions("single", singleSlug, result);
    return result;
  }

  /**
   * Into `result`, the permissions the workflow attached to `entitySlug` adds
   * (`workflowPermissionActions`): each of its steps' own actions, and `publish-without-review`.
   * Seeded with the entity's built-in ones, so every path that seeds those, boot and the per-entity
   * syncs alike, seeds these, idempotently. Nothing is attached until the workflows are published,
   * so a pass before that seeds none and the next one does.
   *
   * One an app or a plugin already declared stays theirs: identity is the action and the resource,
   * so a step asks for that permission either way, and taking it over would flip its owner on
   * every boot.
   */
  private async seedWorkflowPermissions(
    kind: "collection" | "single",
    entitySlug: string,
    result: SeedResult
  ): Promise<void> {
    // Loaded on demand: the registry reaches the versions domain, which the auth seeder need not
    // load to seed an entity with no workflow.
    const { workflowAttachedTo } = await import("../../workflows/registry");
    const attached = workflowAttachedTo(kind, entitySlug);
    if (!attached) return;
    // Held as the class itself, so the call below is read as the service's own member.
    const permissions: PermissionService = this.permissionService;
    // The workflow's permissions as a migration snapshot records them (`workflowEntityPermissions`).
    for (const {
      action,
      name,
      slug,
      description,
      group,
    } of workflowEntityPermissions(entitySlug, attached.workflow)) {
      result.total++;
      try {
        // A row already there keeps its owner and group: an app's, a plugin's, or an admin's own
        // ownerless permission the step happens to name is not made the workflow's. Only a row
        // the seeder creates is stored under the workflow group.
        const owner = await permissions.ownerOf(action, entitySlug);
        if (owner !== undefined) {
          result.skipped++;
          continue;
        }
        // Stored under the workflow group, which is how the presets tell it is a workflow's.
        const ensured = await permissions.ensurePermission(
          action,
          entitySlug,
          name,
          slug,
          description,
          { group: group ?? undefined }
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
  }

  /**
   * Seed permissions for ALL dynamic collections.
   *
   * Reads all collection slugs from the `dynamic_collections` table
   * (including plugin-registered collections) and seeds the six CRUD and
   * publish-lifecycle permissions for each.
   */
  async seedAllCollectionPermissions(): Promise<SeedResult> {
    return inPermissionSweep(() => this.seedAllCollectionPermissionsRows());
  }

  private async seedAllCollectionPermissionsRows(): Promise<SeedResult> {
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
    } catch (error) {
      // A registry table a migration has not created yet holds no slugs. Any
      // other failure to read it left permissions unwritten, and is counted so
      // a caller does not take the seeding for complete.
      if (!isMissingTable(error, this.dialect)) result.errors++;
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
    return inPermissionSweep(() => this.seedAllSinglePermissionsRows());
  }

  private async seedAllSinglePermissionsRows(): Promise<SeedResult> {
    const result = this.emptySeedResult();

    try {
      const slugs = await this.getAllSingleSlugs();

      for (const slug of slugs) {
        const singleResult = await this.seedSinglePermissions(slug);
        this.mergeSeedResult(result, singleResult);
      }
    } catch (error) {
      // As for collections: only a table not created yet is no failure.
      if (!isMissingTable(error, this.dialect)) result.errors++;
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
      // Clearing `orphaned_at` returns the row to the catalogue, which is what
      // a super-admin's key copies. This method only runs when it has a row to
      // repair, so the gate covers a write that either happened or threw into
      // the branch below.
      await writingPermissions(permissions, table =>
        (this.db as RBACDatabaseInstance)
          .update(table)
          .set({ owner: null, orphanedAt: null })
          .where(
            and(
              sql`LOWER(${table.action}) = LOWER(${action})`,
              sql`LOWER(${table.resource}) = LOWER(${resource})`
            )
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
    return inPermissionSweep(() => this.seedCustomPermissionsRows(perms));
  }

  private async seedCustomPermissionsRows(
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
   * Retire the caches, when a pass actually wrote something.
   *
   * Four passes here end with the same question, and asking it four times is
   * four copies of one rule: a pass that changed nothing must not pay for an
   * unfiltered rewrite of the cache table, and a pass that did must not skip
   * it. Answered once.
   */
  /**
   * Retire one permission row: its grants first, then the row itself.
   *
   * Both retiring passes do exactly this and differ only in what they log, so
   * the order lives in one place. It matters: the grants reference the row, so
   * removing the row first is a foreign-key failure on any dialect enforcing
   * one, and leaving the grants behind is a reference to a row that is gone.
   *
   * Answers whether it retired anything rather than throwing, because a single
   * row that cannot be removed is not a reason to abandon the rest of a pass.
   */
  private async retirePermissionRow(permissionId: string): Promise<boolean> {
    const { rolePermissions, permissions } = this.tables;
    try {
      await this.db
        .delete(rolePermissions)
        .where(eq(rolePermissions.permissionId, permissionId));

      await writingPermissions(permissions, table =>
        this.db.delete(table).where(eq(table.id, permissionId))
      );
      return true;
    } catch (error) {
      this.logger.warn?.(
        `Error deleting permission "${permissionId}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }

  /**
   * Mark orphaned each live permission an owner `scope` speaks for no longer
   * declares, and clear the mark of each marked one `declared` names again.
   *
   * `nextly migrate` calls this as each recorded migration applies, with the
   * permissions its snapshot declares and the owners it speaks for
   * (`domains/schema/migrate/permission-orphans.ts`). No start calls it: a
   * permission leaves through a recorded change, never through the
   * configuration a build happens to start with.
   *
   * Marked, not deleted, and grants are left alone (`logOrphanMarkChange`
   * says so, naming them). `cleanupOrphanedPermissions` retires a marked
   * permission later, on purpose.
   *
   * Only permissions with an `owner` are considered: core's own and an
   * entity's built-in ones have none, and their lifecycle follows the release
   * and the entity. A permission whose owner `scope` does not speak for keeps
   * its state, as one a plugin's install added that no snapshot has recorded
   * yet does.
   *
   * @param declared - Every permission the declaration names, whoever owns it.
   * @param scope - The owners it speaks for: by name, and each owner of a
   *   permission whose slug `heldSlugs` names (the point before it, where that
   *   is a list of live permissions rather than a declaration by owner).
   */
  async markOrphanedPermissions(
    declared: readonly { action: string; resource: string }[],
    scope: OrphanMarkScope
  ): Promise<SeedResult> {
    return inPermissionSweep(() =>
      this.markOrphanedPermissionsRows(declared, scope)
    );
  }

  private async markOrphanedPermissionsRows(
    declared: readonly { action: string; resource: string }[],
    scope: OrphanMarkScope
  ): Promise<SeedResult> {
    const result = this.emptySeedResult();

    const declaredKeys = new Set(declared.map(orphanPassKey));
    // Another owner's declarations: their rows are not this pass's to change.
    const keptKeys = new Set((scope.kept ?? []).map(orphanPassKey));

    try {
      const rows = await this.orphanPassRows();

      const judged = {
        declared: declaredKeys,
        kept: keptKeys,
        spokenFor: ownersSpokenFor(rows, scope),
      };
      for (const row of rows) {
        const orphaned = orphanMarkFor(row, judged);
        if (orphaned === undefined || row.owner === null) continue;

        result.total++;
        await this.writeOrphanMark(row, orphaned);
        result.created++;
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
   * Set or clear the orphan marks `decide` names, by permission id, and leave
   * every other permission as it is: what a rollback to the registry record's
   * point does with the marks the rolled-back migrations set or made needed.
   * `decide` is handed every permission as the orphan pass reads it, so the
   * judgement is made on the rows the writes then change. A mark already as
   * decided is not written again.
   *
   * Unlike the orphan pass, a permission with no owner (an entity's built-in
   * one) can be marked here: the rollback that removes an entity's registry
   * row orphans its permissions with it. Every grant is kept, and each mark
   * set or cleared is logged with the grants the permission keeps
   * (`logOrphanMarkChange`). A write that fails throws, so the caller's
   * transaction does not commit with some marks written and others not.
   *
   * @returns How many marks were set or cleared.
   */
  async rewriteOrphanMarks(
    decide: (rows: readonly OrphanPassRow[]) => ReadonlyMap<string, boolean>
  ): Promise<number> {
    return inPermissionSweep(async () => {
      const rows = await this.orphanPassRows();
      const marks = decide(rows);
      let written = 0;
      for (const row of rows) {
        const orphaned = marks.get(String(row.id));
        if (orphaned === undefined || orphaned === (row.orphanedAt !== null)) {
          continue;
        }
        await this.writeOrphanMark(row, orphaned);
        written += 1;
      }
      return written;
    });
  }

  /** Every permission, as the orphan pass and a rollback's undo of its marks read it. */
  private async orphanPassRows(): Promise<OrphanPassRow[]> {
    const { permissions } = this.tables;
    return (await this.db
      .select({
        id: permissions.id,
        slug: permissions.slug,
        action: permissions.action,
        resource: permissions.resource,
        owner: permissions.owner,
        orphanedAt: permissions.orphanedAt,
      })
      .from(permissions)) as OrphanPassRow[];
  }

  /**
   * Write one permission's orphan mark, set or cleared, and log it with the
   * grants the permission has once the mark is written, which a mark leaves
   * as they were.
   */
  private async writeOrphanMark(
    row: OrphanPassRow,
    orphaned: boolean
  ): Promise<void> {
    await writingPermissions(this.tables.permissions, table =>
      this.db
        .update(table)
        .set({ orphanedAt: orphaned ? new Date() : null })
        .where(eq(table.id, String(row.id)))
    );
    await this.permissionService.logOrphanMarkChange({
      id: String(row.id),
      action: row.action,
      resource: row.resource,
      owner: row.owner,
      orphaned,
    });
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
        .where(eq(roles.slug, NEW_ENTITY_PERMISSION_ROLE))
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
    return inPermissionSweep(() =>
      this.deletePermissionsForResourceRows(resourceSlug)
    );
  }

  private async deletePermissionsForResourceRows(
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

      for (const perm of allPerms.data) {
        if (perm.resource === resourceSlug) {
          result.total++;

          if (await this.retirePermissionRow(perm.id)) {
            result.created++;
            this.logger.info?.(
              `Deleted permission "${perm.slug}" for resource "${resourceSlug}"`
            );
          } else {
            result.skipped++;
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
        // The stored slug is what a coarse grant check and a key's copied
        // grants compare against, so a repaired one makes every copy of the
        // old spelling wrong.
        await writingPermissions(permissions, table =>
          (this.db as RBACDatabaseInstance)
            .update(table)
            .set({ slug: canonical })
            .where(eq(table.id, row.id))
        );
        repaired++;
      } catch {
        // Almost certainly the unique index: another row already answers to
        // the canonical name. Left as it is, for the reason above.
      }
    }

    return repaired;
  }

  async cleanupOrphanedPermissions(): Promise<SeedResult> {
    return inPermissionSweep(() => this.cleanupOrphanedPermissionsRows());
  }

  /**
   * The permissions `cleanupOrphanedPermissions` would retire, read without
   * retiring any. `removing` names entities about to be deleted, by kind:
   * their permissions are counted as orphaned too, since the cleanup that
   * follows their deletion retires them. Lets a command list what a cleanup
   * deletes and take consent for it before the first deletion. Throws when
   * the registries or the permissions cannot be read.
   */
  async findOrphanedPermissions(
    removing: {
      collections?: readonly string[];
      singles?: readonly string[];
      fieldGroups?: readonly string[];
    } = {}
  ): Promise<Array<{ id: string; slug: string; resource: string }>> {
    const orphaned = await this.orphanedPermissionRows(removing);
    return orphaned.map(({ id, slug, resource }) => ({ id, slug, resource }));
  }

  /**
   * Every permission no known resource or declaring package accounts for:
   * the one answer both the cleanup and `findOrphanedPermissions` read.
   */
  private async orphanedPermissionRows(
    removing: {
      collections?: readonly string[];
      singles?: readonly string[];
      fieldGroups?: readonly string[];
    } = {}
  ) {
    // Each kind's slugs less those about to go: a slug a removed entity
    // shares with a kept one of another kind stays known through the kept one.
    const remaining = (
      slugs: readonly string[],
      going: readonly string[] = []
    ) => slugs.filter(slug => !going.includes(slug));
    const knownResources = new Set([
      ...(SYSTEM_RESOURCES as readonly string[]),
      ...remaining(await this.getAllCollectionSlugs(), removing.collections),
      ...remaining(await this.getAllSingleSlugs(), removing.singles),
      ...remaining(await this.getAllComponentSlugs(), removing.fieldGroups),
    ]);

    // listPermissions returns `{data, meta}` directly and throws on DB
    // errors; the caller decides what a failure means.
    const allPerms = await this.permissionService.listPermissions({
      page: 1,
      limit: 10000,
      // The whole point of this pass is to find what the rest of the app is
      // deliberately not shown.
      includeOrphaned: true,
    });

    return allPerms.data.filter(perm => isRubbish(perm, knownResources));
  }

  private async cleanupOrphanedPermissionsRows(): Promise<SeedResult> {
    const result = this.emptySeedResult();

    try {
      for (const perm of await this.orphanedPermissionRows()) {
        result.total++;

        if (await this.retirePermissionRow(perm.id)) {
          result.created++;
          this.logger.info?.(
            `Cleaned up orphaned permission "${perm.slug}" (resource: ${perm.resource})`
          );
        } else {
          result.skipped++;
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
