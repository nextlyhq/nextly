/**
 * A repeater or group renamed in the Schema Builder, on an entity that is not translated.
 *
 * Under per-language storage such an entity still keeps its translatable values per language, a
 * container's text inside among them: its structure on the main table, each language's text in its
 * overlay column on the translations table. Renamed in the schema dialog, the overlay follows its
 * structure, so the text reads back under the new name. Left behind, the old overlay is taken for
 * a removed container's and dropped, the new one starts empty, and the save answers 200 with every
 * language's text gone. Collections and Singles alike.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import type { CollectionService } from "../../../collections/services/collection-service";

// As every installation lays tables out: an entity that is not translated keeps its translatable
// values per language.
perLanguageStorageSuite();

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

const container = (name: string) => ({
  name,
  type: "group",
  fields: [
    { name: "label", type: "text" },
    { name: "size", type: "number" },
  ],
});
const VIEWS = { name: "views", type: "number" };

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-untranslated-rename-"));
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  await instance?.destroy();
  instance = undefined;
  vi.unstubAllEnvs();
  await rm(basePath, { recursive: true, force: true });
});

describe.each(getConfiguredTestDialects())(
  "a container renamed on an entity that is not translated (%s)",
  dialect => {
    const boot = async () => {
      instance = await createTestNextly({
        dialect,
        basePath,
        db: DB,
        localization: LOCALIZATION,
      });
      return instance;
    };

    it("keeps a collection's container text under its new name", async () => {
      const t = await boot();
      const service = t.getService("collectionService");
      await service.createCollection(
        {
          name: "boxes",
          label: "Box",
          fields: [container("box"), VIEWS],
        } as Parameters<CollectionService["createCollection"]>[0],
        {}
      );
      const created = await t.nextly.create({
        collection: "boxes",
        locale: "en",
        data: { box: { label: "Hello", size: 3 }, views: 7 },
      });
      const id = (created.item as { id: string }).id;
      // POPULATION CONTROL: the text reads back before the rename.
      expect(
        (
          (await t.nextly.findByID({
            collection: "boxes",
            id,
            locale: "en",
          })) as {
            box?: { label?: string };
          }
        ).box?.label
      ).toBe("Hello");

      await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "boxes" },
        {
          fields: [container("crate"), VIEWS],
          confirmed: true,
          schemaVersion: 1,
          renameResolutions: [
            {
              tableName: "dc_boxes",
              fromColumn: "box",
              toColumn: "crate",
              choice: "rename",
            },
          ],
        }
      );

      const read = (await t.nextly.findByID({
        collection: "boxes",
        id,
        locale: "en",
      })) as { crate?: { label?: string; size?: number } };
      expect(read.crate).toMatchObject({ label: "Hello", size: 3 });
    });

    it("keeps a Single's container text under its new name", async () => {
      const t = await boot();
      await dispatchSingles(
        "createSingle",
        {},
        { slug: "notice", label: "Notice", fields: [container("box"), VIEWS] }
      );
      const singles = t.getService("singleEntryService");
      const saved = await singles.update(
        "notice",
        { box: { label: "Hello", size: 3 }, views: 7, _overwrite: true },
        { overrideAccess: true, locale: "en" }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);

      await dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "notice" },
        {
          fields: [container("crate"), VIEWS],
          confirmed: true,
          renameResolutions: [
            {
              tableName: "single_notice",
              fromColumn: "box",
              toColumn: "crate",
              choice: "rename",
            },
          ],
          schemaVersion: (
            await t.getService("singleRegistryService").getSingle("notice")
          ).schemaVersion,
        }
      );

      const read = await singles.get("notice", {
        overrideAccess: true,
        locale: "en",
      } as never);
      expect(read.success, JSON.stringify(read)).toBe(true);
      expect(
        (read.data as { crate?: { label?: string; size?: number } }).crate
      ).toMatchObject({ label: "Hello", size: 3 });
    });
  }
);
