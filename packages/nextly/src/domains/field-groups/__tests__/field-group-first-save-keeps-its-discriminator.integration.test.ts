/**
 * The first Schema Builder save of a field group whose table has no migration history keeps the
 * type column the table has. On a site whose storage was migrated that column is
 * `_field_group_type`, whatever the table is called.
 *
 * The save adopts such a table as it stands and lists every difference from what Nextly declares
 * as a conversion to confirm. A table under a name of its own (one no slug derives) was compared
 * with a declaration that guessed its type column from the name, so it named `_component_type`,
 * and the review offered to add that column and remove `_field_group_type`, with its values.
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

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { getConfiguredTestDialects } from "../../../plugins/test-nextly";
import {
  execOn,
  withNoHistory,
} from "../../schema/builder-save/__tests__/helpers/older-table";

import {
  columnsOf,
  hasTable,
  openStorageGenerationSite,
  type Declared,
  type StorageGenerationSite,
} from "./helpers/storage-generation-site";

const card = defineFieldGroup({
  slug: "fgfs_card",
  fields: [text({ name: "heading" })],
});
const posts = defineCollection({
  slug: "fgfs_posts",
  fields: [
    text({ name: "title" }),
    fieldGroup({ name: "card", component: "fgfs_card" }),
  ],
});
const DECLARED: Declared = { collections: [posts], fieldGroups: [card] };

const FIELDS = [{ name: "heading", type: "text" }];
const WITH_EXTRA = [...FIELDS, { name: "extra", type: "text" }];

/** The name of its own the group's table is moved to: no slug derives it. */
const OWN_NAME = "fgfs_banner_rows";

let site: StorageGenerationSite | undefined;

afterEach(async () => {
  await site?.close();
  site = undefined;
  vi.unstubAllEnvs();
});

describe.each(getConfiguredTestDialects())(
  "the first Builder save of a field group's table under a name of its own, after the storage migration (%s)",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    it("names no conversion of its type column", async () => {
      site = await openStorageGenerationSite({ dialect, loaded, legacy: true });
      await site.developmentStart(DECLARED);
      expect((await site.migrateStorage()).ran).toBe(true);
      const started = await site.developmentStart(DECLARED);

      // A Builder group, its table moved to a name of its own and its history forgotten, as a
      // table an earlier version kept under such a name has none.
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "fgfs_banner", label: "Banner", fields: FIELDS }
      );
      const exec = execOn(started);
      await exec(`ALTER TABLE ${q("fg_fgfs_banner")} RENAME TO ${q(OWN_NAME)}`);
      await exec(
        `UPDATE ${q("dynamic_field_groups")} SET ${q("table_name")} = '${OWN_NAME}' WHERE ${q("slug")} = 'fgfs_banner'`
      );
      await withNoHistory(started, dialect);
      expect(await hasTable(site.adapter, OWN_NAME)).toBe(true);
      expect(await columnsOf(site.adapter, dialect, OWN_NAME)).toContain(
        "_field_group_type"
      );

      const response = await dispatchComponents(
        "previewComponentSchemaChanges",
        { slug: "fgfs_banner" },
        { fields: WITH_EXTRA }
      );
      const read = (await (response as Response).json()) as {
        data?: { conversions?: { column: string; change: string }[] };
        conversions?: { column: string; change: string }[];
      };
      const conversions = (read.data ?? read).conversions ?? [];

      expect(
        conversions.filter(c =>
          ["_component_type", "_field_group_type"].includes(c.column)
        )
      ).toEqual([]);
    });
  }
);
