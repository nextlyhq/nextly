/**
 * A field group created after a site's storage was migrated is created under the current names,
 * whichever way it is made, so the storage migration finds nothing to do when it runs again.
 *
 * Before this, a new group was always born `comp_<slug>` with a `_component_type` column, inside
 * the migrated `dynamic_field_groups` registry. Re-running `migrate:field-groups` then refused:
 * the migrated registry referenced storage that was not on the migrated names.
 *
 * Each way a group is made is a case of its own: declared in code and picked up by a development
 * start, created in the Schema Builder (the dispatcher it posts to), and created through the
 * Direct API. The REST route shares the dispatcher's implementation
 * (`field-group-create-transports`). An unmigrated site is the control: a group created there
 * stays on the legacy names, because that site has not moved.
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
  columnsOf,
  hasTable,
  legacyObjects,
  openStorageGenerationSite,
  registryRowIn,
  type Declared,
  type StorageGenerationSite,
} from "./helpers/storage-generation-site";

const card = defineFieldGroup({
  slug: "fgca_card",
  fields: [text({ name: "heading" })],
});
const badge = defineFieldGroup({
  slug: "fgca_badge",
  fields: [text({ name: "label" })],
});
const posts = defineCollection({
  slug: "fgca_posts",
  fields: [
    text({ name: "title" }),
    fieldGroup({ name: "card", component: "fgca_card" }),
  ],
});

const BEFORE: Declared = { collections: [posts], fieldGroups: [card] };
const WITH_BADGE: Declared = {
  collections: [posts],
  fieldGroups: [card, badge],
};

const FIELDS = [{ name: "heading", type: "text" }];

let site: StorageGenerationSite | undefined;

afterEach(async () => {
  await site?.close();
  site = undefined;
  vi.unstubAllEnvs();
});

describe.each(getConfiguredTestDialects())(
  "a field group created after the storage migration (%s)",
  dialect => {
    /** A site that started on the legacy names, held content, and was migrated. */
    async function migratedSite(): Promise<StorageGenerationSite> {
      site = await openStorageGenerationSite({ dialect, loaded, legacy: true });
      const first = await site.developmentStart(BEFORE);
      await first.nextly.create({
        collection: "fgca_posts" as never,
        data: { title: "P", card: { heading: "H" } } as never,
      });
      // The legacy start this suite migrates from.
      expect(await hasTable(site.adapter, "comp_fgca_card")).toBe(true);
      const outcome = await site.migrateStorage();
      expect(outcome.ran).toBe(true);
      expect(await legacyObjects(site.adapter, dialect)).toEqual([]);
      return site;
    }

    /** The current-name storage a group created on a migrated site must have. */
    async function expectCurrentNames(slug: string): Promise<void> {
      const row = await registryRowIn(
        site!.adapter,
        "dynamic_field_groups",
        slug
      );
      expect(row?.table_name).toBe(`fg_${slug}`);
      expect(await hasTable(site!.adapter, `fg_${slug}`)).toBe(true);
      const columns = await columnsOf(site!.adapter, dialect, `fg_${slug}`);
      expect(columns).toContain("_field_group_type");
      expect(columns).not.toContain("_component_type");
    }

    it("a group declared in code is created under the current names at the next start", async () => {
      await migratedSite();
      await site!.developmentStart(WITH_BADGE);

      await expectCurrentNames("fgca_badge");
      expect(await legacyObjects(site!.adapter, dialect)).toEqual([]);
    });

    it("a group made in the Schema Builder is created under the current names", async () => {
      await migratedSite();
      await site!.developmentStart(BEFORE);

      await dispatchComponents(
        "createComponent",
        {},
        { slug: "fgca_builder", label: "Builder", fields: FIELDS }
      );

      await expectCurrentNames("fgca_builder");
      expect(await legacyObjects(site!.adapter, dialect)).toEqual([]);
    });

    it("a group made through the Direct API is created under the current names", async () => {
      await migratedSite();
      const started = await site!.developmentStart(BEFORE);

      await started.nextly.fieldGroups.create({
        slug: "fgca_direct",
        label: "Direct",
        fields: FIELDS,
      });

      await expectCurrentNames("fgca_direct");
      expect(await legacyObjects(site!.adapter, dialect)).toEqual([]);
    });

    it("the storage migration then finds nothing to do", async () => {
      await migratedSite();
      const started = await site!.developmentStart(WITH_BADGE);
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "fgca_builder", label: "Builder", fields: FIELDS }
      );
      await started.nextly.fieldGroups.create({
        slug: "fgca_direct",
        label: "Direct",
        fields: FIELDS,
      });

      // The preview first, as an operator runs it, then the apply.
      expect(await site!.migrateStorage({ dryRun: true })).toMatchObject({
        ran: false,
        reason: "already-migrated",
      });
      expect(await site!.migrateStorage()).toMatchObject({
        ran: false,
        reason: "already-migrated",
      });
      expect(await legacyObjects(site!.adapter, dialect)).toEqual([]);
    });

    // The control: a site that has not migrated keeps creating on the legacy names.
    it("on a site that has not migrated, a new group stays on the legacy names", async () => {
      site = await openStorageGenerationSite({ dialect, loaded, legacy: true });
      await site.developmentStart(BEFORE);
      await site.developmentStart(WITH_BADGE);
      await dispatchComponents(
        "createComponent",
        {},
        { slug: "fgca_builder", label: "Builder", fields: FIELDS }
      );

      for (const slug of ["fgca_badge", "fgca_builder"]) {
        const row = await registryRowIn(
          site.adapter,
          "dynamic_components",
          slug
        );
        expect(row?.table_name).toBe(`comp_${slug}`);
        expect(
          await columnsOf(site.adapter, dialect, `comp_${slug}`)
        ).toContain("_component_type");
      }
      expect(await hasTable(site.adapter, "dynamic_field_groups")).toBe(false);
    });
  }
);
