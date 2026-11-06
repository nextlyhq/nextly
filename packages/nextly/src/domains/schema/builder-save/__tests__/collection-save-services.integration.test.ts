/**
 * A collection created through the services every surface reaches — the admin's route, a
 * plugin's `ctx.services.collections`, the `CollectionsHandler` — writes its definition and
 * migration where the config's `db` block says, and in development runs it as `nextly migrate`
 * does: nothing goes to the old `src/db/migrations/dynamic` folder, on every dialect.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CollectionService } from "../../../collections/services/collection-service";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { checksumOf } from "../../migrate/applied-checksums";

let instance: TestNextly | undefined;
let previousNodeEnv: string | undefined;

beforeEach(() => {
  previousNodeEnv = process.env.NODE_ENV;
});

afterEach(async () => {
  process.env.NODE_ENV = previousNodeEnv;
  await instance?.destroy();
  instance = undefined;
});

describe.each(getConfiguredTestDialects())(
  "a collection created through the services (%s)",
  dialect => {
    let t: TestNextly;

    beforeEach(async () => {
      t = await createTestNextly({
        dialect,
        db: {
          migrationsDir: "./database/history",
          uiSchemaFile: "./schema/builder.json",
        },
      });
      instance = t;
    });

    const created = (
      name: string
    ): Parameters<CollectionService["createCollection"]>[0] =>
      ({
        name,
        label: "Article",
        fields: [{ name: "body", type: "text" }],
      }) as Parameters<CollectionService["createCollection"]>[0];

    it("in development writes the definition and an applied migration where the config says", async () => {
      process.env.NODE_ENV = "development";
      const service = t.getService<CollectionService>("collectionService");

      await service.createCollection(created("articles"), {});

      const folder = join(t.basePath, "database", "history");
      const files = readdirSync(folder).filter(f => f.endsWith(".sql"));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^\d{8}_\d{6}_\d{3}_articles_create\.sql$/);
      expect(readdirSync(join(folder, "meta"))).toEqual([
        files[0]!.replace(/\.sql$/, ".snapshot.json"),
      ]);
      const definition = JSON.parse(
        readFileSync(join(t.basePath, "schema", "builder.json"), "utf-8")
      ) as { collections: { slug: string }[] };
      expect(definition.collections.map(c => c.slug)).toEqual(["articles"]);
      expect(existsSync(join(t.basePath, "src", "db", "migrations"))).toBe(
        false
      );

      const adapter = t.adapter as unknown as DrizzleAdapter;
      expect(await adapter.tableExists("dc_articles")).toBe(true);
      const repo = new SchemaEventsRepository(
        adapter.getDrizzle(),
        adapter.getCapabilities().dialect
      );
      const applied = (await repo.listFileApplies()).filter(
        row => row.status === "applied"
      );
      expect(applied.map(row => [row.filename, row.sha256])).toEqual([
        [files[0], checksumOf(readFileSync(join(folder, files[0]!), "utf-8"))],
      ]);
    });

    it("outside development writes them and runs nothing", async () => {
      process.env.NODE_ENV = "production";
      const service = t.getService<CollectionService>("collectionService");

      await service.createCollection(created("articles"), {});

      const folder = join(t.basePath, "database", "history");
      expect(readdirSync(folder).filter(f => f.endsWith(".sql"))).toHaveLength(
        1
      );
      const adapter = t.adapter as unknown as DrizzleAdapter;
      expect(await adapter.tableExists("dc_articles")).toBe(false);
    });
  }
);
