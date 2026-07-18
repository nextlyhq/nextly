/**
 * Migration Discovery Utilities
 *
 * Shared utilities for discovering and grouping migration files,
 * including dialect-specific variant selection (e.g., .mysql.sql, .sqlite.sql).
 *
 * This ensures consistent behavior across migrate, migrate:status, and build commands.
 *
 * @module cli/utils/migration-discovery
 */

import { readdir } from "node:fs/promises";
import { basename } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

/**
 * A migration file variant with its dialect (if any)
 */
export interface MigrationVariant {
  /** The file name (e.g., "0001_000000_blog_schema.mysql.sql") */
  file: string;
  /** The dialect this file targets (mysql, sqlite, postgresql), or undefined for base files */
  dialect: SupportedDialect | undefined;
}

/**
 * Result of migration discovery - grouped variants for each logical migration
 */
export interface MigrationGroup {
  /** Base migration name (without dialect suffix) */
  baseName: string;
  /** All variants of this migration (base + dialect-specific) */
  variants: MigrationVariant[];
}

/**
 * Discover migration files from the migrations directory and group dialect variants.
 *
 * Groups files by base name (without dialect suffix) so that:
 * - 0001_000000_blog_schema.sql
 * - 0001_000000_blog_schema.mysql.sql
 * - 0001_000000_blog_schema.sqlite.sql
 *
 * Are treated as ONE logical migration named "0001_000000_blog_schema".
 *
 * @param migrationsDir - Path to the migrations directory
 * @returns Map of base migration names to their variants
 */
export async function discoverMigrationGroups(
  migrationsDir: string
): Promise<Map<string, MigrationGroup>> {
  let files: string[];

  try {
    files = await readdir(migrationsDir);
  } catch {
    return new Map();
  }

  const sqlFiles = files
    .filter(f => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const migrationGroups = new Map<string, MigrationGroup>();

  for (const file of sqlFiles) {
    // Check if file has a dialect suffix (e.g., .mysql.sql, .sqlite.sql)
    const dialectMatch = file.match(/(.*)\.(mysql|sqlite|postgresql)\.sql$/);

    let baseName: string;
    let dialect: SupportedDialect | undefined;

    if (dialectMatch) {
      // This is a dialect-specific file
      baseName = dialectMatch[1];
      dialect = dialectMatch[2] as SupportedDialect;
    } else {
      // This is a base file (no dialect suffix)
      baseName = basename(file, ".sql");
      dialect = undefined;
    }

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

/**
 * Select the best migration variant for a given dialect.
 *
 * Priority order:
 * 1. Dialect-specific file (e.g., .mysql.sql for mysql dialect)
 * 2. Base file (no dialect suffix)
 * 3. First available variant (fallback)
 *
 * @param variants - Available migration variants
 * @param dialect - Target database dialect (optional)
 * @returns The selected file name, or undefined if no variants available
 */
export function selectVariant(
  variants: MigrationVariant[],
  dialect?: SupportedDialect
): string | undefined {
  if (variants.length === 0) {
    return undefined;
  }

  if (dialect) {
    // Look for dialect-specific variant first
    const dialectVariant = variants.find(v => v.dialect === dialect);
    if (dialectVariant) {
      return dialectVariant.file;
    }
    // Fall back to base file (if exists), otherwise first available
    const baseVariant = variants.find(v => v.dialect === undefined);
    return baseVariant?.file || variants[0]?.file;
  }

  // No dialect specified, prefer base file
  const baseVariant = variants.find(v => v.dialect === undefined);
  return baseVariant?.file || variants[0]?.file;
}

/**
 * Get the sorted list of base migration names from grouped migrations.
 *
 * @param groups - Migration groups from discoverMigrationGroups
 * @returns Sorted array of base migration names
 */
export function getSortedBaseNames(
  groups: Map<string, MigrationGroup>
): string[] {
  return Array.from(groups.keys()).sort();
}
