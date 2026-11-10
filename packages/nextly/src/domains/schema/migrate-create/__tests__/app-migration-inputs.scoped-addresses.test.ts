/**
 * A Schema Builder save judges only the collection it saves, but against every
 * address the project uses: a Single or field group the configuration declares
 * and no snapshot records yet still holds its address, so a saved collection
 * sharing its snake_case form is refused before anything is written, as the
 * next full `migrate:create` or start would refuse it. The other entity is
 * not judged itself: its own address is no business of this save.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { text } from "../../../../collections/fields/helpers";
import { uiSchemaManifest } from "../../../../schemas/_zod/ui-schema";
import { defineSingle } from "../../../../singles/config/define-single";
import { appMigrationInputs } from "../app-migration-inputs";

/** A Builder definition holding the one collection a save writes. */
const manifest = uiSchemaManifest.parse({
  collections: [
    { slug: "team-updates", fields: [{ name: "title", type: "text" }] },
  ],
});

describe("a scoped Builder save's address check", () => {
  let dir: string;
  const errors: string[] = [];
  const logger = {
    warn: () => undefined,
    error: (message: string) => {
      errors.push(message);
    },
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nextly-scoped-addresses-"));
    errors.length = 0;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** The inputs a save of `team-updates` reads, with `singles` configured. */
  const inputsWith = (singles: ReturnType<typeof defineSingle>[]) =>
    appMigrationInputs({
      config: {
        collections: [],
        singles,
        fieldGroups: [],
        plugins: [],
        localization: undefined,
        db: { uiSchemaFile: "./ui-schema.json", migrationsDir: dir },
      } as unknown as Parameters<typeof appMigrationInputs>[0]["config"],
      projectRoot: dir,
      manifest,
      judged: "team-updates",
      migrationsDir: dir,
      dialect: "postgresql",
      logger,
    });

  it("refuses the saved collection when a configured Single shares its snake_case form", async () => {
    const single = defineSingle({
      slug: "team_updates",
      fields: [text({ name: "headline" })],
    });

    await expect(inputsWith([single])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(errors.join("\n")).toContain("SLUG_SAME_SNAKE_CASE");
  });

  it("does not judge the other entity's own address", async () => {
    // An address the rule refuses on its own (too long), declared as a loaded
    // configuration holds it; a save of another collection is not the place
    // it is refused.
    const single = {
      slug: "a".repeat(60),
      fields: [text({ name: "headline" })],
    } as ReturnType<typeof defineSingle>;

    await expect(inputsWith([single])).resolves.toBeDefined();
    expect(errors).toEqual([]);
  });
});
