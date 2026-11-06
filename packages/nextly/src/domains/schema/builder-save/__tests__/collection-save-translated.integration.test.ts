/**
 * A field change on a translated collection keeps the development push it has always had, and is
 * also written as the migration `migrate:create` would write for it: once the push has run, the
 * file is recorded applied, and an empty database replaying the folder ends with the same tables,
 * on every dialect.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import type { CollectionService } from "../../../collections/services/collection-service";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { NO_CONSENT } from "../../migrate/data-loss-consent";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-translated-save-"));
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  await instance?.destroy();
  instance = undefined;
  vi.unstubAllEnvs();
  await rm(basePath, { recursive: true, force: true });
});

const boot = (dialect: TestDialect) =>
  createTestNextly({ dialect, basePath, db: DB, localization: LOCALIZATION });

/** The columns of each of `tables`, as the database has them. */
async function tablesOf(
  t: TestNextly,
  tables: string[]
): Promise<Record<string, string[]>> {
  const adapter = t.adapter as unknown as DrizzleAdapter;
  const live = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    adapter.getCapabilities().dialect,
    tables
  );
  return Object.fromEntries(
    live.tables.map(table => [
      table.name,
      table.columns.map(c => c.name).sort(),
    ])
  );
}

describe.each(getConfiguredTestDialects())(
  "a translated collection's field change (%s)",
  dialect => {
    it("pushes the rename in development, records its migration applied, and replays to the same tables", async () => {
      const t = await boot(dialect);
      instance = t;
      const service = t.getService("collectionService");
      await service.createCollection(
        {
          name: "posts",
          label: "Post",
          localized: true,
          fields: [
            { name: "heading", type: "text" },
            { name: "views", type: "number" },
          ],
        } as Parameters<CollectionService["createCollection"]>[0],
        {}
      );
      await t.nextly.create({
        collection: "posts",
        locale: "en",
        data: { heading: "Hello", views: 7 },
      });

      await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields: [
            { name: "title2", type: "text" },
            { name: "views", type: "number" },
          ],
          confirmed: true,
          schemaVersion: 1,
          localized: true,
          renameResolutions: [
            {
              tableName: "dc_posts_locales",
              fromColumn: "heading",
              toColumn: "title2",
              choice: "rename",
            },
          ],
        }
      );

      // The push ran: the translated value is under its new name.
      const read = await t.nextly.find({
        collection: "posts",
        locale: "en",
      });
      expect((read.items[0] as { title2?: string } | undefined)?.title2).toBe(
        "Hello"
      );

      // The change is a migration of its own, recorded applied.
      const folder = join(basePath, "migrations");
      const files = readdirSync(folder)
        .filter(f => f.endsWith(".sql"))
        .sort();
      expect(files.some(f => f.endsWith("_posts_update.sql"))).toBe(true);
      const adapter = t.adapter as unknown as DrizzleAdapter;
      const repo = new SchemaEventsRepository(
        adapter.getDrizzle(),
        adapter.getCapabilities().dialect
      );
      expect(
        (await repo.listFileApplies())
          .filter(row => row.status === "applied")
          .map(row => row.filename)
          .sort()
      ).toEqual(files);
      const here = await tablesOf(t, ["dc_posts", "dc_posts_locales"]);

      // A deploy's database, with a post written before the rename: replaying
      // the folder renames its translated column, so the value is kept under
      // the new name, and its tables end as here.
      await t.destroy();
      instance = await boot(dialect);
      const fresh = instance.adapter as unknown as DrizzleAdapter;
      const replay = (step?: number) =>
        migrateCore({
          ...(step === undefined ? {} : { step }),
          extensionSchema: undefined,
          dialect: fresh.getCapabilities().dialect,
          db: fresh.getDrizzle(),
          adapter: fresh as never,
          migrationsDir: folder,
          logger: createLogger({ quiet: true }),
          lockMode: "fail-fast",
          consent: NO_CONSENT,
          interactive: false,
        } as never);
      const beforeRename = files.findIndex(f =>
        f.endsWith("_posts_update.sql")
      );
      await replay(beforeRename);
      await fresh.executeQuery(
        "INSERT INTO dc_posts (id, title, slug, views, created_at, updated_at) VALUES ('p1', 'T', 'p1', 7, '2026-11-06 00:00:00', '2026-11-06 00:00:00')"
      );
      await fresh.executeQuery(
        "INSERT INTO dc_posts_locales (_parent, _locale, heading) VALUES ('p1', 'en', 'Hello')"
      );
      await replay();
      expect(
        await tablesOf(instance, ["dc_posts", "dc_posts_locales"])
      ).toEqual(here);
      const kept = (await fresh.executeQuery(
        "SELECT title2 FROM dc_posts_locales"
      )) as unknown as { title2: string }[];
      expect(kept.map(r => r.title2)).toEqual(["Hello"]);
    });
  }
);
