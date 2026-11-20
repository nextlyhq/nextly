/**
 * The Schema Builder's Unique switch on a collection's built-in title, saved as the Builder sends
 * it: the title row (`{ name: "title", required: true, unique }`) beside the collection's own
 * fields, through the apply road (`applySchemaChanges`).
 *
 * - Turned on over titles no two entries share: the title becomes unique, so an entry repeating
 *   one is refused.
 * - Turned on over titles two entries share: refused before anything changes, naming the title
 *   and how many entries share one; the migrations, the definition and the registry row stay as
 *   they were.
 * - Turned off again (the Builder sends `unique: false`, since the server keeps a stored built-in
 *   field it is not sent): an entry may repeat a title once more.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };

/** A field as the Builder's save converts it (`convertToFieldDefinition`). */
const asSent = (
  name: string,
  extra: { required?: boolean; unique?: boolean } = {}
) => ({
  name,
  label: name,
  type: "text",
  required: extra.required ?? false,
  unique: extra.unique ?? false,
  index: false,
});
/** The built-in title row, with the Unique the person set. */
const title = (unique: boolean) => asSent("title", { required: true, unique });
const BODY = asSent("body");

for (const dialect of getConfiguredTestDialects()) {
  describe(`the Builder's Unique switch on a collection's title (${dialect})`, () => {
    let t: TestNextly;
    let basePath: string;

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-title-unique-"));
      // The Builder's save runs its change in development only.
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
      });
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: "posts",
          label: "Post",
          fields: [{ name: "body", type: "text" }],
        }
      );
    });

    afterEach(async () => {
      await t?.destroy();
      vi.unstubAllEnvs();
      await rm(basePath, { recursive: true, force: true });
    });

    const exec = <T>(statement: string) =>
      (
        t.adapter as unknown as {
          executeQuery<R>(sql: string): Promise<R[]>;
        }
      ).executeQuery<T>(statement);

    async function save(fields: unknown[]): Promise<unknown> {
      const [row] = await exec<{ version: number | string | null }>(
        "SELECT schema_version AS version FROM dynamic_collections WHERE slug = 'posts'"
      );
      return dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        { fields, confirmed: true, schemaVersion: Number(row?.version ?? 1) }
      );
    }

    const create = (postTitle: string, body: string) =>
      t.nextly.create({
        collection: "posts",
        data: { title: postTitle, body },
      } as never);

    /** What a refused save must leave as it found it. */
    async function standing() {
      const migrations = join(basePath, "migrations");
      const definition = join(basePath, "ui-schema.json");
      const [row] = await exec<{ fields: unknown }>(
        "SELECT fields FROM dynamic_collections WHERE slug = 'posts'"
      );
      return {
        files: existsSync(migrations) ? readdirSync(migrations).sort() : [],
        definition: existsSync(definition)
          ? readFileSync(definition, "utf-8")
          : undefined,
        fields:
          typeof row?.fields === "string"
            ? row.fields
            : JSON.stringify(row?.fields),
      };
    }

    it("makes the title unique where no two entries share one, and lets it repeat again once turned off", async () => {
      await create("One", "a");
      await create("Two", "b");

      await expect(save([title(true), BODY])).resolves.toBeDefined();
      // Unique now: an entry repeating a title is refused.
      await expect(create("One", "c")).rejects.toBeDefined();

      await expect(save([title(false), BODY])).resolves.toBeDefined();
      // Off again: the same entry is taken.
      await expect(create("One", "c")).resolves.toBeDefined();
    }, 60_000);

    it("refuses it over titles two entries share, naming the title and the count, and changes nothing", async () => {
      await create("Same", "a");
      await create("Same", "b");
      const before = await standing();

      await expect(save([title(true), BODY])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.title",
              code: "UNIQUE_OVER_DUPLICATES",
              message: expect.stringMatching(/\b2\b/),
            }),
          ],
        },
      });

      expect(await standing()).toEqual(before);
      // Still not unique: the refused save made no constraint.
      await expect(create("Same", "c")).resolves.toBeDefined();
    }, 60_000);
  });
}
