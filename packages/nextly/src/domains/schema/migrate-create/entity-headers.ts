/**
 * The reading half of a migration file's entity headers: the patterns that
 * find `-- Collections:`, `-- Singles:`, `-- Field groups:` and the scope
 * marker, and the parser over them. The writing half, and the reasons each
 * spelling is what it is, live in `format-file.ts`, which re-exports these.
 *
 * Its own module so a reader of the migrations folder that runs on a server
 * request (the folder discovery, through the old Schema Builder file
 * classification) parses the headers without loading the CLI modules the
 * writer needs.
 *
 * @module domains/schema/migrate-create/entity-headers
 */

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
 * The field-group header in its current and legacy spellings: files already
 * generated carry `-- Component(s):` and stay on disk forever.
 */
export const FIELD_GROUP_HEADER_PATTERN =
  /^-- (?:Field groups?|Components?):\s*(.+)$/m;

/**
 * The entity slugs a migration's header names.
 *
 * Read here, and written by `formatMigrationFile` beside the same patterns'
 * spellings, for the reason the field-group pattern is shared: a writer and a
 * reader that each spell the format themselves are two places to change and
 * one place to forget. Two callers read this — the
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
