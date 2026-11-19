/**
 * An edit to a code-first field group applies at the next development start, on every dialect.
 *
 * The start judges each group's change before it applies it, comparing the live table with the
 * table the configuration describes. That description was built as a collection's table, whose
 * timestamps MySQL types `timestamp`, while a field group's table is created with `datetime`
 * ones. So on MySQL every edit read as a type change to `created_at` and `updated_at`, was set
 * aside as needing review, and never applied, whatever the edit was. The description is now built
 * as a field group's table, as the apply builds it.
 *
 * A site that has not migrated its field-group storage, so the judgement is the only thing under
 * test; the migrated case is `field-groups-current-names-after-migration`. Every dialect, each on
 * its own database.
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
  fieldNamesOf,
  openStorageGenerationSite,
  recordingLogger,
  registryRowIn,
  type Declared,
  type StorageGenerationSite,
} from "./helpers/storage-generation-site";

const declaredWith = (...extra: string[]): Declared => ({
  collections: [
    defineCollection({
      slug: "fgea_posts",
      fields: [
        text({ name: "title" }),
        fieldGroup({ name: "card", component: "fgea_card" }),
      ],
    }),
  ],
  fieldGroups: [
    defineFieldGroup({
      slug: "fgea_card",
      fields: [text({ name: "heading" }), ...extra.map(name => text({ name }))],
    }),
  ],
});

let site: StorageGenerationSite | undefined;

afterEach(async () => {
  await site?.close();
  site = undefined;
  vi.unstubAllEnvs();
});

describe.each(getConfiguredTestDialects())(
  "a code-first field group edited between starts (%s)",
  dialect => {
    it("applies the edit at the next development start", async () => {
      site = await openStorageGenerationSite({ dialect, loaded, legacy: true });
      await site.developmentStart(declaredWith());

      const { logger, lines } = recordingLogger();
      await site.developmentStart(declaredWith("subtitle"), logger);

      expect(
        await columnsOf(site.adapter, dialect, "comp_fgea_card")
      ).toContain("subtitle");
      expect(
        fieldNamesOf(
          await registryRowIn(site.adapter, "dynamic_components", "fgea_card")
        )
      ).toContain("subtitle");
      // Not set aside for review: the judgement found nothing it could not apply.
      expect(lines.filter(line => /needs review/.test(line))).toEqual([]);
    });
  }
);
