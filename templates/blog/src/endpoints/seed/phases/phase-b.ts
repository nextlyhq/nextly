/**
 * Phase B — Permission sync.
 *
 * Ensures permission rows exist for the collections and singles that
 * Phase A just registered. Code-first projects pass an empty list here
 * and Phase B becomes a no-op (their permissions were created at boot
 * by Nextly's PermissionSeedService).
 *
 * After permissions land, we wire them to the super-admin role so the
 * caller (the super-admin who clicked "Seed demo content") can
 * immediately use the new resources.
 *
 * Each permissionSeedService method is idempotent — re-running the
 * seed against an already-permissioned project is a cheap no-op.
 */

import { container, type Nextly } from "@revnixhq/nextly";

export interface PhaseBInput {
  collections: string[];
  singles: string[];
}

export interface PhaseBResult {
  permissionsSynced: number;
  warnings: string[];
}

interface SeedResultLike {
  created?: number;
  total?: number;
}

interface PermissionSeedServiceLike {
  seedCollectionPermissions(slug: string): Promise<SeedResultLike>;
  seedSinglePermissions(slug: string): Promise<SeedResultLike>;
  assignNewPermissionsToSuperAdmin?(): Promise<unknown>;
}

export async function runPhaseB(
  nextly: Nextly,
  input: PhaseBInput
): Promise<PhaseBResult> {
  const result: PhaseBResult = {
    permissionsSynced: 0,
    warnings: [],
  };

  if (input.collections.length === 0 && input.singles.length === 0) {
    return result;
  }

  // `container` is exported from `@revnixhq/nextly` for templates that
  // need to access internal services not on the public Nextly instance.
  // `nextly` is required as a parameter so callers prove they ran
  // getNextly({config}) first (services are populated by then).
  void nextly;
  const permSeeder = container.get<PermissionSeedServiceLike>(
    "permissionSeedService"
  );

  for (const slug of input.collections) {
    try {
      const r = await permSeeder.seedCollectionPermissions(slug);
      result.permissionsSynced += r.created ?? 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.warnings.push(`permissions for collection "${slug}": ${msg}`);
    }
  }

  for (const slug of input.singles) {
    try {
      const r = await permSeeder.seedSinglePermissions(slug);
      result.permissionsSynced += r.created ?? 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.warnings.push(`permissions for single "${slug}": ${msg}`);
    }
  }

  if (permSeeder.assignNewPermissionsToSuperAdmin) {
    try {
      await permSeeder.assignNewPermissionsToSuperAdmin();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.warnings.push(`assign super-admin permissions: ${msg}`);
    }
  }

  return result;
}
