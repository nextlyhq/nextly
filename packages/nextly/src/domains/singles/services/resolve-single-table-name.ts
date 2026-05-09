/**
 * Canonical single-table name resolver.
 *
 * Why: before this helper, two code paths (registry insert and DDL create)
 * each derived the physical table name independently. That produced drift
 * when a Single config set an explicit `dbName` — the registry row would
 * hold `single_<slug>` while the DDL path would honor `dbName` raw, so the
 * table on disk would not match what subsequent queries expected. This
 * function is the single source of truth: every call site that needs a
 * Single's table name must route through here.
 *
 * Rules:
 * - All Single tables are named `single_<slug_with_underscores>`.
 * - An explicit `dbName` overrides slug-derivation, BUT we still enforce
 *   the `single_` prefix so the registry and DDL never disagree. Historical
 *   configs that set `dbName` without the prefix (intentional or not) are
 *   silently corrected.
 * - Names are always lowercased, non-alphanumeric sequences collapsed to
 *   a single underscore, and leading/trailing underscores stripped.
 */

const PREFIX = "single_";

export interface SingleNameInput {
  slug: string;
  dbName?: string;
}

function normalizeIdentifier(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function ensurePrefixed(name: string): string {
  return name.startsWith(PREFIX) ? name : `${PREFIX}${name}`;
}

export function resolveSingleTableName(config: SingleNameInput): string {
  if (!config.slug || config.slug.trim().length === 0) {
    throw new Error(
      "resolveSingleTableName: slug is required and cannot be empty"
    );
  }

  // dbName takes precedence over slug-derived name, but the `single_` prefix
  // is always enforced so both Path A (registry) and Path B (DDL) converge.
  const base = config.dbName
    ? normalizeIdentifier(config.dbName)
    : normalizeIdentifier(config.slug);
  return ensurePrefixed(base);
}
