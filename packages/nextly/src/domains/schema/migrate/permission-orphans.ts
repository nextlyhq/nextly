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
  const owners = new Set([APP_OWNER, ...Object.keys(now.plugins)]);
  const then = declaredBy(args.before);
  if (then !== undefined) {
    for (const plugin of Object.keys(then.plugins)) owners.add(plugin);
    return { declared: everyPermission(now), owners };
  }
  const baseline =
    args.record !== undefined && args.record.point === args.previous
      ? args.record.baseline
      : undefined;
  return {
    declared: everyPermission(now),
    owners,
    ...(baseline === undefined
      ? {}
      : { heldSlugs: new Set(baseline.permissions) }),
  };
}
