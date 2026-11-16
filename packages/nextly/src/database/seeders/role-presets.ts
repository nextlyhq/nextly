/**
 * Applying the built-in role presets to a database.
 *
 * The presets THEMSELVES — what "Editor" means — are declared in
 * `auth/role-presets`, which takes no I/O and so can be read by callers that
 * only need to ask a predicate what it would grant. This module is the one use
 * of them that needs an adapter.
 *
 * They are re-exported here so every existing importer of this path keeps
 * working, and because a seeder is where most readers will look for them.
 *
 * @module database/seeders/role-presets
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  ROLE_PRESETS,
  resolvePreset,
  type PresetContext,
  type PresetPermission,
  type RolePreset,
} from "../../auth/role-presets";
import type { RolePermissionService } from "../../domains/auth/services/role-permission-service";
import type { RoleService } from "../../domains/auth/services/role-service";
import {
  presetGrantsRecording,
  presetGrantsStanding,
  readPresetGrantsRelease,
  recordPresetGrantsRelease,
  type PresetGrantsRecording,
} from "../../domains/meta/preset-grants-release";
import type { ServiceContainer } from "../../services/index";
import { serviceContainerFor } from "../../services/service-container-for";
import type { Logger } from "../../services/shared";

import { createSeededRole } from "./create-seeded-role";

export {
  ROLE_PRESETS,
  resolvePreset,
  type PresetContext,
  type PresetPermission,
  type RolePreset,
};

/**
 * Create the preset roles, and bring existing ones back in line with what
 * their predicate now resolves to.
 *
 * Re-synced on every boot, not created once. A preset that was right when it
 * was written goes stale the moment a collection is added: the role would
 * still exist, still be assigned, and quietly not cover the new content.
 * Super Admin already works this way — it re-ensures every permission on each
 * boot — and a preset is the same promise narrowed.
 *
 * The cost is that edits to a preset do not survive, which is why they are
 * system roles: they are the framework's, and an admin who wants a variant
 * builds a custom role on top of one rather than editing it underneath. That
 * keeps "Editor means Editor" true across every project, and leaves the
 * variant visible as its own role instead of hidden as a drifted copy.
 *
 * Presets are never assigned to anyone. Defining a role is not granting it.
 *
 * Inside a recording scope (`withPresetGrantsRecorded`, which `nextly
 * migrate` opens), every preset role's grants are set together with the
 * release record instead ({@link setPresetGrantsRecorded}).
 */
export async function seedRolePresets(
  adapter: DrizzleAdapter,
  logger: Logger
): Promise<void> {
  // Loaded when the presets are seeded, not by importing this module: the
  // container imports every core service.
  const container = await serviceContainerFor(adapter);
  const recording = presetGrantsRecording();
  if (recording !== undefined) {
    await setPresetGrantsRecorded(adapter, container, recording, logger);
    return;
  }
  const roleService = container.roles;
  const rolePermissionService = container.rolePermissions;

  for (const { preset, permissionIds } of await resolvePresetGrants(
    container
  )) {
    try {
      // Returns the row, not the id, despite the name.
      const existing = await roleService.findRoleIdBySlug(preset.slug);

      if (!existing) {
        await createSeededRole(
          roleService,
          {
            name: preset.name,
            slug: preset.slug,
            description: preset.description,
            level: preset.level,
            isSystem: true,
            permissionIds,
          },
          logger
        );
        continue;
      }

      // The presets resolve against the declared permissions only, so an
      // orphaned one is in no preset's set. Set by difference alone, that
      // took a preset's grant of it away at the start that orphaned it; an
      // orphan mark takes nothing away, so its grants are left as they are,
      // and are there as they were when it is declared again.
      await rolePermissionService.setRolePermissions(
        String(existing.id),
        permissionIds,
        { leaveOrphanedGrants: true }
      );
    } catch (error) {
      // One bad preset must not stop the rest, and must never stop boot.
      logger.warn?.(
        `Failed to seed role preset "${preset.slug}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

/**
 * The flows whose recorded preset seeding must set every preset role's grants
 * or fail ({@link withPresetGrantsRequired}).
 */
const presetGrantsRequired = new AsyncLocalStorage<true>();

/**
 * Runs `run` with a recorded preset seeding inside it ({@link
 * setPresetGrantsRecorded}) throwing when it could not set the grants, rather
 * than warning and going on: for a write whose own record must not commit
 * without them, as a plugin's install records the plugin installed, which is
 * what lets a production start serve it. The grants' transaction has rolled
 * back by then, so the caller's rolls back too and nothing is recorded.
 */
export function withPresetGrantsRequired<T>(run: () => Promise<T>): Promise<T> {
  return presetGrantsRequired.run(true, run);
}

/** A preset, and the ids of the stored permissions it resolves to. */
interface PresetGrants {
  preset: RolePreset;
  permissionIds: string[];
}

/**
 * Each preset with the permissions it resolves to over the stored ones: the
 * one resolution both ways of seeding set the roles from.
 */
async function resolvePresetGrants(
  container: ServiceContainer
): Promise<PresetGrants[]> {
  const all = await container.permissions.listPermissions({ limit: 100000 });
  const permissions = all.data.map(p => ({
    id: String(p.id),
    action: String(p.action),
    resource: String(p.resource),
    owner: p.owner ?? null,
    group: p.group ?? null,
  }));

  // The permissions workflows seed, which no preset grants: those the published workflows seed
  // (boot publishes them before it seeds the presets), and any row stored under the workflow
  // group, which a workflow seeded before it was detached or its action renamed.
  const [
    { registeredWorkflows },
    { isWorkflowSeededRow, workflowSeededPermissions },
  ] = await Promise.all([
    import("../../domains/workflows/registry"),
    import("../../domains/workflows/permissions"),
  ]);
  const attached = workflowSeededPermissions(registeredWorkflows());
  const isWorkflow = (p: (typeof permissions)[number]) =>
    attached(p) || isWorkflowSeededRow(p);

  return ROLE_PRESETS.map(preset => {
    const matched = resolvePreset(preset, permissions, isWorkflow);
    return {
      preset,
      permissionIds: permissions
        .filter(p => matched.includes(p))
        .map(p => p.id),
    };
  });
}

/**
 * Set every preset role's grants and record the running release with them,
 * in ONE transaction, or leave every grant as it is where a newer release is
 * recorded.
 *
 * The record names the release whose rules every preset role's grants
 * follow, so the roles are made where missing and their grants replaced on
 * the one transaction the record is written on: a failure anywhere, a role
 * that cannot be made included, rolls back every role's grants and the
 * record together, and is logged as a warning, as a preset the unrecorded
 * seeding cannot set is, so the rest of the run goes on. The record keeps
 * the newest release: it is written only where the running release is
 * newer, or none is recorded (`presetGrantsStanding`).
 *
 * Where a newer release is recorded, nothing is written and the scope is told
 * which release the grants were left to. The recorded release is read first
 * without a transaction, so a run from an older release, or one finding every
 * role and the record settled, opens none; it is read again, locked, inside
 * the transaction, which decides.
 */
async function setPresetGrantsRecorded(
  adapter: DrizzleAdapter,
  container: ServiceContainer,
  recording: PresetGrantsRecording,
  logger: Logger
): Promise<void> {
  // Loaded here, as the container is: a start that imports this module and
  // records nothing never loads them.
  const [
    { MetaService },
    { afterGrantsChanged, afterRoleGrantsChanged, changingRoleGrants },
  ] = await Promise.all([
    import("../../domains/meta/services/meta-service"),
    import("../../domains/auth/services/role-grants-changed"),
  ]);
  const meta = new MetaService(adapter, logger);
  const read = presetGrantsStanding(
    await readPresetGrantsRelease(meta),
    recording.release
  );
  if (read.kind === "leave") {
    recording.leftTo = read.recorded;
    return;
  }

  // Typed by their classes, which the container's getters return.
  const roleService: RoleService = container.roles;
  const rolePermissionService: RolePermissionService =
    container.rolePermissions;
  const resolved = await resolvePresetGrants(container);
  const settled = async (): Promise<boolean> => {
    for (const { preset, permissionIds } of resolved) {
      const existing = await roleService.findRoleIdBySlug(preset.slug);
      if (
        !existing ||
        !(await rolePermissionService.rolePermissionsSettled(
          String(existing.id),
          permissionIds,
          { leaveOrphanedGrants: true }
        ))
      ) {
        return false;
      }
    }
    return true;
  };
  if (read.record === undefined && (await settled())) return;

  // The content expiry this change owes is queued before it is written.
  await changingRoleGrants(async () => {
    let changed: string[] = [];
    let leftTo: string | undefined;
    try {
      await adapter.transaction(async tx => {
        // Started afresh by an attempt the adapter retries.
        changed = [];
        leftTo = undefined;
        const executor = tx.getDrizzle();
        const standing = presetGrantsStanding(
          await readPresetGrantsRelease(meta, executor, { lock: true }),
          recording.release
        );
        if (standing.kind === "leave") {
          leftTo = standing.recorded;
          return;
        }
        for (const { preset, permissionIds } of resolved) {
          const role = await roleService.ensureSystemRoleOn(tx, {
            name: preset.name,
            slug: preset.slug,
            description: preset.description,
            level: preset.level,
          });
          // Orphaned permissions' grants are left as they are, as the
          // unrecorded seeding leaves them.
          if (
            await rolePermissionService.replaceRolePermissionsOn(
              tx,
              role.id,
              permissionIds,
              { leaveOrphanedGrants: true }
            )
          ) {
            changed.push(role.id);
          }
        }
        if (standing.record !== undefined) {
          await recordPresetGrantsRelease(meta, executor, standing.record);
        }
      });
    } catch (error) {
      // Where the caller's own record needs the grants, it fails with them.
      if (presetGrantsRequired.getStore() === true) throw error;
      // As the unrecorded seeding treats a preset it cannot set, the run goes
      // on, said; set together, none of the preset roles' grants changed, and
      // the next run sets them all again.
      logger.warn?.(
        `The preset roles' grants were not set, so none of them changed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }
    recording.leftTo = leftTo;
    // Announced once the transaction has committed: each changed role's
    // cached answers retired, then the scheduled releases checked once.
    for (const roleId of changed) {
      await afterRoleGrantsChanged(roleId, { recheckReleases: false });
    }
    if (changed.length > 0) await afterGrantsChanged();
  });
}
