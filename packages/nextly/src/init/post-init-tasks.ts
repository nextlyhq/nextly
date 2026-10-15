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
import { getService } from "../di/register";
import { warnAboutUnusableProviders } from "../domains/email/boot-check";
import { getEmailProviderRegistry } from "../domains/email/services/email-provider-registry";

/**
 * Run idempotent post-initialization tasks after services are registered.
 *
 * - Seeds built-in email templates (welcome, password-reset, email-verification, layout)
 * - Syncs code-defined user fields into `user_field_definitions` (when service exists)
 * - Loads merged fields (code + UI) into `UserExtSchemaService` for consumers
 *
 * Permission and role seeding is not here: the boot waits for it
 * (`seedPermissionsAndRolePresets`), because a role's permissions must not be
 * left half-written by an instance frozen after its first response.
 *
 * All operations are idempotent and safe to run on every startup.
 * Failures are caught and logged — they should never prevent Nextly from starting.
 */
export async function runPostInitTasks(): Promise<void> {
  // Reconcile email templates with their owners: core's built-ins, each
  // running plugin's contributions, and what the site's code sets. Owned
  // templates follow their owner until the site overrides them, and an edit
  // made before ownership existed is kept as an override. Idempotent.
  try {
    const emailTemplateService = getService("emailTemplateService");
    const config = getService("config");
    emailTemplateService.configureOwnership({
      plugins: (config.plugins ?? [])
        .filter(plugin => plugin.enabled !== false)
        .map(plugin => ({
          name: plugin.name,
          templates: plugin.contributes?.emailTemplates ?? [],
        })),
      codeTemplates: config.email?.templates,
    });
    await emailTemplateService.ensureBuiltInTemplates();
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

  // Say so when a stored provider needs a package this install does not have.
  // Runs LAST, after plugin contributions have registered, because whether a
  // type is usable is a question only the fully seeded registry can answer.
  try {
    const providerService = getService("emailProviderService");
    const logger = getService("logger");

    await warnAboutUnusableProviders({
      listProviderTypes: async () =>
        (await providerService.listProviders()).map(provider => provider.type),
      isAvailable: type => {
        const registry = getEmailProviderRegistry();
        // An unregistered type is unusable too, and `get` throws on one rather
        // than returning nothing -- a stored provider whose plugin was removed
        // reaches exactly that branch. Asked before getting, so the answer is
        // "no" instead of an exception that loses every other provider's.
        if (!registry.has(type)) return false;
        return (
          registry.get(type).checkAvailability?.().status !== "needs-dependency"
        );
      },
      warn: message => logger.warn(message),
    });
  } catch {
    // Silently skip — the email services may not be registered, or the
    // providers table may not exist yet. A diagnostic must never be the
    // reason a server fails to start.
  }
}
