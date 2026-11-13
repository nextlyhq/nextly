/**
 * Removing an entity's registry row, as the migrations remove it: the row an
 * applied migration dropped (`nextly migrate`), and the row of an entity a
 * rolled-back migration added (`migrate:down`). A collection's or a Single's
 * goes with its autosaves, version pins and dashboard pins
 * (`deleteEntityRegistryRow`); a field group's is its row alone.
 *
 * The one way both commands remove a row, so a drop and the undo of an add
 * leave the same registry behind.
 *
 * @module domains/schema/migrate/registry-row-removal
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { resolveRegistryTableName } from "../../field-groups/storage/resolve-storage-names";
import {
  deleteEntityRegistryRow,
  type DashboardTables,
} from "../../versions/entity-teardown";
import type { SettingsEntityKind } from "../migrate-create/entity-settings";

/** Where a removal runs: the transaction the registry write holds, and the adapter reading on it. */
export interface RemovalScope {
  tx: Parameters<typeof deleteEntityRegistryRow>[0];
  view: DrizzleAdapter;
  tables: DashboardTables;
}

/** Remove the registry row of `kind` `slug`, on `scope`'s transaction. */
export async function removeRegistryRow(
  scope: RemovalScope,
  kind: SettingsEntityKind,
  slug: string
): Promise<void> {
  if (kind === "fieldGroup") {
    await scope.view.delete(await resolveRegistryTableName(scope.view), {
      and: [{ column: "slug", op: "=", value: slug }],
    });
    // Cleared as the row goes, as `deleteEntityRegistryRow` clears for the
    // other kinds, so a read later in the transaction does not find it.
    clearRegistryRowCache();
    return;
  }
  await deleteEntityRegistryRow(scope.tx, kind, slug, scope.tables);
}
