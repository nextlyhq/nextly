/**
 * A project that ran `migrate:create` on a Builder collection before it was described by the
 * Builder's own column rule has a snapshot saying `varchar(255)` for a text field the Builder made
 * `TEXT` on MySQL. The next `migrate:create` writes the one-time widening, and `nextly migrate`
 * records it applied with no consent to delete data given: a widening keeps every value, so the
 * data-loss check asks nothing for it. A column the earlier migration indexed whole is widened
 * with its index lifted around the change and made again by prefix, every value kept.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import { migrateCore } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { NO_CONSENT } from "../../migrate/data-loss-consent";
import {
  generateMigration,
  type MinimalConfigEntity,
} from "../../migrate-create/generate";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";

let instance: TestNextly | undefined;
let dir: string | undefined;

afterEach(async () => {
  await instance?.destroy();
  instance = undefined;
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const posts = (
  source: "builder" | "code",
  body: Record<string, unknown> = {}
): MinimalConfigEntity => ({
  slug: "posts",
  tableName: "dc_posts",
  fields: [{ name: "body", type: "text", ...body }],
  settings: { source, settings: { slug: "posts" } },
});

describe.runIf(getConfiguredTestDialects().includes("mysql"))(
  "a Builder collection's text column after the mapping change (mysql)",
  () => {
    it("is widened under its index, which the file lifts and makes again by prefix, keeping every value", async () => {
      const t = await createTestNextly({ dialect: "mysql" });
      instance = t;
      const adapter = t.adapter as unknown as DrizzleAdapter;
      dir = await mkdtemp(join(tmpdir(), "nextly-widening-"));
      const migrationsDir = dir;
      const generate = (
        entity: MinimalConfigEntity,
        name: string,
        minute: number
      ) =>
        generateMigration({
          name,
          dialect: "mysql",
          migrationsDir,
          collections: [entity],
          singles: [],
          components: [],
          nonInteractive: true,
          now: new Date(Date.UTC(2026, 10, 10, 12, minute)),
        });
      const migrate = () =>
        migrateCore({
          extensionSchema: undefined,
          dialect: "mysql",
          db: adapter.getDrizzle(),
          adapter: adapter as never,
          migrationsDir,
          logger: createLogger({ quiet: true }),
          lockMode: "fail-fast",
          consent: NO_CONSENT,
          interactive: false,
        } as never);
      /** The column's type, and how much of it each index on it keys (null: the whole value). */
      const bodyKeys = async () => {
        const [column] = await adapter.executeQuery<{ type: string }>(
          "SELECT DATA_TYPE AS `type` FROM information_schema.COLUMNS " +
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dc_posts' AND COLUMN_NAME = 'body'"
        );
        const indexes = await adapter.executeQuery<{
          name: string;
          part: number | string | null;
        }>(
          "SELECT INDEX_NAME AS `name`, SUB_PART AS `part` FROM information_schema.STATISTICS " +
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dc_posts' AND COLUMN_NAME = 'body'"
        );
        return {
          type: column?.type.toLowerCase(),
          indexes: indexes.map(i => ({
            name: i.name,
            part: i.part === null ? null : Number(i.part),
          })),
        };
      };

      // The snapshot an earlier migrate:create wrote by the code-first rule, applied: the column
      // varchar(255) and indexed whole.
      await generate(posts("code", { index: true }), "earlier", 1);
      await migrate();
      expect(await bodyKeys()).toEqual({
        type: "varchar",
        indexes: [{ name: "idx_dc_posts_body", part: null }],
      });
      await adapter.executeQuery(
        "INSERT INTO `dc_posts` (`id`, `title`, `slug`, `body`) VALUES ('p1', 'P', 'p1', 'kept as it was')"
      );

      const widening = await generate(
        posts("builder", { index: true }),
        "widening",
        2
      );
      expect(widening).not.toBeNull();
      await migrate();

      expect(await bodyKeys()).toEqual({
        type: "text",
        indexes: [{ name: "idx_dc_posts_body", part: 191 }],
      });
      const [row] = await adapter.executeQuery<{ body: string }>(
        "SELECT `body` FROM `dc_posts` WHERE `id` = 'p1'"
      );
      expect(row?.body).toBe("kept as it was");
    });

    it("is widened once, and nextly migrate records the widening applied without consent", async () => {
      const t = await createTestNextly({ dialect: "mysql" });
      instance = t;
      const adapter = t.adapter as unknown as DrizzleAdapter;
      dir = await mkdtemp(join(tmpdir(), "nextly-widening-"));
      const migrationsDir = dir;
      const generate = (
        entity: MinimalConfigEntity,
        name: string,
        minute: number
      ) =>
        generateMigration({
          name,
          dialect: "mysql",
          migrationsDir,
          collections: [entity],
          singles: [],
          components: [],
          nonInteractive: true,
          now: new Date(Date.UTC(2026, 10, 10, 12, minute)),
        });
      const migrate = () =>
        migrateCore({
          extensionSchema: undefined,
          dialect: "mysql",
          db: adapter.getDrizzle(),
          adapter: adapter as never,
          migrationsDir,
          logger: createLogger({ quiet: true }),
          lockMode: "fail-fast",
          consent: NO_CONSENT,
          interactive: false,
        } as never);
      const bodyType = async () =>
        (
          await introspectLiveSnapshot(adapter.getDrizzle(), "mysql", [
            "dc_posts",
          ])
        ).tables[0]?.columns
          .find(c => c.name === "body")
          ?.type.toLowerCase();

      // The snapshot an earlier migrate:create wrote, by the code-first rule, applied; then the
      // column as the Builder made it.
      await generate(posts("code"), "earlier", 1);
      await migrate();
      expect(await bodyType()).toMatch(/varchar\(255\)/);
      await adapter.executeQuery(
        "ALTER TABLE `dc_posts` MODIFY `body` TEXT NULL"
      );

      const widening = await generate(posts("builder"), "widening", 2);
      expect(widening).not.toBeNull();
      await migrate();

      expect(await bodyType()).toBe("text");
      const repo = new SchemaEventsRepository(adapter.getDrizzle(), "mysql");
      const applied = (await repo.listFileApplies())
        .filter(row => row.status === "applied")
        .map(row => row.filename)
        .sort();
      expect(applied.some(f => f?.endsWith("_widening.sql"))).toBe(true);
    });
  }
);
