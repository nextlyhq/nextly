/**
 * The registry row of a Single or a field group whose left Builder save landed whole, brought to
 * the saved shape by a settle (`settleLeftSave`): written as a Builder apply writes it
 * (`writeAppliedFieldsRow`), or, where the save deleted the entity, removed as the migrations
 * remove a dropped entity's row (`removeRegistryRow`).
 *
 * @module domains/schema/builder-save/settle-registry
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldConfig } from "../../../collections/fields/types";
import { writeAppliedFieldsRow } from "../../../dispatcher/helpers/applied-fields-row";
import { adapterForReads } from "../../../shared/lib/read-transaction-scope";
import { dashboardPinsPresent } from "../../dashboard/dashboard-pins";
import { resolveRegistryTableName } from "../../field-groups/storage/resolve-storage-names";
import { mediaUsageTablePresent } from "../../versions/entity-teardown";
import { removeRegistryRow } from "../migrate/registry-row-removal";
import { inRegistryStep, writeRegistryRows } from "../schema-version";

import type { SettleDeps } from "./settle-left-save";

/** The registry writer a settle is handed, over `adapter`. */
export function settleRegistryWriter(
  adapter: DrizzleAdapter
): SettleDeps["writeRegistry"] {
  return async ({ kind, slug, saved }) => {
    const table =
      kind === "single"
        ? "dynamic_singles"
        : await resolveRegistryTableName(adapter);
    if (saved === null) {
      await removeRow(adapter, kind, slug);
      return;
    }
    const [row] = await adapter.select<{ schema_version: unknown }>(table, {
      columns: ["schema_version"],
      where: { and: [{ column: "slug", op: "=", value: slug }] },
    });
    // A row gone already (its entity deleted elsewhere since) has nothing to bring up.
    if (row === undefined) return;
    const current = Number(row.schema_version);
    await writeAppliedFieldsRow(adapter, {
      table,
      slug,
      fields: saved.fields as FieldConfig[],
      localized: saved.localized === true,
      // Moved on, as a save's own write moves it, so a Builder holding the old version re-reads.
      schemaVersion: Number.isFinite(current) ? current + 1 : 1,
    });
  };
}

/** Remove the entity's registry row, with what goes with it, where it still stands. */
async function removeRow(
  adapter: DrizzleAdapter,
  kind: "single" | "fieldGroup",
  slug: string
): Promise<void> {
  await writeRegistryRows(
    adapter,
    async tx => {
      const view = adapterForReads(adapter);
      // Asked on the transaction the row is removed in, each as a step of its own, as the
      // migrations ask them.
      const tables = {
        dashboardPinsPresent: await inRegistryStep(adapter, () =>
          dashboardPinsPresent(adapter, undefined, view)
        ),
        mediaUsagePresent: await inRegistryStep(adapter, () =>
          mediaUsageTablePresent(adapter, undefined, view)
        ),
      };
      await removeRegistryRow({ tx, view, tables }, kind, slug);
      return 1;
    },
    { wrote: removed => removed > 0 }
  );
}
