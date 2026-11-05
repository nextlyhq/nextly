/**
 * `nextly upgrade` finds a password stored as given wherever its container is stored: under
 * `experimental.perLanguageStorage`, a translatable group of an entity that is not itself
 * translated lives on its per-language row, not on the main table, and is scanned there.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection, group, password, text } from "../../../config";
import { countPasswordsStoredAsGiven } from "../../../domains/field-groups/stored-plain-passwords";
import { _resetPerLanguageStorage } from "../../../domains/i18n/per-language-storage";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { consoleLogger } from "../../../services/shared";
import { installRegistryResolver } from "../../utils/registry-resolver";

describe.each(getConfiguredTestDialects())(
  "nextly upgrade under per-language storage (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        perLanguageStorage: true,
        collections: [
          defineCollection({
            slug: "pwnotes",
            fields: [
              text({ name: "title" }),
              // Translatable, on a collection that is not: its values live per language only
              // because of the setting.
              group({
                name: "secret",
                localized: true,
                fields: [text({ name: "label" }), password({ name: "pin" })],
              }),
            ],
          }),
        ],
      });
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
      _resetPerLanguageStorage();
    });

    it("counts a password stored as given in a container kept on the per-language row", async () => {
      const created = await t.nextly.create({
        collection: "pwnotes",
        data: { title: "n", secret: { label: "a", pin: "x" } },
      });
      const id = (created.item as { id: string }).id;
      // As an earlier release left it: the password as given, not hashed.
      const plain = { label: "a", pin: "stored-plain" };
      await t.adapter.update(
        "dc_pwnotes_locales",
        { secret: dialect === "sqlite" ? JSON.stringify(plain) : plain },
        { and: [{ column: "_parent", op: "=", value: id }] }
      );

      const counted = await countPasswordsStoredAsGiven({
        adapter: t.adapter,
        registry: installRegistryResolver(t.adapter),
        logger: consoleLogger,
      });
      expect(counted).toEqual(
        expect.arrayContaining([
          { kind: "collection", slug: "pwnotes", count: 1 },
        ])
      );
    }, 120_000);
  }
);
