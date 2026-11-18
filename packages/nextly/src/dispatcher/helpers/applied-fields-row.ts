/**
 * The registry row write a Schema Builder schema save makes once its DDL has
 * run, shared by the Single and field group saves.
 *
 * @module dispatcher/helpers/applied-fields-row
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldConfig } from "../../collections/fields/types";
import { clearRegistryRowCache } from "../../domains/dynamic-collections/services/collection-row-cache";
import { writeRegistryRows } from "../../domains/schema/schema-version";
import { calculateSchemaHash } from "../../domains/schema/services/schema-hash";
import { bumpSchemaVersion } from "../../route-handler/schema-version";

/**
 * Record on `slug`'s row of the registry table `table` the fields a save
 * applied, whether it is translated, and its advanced schema version, with
 * its migration marked applied. The row and the stored schema version are
 * written in one transaction, so the version's count moves with the save it
 * records (`writeRegistryRows`). The write is made past the registry
 * services, so the cached registry rows are cleared here: a read before or
 * during the save may have cached the row from before it.
 */
export async function writeAppliedFieldsRow(
  adapter: DrizzleAdapter,
  row: {
    table: string;
    slug: string;
    fields: FieldConfig[];
    localized: boolean;
    schemaVersion: number;
  }
): Promise<void> {
  await writeRegistryRows(adapter, tx =>
    tx.update(
      row.table,
      {
        fields: JSON.stringify(row.fields),
        schema_hash: calculateSchemaHash(row.fields),
        migration_status: "applied",
        localized: row.localized,
        schema_version: row.schemaVersion,
        updated_at: new Date(),
      },
      { and: [{ column: "slug", op: "=", value: row.slug }] }
    )
  );
  clearRegistryRowCache();
  await afterEnclosingCommit(adapter);
}

/**
 * Whether a Single's or field group's Builder apply writes its registry row inside its file's
 * transaction (`inLastTransaction`), so a failed write leaves the save as it was. Not where the
 * entity keeps translations before or after the save: their table is reconciled after the file,
 * and the row would then record the change before that step holds it, so the apply writes it
 * after the reconcile instead.
 */
export function registryInFileTransaction(translations: {
  wasStored: boolean;
  isStored: boolean;
}): boolean {
  return !translations.wasStored && !translations.isStored;
}

/**
 * Where the write joined a transaction its caller opened (a save's file), the cached rows are
 * cleared and the schema version signalled again once that transaction commits: until then the
 * row it wrote is not what other connections read, so a read in between may cache the old row and
 * take the first signal. Outside a transaction the write has committed, and nothing more is owed.
 */
export async function afterEnclosingCommit(
  adapter: DrizzleAdapter
): Promise<void> {
  if (!adapter.inTransaction()) return;
  await adapter.afterCommit(() => {
    clearRegistryRowCache();
    bumpSchemaVersion();
  });
}
