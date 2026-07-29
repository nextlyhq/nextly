/**
 * Watch Mode Debouncer
 *
 * File watching / re-sync orchestration. This module owns the debounced
 * sync pipeline used when `nextly db:sync --watch` is running and config
 * files change on disk.
 *
 * @module cli/commands/dev-watcher
 */

import { runWithFieldTypes } from "../../domains/schema/field-types/field-type-registry";
import { describeError } from "../../errors/index";
import { assertPluginFieldDeclarations } from "../../shared/lib/assert-plugin-field-declarations";
import type { CommandContext } from "../program";
import type { CLIDatabaseAdapter } from "../utils/adapter";
import type { LoadConfigResult } from "../utils/config-loader";

import type { ResolvedDevOptions } from "./db-sync";
import {
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

        // Unconditional, so the orphan scan still runs when the config declares none of a
        // type: deleting the last entry of a kind is precisely what orphans its table, making
        // a zero count the case where the scan matters most.
        await syncCollections(configToSync, adapter, options, context);
        await syncSingles(configToSync, adapter, options, context);
        await syncComponents(configToSync, adapter, options, context);

        // Sync user_ext table (always — handles both code and UI fields)
        await syncUserFields(configToSync, adapter, options, context);

        // Seed permissions for new/updated collections and singles
        await performPermissionSeeding(adapter, options, context);
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
