/**
 * A development boot gives an existing site the per-document columns even when
 * the project has no migrations directory.
 *
 * The boot runs the core of `nextly migrate`, which adds them, only when there
 * are migrations to run; a project without a migrations directory and without
 * plugin migrations skips it. Its code-first tables would still get the
 * columns from the dev schema push, but a Schema Builder collection and every
 * translation table would not, and every read of them would then select a
 * column they lack. The site here holds both kinds, from before the columns.
 *
 * @module init/__tests__/dev-boot-document-columns.integration.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../config";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import { withSchemaLock } from "../../domains/schema/pipeline/schema-lock";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import type { CollectionsHandler } from "../../services/collections-handler";
import { runBootTimeApplyIfDev } from "../boot-apply";

// A project with no migrations directory and no plugins: the boot has no
// migrate run to make.
vi.mock("../../cli/utils/config-loader", () => ({
  loadConfig: async () => ({
    config: {
      db: { migrationsDir: "no-migrations-directory-here" },
      plugins: [],
    },
    deferredExtends: [],
  }),
}));

const PER_DOCUMENT_COLUMNS = [
  "_revision",
  "_changed_by_kind",
  "_changed_by_id",
  "_changed_by_principal_kind",
  "_changed_at",
];

const TABLES = [
  "dc_dev_posts",
  "dc_dev_posts_locales",
  "dc_dev_pages",
  "dc_dev_pages_locales",
];

// The boot applies only in development, and the Schema Builder creates its
// tables only there.
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
});

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  vi.unstubAllEnvs();
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "dev_posts",
        localized: true,
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  expect(current.adapter.dialect).toBe(dialect);
  return current;
}

const quote = (t: TestNextly, name: string) =>
  t.adapter.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

async function columnsOf(t: TestNextly, table: string): Promise<string[]> {
  const snapshot = await introspectLiveSnapshot(
    t.adapter.getDrizzle(),
    t.adapter.dialect as Parameters<typeof introspectLiveSnapshot>[1],
    [table]
  );
  return (
    snapshot.tables
      .find(spec => spec.name === table)
      ?.columns.map(column => column.name) ?? []
  );
}

describe.each(getConfiguredTestDialects())(
  "a development boot without migrations (%s)",
  dialect => {
    it("gives a Schema Builder collection and translation tables the columns, and reads them", async () => {
      const t = await boot(dialect);
      const handler = t.getService("collectionsHandler") as CollectionsHandler;
      const builder = await handler.createCollection({
        name: "dev_pages",
        label: "Page",
        localized: true,
        fields: [{ name: "heading", type: "text" }],
      });
      expect(builder.success, JSON.stringify(builder)).toBe(true);
      const entries = handler.getEntryService();
      const ids: Record<string, string> = {};
      for (const [slug, data] of [
        ["dev_posts", { title: "Hello" }],
        ["dev_pages", { heading: "Hi" }],
      ] as const) {
        const created = await entries.createEntry(
          { collectionName: slug, overrideAccess: true, locale: "en" },
          data
        );
        expect(created.success, JSON.stringify(created)).toBe(true);
        ids[slug] = String((created.data as { id: unknown }).id);
      }

      // A site from before the columns.
      for (const table of TABLES) {
        for (const column of PER_DOCUMENT_COLUMNS) {
          if (!(await columnsOf(t, table)).includes(column)) continue;
          await t.adapter.executeQuery(
            `ALTER TABLE ${quote(t, table)} DROP COLUMN ${quote(t, column)}`
          );
        }
      }

      await runBootTimeApplyIfDev({ caller: "test" });

      for (const table of TABLES) {
        expect({ [table]: await columnsOf(t, table) }).toEqual({
          [table]: expect.arrayContaining(PER_DOCUMENT_COLUMNS),
        });
      }
      for (const slug of ["dev_posts", "dev_pages"]) {
        const read = (await t.nextly.findByID({
          collection: slug as never,
          id: ids[slug],
          locale: "en",
          overrideAccess: true,
        } as never)) as Record<string, unknown>;
        expect({ [slug]: read._rev }).toEqual({ [slug]: "1.en:1" });
      }
    }, 240_000);

    it("waits for the schema lock another process holds before it alters a table", async () => {
      const t = await boot(dialect);
      for (const column of PER_DOCUMENT_COLUMNS) {
        await t.adapter.executeQuery(
          `ALTER TABLE ${quote(t, "dc_dev_posts")} DROP COLUMN ${quote(t, column)}`
        );
      }

      // Held as a migration or a Schema Builder save holds it, until released.
      let release!: () => void;
      const released = new Promise<void>(resolve => {
        release = resolve;
      });
      let holding!: () => void;
      const held = new Promise<void>(resolve => {
        holding = resolve;
      });
      const holder = withSchemaLock(
        {
          adapter: t.adapter as never,
          command: "test: a migration in progress",
          whenHeld: "wait",
        },
        async () => {
          holding();
          await released;
        }
      );
      await held;

      const booting = runBootTimeApplyIfDev({ caller: "test" });
      await new Promise(resolve => setTimeout(resolve, 1_500));
      // Still waiting: nothing altered while the lock is held.
      expect(await columnsOf(t, "dc_dev_posts")).not.toContain("_revision");

      release();
      await holder;
      await booting;
      expect(await columnsOf(t, "dc_dev_posts")).toEqual(
        expect.arrayContaining(PER_DOCUMENT_COLUMNS)
      );
    }, 240_000);
  }
);
