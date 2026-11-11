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
import { getService } from "../di/service-access";
import { warnAboutUnusableProviders } from "../domains/email/boot-check";
import { warnAboutLateQueuedEmail } from "../domains/email/queued-email-warning";
import { getEmailProviderRegistry } from "../domains/email/services/email-provider-registry";
import { ownershipFromConfig } from "../domains/email/template-ownership";
import { provisionUserFieldStorage } from "../domains/users/services/provision-user-field-storage";

/**
 * Sync the code-defined user fields, merge them with the admin's, and make sure
 * user_ext has a column for each.
 *
 * Part of the start, not of the work it leaves running: until the merged
 * fields are loaded, the user services see the code's fields alone, so a
 * request served before then reads a person without the admin's fields and an
 * update to one is dropped while reporting success. `nextly migrate` runs the
 * same step (`provisionUserFieldStorage`); here it also keeps a development
 * database current as fields change. Never throws: nothing here may stop the
 * app starting.
 */
export async function provisionUserFieldsAtStart(): Promise<void> {
  try {
    await provisionUserFieldStorage({
      codeFields: getService("config").users?.fields ?? [],
      fieldDefService: getService("userFieldDefinitionService"),
      userExtSchemaService: getService("userExtSchemaService"),
      db: getService("adapter").getDrizzle(),
      // A sync that fails (its table not migrated yet) doesn't stop the table
      // being made for the fields already recorded, and nothing here may stop
      // the app starting.
      bestEffort: true,
    });
  } catch {
    // Silently skip — the user services may not be registered
  }
}

/**
 * Run idempotent post-initialization tasks after services are registered.
 *
 * - Seeds built-in email templates (welcome, password-reset, email-verification, layout)
 *
 * The user fields are not here: the start waits for them
 * (`provisionUserFieldsAtStart`), for the reason given there.
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
    emailTemplateService.configureOwnership(
      ownershipFromConfig(getService("config"))
    );
    await emailTemplateService.ensureBuiltInTemplates();
  } catch {
    // Silently skip — email services may not be registered,
    // or the email_templates table may not exist yet (migrations not run)
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

  // Name each configured translated unique field whose per-language index is not there yet. The
  // boot never creates it, so until a migration or `db:sync` does, the rule is not enforced.
  // Development starts only: it reads each such companion table's indexes, and a production
  // start compares nothing with the live schema; there `nextly migrate:create` writes the index.
  if (process.env.NODE_ENV === "development") {
    try {
      const { storedLocalizableEntities, warnAboutUnindexedTranslatedUnique } =
        await import("../domains/i18n/runtime/translated-unique-boot-check");
      const logger = getService("logger");
      await warnAboutUnindexedTranslatedUnique(
        getService("adapter"),
        getService("config"),
        message => logger.warn(message),
        // The Schema Builder's entities too, which no configuration names.
        await storedLocalizableEntities({
          collections: getService("collectionRegistryService"),
          singles: getService("singleRegistryService"),
          fieldGroups: getService("fieldGroupRegistryService"),
        })
      );
    } catch {
      // Silently skip — the adapter may not be registered, or the tables may not exist yet. A
      // diagnostic must never be the reason a server fails to start.
    }
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

  // Say so when queued email is more than 15 minutes past due: the jobs
  // trigger isn't running, and no retry will be made until it does. The check
  // itself never throws.
  try {
    await warnAboutLateQueuedEmail(getService("adapter"), getService("logger"));
  } catch {
    // The adapter or the logger is not registered; there is nothing to check.
  }
}
