/**
 * A shared field inside a repeater or group made translated in the Schema Builder.
 *
 * A container keeping its text per language holds its shared values on its structure, every
 * language's, and each language's text in its overlay. A field already there made translated would
 * have its stored value read as text from then on: the first save in one language would take the
 * value for that language alone, off the structure, and every other language would read none.
 * Refused for now, naming the field, before anything changes. A new translated field added there
 * holds no value yet, and goes ahead.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import type { CollectionService } from "../../../collections/services/collection-service";

perLanguageStorageSuite();

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

const slides = (rank: Record<string, unknown>, extra: object[] = []) => ({
  name: "slides",
  type: "repeater",
  fields: [
    { name: "caption", type: "text" },
    { name: "rank", type: "number", localized: false, ...rank },
    ...extra,
  ],
});

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-turned-translated-"));
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  await instance?.destroy();
  instance = undefined;
  vi.unstubAllEnvs();
  await rm(basePath, { recursive: true, force: true });
});

describe.each(getConfiguredTestDialects())(
  "a shared field inside a container made translated (%s)",
  dialect => {
    async function boot(): Promise<TestNextly> {
      const t = await createTestNextly({
        dialect,
        basePath,
        db: DB,
        localization: LOCALIZATION,
      });
      instance = t;
      await t.getService("collectionService").createCollection(
        {
          name: "shows",
          label: "Show",
          localized: true,
          fields: [{ name: "title", type: "text" }, slides({})],
        } as Parameters<CollectionService["createCollection"]>[0],
        {}
      );
      await t.nextly.create({
        collection: "shows",
        locale: "en",
        data: { title: "Show", slides: [{ caption: "One", rank: 7 }] },
      });
      return t;
    }

    const save = (fields: unknown[]) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "shows" },
        { fields, confirmed: true, schemaVersion: 1, localized: true }
      );

    it("refuses it, naming the field, and changes nothing", async () => {
      const t = await boot();

      await expect(
        save([{ name: "title", type: "text" }, slides({ localized: true })])
      ).rejects.toMatchObject({
        code: "INVALID_INPUT",
        publicMessage: expect.stringMatching(/slides\.rank/),
      });

      const [read] = (
        await t.nextly.find({ collection: "shows", locale: "en" })
      ).items as { slides: { rank?: number }[] }[];
      expect(read?.slides[0]?.rank).toBe(7);
    });

    // The control: a translated field added there holds no value yet.
    it("lets a new translated field be added inside the container", async () => {
      await boot();
      await expect(
        save([
          { name: "title", type: "text" },
          slides({}, [{ name: "alt", type: "text" }]),
        ])
      ).resolves.toBeDefined();
    });
  }
);
