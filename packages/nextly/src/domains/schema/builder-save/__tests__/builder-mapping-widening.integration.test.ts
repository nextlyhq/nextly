/**
 * A project that ran `migrate:create` on a Builder collection before it was described by the
 * Builder's own column rule has a snapshot saying `varchar(255)` for a text field the Builder made
 * `TEXT` on MySQL. The next `migrate:create` writes the one-time widening, and `nextly migrate`
 * records it applied with no consent to delete data given: a widening keeps every value, so the
 * data-loss check asks nothing for it.
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

const posts = (source: "builder" | "code"): MinimalConfigEntity => ({
  slug: "posts",
  tableName: "dc_posts",
  fields: [{ name: "body", type: "text" }],
  settings: { source, settings: { slug: "posts" } },
});

describe.runIf(getConfiguredTestDialects().includes("mysql"))(
  "a Builder collection's text column after the mapping change (mysql)",
  () => {
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
