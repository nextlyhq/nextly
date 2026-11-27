/**
 * A field group placed inline, inside a collection's repeater, has its text kept per language
 * apart from the repeater's structure, by the field group's fields as they are. Turning one of
 * those fields translated or shared converts none of the rows already stored, so the edit is
 * refused before anything changes, naming the field and where the field group is placed. Placed
 * only at a collection's own level, in its own table, the same edit goes through.
 *
 * The plausible broken version: the edit applied, the stored rows left as they were, so the text
 * every language reads is stripped on the next save, or stops being read at once.
 */
import { afterEach, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  number,
  repeater,
  text,
} from "../../../config";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { FieldGroupMetadataService } from "../services/field-group-metadata-service";

// Written for per-language storage, as every installation now runs it.
perLanguageStorageSuite();

/** Booting a site takes most of the default timeout on MySQL alone. */
const BOOT_TIMEOUT = 90_000;

const CARD = defineFieldGroup({
  slug: "inlinecard",
  fields: [text({ name: "label" }), number({ name: "size" })],
});
const BADGE = defineFieldGroup({
  slug: "directbadge",
  fields: [text({ name: "mark" })],
});

const PAGES = defineCollection({
  slug: "inlinepages",
  localized: true,
  fields: [
    text({ name: "title" }),
    repeater({
      name: "panels",
      fields: [
        number({ name: "position" }),
        fieldGroup({ name: "card", component: "inlinecard" }),
      ],
    }),
    fieldGroup({ name: "badge", component: "directbadge" }),
  ],
});

describeEachDialect(
  "a field group's field turned translated or shared",
  dialect => {
    let t: TestNextly | undefined;

    afterEach(async () => {
      await t?.destroy();
      t = undefined;
    }, BOOT_TIMEOUT);

    const update = (slug: string, fields: unknown[]) =>
      new FieldGroupMetadataService(
        t!.getService("fieldGroupRegistryService"),
        t!.getService("logger"),
        t!.adapter as never
      ).updateFieldGroup({ slug, fields: fields as never, source: "code" });

    it(
      "refuses it while the field group is placed inline, naming the field and where",
      async () => {
        t = await createTestNextly({
          dialect,
          collections: [PAGES],
          fieldGroups: [CARD, BADGE],
          localization: { locales: ["en", "es"], defaultLocale: "en" },
        });

        const refusal = await update("inlinecard", [
          text({ name: "label", localized: false }),
          number({ name: "size" }),
        ]).then(
          () => undefined,
          (error: unknown) => error
        );

        expect(refusal).toBeInstanceOf(Error);
        expect((refusal as { publicMessage?: string }).publicMessage).toMatch(
          /"label" of the field group "inlinecard".*the collection "inlinepages" \(panels\.card\)/
        );
      },
      BOOT_TIMEOUT
    );

    it(
      "lets it through where the field group is placed only at a collection's own level",
      async () => {
        t = await createTestNextly({
          dialect,
          collections: [PAGES],
          fieldGroups: [CARD, BADGE],
          localization: { locales: ["en", "es"], defaultLocale: "en" },
        });

        await expect(
          update("directbadge", [text({ name: "mark", localized: false })])
        ).resolves.toBeDefined();
      },
      BOOT_TIMEOUT
    );
  }
);
