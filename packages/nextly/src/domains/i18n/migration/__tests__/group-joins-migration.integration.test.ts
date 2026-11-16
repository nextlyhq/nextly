/**
 * A group field that gains fields and becomes translated, through the migrations
 * `nextly migrate:create` writes and the real runner, on every dialect: how an
 * extension's group changes when the extension upgrades, as a plugin adding an
 * SEO group of five fields, shared, did before it kept the group per language
 * with four more.
 *
 * On an entity that is not translated, the group stays one value on the main
 * table, and every value in it is kept: the new fields live inside the stored
 * value, so the migration changes nothing about it. On a translated entity the
 * group's value becomes the default language's, every field of it, for a draft
 * entry and a published one alike, and nothing else moves.
 *
 * Each case runs on a database of its own, as the runner refuses one holding
 * tables it did not make.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runFileMigrations } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { installRegistryResolver } from "../../../../cli/utils/registry-resolver";
import { loadDialectTables } from "../../../../database/dialect-tables";
import { reconcileCore } from "../../../schema/migrate/core-reconcile";
import {
  generateMigration,
  type MinimalConfigEntity,
  type MinimalConfigField,
} from "../../../schema/migrate-create/generate";
import {
  createScratchDatabase,
  type ScratchDatabase,
} from "../../../../__tests__/helpers/fresh-database";

interface TestAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery<T = unknown>(sql: string): Promise<T[]>;
  getDrizzle<T = unknown>(): T;
}

const DIALECTS: {
  dialect: SupportedDialect;
  url: string | null;
  make: (url: string) => TestAdapter;
}[] = [
  {
    dialect: "postgresql",
    url: process.env.TEST_POSTGRES_URL ?? null,
    make: url => createPostgresAdapter({ url }) as unknown as TestAdapter,
  },
  {
    dialect: "mysql",
    url: process.env.TEST_MYSQL_URL ?? null,
    make: url => createMySqlAdapter({ url }) as unknown as TestAdapter,
  },
  {
    dialect: "sqlite",
    url: "memory",
    make: () => createSqliteAdapter({ memory: true }) as unknown as TestAdapter,
  },
];

const quiet = createLogger({ quiet: true });

/** The group as the extension declared it first: five fields, shared. */
const BEFORE: MinimalConfigField = {
  name: "seo",
  type: "group",
  fields: [
    { name: "metaTitle", type: "text", maxLength: 60 },
    { name: "metaDescription", type: "textarea", maxLength: 160 },
    { name: "ogImage", type: "upload", relationTo: "media" },
    { name: "canonical", type: "text" },
    { name: "noindex", type: "checkbox", defaultValue: false },
  ],
};

/** The group as the extension declares it now: four more fields, per language. */
const AFTER: MinimalConfigField = {
  ...BEFORE,
  localized: true,
  fields: [
    { name: "metaTitle", type: "text", maxLength: 60 },
    { name: "metaDescription", type: "textarea", maxLength: 160 },
    { name: "socialTitle", type: "text" },
    { name: "socialDescription", type: "textarea" },
    { name: "ogImage", type: "upload", relationTo: "media" },
    { name: "canonical", type: "text" },
    { name: "canonicalElsewhere", type: "checkbox", defaultValue: false },
    { name: "noindex", type: "checkbox", defaultValue: false },
    { name: "structuredDataType", type: "text" },
  ],
};

/** A value in every field the group had, different on each entry. */
const valueOf = (entry: string) => ({
  metaTitle: `Title of ${entry}`,
  metaDescription: `Description of ${entry}`,
  ogImage: `media-${entry}`,
  canonical: `https://example.com/${entry}`,
  noindex: entry === "draft",
});

/** A stored group read back as an object, however the dialect returns it. */
function groupOf(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

for (const entry of DIALECTS) {
  const suite = entry.url === null ? describe.skip : describe;

  suite(
    `a group gaining fields and becoming translated through migrations (${entry.dialect})`,
    () => {
      const { dialect } = entry;
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

      let adapter: TestAdapter;
      let scratch: ScratchDatabase | null = null;
      let migrationsDir: string;
      let slug: string;
      let table: string;
      let created = 0;

      beforeEach(async () => {
        const tag = randomBytes(4).toString("hex");
        slug = `pages${tag}`;
        table = `dc_pages${tag}`;
        created = 0;
        scratch =
          dialect === "sqlite"
            ? null
            : await createScratchDatabase(dialect, "group_joins");
        adapter = entry.make(scratch?.url ?? entry.url ?? "");
        await adapter.connect();
        await loadDialectTables(dialect);
        installRegistryResolver(adapter as unknown as DrizzleAdapter);
        await reconcileCore({
          db: adapter.getDrizzle(),
          dialect,
          logger: { info: () => {}, warn: () => {} },
        });
        migrationsDir = await mkdtemp(join(tmpdir(), "nextly-group-joins-"));
      });

      afterEach(async () => {
        try {
          await adapter.disconnect();
        } finally {
          await scratch?.drop();
          scratch = null;
          await rm(migrationsDir, { recursive: true, force: true });
        }
      });

      /** `nextly migrate:create`, then `nextly migrate`, for the entity as it is now. */
      async function migrateTo(entity: MinimalConfigEntity): Promise<void> {
        created += 1;
        await generateMigration({
          name: `${slug}_${created}`,
          dialect,
          migrationsDir,
          defaultLocale: "en",
          collections: [entity],
          singles: [],
          components: [],
          nonInteractive: true,
          now: new Date(Date.UTC(2026, 10, 11, 10, created)),
        });
        await runFileMigrations({
          adapter: adapter as never,
          db: adapter.getDrizzle(),
          dialect,
          migrationsDir,
          logger: quiet,
        });
      }

      /** The entity with `group` as its group, translated or not. */
      const entity = (
        group: MinimalConfigField,
        localized: boolean
      ): MinimalConfigEntity => ({
        slug,
        tableName: table,
        status: true,
        localized,
        fields: [{ name: "headline", type: "text", localized }, group],
      });

      /** A draft and a published entry, each with a value in every field of the group. */
      async function seed(): Promise<void> {
        for (const [id, status] of [
          ["draft", "draft"],
          ["live", "published"],
        ]) {
          await adapter.executeQuery(
            `INSERT INTO ${q(table)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("status")}, ${q("seo")}) VALUES ('${id}', '${id}', '${id}', '${status}', '${JSON.stringify(valueOf(id))}')`
          );
        }
      }

      it("keeps every value of the group on an entity that is not translated", async () => {
        await migrateTo(entity(BEFORE, false));
        await seed();
        await migrateTo(entity(AFTER, false));

        const rows = await adapter.executeQuery<{
          id: string;
          status: string;
          seo: unknown;
        }>(
          `SELECT ${q("id")} AS id, ${q("status")} AS status, ${q("seo")} AS seo FROM ${q(table)} ORDER BY ${q("id")}`
        );
        expect(rows.map(row => ({ ...row, seo: groupOf(row.seo) }))).toEqual([
          { id: "draft", status: "draft", seo: valueOf("draft") },
          { id: "live", status: "published", seo: valueOf("live") },
        ]);
      });

      it("makes every value of the group the default language's on a translated entity", async () => {
        await migrateTo(entity(BEFORE, true));
        await seed();
        await migrateTo(entity(AFTER, true));

        const companion = `${table}_locales`;
        const rows = await adapter.executeQuery<{
          parent: string;
          locale: string;
          seo: unknown;
        }>(
          `SELECT ${q("_parent")} AS parent, ${q("_locale")} AS locale, ${q("seo")} AS seo FROM ${q(companion)} ORDER BY ${q("_parent")}`
        );
        expect(rows.map(row => ({ ...row, seo: groupOf(row.seo) }))).toEqual([
          { parent: "draft", locale: "en", seo: valueOf("draft") },
          { parent: "live", locale: "en", seo: valueOf("live") },
        ]);
      });
    }
  );
}
