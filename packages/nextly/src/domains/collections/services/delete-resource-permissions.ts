/**
 * Remove the permissions a deleted collection or Single was guarded by.
 *
 * Best effort, and never a reason to fail the delete: the entity is gone
 * either way, and a permission still assigned to a role is kept and named in
 * the log so it can be removed by hand. One helper for both kinds of entity,
 * so they report it alike.
 *
 * @module domains/collections/services/delete-resource-permissions
 */
import type { PermissionSeedService } from "../../auth/services/permission-seed-service";

/** The logger methods this reports through. */
interface PermissionCleanupLogger {
  info(message: string): void;
  warn(message: string): void;
}

export async function deleteResourcePermissions(input: {
  service: PermissionSeedService | undefined;
  slug: string;
  kind: "collection" | "single";
  logger: PermissionCleanupLogger;
}): Promise<void> {
  const { service, slug, kind, logger } = input;
  if (!service) return;
  try {
    const result = await service.deletePermissionsForResource(slug);
    if (result.created > 0) {
      logger.info(
        `Deleted ${result.created} permission(s) for ${kind} "${slug}"`
      );
    }
    if (result.skipped > 0) {
      logger.warn(
        `${result.skipped} permission(s) for "${slug}" could not be deleted (may be assigned to roles)`
      );
    }
  } catch (error) {
    logger.warn(
      `Failed to cleanup permissions for ${kind} "${slug}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
