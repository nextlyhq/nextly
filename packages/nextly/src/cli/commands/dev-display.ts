/**
 * Dev Command — Display Helpers
 *
 * Output formatting helpers extracted from `dev.ts` to keep
 * sync/build/server modules focused on their core logic.
 *
 * @module cli/commands/dev-display
 */

import type { SeederResult } from "../../database/seeders/index.js";
import type { CollectionSyncResultWithValidation } from "../../services/collections/collection-sync-service.js";
import type { SyncComponentResult } from "../../services/components/component-registry-service.js";
import type { SyncSingleResult } from "../../services/singles/single-registry-service.js";
import type { CommandContext } from "../program.js";
import { formatCount, formatDuration } from "../utils/logger.js";

import type { ResolvedDevOptions } from "./db-sync.js";

/**
 * Display singles sync results to the user
 */
export function displaySinglesSyncResults(
  result: SyncSingleResult,
  options: ResolvedDevOptions,
  context: CommandContext
): void {
  const { logger } = context;

  // Summary line
  const total =
    result.created.length + result.updated.length + result.unchanged.length;
  const parts: string[] = [];

  if (result.created.length > 0) {
    parts.push(`${result.created.length} created`);
  }
  if (result.updated.length > 0) {
    parts.push(`${result.updated.length} updated`);
  }
  if (result.unchanged.length > 0) {
    parts.push(`${result.unchanged.length} unchanged`);
  }

  const summary = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  logger.success(`Synced ${formatCount(total, "single")}${summary}`);

  // Show details in verbose mode
  if (options.verbose) {
    if (result.created.length > 0) {
      logger.debug("Created singles:");
      for (const slug of result.created) {
        logger.item(slug, 1);
      }
    }
    if (result.updated.length > 0) {
      logger.debug("Updated singles:");
      for (const slug of result.updated) {
        logger.item(slug, 1);
      }
    }
  }

  // Show errors if any
  if (result.errors.length > 0) {
    logger.newline();
    logger.warn(`${result.errors.length} single sync error(s):`);
    for (const err of result.errors) {
      logger.item(`${err.slug}: ${err.error}`, 1);
    }
  }
}

/**
 * Display components sync results to the user
 */
export function displayComponentsSyncResults(
  result: SyncComponentResult,
  options: ResolvedDevOptions,
  context: CommandContext
): void {
  const { logger } = context;

  // Summary line
  const total =
    result.created.length + result.updated.length + result.unchanged.length;
  const parts: string[] = [];

  if (result.created.length > 0) {
    parts.push(`${result.created.length} created`);
  }
  if (result.updated.length > 0) {
    parts.push(`${result.updated.length} updated`);
  }
  if (result.unchanged.length > 0) {
    parts.push(`${result.unchanged.length} unchanged`);
  }

  const summary = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  logger.success(`Synced ${formatCount(total, "component")}${summary}`);

  // Show details in verbose mode
  if (options.verbose) {
    if (result.created.length > 0) {
      logger.debug("Created components:");
      for (const slug of result.created) {
        logger.item(slug, 1);
      }
    }
    if (result.updated.length > 0) {
      logger.debug("Updated components:");
      for (const slug of result.updated) {
        logger.item(slug, 1);
      }
    }
  }

  // Show errors if any
  if (result.errors.length > 0) {
    logger.newline();
    logger.warn(`${result.errors.length} component sync error(s):`);
    for (const err of result.errors) {
      logger.item(`${err.slug}: ${err.error}`, 1);
    }
  }
}

/**
 * Display seeding results
 */
export function displaySeedingResults(
  result: SeederResult,
  options: ResolvedDevOptions,
  context: CommandContext
): void {
  const { logger } = context;

  if (result.success) {
    // Check if this was a fresh seed or everything was already seeded
    const isAlreadySeeded = result.created === 0 && result.skipped > 0;

    if (isAlreadySeeded) {
      // Database was already seeded - just show a brief message
      logger.success("Database already seeded (skipped)");
      if (options.verbose) {
        logger.debug(`${result.skipped} seed entries already exist`);
      }
    } else if (result.created > 0) {
      // Fresh seed - show full details
      const parts: string[] = [];
      parts.push(`${result.created} created`);
      if (result.skipped > 0) {
        parts.push(`${result.skipped} skipped`);
      }

      const summary = ` (${parts.join(", ")})`;
      logger.success(`Seeding completed${summary}`);

      logger.newline();
    } else {
      // Nothing to seed
      logger.success("Seeding completed (nothing to seed)");
    }
  } else {
    logger.error(`Seeding failed with ${result.errors} error(s)`);
    if (result.errorMessages && options.verbose) {
      for (const msg of result.errorMessages) {
        logger.item(msg, 1);
      }
    }
  }
}

/**
 * Display sync results to the user
 */
export function displaySyncResults(
  result: CollectionSyncResultWithValidation,
  options: ResolvedDevOptions,
  context: CommandContext
): void {
  const { logger } = context;
  const { sync, relationshipValidation } = result;

  // Summary line
  const total =
    sync.created.length + sync.updated.length + sync.unchanged.length;
  const parts: string[] = [];

  if (sync.created.length > 0) {
    parts.push(`${sync.created.length} created`);
  }
  if (sync.updated.length > 0) {
    parts.push(`${sync.updated.length} updated`);
  }
  if (sync.unchanged.length > 0) {
    parts.push(`${sync.unchanged.length} unchanged`);
  }

  const summary = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  logger.success(`Synced ${formatCount(total, "collection")}${summary}`);

  // Show errors if any
  if (sync.errors.length > 0) {
    logger.newline();
    logger.warn(`${sync.errors.length} sync error(s):`);
    for (const err of sync.errors) {
      logger.item(`${err.slug}: ${err.error}`, 1);
    }
  }

  // Show relationship validation issues
  if (!relationshipValidation.valid) {
    logger.newline();
    logger.warn(
      `${relationshipValidation.errors.length} relationship error(s):`
    );
    for (const error of relationshipValidation.errors) {
      logger.item(
        `${error.collection}.${error.field} → ${error.targetCollection}: ${error.reason}`,
        1
      );
    }
  }

  if (relationshipValidation.warnings.length > 0 && options.verbose) {
    logger.newline();
    logger.warn(
      `${relationshipValidation.warnings.length} relationship warning(s):`
    );
    for (const warning of relationshipValidation.warnings) {
      logger.item(
        `${warning.collection}.${warning.field}: ${warning.message}`,
        1
      );
    }
  }

  // Show removed collections
  if (result.removedCollections.length > 0) {
    logger.newline();
    logger.warn(
      `${result.removedCollections.length} orphaned collection(s) in database:`
    );
    for (const removed of result.removedCollections) {
      logger.item(removed.slug, 1);
    }
    logger.info("These exist in the database but not in your config.");
  }

  // Show generated files
  logger.newline();

  if (result.generatedSchemas.length > 0) {
    const dir = getCommonDirectory(result.generatedSchemas);
    logger.success(
      `Generated ${formatCount(result.generatedSchemas.length, "Drizzle schema")} → ${dir}`
    );

    if (options.verbose) {
      for (const file of result.generatedSchemas) {
        logger.item(file, 1);
      }
    }
  }

  if (result.generatedZodSchemas.length > 0) {
    const dir = getCommonDirectory(result.generatedZodSchemas);
    logger.success(
      `Generated ${formatCount(result.generatedZodSchemas.length, "Zod schema")} → ${dir}`
    );

    if (options.verbose) {
      for (const file of result.generatedZodSchemas) {
        logger.item(file, 1);
      }
    }
  }

  if (result.generatedTypesFile) {
    logger.success(`Generated types → ${result.generatedTypesFile}`);
  }

  // Show warnings
  if (result.warnings.length > 0 && options.verbose) {
    logger.newline();
    logger.warn(`${result.warnings.length} warning(s):`);
    for (const warning of result.warnings) {
      logger.item(warning, 1);
    }
  }

  // Show duration
  logger.debug(`Sync completed in ${formatDuration(result.durationMs)}`);
}

/**
 * Get common directory from a list of file paths
 */
export function getCommonDirectory(paths: string[]): string {
  if (paths.length === 0) return "";
  if (paths.length === 1) {
    const parts = paths[0].split(/[/\\]/);
    parts.pop(); // Remove filename
    return parts.join("/") || ".";
  }

  const parts = paths[0].split(/[/\\]/);
  parts.pop(); // Remove filename
  return parts.join("/") || ".";
}
