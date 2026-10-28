/**
 * A change to settings alone is written as a migration, and every snapshot
 * records every entity's settings.
 *
 * Entities are reduced from `define*` configs through `toMinimalEntities`, the
 * reduction `migrate:create` itself uses, so what reaches the generator is the
 * declaration as the command sees it rather than a hand-built shape.
 *
 * What separates a correct generator from the plausible broken one here is the
 * file existing at all when no table changes: the generator that only diffs
 * tables returns null for every case below that asserts a file. The second
 * property is that the file carries no table statements, which a generator
 * that wrote a no-op `ALTER` to force a file would fail.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  text,
  textarea,
} from "../../../../config";
import { splitSqlStatements } from "../../migrate/split-sql";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../../utils/resolve-table-name";
import { resolveSingleTableName } from "../../../singles/services/resolve-single-table-name";
import { parseSqlSections } from "../../../../cli/commands/migrate";
import { toMinimalEntities } from "../config-entities";
import { generateMigration } from "../generate";
import { writeSnapshot } from "../snapshot-io";

type Declared = {
  collections?: unknown[];
  singles?: unknown[];
  fieldGroups?: unknown[];
};

let migrationsDir: string;
let clock = 0;

beforeEach(async () => {
  migrationsDir = await mkdtemp(join(tmpdir(), "nextly-settings-only-"));
});

afterEach(async () => {
  await rm(migrationsDir, { recursive: true, force: true });
});

/** `migrate:create` over `declared`, as the command reduces a config. */
function generate(declared: Declared, name = "change") {
  clock += 1;
  return generateMigration({
    name,
    dialect: "postgresql",
    migrationsDir,
    collections: toMinimalEntities(declared.collections ?? [], e =>
      resolveCollectionTableName(e.slug, e.dbName)
    ),
    singles: toMinimalEntities(declared.singles ?? [], e =>
      resolveSingleTableName({ slug: e.slug, dbName: e.dbName })
    ),
    components: toMinimalEntities(declared.fieldGroups ?? [], e =>
      resolveComponentTableName(e.slug)
    ),
    nonInteractive: true,
    // Strictly later each run, so the newest snapshot is always the last one.
    now: new Date(Date.UTC(2026, 9, 28, 12, 0, 0, clock)),
  });
}

/** The UP section's statements, as `nextly migrate` would split them. */
function upStatements(sql: string): string[] {
  return splitSqlStatements(parseSqlSections(sql).upSql, "postgresql");
}

/** A written migration's `.sql` and parsed snapshot. */
async function written(result: Awaited<ReturnType<typeof generate>>) {
  expect(result).not.toBeNull();
  const sql = await readFile(result!.sqlPath, "utf-8");
  const snapshot = JSON.parse(await readFile(result!.snapshotPath, "utf-8"));
  return { sql, snapshot };
}

const posts = (extra: Record<string, unknown> = {}, fields?: unknown[]) =>
  defineCollection({
    slug: "posts",
    fields: (fields ?? [
      text({ name: "headline" }),
      textarea({ name: "body" }),
    ]) as never,
    ...extra,
  });

describe("a settings-only change writes a migration with no table statements", () => {
  const cases: {
    setting: string;
    before: () => unknown;
    after: () => unknown;
    named: string;
  }[] = [
    {
      setting: "labels",
      before: () => posts({ labels: { singular: "Post", plural: "Posts" } }),
      after: () => posts({ labels: { singular: "Article", plural: "Posts" } }),
      named: "posts: labels.singular",
    },
    {
      setting: "description",
      before: () => posts({ description: "Blog posts" }),
      after: () => posts({ description: "Articles for the blog" }),
      named: "posts: description",
    },
    {
      setting: "icon",
      before: () => posts({ admin: { icon: "FileText" } }),
      after: () => posts({ admin: { icon: "Newspaper" } }),
      named: "posts: admin.icon",
    },
    {
      setting: "sidebar group",
      before: () => posts({ admin: { group: "Content" } }),
      after: () => posts({ admin: { group: "Blog" } }),
      named: "posts: admin.group",
    },
    {
      setting: "an admin option",
      before: () => posts({ admin: { useAsTitle: "headline" } }),
      after: () => posts({ admin: { useAsTitle: "body" } }),
      named: "posts: admin.useAsTitle",
    },
    {
      setting: "versioning",
      before: () => posts(),
      after: () => posts({ versions: true }),
      named: "posts: versions",
    },
    {
      setting: "a field's help text",
      before: () =>
        posts({}, [
          text({ name: "headline" }),
          textarea({ name: "body", admin: { description: "The story" } }),
        ]),
      after: () =>
        posts({}, [
          text({ name: "headline" }),
          textarea({ name: "body", admin: { description: "The full story" } }),
        ]),
      named: "posts: fields.body.admin.description",
    },
    {
      setting: "a field's placeholder",
      before: () => posts(),
      after: () =>
        posts({}, [
          text({ name: "headline", admin: { placeholder: "A headline" } }),
          textarea({ name: "body" }),
        ]),
      named: "posts: fields.headline.admin.placeholder",
    },
    {
      setting: "a field's hidden flag",
      before: () => posts(),
      after: () =>
        posts({}, [
          text({ name: "headline" }),
          textarea({ name: "body", admin: { hidden: true } }),
        ]),
      named: "posts: fields.body.admin.hidden",
    },
  ];

  it.each(cases)("$setting", async ({ before, after, named }) => {
    await written(await generate({ collections: [before()] }, "create"));

    const { sql, snapshot } = await written(
      await generate({ collections: [after()] })
    );

    expect(sql).toContain(`-- Settings: ${named}`);
    expect(upStatements(sql)).toEqual([]);
    // The table is not named as changed: no table of it changed.
    expect(sql).not.toContain("-- Collections:");
    expect(
      snapshot.snapshot.tables.map((t: { name: string }) => t.name)
    ).toEqual(["dc_posts"]);
  });

  it("a Single's label and a field group's description", async () => {
    const home = (singular: string) =>
      defineSingle({
        slug: "home",
        label: { singular },
        fields: [text({ name: "heading" })],
      });
    const hero = (description: string) =>
      defineFieldGroup({
        slug: "hero",
        description,
        fields: [text({ name: "heading" })],
      });
    await written(
      await generate(
        { singles: [home("Home")], fieldGroups: [hero("Top of page")] },
        "create"
      )
    );

    const { sql } = await written(
      await generate({
        singles: [home("Front page")],
        fieldGroups: [hero("Above the fold")],
      })
    );

    expect(sql).toContain("-- Settings: home (single): label.singular");
    expect(sql).toContain("-- Settings: hero (field group): description");
    expect(upStatements(sql)).toEqual([]);
  });

  it("names Draft/Published and the localisation flag, which also move columns", async () => {
    await written(await generate({ collections: [posts()] }, "create"));

    const { sql } = await written(
      await generate({ collections: [posts({ status: true })] })
    );

    expect(sql).toContain("-- Settings: posts: status");
    expect(upStatements(sql).join("\n")).toContain('"status"');
  });

  it("writes nothing when nothing changed", async () => {
    await written(
      await generate({ collections: [posts({ description: "x" })] }, "create")
    );

    expect(
      await generate({ collections: [posts({ description: "x" })] })
    ).toBeNull();
  });
});

describe("a cleared setting is a change", () => {
  it("a removed description is named cleared, and the snapshot no longer has it", async () => {
    await written(
      await generate(
        { collections: [posts({ description: "Blog posts" })] },
        "create"
      )
    );

    const { sql, snapshot } = await written(
      await generate({ collections: [posts()] })
    );

    expect(sql).toContain("-- Settings: posts: description (cleared)");
    expect(upStatements(sql)).toEqual([]);
    expect(snapshot.entities.collections.posts.settings).not.toHaveProperty(
      "description"
    );
  });
});

describe("a column migration carries every settings change", () => {
  it("names another entity's settings change beside one entity's new column", async () => {
    const pages = (description: string) =>
      defineCollection({
        slug: "pages",
        description,
        fields: [text({ name: "headline" })],
      });
    await written(
      await generate({ collections: [posts(), pages("Pages")] }, "create")
    );

    const { sql, snapshot } = await written(
      await generate({
        collections: [
          posts({}, [
            text({ name: "headline" }),
            textarea({ name: "body" }),
            text({ name: "subtitle" }),
          ]),
          pages("Site pages"),
        ],
      })
    );

    expect(upStatements(sql).join("\n")).toContain(
      'ALTER TABLE "dc_posts" ADD COLUMN "subtitle"'
    );
    expect(sql).toContain("-- Settings: pages: description");
    expect(sql).toContain("-- Settings: posts: fields.subtitle (added)");
    // The table header still names only the entity whose table changed.
    expect(sql).toContain("-- Collections: posts\n");
    expect(snapshot.entities.collections.pages.settings.description).toBe(
      "Site pages"
    );
  });
});

describe("every snapshot records every entity's full settings", () => {
  it("an entity the migration does not touch is recorded whole", async () => {
    const pages = defineCollection({
      slug: "pages",
      labels: { singular: "Page", plural: "Pages" },
      description: "Site pages",
      admin: { group: "Site", icon: "File" },
      fields: [text({ name: "headline", admin: { placeholder: "Title" } })],
    });
    const home = defineSingle({
      slug: "home",
      label: { singular: "Home" },
      fields: [text({ name: "heading" })],
    });
    await written(
      await generate(
        { collections: [posts(), pages], singles: [home] },
        "create"
      )
    );

    const { snapshot } = await written(
      await generate({
        collections: [
          posts({}, [text({ name: "headline" }), text({ name: "subtitle" })]),
          pages,
        ],
        singles: [home],
      })
    );

    expect(snapshot.entities.collections.pages).toEqual({
      source: "code",
      settings: expect.objectContaining({
        slug: "pages",
        labels: { singular: "Page", plural: "Pages" },
        description: "Site pages",
        admin: expect.objectContaining({ group: "Site", icon: "File" }),
        fields: expect.arrayContaining([
          expect.objectContaining({
            name: "headline",
            admin: expect.objectContaining({ placeholder: "Title" }),
          }),
        ]),
      }),
    });
    expect(snapshot.entities.singles.home).toEqual({
      source: "code",
      settings: expect.objectContaining({
        slug: "home",
        label: { singular: "Home" },
      }),
    });
    expect(Object.keys(snapshot.entities.collections).sort()).toEqual([
      "pages",
      "posts",
    ]);
  });

  it("records no function and no code-defined access", async () => {
    const guarded = defineCollection({
      slug: "guarded",
      // A rule that is a plain value as well as one that is a function: the
      // first survives serialising, so only leaving `access` out drops it.
      access: { read: true, update: () => true },
      hooks: { beforeChange: [({ data }: { data: unknown }) => data] },
      fields: [text({ name: "headline", validate: () => true })],
    } as never);

    const { snapshot } = await written(
      await generate({ collections: [guarded] }, "create")
    );

    const settings = snapshot.entities.collections.guarded.settings;
    expect(settings).not.toHaveProperty("access");
    expect(settings).not.toHaveProperty("hooks");
    const headline = settings.fields.find(
      (f: { name: string }) => f.name === "headline"
    );
    expect(headline).toEqual(expect.objectContaining({ name: "headline" }));
    expect(headline).not.toHaveProperty("validate");
  });

  it("the first run after a snapshot that predates settings records them all", async () => {
    // A snapshot written before settings were recorded: tables only, the same
    // tables the config describes, so the table diff has nothing to write.
    const first = await written(
      await generate({ collections: [posts()] }, "create")
    );
    await rm(join(migrationsDir, "meta"), { recursive: true, force: true });
    await writeSnapshot(
      join(migrationsDir, "meta"),
      "20260101_000000_000_create",
      first.snapshot.snapshot,
      first.sql
    );

    const { sql } = await written(await generate({ collections: [posts()] }));

    expect(sql).toContain("-- Settings: posts: settings recorded");
    expect(upStatements(sql)).toEqual([]);
  });
});
