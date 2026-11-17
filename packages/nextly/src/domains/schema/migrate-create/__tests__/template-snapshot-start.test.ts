/**
 * A project made from the blog template starts from the snapshot the template
 * ships, which lists its collections and Singles with their fields and no
 * tables. Both readers of the newest snapshot take the template's entities as
 * already made:
 *
 * - the comparison `nextly migrate` and `migrate:check` make names a
 *   collection, a Single or a top-level field added or removed since, and
 *   nothing for the template as shipped;
 * - `migrate:create` writes a migration holding that change alone.
 *
 * Driven with the template's own collections, Singles and migrations folder.
 */
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../../config";
import {
  nothingUnwritten,
  unwrittenChangeLines,
  unwrittenChangesOf,
} from "../../migrate/unwritten-changes";
import { appMigrationInputs } from "../app-migration-inputs";
import { generateMigration } from "../generate";

// The template imports nextly by its published names, which vitest.config.ts
// resolves to this package's source for template files. Each mock records that
// a template import reached it, so a template that stopped resolving to this
// source fails the check below by name.
const reached = vi.hoisted(() => new Set<string>());
vi.mock("../../../../config", async importOriginal => {
  reached.add("nextly/config");
  return importOriginal();
});
vi.mock("../../../../index", async () => {
  reached.add("nextly");
  return {
    NextlyError: (await import("../../../../errors/nextly-error")).NextlyError,
  };
});

const TEMPLATE = new URL(
  "../../../../../../../templates/blog/",
  import.meta.url
);
const DIALECT = "postgresql" as const;

/** One export of a module in the blog template, loaded by a run-time path. */
async function templateExport(file: string, name: string): Promise<Entity> {
  const module: Record<string, unknown> = await import(
    fileURLToPath(new URL(file, TEMPLATE))
  );
  return module[name] as Entity;
}

interface Entity {
  slug: string;
  fields: { name?: string }[];
}

/** The template's collections and Singles, as its configuration declares them. */
async function blog(): Promise<{ collections: Entity[]; singles: Entity[] }> {
  const [Posts, Authors, Categories, Tags, SiteSettings, Navigation, Homepage] =
    await Promise.all([
      templateExport("src/collections/Posts/index.ts", "Posts"),
      templateExport("src/collections/Authors.ts", "Authors"),
      templateExport("src/collections/Categories.ts", "Categories"),
      templateExport("src/collections/Tags.ts", "Tags"),
      templateExport("src/singles/SiteSettings/index.ts", "SiteSettings"),
      templateExport("src/singles/Navigation/index.ts", "Navigation"),
      templateExport("src/singles/Homepage/index.ts", "Homepage"),
    ]);
  return {
    collections: [Posts, Authors, Categories, Tags],
    singles: [SiteSettings, Navigation, Homepage],
  };
}

/** A collection a plugin contributes, as the template's form plugin does. */
const submissions = defineCollection({
  slug: "tpl_submissions",
  fields: [text({ name: "answer" })],
});
const formsPlugin = {
  name: "@acme/tpl-forms",
  contributes: { collections: [submissions] },
};

describe("a project starting from the blog template's snapshot", () => {
  let dir: string;
  let migrationsDir: string;
  const logger = { warn: () => undefined, error: () => undefined };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nextly-template-start-"));
    migrationsDir = join(dir, "migrations");
    await cp(fileURLToPath(new URL("migrations", TEMPLATE)), migrationsDir, {
      recursive: true,
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** What both readers are asked with, for the declared entities. */
  const asked = (declared: { collections: Entity[]; singles: Entity[] }) => ({
    config: {
      // The plugin's collection is in the configuration's list, as a resolved
      // configuration holds it.
      collections: [...declared.collections, submissions],
      singles: declared.singles,
      fieldGroups: [],
      plugins: [formsPlugin],
      localization: undefined,
      db: { uiSchemaFile: "./ui-schema.json", migrationsDir },
    } as unknown as Parameters<typeof appMigrationInputs>[0]["config"],
    projectRoot: dir,
    migrationsDir,
    dialect: DIALECT,
    logger,
  });

  const linesFor = async (declared: {
    collections: Entity[];
    singles: Entity[];
  }) => unwrittenChangeLines(await unwrittenChangesOf(asked(declared)));

  /** `declared` with `change` applied to the collection `slug`. */
  const withCollection = (
    declared: { collections: Entity[]; singles: Entity[] },
    slug: string,
    change: (entity: Entity) => Entity
  ) => ({
    ...declared,
    collections: declared.collections.map(c =>
      c.slug === slug ? change(c) : c
    ),
  });

  it("names nothing for the template as shipped, a plugin's collection included", async () => {
    const changes = await unwrittenChangesOf(asked(await blog()));

    expect(unwrittenChangeLines(changes)).toEqual([]);
    expect(nothingUnwritten(changes)).toBe(true);
    expect([...reached].sort()).toEqual(["nextly", "nextly/config"]);
  });

  it("names a field added to a collection and one added to a Single", async () => {
    const declared = withCollection(await blog(), "posts", posts => ({
      ...posts,
      fields: [...posts.fields, text({ name: "subtitle" })],
    }));
    declared.singles = declared.singles.map(s =>
      s.slug === "homepage"
        ? { ...s, fields: [...s.fields, text({ name: "heroNote" })] }
        : s
    );

    const lines = await linesFor(declared);

    expect(lines).toHaveLength(2);
    expect(lines.join("\n")).toMatch(/^\+ .*dc_posts.*subtitle/m);
    expect(lines.join("\n")).toMatch(/^\+ .*single_homepage.*hero_note/m);
  });

  it("names a field removed", async () => {
    const lines = await linesFor(
      withCollection(await blog(), "posts", posts => ({
        ...posts,
        fields: posts.fields.filter(f => f.name !== "excerpt"),
      }))
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^- .*dc_posts.*excerpt/);
  });

  it("names a collection added and a collection removed", async () => {
    // Removed with the one field that points at it, as a declaration has to:
    // a collection another field still points at is refused before this.
    const declared = withCollection(await blog(), "posts", posts => ({
      ...posts,
      fields: posts.fields.filter(f => f.name !== "byline"),
    }));
    const lines = await linesFor({
      ...declared,
      collections: [
        ...declared.collections.filter(c => c.slug !== "authors"),
        defineCollection({
          slug: "tpl_events",
          fields: [text({ name: "venue" })],
        }),
      ],
    });

    // The two tables, and the removed field with its index; no other table of
    // the template is named.
    expect([...lines].sort()).toEqual([
      "+ add_table dc_tpl_events",
      "- drop_column dc_posts.byline",
      "- drop_index idx_dc_posts_byline on dc_posts",
      "- drop_table dc_authors",
    ]);
  });

  it("migrate:create writes the added field alone, and the next comparison names nothing", async () => {
    const declared = withCollection(await blog(), "posts", posts => ({
      ...posts,
      fields: [...posts.fields, text({ name: "subtitle" })],
    }));
    const inputs = await appMigrationInputs(asked(declared));

    const result = await generateMigration({
      name: "add_subtitle",
      dialect: DIALECT,
      migrationsDir,
      collections: inputs.collections,
      singles: inputs.singles,
      components: inputs.components,
      metadataUpserts: inputs.metadataUpserts,
      previousMetadataUpserts: inputs.previousMetadataUpserts,
      appStream: inputs.appStream,
      previous: inputs.latest,
      nonInteractive: true,
    });

    expect(result).not.toBeNull();
    const written = (await readdir(migrationsDir)).find(name =>
      name.endsWith("_add_subtitle.sql")
    );
    expect(written).toBeDefined();
    const sql = await readFile(join(migrationsDir, written!), "utf-8");
    const up = sql.split("-- DOWN")[0];
    expect(up).toMatch(/ALTER TABLE "dc_posts" ADD COLUMN "subtitle"/);
    // Nothing the template already made: no table is created, and no other
    // table is altered.
    expect(up).not.toMatch(/CREATE TABLE/);
    expect(up.match(/ALTER TABLE/g)).toHaveLength(1);

    expect(await linesFor(declared)).toEqual([]);
  });
});
