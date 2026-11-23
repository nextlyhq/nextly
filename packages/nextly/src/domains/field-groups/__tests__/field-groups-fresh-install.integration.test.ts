/**
 * A new site starts its field groups on the current names, so it never needs the storage
 * migration.
 *
 * Before this, the first start on an empty database created the legacy `dynamic_components`
 * registry, and every group after it was born `comp_<slug>` with a `_component_type` column:
 * storage every new site would one day have to migrate. And a database born on the current names
 * with no record of it made `migrate:field-groups` refuse, finding migrated names that no recorded
 * run accounted for, instead of saying there was nothing to do.
 *
 * Each case starts on an empty database, as `next dev` does the first time: the first start sets
 * the database up, the code-first sync creates the declared groups, and a group is then made
 * through the Direct API. Every dialect, each case on its own database.
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
import { getConfiguredTestDialects } from "../../../plugins/test-nextly";

import {
  columnsOf,
  hasTable,
  legacyObjects,
  openStorageGenerationSite,
  registryRowIn,
  type Declared,
  type StorageGenerationSite,
} from "./helpers/storage-generation-site";

const LOCALIZATION = { locales: ["en", "de"], defaultLocale: "en" };

const card = defineFieldGroup({
  slug: "fgfi_card",
  localized: true,
  fields: [text({ name: "heading" })],
});
const posts = defineCollection({
  slug: "fgfi_posts",
  fields: [
    text({ name: "title" }),
    fieldGroup({ name: "card", component: "fgfi_card" }),
  ],
});
const DECLARED: Declared = { collections: [posts], fieldGroups: [card] };

let site: StorageGenerationSite | undefined;

afterEach(async () => {
  await site?.close();
  site = undefined;
  vi.unstubAllEnvs();
});

describe.each(getConfiguredTestDialects())("a new site (%s)", dialect => {
  it("creates its registry and groups under the current names", async () => {
    site = await openStorageGenerationSite({
      dialect,
      loaded,
      localization: LOCALIZATION,
    });
    const started = await site.developmentStart(DECLARED);

    expect(await hasTable(site.adapter, "dynamic_field_groups")).toBe(true);
    expect(
      (await registryRowIn(site.adapter, "dynamic_field_groups", "fgfi_card"))
        ?.table_name
    ).toBe("fg_fgfi_card");
    expect(await columnsOf(site.adapter, dialect, "fg_fgfi_card")).toContain(
      "_field_group_type"
    );
    expect(await hasTable(site.adapter, "fg_fgfi_card_locales")).toBe(true);

    await started.nextly.fieldGroups.create({
      slug: "fgfi_direct",
      label: "Direct",
      fields: [{ name: "heading", type: "text" }],
    });
    expect(
      (await registryRowIn(site.adapter, "dynamic_field_groups", "fgfi_direct"))
        ?.table_name
    ).toBe("fg_fgfi_direct");

    // Content round-trips through the current-name storage.
    const created = await started.nextly.create({
      collection: "fgfi_posts" as never,
      data: { title: "P", card: { heading: "H" } } as never,
    });
    const read = (await started.nextly.findByID({
      collection: "fgfi_posts" as never,
      id: (created.item as { id: string }).id as never,
    })) as { card?: { heading?: unknown } };
    expect(read.card?.heading).toBe("H");

    expect(await legacyObjects(site.adapter, dialect)).toEqual([]);
  });

  it("records that its storage is on the current names, so the storage migration has nothing to do", async () => {
    site = await openStorageGenerationSite({
      dialect,
      loaded,
      localization: LOCALIZATION,
    });
    await site.developmentStart(DECLARED);

    expect(await site.marker()).toMatchObject({
      status: "settled",
      generation: "field-groups-v2",
      recorded: true,
    });
    expect(await site.migrateStorage({ dryRun: true })).toMatchObject({
      ran: false,
      reason: "already-migrated",
    });
    expect(await site.migrateStorage()).toMatchObject({
      ran: false,
      reason: "already-migrated",
    });
    expect(await legacyObjects(site.adapter, dialect)).toEqual([]);
  });

  it("a later start keeps the current names", async () => {
    site = await openStorageGenerationSite({
      dialect,
      loaded,
      localization: LOCALIZATION,
    });
    await site.developmentStart(DECLARED);
    await site.developmentStart(DECLARED);

    expect(await hasTable(site.adapter, "dynamic_field_groups")).toBe(true);
    expect(await legacyObjects(site.adapter, dialect)).toEqual([]);
  });
});
