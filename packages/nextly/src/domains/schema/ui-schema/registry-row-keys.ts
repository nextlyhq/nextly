/**
 * The unique keys of a UI-built entity's registry row besides its slug: its
 * `id` and `table_name`, both derived from the slug. One derivation for the
 * two that need it: the metadata upsert that writes the row
 * (`metadata-sql.ts`), and the reading of a migration statement that judges
 * whose row an upsert writes (`statement-targets.ts`), where MySQL's
 * `ON DUPLICATE KEY UPDATE` updates whichever row any unique key meets.
 *
 * @module domains/schema/ui-schema/registry-row-keys
 */
import { createHash } from "node:crypto";

import { STORAGE_FORMAT } from "../../../schemas/storage-format";

/** The prefix of the data table each registry's entities are stored in. */
const TABLE_PREFIX_BY_REGISTRY: Readonly<Record<string, string>> = {
  dynamic_collections: "dc_",
  dynamic_singles: "single_",
  [STORAGE_FORMAT.registryTable]: STORAGE_FORMAT.tablePrefix,
};

/** A registry row's unique keys besides its slug, by column. */
export interface RegistryRowKeys {
  id: string;
  table_name: string;
}

/** Deterministic UUID-shaped id from a slug, so the committed SQL is byte-stable. */
function deterministicId(slug: string): string {
  const hex = createHash("sha256").update(`ui:${slug}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * The `id` and `table_name` the row of `slug` in `registryTable` is written
 * with, or undefined for a table that is not one of the three registries:
 * nothing here says what that table's keys are.
 */
export function registryRowKeys(
  registryTable: string,
  slug: string
): RegistryRowKeys | undefined {
  const prefix = Object.hasOwn(TABLE_PREFIX_BY_REGISTRY, registryTable)
    ? TABLE_PREFIX_BY_REGISTRY[registryTable]
    : undefined;
  if (prefix === undefined) return undefined;
  return {
    id: deterministicId(slug),
    // A hyphen in a slug is an underscore in its table.
    table_name: `${prefix}${slug.replace(/-/g, "_")}`,
  };
}
