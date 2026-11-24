/**
 * A field group's groups and repeaters keep one structure across languages, as a collection's do:
 * the structure on the instance's row, and each language's text inside them on that language's
 * translation row (its overlay), a repeater's rows keyed by their ids.
 *
 * What separates a correct field group from a broken one:
 *
 * - a group's text written in one language replacing another language's (one value for every
 *   language, as before field groups kept overlays);
 * - a repeater row removed in one language keeping its text in another language's overlay, to be
 *   read back by a row given the same id.
 *
 * Self-skips per dialect on the standard rule.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  group,
  repeater,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Field groups keep their text per language as every installation does (`storage-layout`).
perLanguageStorageSuite();

type Doc = Record<string, unknown>;

describe.each(getConfiguredTestDialects())(
  "a field group's groups and repeaters, translated (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    const SLUG = `fgol_${dialect.slice(0, 2)}`;
    const COLLECTION = `fgoh_${dialect.slice(0, 2)}`;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        localization: {
          locales: ["en", "es"],
          defaultLocale: "en",
          fallback: false,
        },
        fieldGroups: [
          defineFieldGroup({
            slug: SLUG,
            localized: true,
            fields: [
              text({ name: "heading" }),
              group({ name: "box", fields: [text({ name: "label" })] }),
              repeater({
                name: "items",
                fields: [text({ name: "caption" })],
              }),
            ],
          }),
        ],
        collections: [
          defineCollection({
            slug: COLLECTION,
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "badge", component: SLUG }),
            ],
          }),
        ],
      } as never);
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    const read = async (id: string, locale: string) =>
      (
        (await t.nextly.findByID({
          collection: COLLECTION,
          id,
          locale,
          depth: 1,
        } as never)) as Doc
      ).badge as Doc;

    it("keeps a group's text for each language, the same group in both", async () => {
      const { item } = await t.nextly.create({
        collection: COLLECTION,
        data: {
          title: "One",
          badge: { heading: "Hello", box: { label: "EN" } },
        },
      } as never);
      const id = String(item.id);
      const badge = String((await read(id, "en")).id);
      await t.nextly.update({
        collection: COLLECTION,
        id,
        locale: "es",
        data: {
          badge: { id: badge, heading: "Hola", box: { label: "ES" } },
          _overwrite: true,
        },
      } as never);

      expect(((await read(id, "en")).box as Doc).label).toBe("EN");
      expect(((await read(id, "es")).box as Doc).label).toBe("ES");
    });

    it("takes a removed row's text out of every language", async () => {
      const { item } = await t.nextly.create({
        collection: COLLECTION,
        data: {
          title: "Two",
          badge: {
            heading: "Hello",
            items: [{ caption: "one EN" }, { caption: "two EN" }],
          },
        },
      } as never);
      const id = String(item.id);
      const english = await read(id, "en");
      const badge = String(english.id);
      const [first, second] = english.items as Doc[];
      await t.nextly.update({
        collection: COLLECTION,
        id,
        locale: "es",
        data: {
          badge: {
            id: badge,
            heading: "Hola",
            items: [
              { id: first!.id, caption: "uno ES" },
              { id: second!.id, caption: "dos ES" },
            ],
          },
          _overwrite: true,
        },
      } as never);

      // The first row removed, in English.
      await t.nextly.update({
        collection: COLLECTION,
        id,
        locale: "en",
        data: {
          badge: {
            id: badge,
            heading: "Hello",
            items: [{ id: second!.id, caption: "two EN" }],
          },
          _overwrite: true,
        },
      } as never);

      // One structure: Spanish holds the remaining row alone, with its own text.
      const spanish = (await read(id, "es")).items as Doc[];
      expect(spanish.map(row => [row.id, row.caption])).toEqual([
        [second!.id, "dos ES"],
      ]);
      // And the removed row's text is gone from Spanish's overlay, not merely unread.
      const registry = t.getService("fieldGroupRegistryService");
      const { tableName } = await registry.getComponent(SLUG);
      const q = dialect === "mysql" ? "`" : '"';
      const rows = await t.adapter.executeQuery<{ items: unknown }>(
        `SELECT ${q}items${q} AS items FROM ${q}${tableName}_locales${q} WHERE ${q}_parent${q} = '${badge}' AND ${q}_locale${q} = 'es'`
      );
      expect(JSON.stringify(rows[0]?.items)).not.toContain(String(first!.id));
      expect(JSON.stringify(rows[0]?.items)).toContain(String(second!.id));
    });
  }
);
