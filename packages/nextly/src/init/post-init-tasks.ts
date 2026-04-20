/**
 * Nextly Initialization — Post-Init Tasks
 *
 * Idempotent background tasks executed after the DI container has been
 * registered. Extracted from `init.ts` so the initialization orchestrator
 * can stay focused on lifecycle/cache concerns.
 *
 * @module init/post-init-tasks
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { getService, type NextlyServiceConfig } from "../di/register";

/**
 * Run idempotent post-initialization tasks after services are registered.
 *
 * - Seeds built-in email templates (welcome, password-reset, email-verification, layout)
 * - Syncs code-defined user fields into `user_field_definitions` (when service exists)
 * - Loads merged fields (code + UI) into `UserExtSchemaService` for consumers
 * - Seeds system, collection, and single permissions
 *
 * All operations are idempotent and safe to run on every startup.
 * Failures are caught and logged — they should never prevent Nextly from starting.
 */
export async function runPostInitTasks(): Promise<void> {
  // Seed built-in email templates
  try {
    const emailTemplateService = getService("emailTemplateService");
    await emailTemplateService.ensureBuiltInTemplates();
  } catch {
    // Silently skip — email services may not be registered,
    // or the email_templates table may not exist yet (migrations not run)
  }

  // Sync code-defined user fields from defineConfig() into user_field_definitions table,
  // then load merged fields (code + UI) into UserExtSchemaService for schema generation
  try {
    const fieldDefService = getService("userFieldDefinitionService");
    const config = getService("config") as NextlyServiceConfig;
    const codeFields = config.users?.fields || [];
    await fieldDefService.syncCodeFields(
      codeFields as unknown as { name: string; [key: string]: unknown }[]
    );
  } catch {
    // Silently skip — service may not be registered,
    // or the user_field_definitions table may not exist yet (migrations not run)
  }

  // Load merged fields and ensure user_ext table exists (separate try/catch
  // so table creation runs even if code-field sync above fails)
  try {
    const userExtSchemaService = getService("userExtSchemaService");
    await userExtSchemaService.loadMergedFields();

    // Ensure the user_ext table exists and has columns for all merged fields.
    // This creates the table if missing and adds columns for new UI-defined fields.
    if (userExtSchemaService.hasMergedFields()) {
      const adapter = getService("adapter");
      const drizzleDb = (adapter as unknown as DrizzleAdapter).getDrizzle();
      await userExtSchemaService.ensureUserExtSchema(drizzleDb);
    }
  } catch {
    // Silently skip — userExtSchemaService may not be registered
  }

  // Seed system + collection + single permissions (idempotent).
  // Ensures CRUD permissions exist for every collection (4 each) and single (2 each),
  // plus all system resource permissions. New permissions are auto-assigned to super_admin.
  try {
    const permissionSeedService = getService("permissionSeedService");
    const systemResult = await permissionSeedService.seedSystemPermissions();
    const collectionResult =
      await permissionSeedService.seedAllCollectionPermissions();
    const singleResult = await permissionSeedService.seedAllSinglePermissions();

    const allNewIds = [
      ...systemResult.newPermissionIds,
      ...collectionResult.newPermissionIds,
      ...singleResult.newPermissionIds,
    ];

    if (allNewIds.length > 0) {
      await permissionSeedService.assignNewPermissionsToSuperAdmin(allNewIds);
    }
  } catch {
    // Silently skip — permissions table may not exist yet (migrations not run),
    // or permissionSeedService may not be registered
  }
}
