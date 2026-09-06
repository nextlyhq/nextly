// F11 PR 3: SQL file body composition for `migrate:create` output.
//
// File header convention (parsed by migrate.ts at apply time):
//   -- Migration: <name>
//   -- Collections: posts, comments      (Q6=A linkage to dynamic_collections.migration_status)
//   -- Singles: header, footer
//   -- Field groups: hero
//   -- UserExt: user_ext
//   -- Generated at: <ISO timestamp>
//   -- Dialect: PostgreSQL
//
//   -- UP
//   <sql statements joined by semicolons + newlines>
//   -- DOWN
//   <inverse sql statements, or a placeholder comment>
//
// SP-2: a -- DOWN section is now emitted (auto-generated inverse, or a
// placeholder comment when the migration has no automatic rollback).
//
// Per spec §6.1 Step 7: the `-- Checksum:` line in the header is
// decorative for human readability. The canonical hash lives in the
// paired .snapshot.json file's `migrationHash` field. This avoids the
// circular-hash problem where editing the header changes the file's
// own hash.

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { getDialectDisplayName } from "../../../cli/utils/adapter";

/**
 * The field-group header written into a generated migration, and the pattern that reads it
 * back.
 *
 * Both live here because a writer and a reader that each spell the format themselves are two
 * places to change and one place to forget — which is how this header came to be written as
 * `-- Components:` long after the concept was renamed to a field group.
 *
 * The pattern accepts the legacy spellings deliberately. Migration files already generated
 * carry `-- Component(s):` and stay on disk forever; a reader that knew only the current
 * header would report those migrations as touching no field groups, silently.
 */
export const FIELD_GROUP_HEADER = "-- Field groups:";

/**
 * Marks a file whose entity headers name what the migration CHANGES.
 *
 * 🔴 Provenance, not decoration. Migrations generated before headers were
 * scoped list every entity in the config, so reading one as ownership makes an
 * unrelated old migration hold a collection's row -- and its dashboard --
 * until it runs. A reader cannot tell the two apart from the header itself:
 * both are a comma-separated list of slugs.
 *
 * Absent means "this file's scope is unknown", which is the honest reading of a
 * legacy header.
 *
 * A blank migration SHIPS with this line, and that is deliberate rather than a
 * loophole: without it, an operator who follows the template and adds
 * `-- Collections: posts` still has the slug discarded, because the file the
 * guidance produced is not marked. The marker alone claims nothing — a file
 * carrying it and naming no entity is still unknown scope, because "changes
 * nothing" and "nobody said" stay different facts. It becomes an assertion only
 * once the operator names something, which is when they make it.
 */
export const SCOPED_ENTITIES_MARKER = "-- Entity scope: touched";

/**
 * The marker as a HEADER LINE, which is the only form that counts.
 *
 * 🔴 A substring test reads the marker's own guidance sentence as provenance —
 * and the blank template prints that sentence — so a file whose real marker was
 * removed still answered `scoped`. That is not only a wrong answer: it made the
 * test guarding the marker unable to fail, because the text it searched for was
 * present either way.
 */
const SCOPED_ENTITIES_PATTERN = /^-- Entity scope: touched$/m;

/**
 * The one-line instruction for annotating a hand-written migration.
 *
 * 🔴 Exported so the CLI's remediation and the blank template say the SAME
 * thing. They were written separately and immediately disagreed: the template
 * listed all three headers while the warning named only `-- Collections:`, and
 * following the warning filed a single among collections. Guidance about a
 * format belongs beside the format.
 *
 * 🔴 Distinguishes hand-written from generated, because the files this is
 * shown for are not all alike and the same edit is safe on one and destructive
 * on the other. `writeSnapshot` records a SHA-256 of the `.sql` in its paired
 * snapshot and `verifyMigrationHash` compares them, so annotating a GENERATED
 * migration after the fact invalidates its own integrity record. The blank
 * path writes no snapshot, so a hand-written file has nothing to invalidate.
 *
 * 🔴 Names the MARKER as well as the header, because the files this is shown
 * for are not all alike. A new blank migration ships the marker, so naming the
 * entity is enough; a migration generated before headers were scoped has
 * headers and no marker, and adding another header to it changes nothing —
 * `scoped` stays false and the names are discarded exactly as before. One
 * remediation is shown for both, so it has to be sufficient for both.
 */
export const ENTITY_HEADER_GUIDANCE =
  "In a hand-written migration, add `-- Collections:`, `-- Singles:` or " +
  "`-- Field groups:` naming what it changes, plus " +
  `\`${SCOPED_ENTITIES_MARKER}\` if it is not already there. ` +
  "A generated migration's `.sql` is hashed by its paired snapshot, so leave " +
  "that one alone — its entities keep the behaviour they had before";
export const FIELD_GROUP_HEADER_PATTERN =
  /^-- (?:Field groups?|Components?):\s*(.+)$/m;

export interface FormatArgs {
  /** Slug-cased migration name (without timestamp prefix or extension). */
  name: string;
  dialect: SupportedDialect;
  /** SQL statements WITHOUT trailing semicolons. The formatter adds them. */
  sqlStatements: string[];
  /**
   * Inverse SQL statements (WITHOUT trailing semicolons) for the `-- DOWN`
   * section. Empty array → a placeholder comment is emitted instead, marking
   * the migration as having no automatic rollback (e.g. data-only or blank).
   */
  downSqlStatements: string[];
  /** Collection slugs covered by this migration. */
  collections: string[];
  singles: string[];
  components: string[];
  /** True if this migration includes user_ext changes. */
  hasUserExt: boolean;
  /**
   * Whether the entity arrays name what this migration CHANGES.
   *
   * 🔴 False for a caller that does not compute them, and `migrate-baseline`
   * is one: it passes all three arrays empty while its SQL adopts existing
   * tables. Stamping the marker there would publish "scoped, and it changes
   * nothing" about a migration that creates the whole schema — a false
   * declaration, and worse than none, because a reader can tell an absent
   * declaration from a wrong one only if wrong ones are never written.
   */
  entitiesAreScoped?: boolean;
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
      ? `${FIELD_GROUP_HEADER} ${args.components.join(", ")}\n`
      : "";
  const userExtLine = args.hasUserExt ? "-- UserExt: user_ext\n" : "";
  // Written whether or not any entity is NAMED: a migration that changes no
  // entity is a different fact from one whose scope nobody recorded. Withheld
  // when the caller says it did not compute the arrays at all.
  const scopeLine =
    args.entitiesAreScoped === false ? "" : `${SCOPED_ENTITIES_MARKER}\n`;
  // Each statement gets a trailing `;`. splitSqlStatements in migrate.ts
  // splits on `;` so statements MUST be terminated.
  const body = args.sqlStatements.map(s => `${s};`).join("\n\n");
  const downBody =
    args.downSqlStatements.length > 0
      ? args.downSqlStatements.map(s => `${s};`).join("\n\n")
      : "-- (no automatic down — this migration is not reversible. Hand-write rollback SQL here)";

  return `-- Migration: ${args.name}
${collectionLine}${singleLine}${componentLine}${userExtLine}${scopeLine}-- Generated at: ${now}
-- Dialect: ${getDialectDisplayName(args.dialect)}

-- UP
${body}

-- DOWN
${downBody}
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
--
--
-- ${ENTITY_HEADER_GUIDANCE}. For example:
--
-- -- Collections: posts
-- -- Singles: home
-- -- Field groups: hero
--
-- \`nextly migrate\` reads those lines to know which entities are still
-- waiting on this file. Without one it cannot tell, and will record those
-- entities as migrated once their tables exist.
${SCOPED_ENTITIES_MARKER}

-- UP


-- DOWN
-- (hand-write rollback SQL here, or leave empty if irreversible)
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

/**
 * The entity slugs a migration's header names.
 *
 * Lives beside {@link formatMigrationFile} for the reason the field-group
 * pattern does: a writer and a reader that each spell the format themselves are
 * two places to change and one place to forget. Two callers read this — the
 * migrate command when it parses a file, and the pending sweep when it asks
 * which entities are still waiting on something.
 *
 * The singular spellings are accepted because files already on disk carry them.
 */
export interface MigrationEntityHeaders {
  collections: string[];
  singles: string[];
  components: string[];
  /**
   * Whether the names above are what this migration CHANGES.
   *
   * False for a legacy file, whose header lists the whole config, and for a
   * hand-written one with no header. A caller deciding ownership must treat
   * those as unknown rather than as evidence.
   */
  scoped: boolean;
}

const COLLECTIONS_HEADER_PATTERN = /^-- Collections?:\s*(.+)$/m;
const SINGLES_HEADER_PATTERN = /^-- Singles?:\s*(.+)$/m;

/** The comma-separated slugs on one header line, or none. */
function headerSlugs(content: string, pattern: RegExp): string[] {
  const match = content.match(pattern);
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map(value => value.trim())
    .filter(value => value.length > 0);
}

export function parseEntityHeaders(content: string): MigrationEntityHeaders {
  return {
    collections: headerSlugs(content, COLLECTIONS_HEADER_PATTERN),
    singles: headerSlugs(content, SINGLES_HEADER_PATTERN),
    components: headerSlugs(content, FIELD_GROUP_HEADER_PATTERN),
    scoped: SCOPED_ENTITIES_PATTERN.test(content),
  };
}

/**
 * The header line naming ONE entity, chosen by its kind.
 *
 * 🔴 Here rather than at the call site because the kind decides which bucket a
 * reader puts the slug in, and a writer that always says `-- Collections:`
 * files a single or a field group under the wrong one. The sweep then looks in
 * its own kind's set, finds nothing, and promotes a row whose migration has not
 * run — the exact failure the header exists to prevent, reintroduced by the
 * writer rather than the reader.
 *
 * Kept beside {@link parseEntityHeaders} and {@link formatMigrationFile} so the
 * three spellings of this format stay in one file.
 */
export function entityHeaderLine(
  kind: "collection" | "single" | "fieldGroup",
  slug: string
): string {
  switch (kind) {
    case "single":
      return `-- Singles: ${slug}`;
    case "fieldGroup":
      return `${FIELD_GROUP_HEADER} ${slug}`;
    case "collection":
      return `-- Collections: ${slug}`;
  }
}
