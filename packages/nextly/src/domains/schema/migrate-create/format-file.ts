// F11 PR 3: SQL file body composition for `migrate:create` output.
//
// File header convention (parsed by migrate.ts at apply time):
//   -- Migration: <name>
//   -- Collections: posts, comments      (Q6=A linkage to dynamic_collections.migration_status)
//   -- Singles: header, footer
//   -- Components: hero
//   -- UserExt: user_ext
//   -- Generated at: <ISO timestamp>
//   -- Dialect: PostgreSQL
//
//   -- UP
//   <sql statements joined by semicolons + newlines>
//
// Per Q4=A (PR 2): no -- DOWN section. Forward-only model.
//
// Per spec §6.1 Step 7: the `-- Checksum:` line in the header is
// decorative for human readability. The canonical hash lives in the
// paired .snapshot.json file's `migrationHash` field. This avoids the
// circular-hash problem where editing the header changes the file's
// own hash.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import { getDialectDisplayName } from "../../../cli/utils/adapter.js";

export interface FormatArgs {
  /** Slug-cased migration name (without timestamp prefix or extension). */
  name: string;
  dialect: SupportedDialect;
  /** SQL statements WITHOUT trailing semicolons. The formatter adds them. */
  sqlStatements: string[];
  /** Collection slugs covered by this migration. */
  collections: string[];
  singles: string[];
  components: string[];
  /** True if this migration includes user_ext changes. */
  hasUserExt: boolean;
  /** Override generated-at timestamp for tests; default = `new Date()`. */
  now?: Date;
}

export function formatMigrationFile(args: FormatArgs): string {
  const now = (args.now ?? new Date()).toISOString();
  const collectionLine =
    args.collections.length > 0
      ? `-- Collections: ${args.collections.join(", ")}\n`
      : "";
  const singleLine =
    args.singles.length > 0 ? `-- Singles: ${args.singles.join(", ")}\n` : "";
  const componentLine =
    args.components.length > 0
      ? `-- Components: ${args.components.join(", ")}\n`
      : "";
  const userExtLine = args.hasUserExt ? "-- UserExt: user_ext\n" : "";
  // Each statement gets a trailing `;`. splitSqlStatements in migrate.ts
  // splits on `;` so statements MUST be terminated.
  const body = args.sqlStatements.map(s => `${s};`).join("\n\n");

  return `-- Migration: ${args.name}
${collectionLine}${singleLine}${componentLine}${userExtLine}-- Generated at: ${now}
-- Dialect: ${getDialectDisplayName(args.dialect)}

-- UP
${body}
`;
}

export function formatBlankFile(
  name: string,
  dialect: SupportedDialect,
  now: Date = new Date()
): string {
  return `-- Migration: ${name}
-- Generated at: ${now.toISOString()}
-- Dialect: ${getDialectDisplayName(dialect)}
--
-- This is a blank migration file for custom SQL.
-- Add your migration SQL below.

-- UP

`;
}

/**
 * Format the migration filename per spec §6.1 Q8=C.
 * Pattern: `YYYYMMDD_HHMMSS_mmm_<slug>.sql`.
 *
 * Underscore separators around the millisecond component keep the
 * filename readable while preserving sub-second precision for rebase
 * conflict avoidance.
 */
export function formatTimestamp(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}_${ms}`;
}

/**
 * Slugify a user-provided migration name for use in filenames.
 * Lowercases, replaces non-alphanumeric runs with single underscore,
 * trims leading/trailing underscores.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
