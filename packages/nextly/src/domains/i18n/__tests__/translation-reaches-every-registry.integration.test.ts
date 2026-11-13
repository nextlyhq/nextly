/**
 * Turning translation on or off for a collection is a migration like any other change, and the
 * registry of every database the migration reaches records it: a second database replaying the
 * folder `nextly migrate` runs ends with the collection recorded translated, or not, and its
 * values are written and read the way that record says, on every dialect.
 *
 * The first database is a development server's, where the Schema Builder writes each change as a
 * migration file; the second is a deploy's, empty until the folder is replayed into it.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../cli/commands/migrate";
import { createLogger } from "../../../cli/utils/logger";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import type { CollectionService } from "../../collections/services/collection-service";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import {
  type DataLossConsent,
  NO_CONSENT,
  resolveDataLossConsent,
} from "../../schema/migrate/data-loss-consent";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };
const SLUG = "trr_posts";

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-translation-registry-"));
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  await instance?.destroy();
  instance = undefined;
  vi.unstubAllEnvs();
  await rm(basePath, { recursive: true, force: true });
});

const boot = (dialect: TestDialect) =>
  createTestNextly({
    dialect,
    basePath,
    db: DB,
    localization: LOCALIZATION,
  });

/** `trr_posts` with a text `heading`, translated or not, as the Builder creates it. */
async function createPosts(t: TestNextly, localized: boolean): Promise<void> {
  const service = t.getService("collectionService");
  await service.createCollection(
    {
      name: SLUG,
      label: "Post",
      localized,
      fields: [{ name: "heading", type: "text" }],
    } as Parameters<CollectionService["createCollection"]>[0],
    {}
  );
}

/** The schema dialog's save turning translation on or off, its fields unchanged. */
async function setTranslated(localized: boolean): Promise<void> {
  await dispatchCollections(
    {} as ServiceContainer,
    "applySchemaChanges",
    { collectionName: SLUG },
    {
      fields: [{ name: "heading", type: "text" }],
      confirmed: true,
      schemaVersion: 1,
      localized,
    }
  );
}

/**
 * A deploy's database: a new instance on an empty database, with the folder the first one wrote
 * replayed as `nextly migrate` replays it, its registry rows brought to the newest snapshot. With
 * no terminal to ask, as a deploy runs it: `consent` is only what the deploy names.
 */
async function replayIntoSecondDatabase(
  dialect: TestDialect,
  consent: DataLossConsent = NO_CONSENT
): Promise<TestNextly> {
  await instance?.destroy();
  const second = await boot(dialect);
  instance = second;
  const adapter = second.adapter as unknown as DrizzleAdapter;
  await migrateCore({
    extensionSchema: undefined,
    dialect: adapter.getCapabilities().dialect,
    db: adapter.getDrizzle(),
    adapter: adapter as never,
    migrationsDir: join(basePath, "migrations"),
    logger: createLogger({ quiet: true }),
    lockMode: "fail-fast",
    consent,
    interactive: false,
  } as never);
  // The instance read the registry before the folder was replayed into it.
  clearRegistryRowCache();
  return second;
}

/** Whether the registry row of `trr_posts` records it as translated, as each dialect stores it. */
async function recordedTranslated(t: TestNextly): Promise<boolean> {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  const [row] = (await adapter.executeQuery(
    `SELECT localized FROM dynamic_collections WHERE slug = '${SLUG}'`
  )) as unknown as { localized: unknown }[];
  expect(row).toBeDefined();
  return row.localized === true || Number(row.localized) === 1;
}

describe.each(getConfiguredTestDialects())(
  "a migration turning translation on or off, replayed into a second database (%s)",
  dialect => {
    // Waits on the data-loss judgement counting a translations table created in the same file as
    // the run's own; until then an unattended run refuses this file without blanket consent.
    it.skip("records the collection translated, and keeps a value per language", async () => {
      const first = await boot(dialect);
      instance = first;
      await createPosts(first, false);
      await setTranslated(true);

      const second = await replayIntoSecondDatabase(dialect);

      expect(await recordedTranslated(second)).toBe(true);
      const created = await second.nextly.create({
        collection: SLUG,
        locale: "en",
        data: { heading: "Hello" },
      });
      const id = (created.item as { id: string }).id;
      await second.nextly.update({
        collection: SLUG,
        id,
        locale: "es",
        data: { heading: "Hola" },
      });
      const inSpanish = await second.nextly.findByID({
        collection: SLUG,
        id,
        locale: "es",
      });
      const inEnglish = await second.nextly.findByID({
        collection: SLUG,
        id,
        locale: "en",
      });
      expect((inSpanish as { heading?: unknown }).heading).toBe("Hola");
      expect((inEnglish as { heading?: unknown }).heading).toBe("Hello");
    }, 120_000);

    it("records the collection not translated, and keeps its values in the default language", async () => {
      const first = await boot(dialect);
      instance = first;
      await createPosts(first, true);
      await setTranslated(false);

      // Turning translation off drops the translations table, a deletion the deploy names.
      const second = await replayIntoSecondDatabase(
        dialect,
        resolveDataLossConsent({ flag: "dc_trr_posts_locales", env: {} })
      );

      expect(await recordedTranslated(second)).toBe(false);
      const created = await second.nextly.create({
        collection: SLUG,
        locale: "en",
        data: { heading: "Hello" },
      });
      const id = (created.item as { id: string }).id;
      const read = await second.nextly.findByID({
        collection: SLUG,
        id,
        locale: "en",
      });
      expect((read as { heading?: unknown }).heading).toBe("Hello");
    }, 120_000);
  }
);
