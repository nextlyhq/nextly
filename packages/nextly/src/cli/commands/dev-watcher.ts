/**
 * Watch Mode Debouncer
 *
 * File watching / re-sync orchestration. This module owns the debounced
 * sync pipeline used when `nextly db:sync --watch` is running and config
 * files change on disk.
 *
 * @module cli/commands/dev-watcher
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { withMigrationExcluded } from "../../domains/field-groups/migration/sync-guard";
import { runWithFieldTypes } from "../../domains/schema/field-types/field-type-scope";
import { describeError } from "../../errors/index";
import { assertPluginFieldDeclarations } from "../../shared/lib/assert-plugin-field-declarations";
import type { CommandContext } from "../program";
import type { CLIDatabaseAdapter } from "../utils/adapter";
import type { LoadConfigResult } from "../utils/config-loader";

import type { ResolvedDevOptions } from "./db-sync";
import {
  ensureLocalizedCompanions,
  performPermissionSeeding,
  syncCollections,
  syncComponents,
  syncSingles,
  syncUserFields,
} from "./dev-build";

/** Debounce delay in milliseconds */
const DEBOUNCE_DELAY_MS = 500;

/**
 * Create a debounced sync function for watch mode.
 *
 * This prevents multiple rapid syncs when files change quickly
 * (e.g., editor auto-save, multiple saves in quick succession).
 *
 * @param adapter - Database adapter
 * @param options - Resolved dev options
 * @param context - Command context
 * @returns Debounced sync function
 */
export function createDebouncedSync(
  adapter: CLIDatabaseAdapter,
  options: ResolvedDevOptions,
  context: CommandContext
): (configResult: LoadConfigResult) => void {
  const { logger } = context;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingConfigResult: LoadConfigResult | null = null;
  let isSyncing = false;

  const executeSync = async (): Promise<void> => {
    if (!pendingConfigResult) return;

    const configToSync = pendingConfigResult;
    pendingConfigResult = null;
    isSyncing = true;

    try {
      logger.newline();
      logger.header("Config Changed - Re-syncing");

      // Pinned to the field types this config registered. Saving again while
      // the work below is still running reloads the config, which clears and
      // rebuilds the live registry; the columns being materialized here belong
      // to the config that started this run, so they have to resolve against
      // its types and not the ones that replaced them.
      await runWithFieldTypes(configToSync.fieldTypes, async () => {
        // Every reload gets the same gate the first sync did. Editing a plugin
        // field's options after the watcher starts would otherwise serialize
        // the metadata and materialize the columns for a declaration its own
        // type rejects — the state this check exists to keep out of the
        // database.
        assertPluginFieldDeclarations(configToSync.config);

        // The same reasoning, for storage rather than declarations. A migration
        // can begin after the watcher starts, so checking only at boot leaves
        // every later save free to reconcile — and, with `--remove-orphaned`,
        // delete — tables that are halfway through being renamed.
        //
        // Held for the whole re-sync rather than read once at the top of it: a
        // migration beginning a moment later would rename tables underneath work
        // that has already decided what exists.
        await withMigrationExcluded(
          {
            adapter: adapter as unknown as DrizzleAdapter,
            logger,
            label: "db:sync watch",
            mayCreateLock: options.autoSync !== false,
            // Ctrl+C is the documented way to stop watch mode, and a sync is idempotent, so a
            // claim stuck behind a dead watcher would block every later sync for no gain.
            releaseOnInterrupt: true,
          },
          async () => {
            // Before the pushes, for the same reason the one-shot `db:sync` does it: a watched
            // edit that enables localization removes the translatable columns from the desired
            // schema, so the push wants to drop them. Copying first makes that drop a cleanup
            // rather than a loss.
            if (options.autoSync !== false) {
              await ensureLocalizedCompanions(
                configToSync.config,
                adapter,
                context,
                "beforeApply"
              );
            }

            // Unconditional, so the orphan scan still runs when the config declares none of a
            // type: deleting the last entry of a kind is precisely what orphans its table, making
            // a zero count the case where the scan matters most.
            await syncCollections(configToSync, adapter, options, context);
            await syncSingles(configToSync, adapter, options, context);
            await syncComponents(configToSync, adapter, options, context);

            // Turning on localization is a config edit, so it arrives through this
            // watcher as often as through `db:sync`. The companion table is not part of
            // the push pipeline, and creating it here rather than at the next boot is
            // what keeps a running server from advertising localization it cannot store.
            // Suppressed under `--no-auto-sync` for the same reason the rest of the
            // push is: it issues DDL and can copy rows.
            if (options.autoSync !== false) {
              await ensureLocalizedCompanions(
                configToSync.config,
                adapter,
                context
              );
            }

            // Sync user_ext table (always — handles both code and UI fields)
            await syncUserFields(configToSync, adapter, options, context);

            // Seed permissions for new/updated collections and singles
            await performPermissionSeeding(adapter, options, context);
          }
        );
      });
    } catch (error) {
      logger.error(`Re-sync failed: ${describeError(error)}`);
    } finally {
      isSyncing = false;

      // Check if another change came in while we were syncing
      if (pendingConfigResult) {
        logger.debug("Additional changes detected, scheduling re-sync...");
        scheduleSync();
      }
    }
  };

  const scheduleSync = (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!isSyncing) {
        void executeSync();
      }
    }, DEBOUNCE_DELAY_MS);
  };

  return (configResult: LoadConfigResult) => {
    pendingConfigResult = configResult;

    if (isSyncing) {
      // A sync is already in progress, it will pick up the new config when done
      logger.debug("Sync in progress, queuing changes...");
      return;
    }

    scheduleSync();
  };
}
