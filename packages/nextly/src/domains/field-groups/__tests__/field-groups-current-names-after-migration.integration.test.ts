/**
 * Once a site's field-group storage is migrated, every runtime path uses each group's stored
 * names and never derives, creates or targets a legacy one.
 *
 * Before this, the code-first sync derived `comp_<slug>` for every group. On a migrated site the
 * stored `fg_<slug>` never matched it, so the sync recorded an error and skipped the group on every
 * start and reload: an edit to a group's config stopped applying, the boot probe looked for a
 * `comp_` table, and the reload went on as if the registry had taken the edit.
 *
 * One site per dialect: it starts on the legacy names with a code-first group and content, then
 * migrates. Then, in order:
 *
 * - a development start carrying an edit to the code-first group applies it to the stored table
 *   and the registry, and says nothing about a legacy name;
 * - a configuration reload carrying a second edit applies it the same way;
 * - a translated group made in the Builder and then deleted has its translations and tables torn
 *   down under the stored names;
 * - a reset of the system tables drops the migrated registry, not the legacy one.
 *
 * After each step the database holds no legacy table, registry or discriminator column, and the
 * content still reads. `migrate:create`, `migrate:check` and `nextly migrate` are covered by their
 * own suite.
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

import { recordStatements } from "../../../__tests__/helpers/record-statements";
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { getConfiguredTestDialects } from "../../../plugins/test-nextly";
import { SystemTableService } from "../../../services/system/system-table-service";

import {
  columnsOf,
  fieldNamesOf,
  hasTable,
  legacyObjects,
  openStorageGenerationSite,
  recordingLogger,
  registryRowIn,
  type Declared,
  type StorageGenerationSite,
} from "./helpers/storage-generation-site";

const LOCALIZATION = { locales: ["en", "de"], defaultLocale: "en" };

const cardWith = (...extra: string[]) =>
  defineFieldGroup({
    slug: "fgcn_card",
    fields: [
      text({ name: "heading" }),
      ...extra.map(name => text({ name, localized: false })),
    ],
  });
const posts = defineCollection({
  slug: "fgcn_posts",
  fields: [
    text({ name: "title" }),
    fieldGroup({ name: "card", component: "fgcn_card" }),
  ],
});

const declaredWith = (...extra: string[]): Declared => ({
  collections: [posts],
  fieldGroups: [cardWith(...extra)],
});

/** Whether a statement names a legacy field-group object. */
const namesLegacy = (statement: string): boolean =>
  /\bcomp_fgcn_|\bdynamic_components\b|\b_component_type\b/i.test(statement);

let site: StorageGenerationSite | undefined;

afterEach(async () => {
  await site?.close();
  site = undefined;
  vi.unstubAllEnvs();
});

describe.each(getConfiguredTestDialects())(
  "every runtime path after the storage migration (%s)",
  dialect => {
    it("applies config edits, tears down and resets under the stored names only", async () => {
      site = await openStorageGenerationSite({
        dialect,
        loaded,
        localization: LOCALIZATION,
        legacy: true,
      });

      // The legacy site: a code-first group placed in a collection, with content in it.
      const first = await site.developmentStart(declaredWith());
      const created = await first.nextly.create({
        collection: "fgcn_posts" as never,
        data: { title: "P", card: { heading: "Kept" } } as never,
      });
      const id = (created.item as { id: string }).id;
      expect(await hasTable(site.adapter, "comp_fgcn_card")).toBe(true);

      expect((await site.migrateStorage()).ran).toBe(true);
      expect(await legacyObjects(site.adapter, dialect)).toEqual([]);

      const readHeading = async (): Promise<unknown> => {
        const read = (await site!.current!.nextly.findByID({
          collection: "fgcn_posts" as never,
          id: id as never,
        })) as { card?: { heading?: unknown } };
        return read.card?.heading;
      };

      // 1. A development start carrying an edit to the code-first group.
      const { logger, lines } = recordingLogger();
      await site.developmentStart(declaredWith("subtitle"), logger);
      expect(await columnsOf(site.adapter, dialect, "fg_fgcn_card")).toContain(
        "subtitle"
      );
      expect(
        fieldNamesOf(
          await registryRowIn(site.adapter, "dynamic_field_groups", "fgcn_card")
        )
      ).toContain("subtitle");
      // Neither the sync nor the boot probe speaks of a legacy name.
      expect(
        lines.filter(line => /comp_fgcn_|does not match the derived/.test(line))
      ).toEqual([]);
      expect(await legacyObjects(site.adapter, dialect)).toEqual([]);
      expect(await readHeading()).toBe("Kept");

      // 2. A configuration reload carrying a second edit.
      await site.configurationReload(declaredWith("subtitle", "caption"));
      expect(await columnsOf(site.adapter, dialect, "fg_fgcn_card")).toContain(
        "caption"
      );
      expect(
        fieldNamesOf(
          await registryRowIn(site.adapter, "dynamic_field_groups", "fgcn_card")
        )
      ).toContain("caption");
      expect(await legacyObjects(site.adapter, dialect)).toEqual([]);
      expect(await readHeading()).toBe("Kept");

      // 3. A translated group made in the Builder, then deleted: its translations are torn down
      // under the stored names.
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: "fgcn_note",
          label: "Note",
          localized: true,
          fields: [{ name: "body", type: "text", localized: true }],
        }
      );
      expect(await hasTable(site.adapter, "fg_fgcn_note_locales")).toBe(true);
      const deleting = await recordStatements(site.adapter, dialect);
      try {
        await site.current!.nextly.fieldGroups.delete({ slug: "fgcn_note" });
      } finally {
        deleting.uninstall();
      }
      expect(deleting.statements.filter(namesLegacy)).toEqual([]);
      expect(await hasTable(site.adapter, "fg_fgcn_note")).toBe(false);
      expect(await hasTable(site.adapter, "fg_fgcn_note_locales")).toBe(false);
      expect(await legacyObjects(site.adapter, dialect)).toEqual([]);

      // 4. A reset of the system tables drops the migrated registry.
      const resetting = await recordStatements(site.adapter, dialect);
      try {
        await new SystemTableService(
          site.adapter,
          logger as never
        ).dropSystemTables();
      } finally {
        resetting.uninstall();
      }
      expect(resetting.statements.filter(namesLegacy)).toEqual([]);
      expect(await hasTable(site.adapter, "dynamic_field_groups")).toBe(false);
      expect(await legacyObjects(site.adapter, dialect)).toEqual([]);
    });
  }
);
