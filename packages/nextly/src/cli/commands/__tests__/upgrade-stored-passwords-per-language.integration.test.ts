/**
 * `nextly upgrade` finds a password stored as given where its container keeps it under
 * per-language storage. A group keeps one structure in every language: its shared values, a
 * password among them (never translated), on the main table, and only its text, each language's,
 * on the per-language row beside it. So a password stored as given is found on the main table,
 * whatever the group's text does.
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
              // Its text kept per language beside its structure, its password in the structure.
              group({
                name: "secret",
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

    it("counts a password stored as given in a group whose text is kept per language", async () => {
      const created = await t.nextly.create({
        collection: "pwnotes",
        data: { title: "n", secret: { label: "a", pin: "x" } },
      });
      const id = (created.item as { id: string }).id;
      // As an earlier release left it: the password as given, not hashed, in the group's structure.
      const plain = { label: "a", pin: "stored-plain" };
      await t.adapter.update(
        "dc_pwnotes",
        { secret: dialect === "sqlite" ? JSON.stringify(plain) : plain },
        { and: [{ column: "id", op: "=", value: id }] }
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
