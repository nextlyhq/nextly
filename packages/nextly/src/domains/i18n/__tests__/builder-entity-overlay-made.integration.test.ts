/**
 * The overlay column of a Schema Builder entity's container, made where it is missing.
 *
 * A site an earlier release built keeps a Builder collection's repeater whole on its main row,
 * with no overlay column on its translations table. Upgraded, the repeater keeps its text per
 * language in that column, so reads in every language need it there. The pass `nextly migrate`
 * and a production start run (`ensureLocalizedCompanions`) makes it, and seeds the default
 * language's text from the main row, for the entities in code and in the registries alike. Made
 * only for the entities in code, a Builder collection's reads failed in every language, while
 * `nextly migrate` said there was nothing to migrate.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { ensureLocalizedCompanions } from "../../../cli/commands/dev-build";
import type { CommandContext } from "../../../cli/program";
import { createLogger } from "../../../cli/utils/logger";
import { defineConfig } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { parsedValue } from "../../../shared/lib/json-column-value";
import type { CollectionService } from "../../collections/services/collection-service";

perLanguageStorageSuite();

const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };
const TABLE = "dc_bshows";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };

let t: TestNextly | undefined;
let basePath: string;
beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-builder-overlay-"));
  // As the Builder runs: each save is applied here.
  vi.stubEnv("NODE_ENV", "development");
});
afterEach(async () => {
  await t?.destroy();
  t = undefined;
  vi.unstubAllEnvs();
  await rm(basePath, { recursive: true, force: true });
});

describe.each(getConfiguredTestDialects())(
  "a Builder collection's container overlay missing (%s)",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    it("is made and seeded by the pass nextly migrate runs, and each language reads its text", async () => {
      t = await createTestNextly({
        dialect,
        basePath,
        db: DB,
        localization: LOCALIZATION,
      });
      await t.getService("collectionService").createCollection(
        {
          name: "bshows",
          label: "Show",
          localized: true,
          fields: [
            { name: "title", type: "text" },
            {
              name: "slides",
              type: "repeater",
              fields: [
                { name: "caption", type: "text" },
                { name: "rank", type: "number" },
              ],
            },
          ],
        } as Parameters<CollectionService["createCollection"]>[0],
        {}
      );
      const created = await t.nextly.create({
        collection: "bshows",
        locale: "en",
        data: { title: "Show", slides: [{ caption: "Hello", rank: 1 }] },
      });
      const id = (created.item as { id: string }).id;
      const [row] = (
        (await t.nextly.findByID({
          collection: "bshows",
          id,
          locale: "en",
        })) as {
          slides: { id: string }[];
        }
      ).slides;

      // As an earlier release left it: the repeater whole on the main row, no overlay column.
      const run = (statement: string) => t!.adapter.executeQuery(statement);
      await run(
        `ALTER TABLE ${q(`${TABLE}_locales`)} DROP COLUMN ${q("slides")}`
      );
      await run(
        `UPDATE ${q(TABLE)} SET ${q("slides")} = '${JSON.stringify([{ id: row!.id, caption: "Hello", rank: 1 }])}' WHERE ${q("id")} = '${id}'`
      );

      const logger = createLogger({ quiet: true });
      await ensureLocalizedCompanions(
        defineConfig({ localization: LOCALIZATION, collections: [] }) as never,
        t.adapter as never,
        { logger, options: {} } as unknown as CommandContext,
        "afterApply",
        { supervised: true }
      );

      const [english] = (await run(
        `SELECT ${q("slides")} AS slides FROM ${q(`${TABLE}_locales`)} WHERE ${q("_parent")} = '${id}' AND ${q("_locale")} = 'en'`
      )) as { slides: unknown }[];
      expect(JSON.stringify(parsedValue(english?.slides))).toContain("Hello");
    }, 120_000);
  }
);
