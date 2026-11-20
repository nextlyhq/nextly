/**
 * After a site's field-group storage is migrated, `db:sync`'s translation pass and a plugin's
 * contribution to a field group both reach the group's stored `fg_<slug>` table.
 *
 * Each took the group's table from its slug alone, which derives the legacy `comp_<slug>`:
 *
 * - `db:sync`'s translation pass looked for `comp_<slug>` as the main table of a group that had
 *   become translatable, found none, and created no `fg_<slug>_locales` for it, so its other
 *   languages had nowhere to be written;
 * - the extension schema seeded a field group as `comp_<slug>`, so a column a plugin contributes
 *   to every field group's table was declared on a table that does not exist.
 *
 * Every dialect, each case on its own database.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "/virtual/nextly.config.ts",
    dependencies: [],
  }),
}));

import { ensureLocalizedCompanions } from "../../../cli/commands/dev-build";
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { definePlugin } from "../../../plugins/plugin-context";
import { getConfiguredTestDialects } from "../../../plugins/test-nextly";
import { col } from "../../schema/extension/dsl";
import { compileExtensionSchema } from "../../schema/extension/publish";
import { declaredFieldGroupStorage } from "../services/field-group-stored-tables";

import {
  hasTable,
  legacyObjects,
  openStorageGenerationSite,
  type Declared,
  type StorageGenerationSite,
} from "./helpers/storage-generation-site";

const LOCALIZATION = { locales: ["en", "de"], defaultLocale: "en" };

const declaredWith = (localized: boolean): Declared => ({
  collections: [
    defineCollection({
      slug: "fgsc_posts",
      fields: [
        text({ name: "title" }),
        fieldGroup({ name: "card", component: "fgsc_card" }),
      ],
    }),
  ],
  fieldGroups: [
    defineFieldGroup({
      slug: "fgsc_card",
      ...(localized ? { localized: true } : {}),
      fields: [text({ name: "heading" })],
    }),
  ],
});

/** The columns each field group's table showed the contributor's hook, by table. */
const seenColumns = new Map<string, string[]>();

/** A plugin adding a column to every field group's table, found by kind rather than by name. */
const contributor = definePlugin({
  name: "@test/field-group-contributor",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    schema: {
      extend: [
        ({ schema }) => {
          for (const table of schema.tables()) {
            const { owner } = table;
            if (owner.kind !== "entity" || owner.entityKind !== "component") {
              continue;
            }
            seenColumns.set(
              table.name,
              table.columns.map(column => column.name)
            );
            schema.extendTable(table.name, {
              columns: { searchKey: col.shortText({ nullable: true }) },
            });
          }
        },
      ],
    },
  },
});

const SILENT = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  newline: () => {},
};

let site: StorageGenerationSite | undefined;

afterEach(async () => {
  await site?.close();
  site = undefined;
  vi.unstubAllEnvs();
});

describe.each(getConfiguredTestDialects())(
  "after the field-group storage migration (%s)",
  dialect => {
    it("db:sync's translation pass creates a translatable group's fg_ translation table", async () => {
      site = await openStorageGenerationSite({
        dialect,
        loaded,
        localization: LOCALIZATION,
        legacy: true,
      });
      await site.developmentStart(declaredWith(false));
      expect((await site.migrateStorage()).ran).toBe(true);
      expect(await hasTable(site.adapter, "fg_fgsc_card_locales")).toBe(false);

      // The group becomes translatable, and `db:sync` runs its translation pass.
      const declared = declaredWith(true);
      await ensureLocalizedCompanions(
        defineConfig({
          collections: declared.collections,
          fieldGroups: declared.fieldGroups,
          localization: LOCALIZATION,
        }) as never,
        site.adapter as never,
        { logger: SILENT } as never
      );

      expect(await hasTable(site.adapter, "fg_fgsc_card_locales")).toBe(true);
      expect(await legacyObjects(site.adapter, dialect)).toEqual([]);
    });

    it("a plugin's column on every field group is declared on the group's fg_ table", async () => {
      site = await openStorageGenerationSite({ dialect, loaded, legacy: true });
      const declared = declaredWith(false);
      await site.developmentStart(declared);
      expect((await site.migrateStorage()).ran).toBe(true);

      // The plugin's contribution compiled as a start compiles it: each declared group under the
      // table the registry records for it, so the column is declared on the table the group is in.
      const config = {
        collections: declared.collections,
        fieldGroups: declared.fieldGroups,
      };
      const storage = await declaredFieldGroupStorage(
        site.adapter as never,
        config.fieldGroups
      );
      const schema = await compileExtensionSchema({
        dialect,
        plugins: [contributor],
        config,
        logger: SILENT,
        ...(storage === undefined
          ? {}
          : {
              fieldGroupTables: storage.tables,
              fieldGroupTypeColumns: storage.typeColumns,
            }),
      });

      const columnsOn = (table: string): string[] =>
        (schema?.entityColumns.get(table) ?? []).map(column => column.name);
      expect(columnsOn("fg_fgsc_card")).toContain("search_key");
      expect(columnsOn("comp_fgsc_card")).toEqual([]);
      // The table is seeded with the discriminator it holds, so a hook naming it is judged right.
      expect(seenColumns.get("fg_fgsc_card")).toContain("_field_group_type");
      expect(seenColumns.get("fg_fgsc_card")).not.toContain("_component_type");
      expect(await legacyObjects(site.adapter, dialect)).toEqual([]);
    });
  }
);
