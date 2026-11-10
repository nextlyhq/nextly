// A collection the Schema Builder declares is described with the Builder's own column rule, as the
// Builder creates and pushes its table: on MySQL a text field with no stated width is unbounded
// TEXT there, where a code-first one is varchar(255). Described with the code-first rule, the
// file and the Builder's own table disagreed on every such column.

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSqlSections } from "../../migrate/sql-sections";
import { generateMigration, type MinimalConfigEntity } from "../generate";

const posts = (source?: "builder" | "code"): MinimalConfigEntity => ({
  slug: "posts",
  tableName: "dc_posts",
  fields: [{ name: "body", type: "text" }],
  ...(source === undefined
    ? {}
    : { settings: { source, settings: { slug: "posts" } } }),
});

async function created(entity: MinimalConfigEntity): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nextly-builder-mapping-"));
  const result = await generateMigration({
    name: "one",
    dialect: "mysql",
    migrationsDir: dir,
    collections: [entity],
    singles: [],
    components: [],
    nonInteractive: true,
    now: new Date(Date.UTC(2026, 10, 10, 12)),
  });
  if (result === null) throw new Error("no migration was written");
  return parseSqlSections(await readFile(result.sqlPath, "utf-8")).upSql;
}

describe("a collection's text column on MySQL", () => {
  it("is unbounded TEXT for a Builder collection, as the Builder creates it", async () => {
    expect(await created(posts("builder"))).toMatch(/`body` text\b/i);
  });

  it("stays varchar(255) for a code-first collection", async () => {
    expect(await created(posts("code"))).toMatch(/`body` varchar\(255\)/i);
    expect(await created(posts())).toMatch(/`body` varchar\(255\)/i);
  });
});

/** Every file a translated `posts` writes, its translations table's included, as one text. */
async function createdTranslated(entity: MinimalConfigEntity): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nextly-builder-mapping-"));
  const result = await generateMigration({
    name: "one",
    dialect: "mysql",
    migrationsDir: dir,
    collections: [
      {
        ...entity,
        localized: true,
        fields: [{ name: "body", type: "text", localized: true }],
      },
    ],
    singles: [],
    components: [],
    nonInteractive: true,
    now: new Date(Date.UTC(2026, 10, 10, 12)),
  });
  if (result === null) throw new Error("no migration was written");
  const texts = await Promise.all(
    [result.sqlPath, ...result.companionFiles.map(f => f.path)].map(path =>
      readFile(path, "utf-8")
    )
  );
  return texts.map(text => parseSqlSections(text).upSql).join("\n");
}

describe("a translated text column in the translations table on MySQL", () => {
  it("is unbounded TEXT for a Builder collection, as the Builder creates its translations table", async () => {
    const sql = await createdTranslated(posts("builder"));
    expect(sql).toMatch(/dc_posts_locales/);
    expect(sql).toMatch(/`body` text\b/i);
    expect(sql).not.toMatch(/`body` varchar\(255\)/i);
  });

  it("stays varchar(255) for a code-first collection", async () => {
    expect(await createdTranslated(posts("code"))).toMatch(
      /`body` varchar\(255\)/i
    );
  });
});
