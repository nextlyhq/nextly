/**
 * A translated many-to-many on a translated Single has its join table, on every dialect: a schema
 * save that adds the field creates it, one that points the field at another collection replaces
 * it, and one that removes the field drops it. A save that leaves the field alone leaves the table.
 *
 * A translated field has no column on the Single's own table, so the save's diff of that table
 * leaves it out, and the join tables were decided from the same shortened list. A collection's save
 * decides them from the whole list, which is what a Single's does too.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../config";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Slugs prefixed for this file (`stm_`), so the tables it owns are its own.
const HERO = "stm_hero";
const TAGS = "stm_tags";
const TOPICS = "stm_topics";
const TABLE = `single_${HERO}`;
const TITLE = { name: "title", type: "text" };
const tagsTo = (target: string) => ({
  name: "tags",
  type: "relationship",
  localized: true,
  options: { relationType: "manyToMany", target },
});
// The generator's convention: source and target table names sorted, then the field name.
const TO_TAGS = `dc_${TAGS}_${TABLE}_tags`;
const TO_TOPICS = `dc_${TOPICS}_${TABLE}_tags`;

describeEachDialect(
  "a translated Single's translated many-to-many",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      // The builder's update path runs its migration in development only.
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({ slug: TAGS, fields: [text({ name: "name" })] }),
          defineCollection({
            slug: TOPICS,
            fields: [text({ name: "name" })],
          }),
        ],
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
    });

    afterEach(async () => {
      await current.destroy();
      vi.unstubAllEnvs();
    });

    const exists = (table: string) => current.adapter.tableExists(table);

    async function createHero(fields: unknown[]): Promise<void> {
      await dispatchSingles(
        "createSingle",
        {},
        { slug: HERO, label: "Hero", localized: true, fields }
      );
    }

    async function save(fields: unknown[]): Promise<void> {
      await dispatchSingles("updateSingleSchema", { slug: HERO }, { fields });
    }

    it("is created with the Single", async () => {
      await createHero([TITLE, tagsTo(TAGS)]);

      expect(await exists(TO_TAGS)).toBe(true);
    });

    it("gets its join table when a save adds it", async () => {
      await createHero([TITLE]);
      expect(await exists(TO_TAGS)).toBe(false);

      await save([TITLE, tagsTo(TAGS)]);

      expect(await exists(TO_TAGS)).toBe(true);
    });

    it("keeps its join table through a save that leaves it alone", async () => {
      await createHero([TITLE, tagsTo(TAGS)]);

      await save([TITLE, { name: "body", type: "text" }, tagsTo(TAGS)]);

      expect(await exists(TO_TAGS)).toBe(true);
    });

    it("moves to a new join table when a save points it at another collection", async () => {
      await createHero([TITLE, tagsTo(TAGS)]);

      await save([TITLE, tagsTo(TOPICS)]);

      expect(await exists(TO_TOPICS)).toBe(true);
      expect(await exists(TO_TAGS)).toBe(false);
    });

    // A junction carried to a name the database already holds is refused before anything runs, as
    // a collection's is: met at apply, the rename would fail after the save's earlier statements.
    it.each([
      ["translated", true],
      ["not translated", false],
    ])(
      "refuses moving a %s many-to-many's join table onto a table that exists, changing nothing",
      async (_label, localized) => {
        const field = (junctionTable?: string) => ({
          ...tagsTo(TAGS),
          localized,
          options: {
            relationType: "manyToMany",
            target: TAGS,
            ...(junctionTable ? { junctionTable } : {}),
          },
        });
        await createHero([TITLE, field()]);
        expect(await exists(TO_TAGS)).toBe(true);
        const taken = "stm_hero_tag_links";
        const q = (name: string) =>
          dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
        await (
          current.adapter as unknown as {
            executeQuery(sql: string): Promise<unknown>;
          }
        ).executeQuery(`CREATE TABLE ${q(taken)} (${q("id")} varchar(36))`);

        const refused = await save([TITLE, field(taken)]).then(
          () => undefined,
          (error: unknown) => error
        );

        expect(refused).toMatchObject({
          publicData: {
            errors: [
              expect.objectContaining({ code: "JUNCTION_TABLE_IN_USE" }),
            ],
          },
        });
        expect(await exists(TO_TAGS)).toBe(true);
        expect(await exists(taken)).toBe(true);
      }
    );

    it("takes its join table with it when a save removes it", async () => {
      await createHero([TITLE, tagsTo(TAGS)]);
      // Positive control: there is a table to remove.
      expect(await exists(TO_TAGS)).toBe(true);

      await save([TITLE]);

      expect(await exists(TO_TAGS)).toBe(false);
    });
  }
);
