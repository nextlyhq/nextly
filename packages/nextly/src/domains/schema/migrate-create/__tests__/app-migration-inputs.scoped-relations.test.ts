/**
 * A Schema Builder save judges the relationships of the entity it saves before anything is
 * written, as `migrate:create` judges every entity's: one whose target neither the configuration
 * nor the definition declares is refused. An unrelated entry's is not the save's to refuse, and a
 * save has no snapshot loss to judge, its own delete included.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { uiSchemaManifest } from "../../../../schemas/_zod/ui-schema";
import { appMigrationInputs } from "../app-migration-inputs";

describe("a scoped Builder save's relationship targets", () => {
  let dir: string;
  const logger = { warn: () => undefined, error: () => undefined };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nextly-scoped-relations-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** The inputs a save of the collection `saved` reads, from `collections` in the definition. */
  const inputsOf = (saved: string, collections: unknown[]) =>
    appMigrationInputs({
      config: {
        collections: [],
        singles: [],
        fieldGroups: [],
        plugins: [],
        localization: undefined,
        db: { uiSchemaFile: "./ui-schema.json", migrationsDir: dir },
      } as unknown as Parameters<typeof appMigrationInputs>[0]["config"],
      projectRoot: dir,
      manifest: uiSchemaManifest.parse({ collections }),
      judged: { kind: "collection", slug: saved },
      migrationsDir: dir,
      dialect: "postgresql",
      logger,
    });

  const dangling = {
    slug: "posts",
    fields: [{ name: "author", type: "relationship", relationTo: "authors" }],
  };
  const plain = { slug: "notes", fields: [{ name: "title", type: "text" }] };

  it("refuses the saved collection's relationship to a collection nobody declares", async () => {
    await expect(inputsOf("posts", [dangling])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          {
            code: "NEXTLY_SCHEMA_RELATION_TARGET_MISSING",
            message: "posts.author relates to unknown target 'authors'",
          },
        ],
      },
    });
  });

  it("does not refuse a save over another entry's relationship", async () => {
    await expect(inputsOf("notes", [dangling, plain])).resolves.toBeDefined();
  });

  it("accepts the saved collection's relationship to a collection the definition declares", async () => {
    const authors = {
      slug: "authors",
      fields: [{ name: "name", type: "text" }],
    };
    await expect(inputsOf("posts", [dangling, authors])).resolves.toBeDefined();
  });
});
