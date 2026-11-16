/**
 * The app's migration files grouped as the runner groups them: by base name,
 * each group with its dialect variants. A module that imports nothing heavy,
 * so a reader of the folder's names alone (`withNextly`, while Next.js loads
 * `next.config`) groups them by this same rule without loading the runner's
 * folder reading (`readMigrationFolderSync`), which groups through it too.
 *
 * @module domains/schema/migrate/migration-groups
 */
import { basename } from "node:path";

import type { MigrationGroup } from "../../../cli/utils/migration-discovery";

import { dialectVariantOf } from "./dialect-variant";

/** `files` grouped by base name, each group with its dialect variants. */
export function groupMigrationFiles(
  files: readonly string[]
): Map<string, MigrationGroup> {
  const sqlFiles = [...files].sort((a, b) => a.localeCompare(b));

  const migrationGroups = new Map<string, MigrationGroup>();

  for (const file of sqlFiles) {
    // A dialect suffix (`.mysql.sql`) names a variant of its base's group;
    // read once, as the old-Builder reading reads it.
    const variant = dialectVariantOf(file);
    const baseName = variant?.baseName ?? basename(file, ".sql");
    const dialect = variant?.dialect;

    // Get or create the group for this base name
    let group = migrationGroups.get(baseName);
    if (!group) {
      group = { baseName, variants: [] };
      migrationGroups.set(baseName, group);
    }

    // Add this variant to the group
    group.variants.push({ file, dialect });
  }

  return migrationGroups;
}
