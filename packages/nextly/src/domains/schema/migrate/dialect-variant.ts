/**
 * How a migration file's name says it is one dialect's variant of a
 * migration: `<base>.<dialect>.sql`, run in place of `<base>.sql` on that
 * dialect. The one reading, for grouping the folder and for telling a
 * variant from a file an earlier Schema Builder wrote.
 *
 * @module domains/schema/migrate/dialect-variant
 */
import { basename } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

const DIALECT_VARIANT = /^(.*)\.(mysql|sqlite|postgresql)\.sql$/;

/** The base name and dialect a variant's file name gives; none for a base file. */
export function dialectVariantOf(
  file: string
): { baseName: string; dialect: SupportedDialect } | undefined {
  const match = DIALECT_VARIANT.exec(file);
  if (match === null) return undefined;
  return { baseName: match[1], dialect: match[2] as SupportedDialect };
}

/**
 * The name of the migration `file` is a file of: a dialect's variant's base name, any other
 * file's own name without `.sql`. The one answer for grouping the folder, pairing a file with its
 * group's snapshot (`<name>.snapshot.json`) and naming it to `migrate:resolve`.
 */
export function migrationNameOf(file: string): string {
  return dialectVariantOf(file)?.baseName ?? basename(file, ".sql");
}
