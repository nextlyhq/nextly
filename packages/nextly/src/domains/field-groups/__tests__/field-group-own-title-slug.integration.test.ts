/**
 * A field group holds no built-in title or slug, so fields of its own by those names are kept by
 * every save: the create stores them and makes their columns, and a later Builder save that sends
 * them with the rest keeps their columns and the values in them. The Builder's half (it shows
 * them as the field group's own and sends them) is held in the admin's
 * `useBuilderEntityState.test.tsx`; this is the server's half, on a real database.
 *
 * Run as a development server runs it, where a Builder save applies its migration at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { introspectLiveColumns } from "../../schema/pipeline/diff/introspect-live";

let t: TestNextly | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  await t?.destroy();
  t = undefined;
});

const OWN = [
  { name: "title", type: "text" },
  { name: "slug", type: "text" },
  { name: "body", type: "text" },
];

for (const dialect of getConfiguredTestDialects()) {
  describe(`a field group's own title and slug — ${dialect}`, () => {
    beforeEach(async () => {
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({ dialect });
    });

    const app = () => t as TestNextly;
    const stored = (slug: string) =>
      app().getService("fieldGroupRegistryService").getComponentBySlug(slug);

    async function liveColumns(table: string): Promise<string[]> {
      const snapshot = await introspectLiveColumns(
        app().adapter.getDrizzle(),
        dialect,
        [table]
      );
      return (snapshot.tables[0]?.columns ?? []).map(column => column.name);
    }

    it("are stored by the create and kept, with their values, by a later Builder save", async () => {
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "fgown", label: "Card", fields: OWN }
      );
      const q = dialect === "mysql" ? "`" : '"';
      await app().adapter.executeQuery(
        `INSERT INTO ${q}comp_fgown${q} (${q}id${q}, ${q}_parent_id${q}, ${q}_parent_table${q}, ${q}_parent_field${q}, ${q}_order${q}, ${q}title${q}, ${q}slug${q}, ${q}body${q}) VALUES ('fgown-1', 'p-1', 'dc_parent', 'card', 0, 'Kept title', 'kept-slug', 'Body')`
      );

      const before = await stored("fgown");
      await dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: "fgown" },
        {
          fields: [...OWN, { name: "note", type: "text" }],
          confirmed: true,
          schemaVersion: before?.schemaVersion,
        }
      );

      const after = await stored("fgown");
      expect(
        ((after?.fields ?? []) as Array<{ name: string }>).map(f => f.name)
      ).toEqual(["title", "slug", "body", "note"]);
      expect(await liveColumns("comp_fgown")).toEqual(
        expect.arrayContaining(["title", "slug", "body", "note"])
      );
      const [row] = await app().adapter.executeQuery<{
        title: unknown;
        slug: unknown;
      }>(
        `SELECT ${q}title${q} AS title, ${q}slug${q} AS slug FROM ${q}comp_fgown${q} WHERE ${q}id${q} = 'fgown-1'`
      );
      expect(row).toMatchObject({ title: "Kept title", slug: "kept-slug" });
    });
  });
}
