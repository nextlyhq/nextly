/**
 * A Builder save's migration inputs for an entity they describe as the database already stands
 * (`held`): a pair of sibling fields sharing a stored value that the held entity had is kept, since
 * its definition is judged where it is written, and a pair it did not hold, such as one a plugin's
 * extension adds, is refused.
 *
 * What separates the right check from plausible wrong ones: one that skips the held entity whole
 * lets the added pair through; one that judges the held entity like any other refuses the pair it
 * already had, and with it the save that renames it.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { uiSchemaManifest } from "../../../../schemas/_zod/ui-schema";
import { appMigrationInputs } from "../app-migration-inputs";

const text = (name: string) => ({ name, type: "text" });

/** The Builder's definition holding `posts` with `fields`. */
const manifestWith = (fields: unknown[]) =>
  uiSchemaManifest.parse({ collections: [{ slug: "posts", fields }] });

/** `posts` as the database stands: two fields sharing the column `title`. */
const HELD = manifestWith([text("Title"), text("title")]).collections[0];

describe("a held entity's sibling fields in a save's migration inputs", () => {
  let dir: string;
  const errors: string[] = [];
  const logger = {
    warn: () => undefined,
    error: (message: string) => {
      errors.push(message);
    },
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nextly-held-siblings-"));
    errors.length = 0;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const inputsFor = (fields: unknown[]) =>
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
      manifest: manifestWith(fields),
      held: [{ kind: "collection", entity: HELD }],
      judged: { kind: "collection", slug: "posts" },
      migrationsDir: dir,
      dialect: "postgresql",
      logger,
    });

  it("keeps the pair the held entity had", async () => {
    await expect(
      inputsFor([text("Title"), text("title")])
    ).resolves.toBeDefined();
    expect(errors).toEqual([]);
  });

  it("refuses a pair sharing a column that the held entity did not have", async () => {
    await expect(
      inputsFor([text("Title"), text("title"), text("fooBar"), text("foo_bar")])
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(errors).toEqual([
      "Collection 'posts': fields 'fooBar' and 'foo_bar' at the top level share the column 'foo_bar'. Rename one of them so each has its own column.",
    ]);
  });
});
