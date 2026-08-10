/**
 * Every way a field group can be created has to leave one that actually works.
 *
 * ## The gap this closes
 *
 * A field group is creatable through three transports, and only the dispatcher made the table. The
 * REST route answered `201 Field group created.` and the Direct API resolved normally, both having
 * written a registry row describing a `comp_<slug>` that did not exist. Every later read and write
 * to that field group then failed against the database.
 *
 * Nothing caught it because the coverage was per transport rather than per outcome: the dispatcher
 * had tests, and they passed, while the other two were tested for their response shape and their
 * table-name derivation — neither of which touches a database. So each transport was individually
 * green and the product was broken.
 *
 * These assert the OUTCOME against a real database: the physical table exists. Written as one suite
 * because the defect was precisely that the transports disagreed, and testing them apart is what
 * let them.
 *
 * 🔴 The REST route is proved a level up rather than here, and the reason is worth stating plainly
 * so nobody reads its absence as coverage. It is permission-gated, the test harness has no way to
 * authenticate a request, and faking a session would test the fake. What matters is that all three
 * transports now share ONE implementation: these cases prove that implementation provisions the
 * table on a live database, and `field-group-route-delegates.test.ts` proves the route reaches it
 * instead of writing the row itself. Neither half stands alone.
 *
 * Self-skips per dialect on the standard rule: SQLite always runs, the servers run when their URL
 * is set, and each dialect gets its own throwaway database.
 */
import { afterEach, describe, expect, it } from "vitest";

import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The registry's own view of a slug, or undefined when it holds none. */
async function registryRow(
  instance: TestNextly,
  slug: string
): Promise<{ migrationStatus?: string; tableName?: string } | undefined> {
  const registry = instance.getService("fieldGroupRegistryService");
  return (await registry.getComponentBySlug(slug)) ?? undefined;
}

const FIELDS = [
  { name: "heading", type: "text" },
  { name: "weight", type: "number" },
];

for (const dialect of getConfiguredTestDialects()) {
  describe(`every field-group create transport provisions its table — ${dialect}`, () => {
    // Per-dialect slugs: the suites share one process, so a name reused across them turns a leaked
    // row into a duplicate-slug rejection in a later suite rather than a failure where it leaked.
    const viaDispatcher = `fg_${dialect.slice(0, 2)}_disp`;
    const viaDirect = `fg_${dialect.slice(0, 2)}_direct`;

    it("the dispatcher creates the table", async () => {
      current = await createTestNextly({ dialect });

      await dispatchComponents(
        "createComponent",
        {},
        { slug: viaDispatcher, label: "Via dispatcher", fields: FIELDS }
      );

      const row = await registryRow(current, viaDispatcher);
      // The recorded outcome FIRST: it names the problem, where a bare "table missing" only says
      // the end state is wrong.
      expect(row?.migrationStatus).toBe("applied");
      expect(await current.adapter.tableExists(`comp_${viaDispatcher}`)).toBe(
        true
      );
    });

    it("the Direct API creates the table", async () => {
      current = await createTestNextly({ dialect });

      await current.nextly.fieldGroups.create({
        slug: viaDirect,
        label: "Via direct API",
        fields: FIELDS,
      });

      const row = await registryRow(current, viaDirect);
      expect(row?.migrationStatus).toBe("applied");
      expect(await current.adapter.tableExists(`comp_${viaDirect}`)).toBe(true);
    });

    it("refuses a create whose slug names a table another field group owns", async () => {
      current = await createTestNextly({ dialect });

      // Two DIFFERENT slugs naming ONE physical table, which is the case a slug-keyed check cannot
      // see: a slug is normalised on its way to a table name, so these two are `comp_<...>_held`
      // alike while looking like two free slugs.
      const held = `fg_${dialect.slice(0, 2)}_held`;
      const collides = held.replace(/_held$/, "-held");

      await dispatchComponents(
        "createComponent",
        {},
        { slug: held, label: "Holds the table", fields: FIELDS }
      );

      // Rejected for the reason that is true — a table conflict — rather than by whatever the
      // database says when the unique index on `table_name` stops the insert. The distinction is
      // the whole point: reaching the insert means the DDL and the runtime re-registration have
      // already run, and the second of those rebinds the EXISTING field group to this request's
      // fields.
      await expect(
        current.nextly.fieldGroups.create({
          slug: collides,
          label: "Wants the same table",
          fields: [{ name: "different", type: "text" }],
        })
      ).rejects.toMatchObject({ code: "DUPLICATE" });

      // The field group that owns the table is untouched, which is what a refusal before the DDL
      // buys. Its own fields still describe it.
      const row = await registryRow(current, held);
      expect(row?.migrationStatus).toBe("applied");
      expect(await current.adapter.tableExists(`comp_${held}`)).toBe(true);
    });
  });
}
