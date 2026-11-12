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

/** A Single or a field group declaring `fields`, as the Builder or code records it. */
const entityOf = (
  kind: "single" | "fieldGroup",
  source: "builder" | "code",
  fields: MinimalConfigEntity["fields"]
): MinimalConfigEntity => ({
  slug: "hero",
  tableName: kind === "single" ? "single_hero" : "comp_hero",
  fields,
  settings: { source, settings: { slug: "hero" } },
});

/** Each file's up statements, writing `steps` in turn into one folder. */
async function createdInTurn(
  kind: "single" | "fieldGroup",
  steps: MinimalConfigEntity[]
): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "nextly-builder-mapping-"));
  const written: string[] = [];
  for (const [index, entity] of steps.entries()) {
    const result = await generateMigration({
      name: `step_${index}`,
      dialect: "mysql",
      migrationsDir: dir,
      collections: [],
      singles: kind === "single" ? [entity] : [],
      components: kind === "fieldGroup" ? [entity] : [],
      nonInteractive: true,
      now: new Date(Date.UTC(2026, 10, 10, 12, index)),
    });
    if (result === null) throw new Error("no migration was written");
    written.push(
      parseSqlSections(await readFile(result.sqlPath, "utf-8")).upSql
    );
  }
  return written;
}

const BODY = [{ name: "body", type: "text" }];

describe.each(["single", "fieldGroup"] as const)(
  "a %s's text column on MySQL",
  kind => {
    it("is unbounded TEXT for a Builder one, as its Builder creator makes it, and the next file leaves it alone", async () => {
      const [first, next] = await createdInTurn(kind, [
        entityOf(kind, "builder", BODY),
        entityOf(kind, "builder", [...BODY, { name: "extra", type: "text" }]),
      ]);

      expect(first).toMatch(/`body` text\b/i);
      // The next change adds its field and plans nothing for the column already there.
      expect(next).toMatch(/`extra` text\b/i);
      expect(next).not.toMatch(/`body`/);
    });

    it("stays varchar(255) for a code-first one", async () => {
      const [first] = await createdInTurn(kind, [entityOf(kind, "code", BODY)]);

      expect(first).toMatch(/`body` varchar\(255\)/i);
    });
  }
);
