/**
 * `migrate:create` gives a translated field marked unique its per-language index in a `unique`
 * companion file, drops it the same way when the rule goes, and writes nothing on a second run.
 * The creates run after every other file, once each column they key on exists.
 */
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { companionUniqueIndexName } from "../../../i18n/migration/companion-unique-indexes";
import { parseLocalizationIntent } from "../../../i18n/migration/migration-intent";
import {
  generateMigration,
  type MinimalConfigEntity,
  type MinimalConfigField,
} from "../generate";

const INDEX = companionUniqueIndexName("dc_docs_locales", "handle");

const docs = (fields: MinimalConfigField[]): MinimalConfigEntity => ({
  slug: "docs",
  tableName: "dc_docs",
  localized: true,
  fields: [...fields, { name: "body", type: "text", localized: true }],
});

describe("migrate:create, a translated unique field", () => {
  let migrationsDir: string;
  let minute = 0;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), "nextly-translated-unique-"));
    minute = 0;
  });

  /** One `migrate:create` over `entity`, a minute after the last. */
  const create = (entity: MinimalConfigEntity) =>
    generateMigration({
      name: `change_${++minute}`,
      dialect: "postgresql",
      migrationsDir,
      defaultLocale: "en",
      collections: [entity],
      singles: [],
      components: [],
      nonInteractive: true,
      now: new Date(Date.UTC(2026, 9, 22, 12, minute)),
    });

  /** The files the runs wrote, in the order `nextly migrate` runs them, with each one's kind. */
  async function files(): Promise<
    { name: string; kind?: string; sql: string }[]
  > {
    const names = (await readdir(migrationsDir))
      .filter(f => f.endsWith(".sql"))
      .sort();
    return Promise.all(
      names.map(async name => {
        const sql = await readFile(resolve(migrationsDir, name), "utf-8");
        return { name, kind: parseLocalizationIntent(sql, name)?.kind, sql };
      })
    );
  }

  const unique = {
    name: "handle",
    type: "text",
    unique: true,
    localized: true,
  };

  it("creates the index after the companion, and writes nothing the second time", async () => {
    expect(await create(docs([unique]))).not.toBeNull();

    const written = await files();
    const kinds = written.map(f => f.kind);
    expect(kinds).toContain("create-only");
    expect(kinds.at(-1)).toBe("unique");
    // Its header names what it indexes, which `nextly migrate` checks before running it.
    const last = written.at(-1)!;
    expect(parseLocalizationIntent(last.sql, last.name)?.spec.unique).toEqual([
      { field: "handle", column: "handle" },
    ]);
    const [up, down] = written.at(-1)!.sql.split("-- DOWN");
    expect(up).toContain(`CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX}"`);
    expect(down).toContain(`DROP INDEX IF EXISTS "${INDEX}"`);

    expect(await create(docs([unique]))).toBeNull();
    expect(await files()).toHaveLength(written.length);
  });

  it("drops the index when the rule goes, and its DOWN puts it back", async () => {
    await create(docs([unique]));
    const before = (await files()).length;

    expect(await create(docs([{ ...unique, unique: false }]))).not.toBeNull();

    const added = (await files()).slice(before);
    const drop = added.find(f => f.kind === "unique");
    expect(drop).toBeDefined();
    const [up, down] = drop!.sql.split("-- DOWN");
    expect(up).toContain(`DROP INDEX IF EXISTS "${INDEX}"`);
    expect(up).not.toContain("CREATE");
    expect(down).toContain(`CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX}"`);
  });
});
