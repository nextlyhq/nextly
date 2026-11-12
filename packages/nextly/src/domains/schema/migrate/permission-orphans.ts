/**
 * Which permissions an applied app migration leaves orphaned: what its
 * snapshot declares, and the owners it speaks for.
 *
 * A snapshot that carries the registry metadata records every permission the
 * app and each collection, Single and plugin declare at that point
 * (`declared-permissions.ts`). As `nextly migrate` applies such a migration,
 * each live permission whose owner the snapshot speaks for, and which it does
 * not declare, is marked orphaned, whichever writer added it: an earlier
 * migration, the registry baseline, a plugin's install or a development
 * start. A marked permission it declares again has its mark cleared. Every
 * grant is kept (`PermissionSeedService.markOrphanedPermissions`).
 *
 * The snapshot speaks for the app always, and for each plugin it records or
 * whose permissions the point before it held: the snapshot before it, or the
 * registry baseline where the point before it is the registry record's and
 * has no snapshot of its own to say. A plugin neither knows of (a migration
 * written before the plugin joined the build) keeps its permissions. Core's
 * own permissions are in no snapshot and have no owner, so no migration
 * orphans one. A snapshot without the registry metadata, or written before
 * permissions were recorded, says nothing about permissions and orphans
 * nothing.
 *
 * @module domains/schema/migrate/permission-orphans
 */
import {
  collectCustomPermissions,
  type PermissionConfigSource,
} from "../../../plugins/permissions/collect-permissions";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import type { OrphanMarkScope } from "../../auth/services/permission-seed-service";
import type { PermissionRecord } from "../migrate-create/declared-permissions";
import {
  carriesRegistryMetadata,
  type SnapshotFile,
} from "../migrate-create/snapshot-io";

import type { RegistryRecord } from "./registry-record";

/** The owner key the app's own permissions are stored under. */
const APP_OWNER = "app";

/** What one applied migration orphans and clears, for `markOrphanedPermissions`. */
export interface MigrationOrphanScope extends OrphanMarkScope {
  /** Every permission the migration's snapshot declares, whoever owns it. */
  declared: { action: string; resource: string }[];
  /** The plugins the snapshot, or the one before it, records. */
  plugins: ReadonlySet<string>;
  /** What the snapshot declares for each plugin it records, by plugin name. */
  declaredByPlugin: ReadonlyMap<string, { action: string; resource: string }[]>;
}

/** A snapshot as this module reads it. */
type SnapshotPart = Pick<SnapshotFile, "entities" | "permissions">;

/** The permission record a snapshot declares from, or undefined where it says nothing. */
function declaredBy(
  snapshot: SnapshotPart | null
): PermissionRecord | undefined {
  if (snapshot === null || !carriesRegistryMetadata(snapshot)) return undefined;
  return snapshot.permissions;
}

/** Every permission a record declares, by action and resource. */
function everyPermission(
  record: PermissionRecord
): { action: string; resource: string }[] {
  const owners = [
    record.app,
    ...Object.values(record.plugins),
    ...Object.values(record.collections),
    ...Object.values(record.singles),
  ];
  return owners.flatMap(owned =>
    Object.values(owned).map(({ action, resource }) => ({ action, resource }))
  );
}

/**
 * Every permission `snapshot` declares, by action and resource, or undefined
 * where it says nothing about permissions: what a migration made live as it
 * applied, which a rollback to the registry record's point withdraws.
 */
export function permissionsDeclaredBy(
  snapshot: SnapshotPart | null
): { action: string; resource: string }[] | undefined {
  const record = declaredBy(snapshot);
  return record === undefined ? undefined : everyPermission(record);
}

/** What a record declares for each plugin it records. */
function eachPluginsPermissions(
  record: PermissionRecord
): Map<string, { action: string; resource: string }[]> {
  return new Map(
    Object.entries(record.plugins).map(([plugin, owned]) => [
      plugin,
      Object.values(owned).map(({ action, resource }) => ({
        action,
        resource,
      })),
    ])
  );
}

/**
 * The scope of `migration`, just applied, or undefined where its snapshot
 * declares no permissions.
 *
 * - `snapshot`: the migration's own snapshot.
 * - `before`: the newest snapshot of a migration ordered before it, or null
 *   where none has one.
 * - `previous`: the base name of the app migration ordered just before it, or
 *   null where it is the first: the point before it.
 * - `record`: the registry record, where one is stored. Its baseline stands
 *   for the point before only where that point is the record's and `before`
 *   declares nothing.
 */
export function orphanScopeOf(args: {
  snapshot: SnapshotPart;
  before: SnapshotPart | null;
  previous: string | null;
  record: RegistryRecord | undefined;
}): MigrationOrphanScope | undefined {
  const now = declaredBy(args.snapshot);
  if (now === undefined) return undefined;
  const plugins = new Set(Object.keys(now.plugins));
  const then = declaredBy(args.before);
  for (const plugin of Object.keys(then?.plugins ?? {})) plugins.add(plugin);
  const owners = new Set([APP_OWNER, ...plugins]);
  if (then !== undefined) {
    return {
      declared: everyPermission(now),
      declaredByPlugin: eachPluginsPermissions(now),
      owners,
      plugins,
    };
  }
  const baseline =
    args.record !== undefined && args.record.point === args.previous
      ? args.record.baseline
      : undefined;
  return {
    declared: everyPermission(now),
    declaredByPlugin: eachPluginsPermissions(now),
    owners,
    plugins,
    ...(baseline === undefined
      ? {}
      : { heldSlugs: new Set(baseline.permissions) }),
  };
}

/**
 * `scope` with the permissions of each configured plugin it does not record
 * kept as they are (`OrphanMarkScope.kept`). Such a plugin joined after the
 * migration was written, so the migration does not speak for it and its
 * permissions stay. Its owner key alone cannot always say so: the app's own
 * permissions are stored under `app`, which the migration always speaks for,
 * and a plugin may be named `app` too. Who declares what is read from the
 * configuration's one collection of declarations (`collectCustomPermissions`),
 * which keeps the app's apart by their source. Only keeps: it marks nothing,
 * and a plugin the migration records is judged by its snapshot alone.
 */
export function keepingUnrecordedPlugins(
  scope: MigrationOrphanScope,
  config: PermissionConfigSource & { plugins?: PluginDefinition[] }
): MigrationOrphanScope {
  const kept = collectCustomPermissions(config, config.plugins ?? []).filter(
    p => p.source === "plugin" && !scope.plugins.has(p.owner)
  );
  return { ...scope, kept };
}

/**
 * `scope` without what its snapshot declares for each plugin in
 * `notInstalled`, the plugins recorded as anything but installed
 * (`pluginsRecordedNotInstalled`). A migration written before such a plugin's
 * uninstall still declares its permissions, and a declared permission has its
 * mark cleared, which would undo the uninstall without a reinstall. Left out,
 * a permission the uninstall marked stays marked, and one not yet marked is
 * marked where the migration speaks for the plugin, as its uninstall marks it.
 */
export function leavingPluginsNotInstalled(
  scope: MigrationOrphanScope,
  notInstalled: ReadonlySet<string>
): MigrationOrphanScope {
  const keyOf = (p: { action: string; resource: string }) =>
    `${p.action.toLowerCase()}|${p.resource.toLowerCase()}`;
  const left = new Set(
    [...scope.declaredByPlugin]
      .filter(([plugin]) => notInstalled.has(plugin))
      .flatMap(([, owned]) => owned.map(keyOf))
  );
  if (left.size === 0) return scope;
  return {
    ...scope,
    declared: scope.declared.filter(p => !left.has(keyOf(p))),
  };
}
