/**
 * A collection created through the services every surface reaches — the admin's route, a
 * plugin's `ctx.services.collections`, the `CollectionsHandler` — writes its definition and
 * migration where the config's `db` block says, and in development runs it as `nextly migrate`
 * does: nothing goes to the old `src/db/migrations/dynamic` folder, on every dialect.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { runFileMigrations } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";

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

    it("keeps a plugin many-to-one's foreign-key action through the definition into a deploy's registry row", async () => {
      process.env.NODE_ENV = "development";
      const service = t.getService<CollectionService>("collectionService");
      const author = {
        name: "author",
        type: "relationship",
        options: {
          target: "people",
          relationType: "manyToOne",
          onDelete: "set null",
        },
      };
      await service.createCollection(created("people"), {});
      await service.createCollection(
        { name: "notes", label: "Note", fields: [author] } as Parameters<
          CollectionService["createCollection"]
        >[0],
        {}
      );

      const definition = JSON.parse(
        readFileSync(join(t.basePath, "schema", "builder.json"), "utf-8")
      ) as {
        collections: { slug: string; fields: { options?: unknown }[] }[];
      };
      expect(
        definition.collections.find(c => c.slug === "notes")?.fields[0]?.options
      ).toEqual(author.options);
      const setNull = async (on: TestNextly) => {
        const adapter = on.adapter as unknown as DrizzleAdapter;
        const live = await introspectLiveSnapshot(
          adapter.getDrizzle(),
          adapter.getCapabilities().dialect,
          ["dc_notes"]
        );
        return live.tables[0]?.foreignKeys?.find(
          fk => fk.referencesTable === "dc_people"
        )?.onDelete;
      };
      expect(await setNull(t)).toBe("set null");

      // A deploy's empty database replays the folder: the registry row the file
      // writes keeps the field's options, and the key acts as it does here.
      const folder = await mkdtemp(join(tmpdir(), "nextly-save-replay-"));
      try {
        await cp(join(t.basePath, "database", "history"), folder, {
          recursive: true,
        });
        await t.destroy();
        instance = await createTestNextly({ dialect });
        const fresh = instance.adapter as unknown as DrizzleAdapter;
        await runFileMigrations({
          adapter: fresh as never,
          db: fresh.getDrizzle(),
          dialect: fresh.getCapabilities().dialect,
          migrationsDir: folder,
          logger: createLogger({ quiet: true }),
        });
        const rows = (await fresh.executeQuery(
          "SELECT fields FROM dynamic_collections WHERE slug = 'notes'"
        )) as unknown as { fields: unknown }[];
        const fields = rows[0]?.fields;
        expect(
          (typeof fields === "string" ? JSON.parse(fields) : fields) as unknown
        ).toEqual([author]);
        expect(await setNull(instance)).toBe("set null");
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
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
