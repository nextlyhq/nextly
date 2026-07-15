/**
 * Nextly Initialization — Post-Init Tasks
 *
 * Idempotent background tasks executed after the DI container has been
 * registered. Extracted from `init.ts` so the initialization orchestrator
 * can stay focused on lifecycle/cache concerns.
 *
 * @module init/post-init-tasks
 */

import {
  repairSqliteTimestamps,
  TIMESTAMP_REPAIR_META_KEY,
} from "../database/repair-sqlite-timestamps";
import { seedRolePresets } from "../database/seeders/role-presets";
import { getService } from "../di/register";
import { collectCustomPermissions } from "../plugins/permissions/collect-permissions";
import { collectRoles } from "../plugins/roles/collect-roles";
import { seedPluginRoles } from "../plugins/roles/seed-roles";

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
  // Seed built-in + plugin-contributed email templates (C2/D65). Idempotent by
  // slug; plugin templates never clobber a built-in or an admin's edits.
  try {
    const emailTemplateService = getService("emailTemplateService");
    await emailTemplateService.ensureBuiltInTemplates();

    const config = getService("config");
    for (const plugin of config.plugins ?? []) {
      if (plugin.enabled === false) continue;
      const templates = plugin.contributes?.emailTemplates;
      if (templates && templates.length > 0) {
        await emailTemplateService.ensurePluginTemplates(templates);
      }
    }
  } catch {
    // Silently skip — email services may not be registered,
    // or the email_templates table may not exist yet (migrations not run)
  }

  // Sync code-defined user fields from defineConfig() into user_field_definitions table,
  // then load merged fields (code + UI) into UserExtSchemaService for schema generation
  try {
    const fieldDefService = getService("userFieldDefinitionService");
    const config = getService("config");
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
      const drizzleDb = adapter.getDrizzle();
      await userExtSchemaService.ensureUserExtSchema(drizzleDb);
    }
  } catch {
    // Silently skip — userExtSchemaService may not be registered
  }

  // Seed system + collection + single + plugin custom permissions (idempotent).
  // Ensures CRUD permissions exist for every collection (4 each) and single (2 each),
  // plus all system resource permissions and plugin-declared custom permissions
  // (D36). New permissions are auto-assigned to super_admin.
  try {
    const permissionSeedService = getService("permissionSeedService");
    const systemResult = await permissionSeedService.seedSystemPermissions();
    const collectionResult =
      await permissionSeedService.seedAllCollectionPermissions();
    const singleResult = await permissionSeedService.seedAllSinglePermissions();

    const config = getService("config");
    const declared = collectCustomPermissions(config, config.plugins ?? []);
    const customResult =
      await permissionSeedService.seedCustomPermissions(declared);

    // Seeding only ever adds. A permission whose package has stopped declaring
    // it keeps the attribution it had, which is read to decide whether it is a
    // plugin's — so a declaration that goes away quietly changes what the
    // presets grant. Marked here, against the same list that was just seeded;
    // grants are untouched and nothing is deleted.
    await permissionSeedService.markOrphanedPermissions(declared);

    const allNewIds = [
      ...systemResult.newPermissionIds,
      ...collectionResult.newPermissionIds,
      ...singleResult.newPermissionIds,
      ...customResult.newPermissionIds,
    ];

    if (allNewIds.length > 0) {
      await permissionSeedService.assignNewPermissionsToSuperAdmin(allNewIds);
    }
  } catch {
    // Silently skip — permissions table may not exist yet (migrations not run),
    // or permissionSeedService may not be registered
  }

  // Bring the preset roles in line with the permissions that now exist. Runs
  // every boot rather than once: each preset is a predicate, so a collection
  // added since last boot is covered without anyone editing a role. Presets
  // are never assigned to anyone — defining a role is not granting it.
  try {
    const adapter = getService("adapter");
    const logger = getService("logger");
    await seedRolePresets(adapter, logger);
  } catch {
    // Silently skip — roles/permissions tables may not exist yet.
  }

  // Seed plugin/app-declared role bundles (D67) AFTER permissions exist, so each
  // role's permission slugs resolve to ids. Idempotent by slug; roles are
  // never auto-assigned to users (define, don't grant — D36). Collision
  // validation already ran at boot (registerServices).
  try {
    const config = getService("config");
    const adapter = getService("adapter");
    const logger = getService("logger");
    await seedPluginRoles(
      adapter,
      collectRoles(config, config.plugins ?? []),
      logger
    );
  } catch {
    // Silently skip — roles/permissions tables may not exist yet.
  }

  // Rewrite timestamps an older SQLite writer stored as text. Runs once and
  // records that it has; the guard matters because it scans every table, and
  // leaving both encodings in one column is worse than either alone — SQLite
  // orders integers before text whatever the values say, so a half-repaired
  // database sorts wrongly while looking fine.
  try {
    const adapter = getService("adapter");
    if (adapter.dialect === "sqlite") {
      const meta = getService("metaService");
      const done = await meta.get<string>(TIMESTAMP_REPAIR_META_KEY);
      if (!done) {
        const logger = getService("logger");
        const { repaired, columns } = await repairSqliteTimestamps(adapter);
        if (repaired > 0) {
          logger.info(
            `Repaired ${repaired} timestamp(s) stored as text in ${columns.length} column(s)`,
            { columns }
          );
        }
        await meta.set(TIMESTAMP_REPAIR_META_KEY, new Date().toISOString());
      }
    }
  } catch {
    // Silently skip — meta or the adapter may not be registered, or the tables
    // may not exist yet. A failed repair must never stop the app booting; the
    // marker stays unset, so the next boot tries again.
  }
}
