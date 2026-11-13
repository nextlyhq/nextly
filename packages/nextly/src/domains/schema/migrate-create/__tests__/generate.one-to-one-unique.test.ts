/**
 * `migrate:create` makes a one-to-one relationship's column unique in the file it writes, and
 * removes that uniqueness when the relationship stops being one-to-one. A relationship the
 * Builder stored with `relationType: "oneToOne"` carries no `unique` flag, so the file follows the
 * one rule every road shares (`builderColumnIsUnique`), not the flag alone. A second run with
 * nothing changed writes nothing.
 */
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { uniqueIndexNameForColumn } from "../../services/index-name";
import {
  generateMigration,
  type MinimalConfigEntity,
  type MinimalConfigField,
} from "../generate";

const UNIQUE = uniqueIndexNameForColumn("dc_profiles", "person");

const people: MinimalConfigEntity = {
  slug: "people",
  tableName: "dc_people",
  fields: [{ name: "name", type: "text" }],
};

/** The profiles, whose `person` points at one person, as the Builder stores the relationship. */
const profiles = (
  relationType: "oneToOne" | "manyToOne"
): MinimalConfigEntity => ({
  slug: "profiles",
  tableName: "dc_profiles",
  fields: [
    { name: "title", type: "text" },
    {
      name: "person",
      type: "relationship",
      options: { target: "people", relationType },
    } as unknown as MinimalConfigField,
  ],
});

describe("migrate:create, a one-to-one relationship", () => {
  let migrationsDir: string;
  let minute = 0;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), "nextly-one-to-one-"));
    minute = 0;
  });

  /** One `migrate:create` over the two collections, a minute after the last. */
  const create = (relationType: "oneToOne" | "manyToOne") =>
    generateMigration({
      name: `change_${++minute}`,
      dialect: "postgresql",
      migrationsDir,
      collections: [people, profiles(relationType)],
      singles: [],
      components: [],
      nonInteractive: true,
      now: new Date(Date.UTC(2026, 10, 10, 12, minute)),
    });

  /** The UP and DOWN halves of every file written since `from`. */
  async function written(from = 0): Promise<{ up: string; down: string }[]> {
    const names = (await readdir(migrationsDir))
      .filter(f => f.endsWith(".sql"))
      .sort()
      .slice(from);
    return Promise.all(
      names.map(async name => {
        const [up, down = ""] = (
          await readFile(resolve(migrationsDir, name), "utf-8")
        ).split("-- DOWN");
        return { up, down };
      })
    );
  }

  it("makes the column unique when the relationship is created one-to-one, and writes nothing the second time", async () => {
    expect(await create("oneToOne")).not.toBeNull();

    const files = await written();
    expect(files.some(f => f.up.includes(`"${UNIQUE}"`))).toBe(true);
    expect(files.find(f => f.up.includes(`"${UNIQUE}"`))?.up).toMatch(
      /CREATE UNIQUE INDEX/
    );

    expect(await create("oneToOne")).toBeNull();
  });

  it("makes the column unique when a many-to-one becomes one-to-one, and its DOWN removes it", async () => {
    await create("manyToOne");
    const before = (await readdir(migrationsDir)).filter(f =>
      f.endsWith(".sql")
    ).length;

    expect(await create("oneToOne")).not.toBeNull();

    const [file] = await written(before);
    expect(file.up).toMatch(new RegExp(`CREATE UNIQUE INDEX[^;]*"${UNIQUE}"`));
    expect(file.down).toContain(`"${UNIQUE}"`);
  });

  it("removes the uniqueness when a one-to-one becomes many-to-one", async () => {
    await create("oneToOne");
    const before = (await readdir(migrationsDir)).filter(f =>
      f.endsWith(".sql")
    ).length;

    expect(await create("manyToOne")).not.toBeNull();

    const [file] = await written(before);
    expect(file.up).toMatch(new RegExp(`DROP INDEX[^;]*"${UNIQUE}"`));
    expect(file.up).not.toContain("CREATE UNIQUE INDEX");
  });
});
