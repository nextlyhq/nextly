/**
 * A project made from the blog template starts from the snapshot the template
 * ships, which lists its collections and Singles with their fields and no
 * tables. Both readers of the newest snapshot take the template's entities as
 * already made:
 *
 * - the comparison `nextly migrate` makes names a collection or a Single
 *   added since, and a top-level field added to or removed from a listed
 *   entity once the project declares it;
 * - an entity the template lists that nothing declares is never read as
 *   removed: the scaffold ships this snapshot with the Schema Builder
 *   approach, whose configuration declares no entity at all;
 * - `migrate:create` writes a migration holding that change alone.
 *
 * Two shapes are driven, both over the template's own migrations folder: the
 * configuration the scaffold makes (no entity declared), and the template's
 * collections and Singles declared, as a project is once it moves them into
 * its configuration or saves them from the Schema Builder.
 */
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineFieldGroup, text } from "../../../../config";
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
  const asked = (declared: {
    collections: Entity[];
    singles: Entity[];
    fieldGroups?: unknown[];
  }) => ({
    config: {
      // The plugin's collection is in the configuration's list, as a resolved
      // configuration holds it.
      collections: [...declared.collections, submissions],
      singles: declared.singles,
      fieldGroups: declared.fieldGroups ?? [],
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
    fieldGroups?: unknown[];
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

  it("names a collection added, and never one the template lists that is no longer declared", async () => {
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

    // The added table and the removed field with its index. `dc_authors` is
    // not named: an entity nothing declares may be one the Schema Builder
    // holds, so its absence is never read as a removal.
    expect([...lines].sort()).toEqual([
      "+ add_table dc_tpl_events",
      "- drop_column dc_posts.byline",
      "- drop_index idx_dc_posts_byline on dc_posts",
    ]);
  });

  describe("as the scaffold makes it: the Schema Builder approach, declaring no entity", () => {
    /** The configuration the scaffold copies beside the template's migrations. */
    const visualConfig = () =>
      readFile(
        fileURLToPath(new URL("configs/visual.config.ts", TEMPLATE)),
        "utf-8"
      );

    it("is the configuration these cases stand for: no collection and no Single", async () => {
      // The file imports by paths that resolve only once the scaffold has
      // copied it to a project's root, so it is read rather than loaded.
      const config = await visualConfig();
      expect(config).toMatch(/collections: \[\],/);
      expect(config).toMatch(/singles: \[\],/);
    });

    it("names nothing: every listed entity stays as the template made it", async () => {
      const changes = await unwrittenChangesOf(
        asked({ collections: [], singles: [] })
      );

      expect(unwrittenChangeLines(changes)).toEqual([]);
      expect(nothingUnwritten(changes)).toBe(true);
    });

    it("migrate:create writes a collection added in the configuration, and no drop of a template table", async () => {
      const declared = {
        collections: [
          defineCollection({
            slug: "tpl_events",
            fields: [text({ name: "venue" })],
          }) as unknown as Entity,
        ],
        singles: [],
      };
      expect(await linesFor(declared)).toEqual(["+ add_table dc_tpl_events"]);
      const inputs = await appMigrationInputs(asked(declared));

      const result = await generateMigration({
        name: "add_events",
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
        name.endsWith("_add_events.sql")
      );
      const up = (await readFile(join(migrationsDir, written!), "utf-8")).split(
        "-- DOWN"
      )[0];
      expect(up).toMatch(/CREATE TABLE "dc_tpl_events"/);
      expect(up).not.toMatch(/DROP TABLE/);
      expect(up).not.toMatch(/dc_posts|dc_authors|single_/);
    });
  });

  it("names a field group added, whose table the template never made", async () => {
    const lines = await linesFor({
      ...(await blog()),
      fieldGroups: [
        defineFieldGroup({
          slug: "tpl_callout",
          fields: [text({ name: "heading" })],
        }),
      ],
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\+ .*tpl_callout/);
  });

  it("names a listed collection given another table: the template's table is the one that exists", async () => {
    const lines = await linesFor(
      withCollection(await blog(), "tags", tags => ({
        ...tags,
        dbName: "dc_tpl_labels",
      }))
    );

    // The template made `dc_tags`; the declaration now asks for another table.
    expect(lines.some(line => /dc_tags\b/.test(line))).toBe(true);
    expect(lines.some(line => /dc_tpl_labels\b/.test(line))).toBe(true);
  });

  it("names the Draft/Published columns of a listed collection that has since turned it off", async () => {
    const lines = await linesFor(
      withCollection(await blog(), "posts", posts => ({
        ...posts,
        status: false,
      }))
    );

    // The template made Posts with Draft/Published; its columns are still there.
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every(line => /^[-~] .*dc_posts/.test(line))).toBe(true);
    expect(lines.some(line => /^- .*dc_posts.*\bstatus\b/.test(line))).toBe(
      true
    );
  });

  it.each([
    ["an object", { collections: {}, singles: [] }],
    ["null", { collections: null, singles: [] }],
    ["an entry without a slug", { collections: [{ fields: [] }], singles: [] }],
    [
      "a field without a name",
      { collections: [{ slug: "posts", fields: [{ type: "text" }] }] },
    ],
  ])(
    "refuses a template snapshot whose entity list is %s, rather than reading it as empty",
    async (_what, damaged) => {
      const meta = join(migrationsDir, "meta");
      const [name] = await readdir(meta);
      await rm(join(meta, name));
      await writeFile(join(meta, name), JSON.stringify(damaged), {
        flag: "wx",
      });

      await expect(unwrittenChangesOf(asked(await blog()))).rejects.toThrow(
        /snapshot file .* is invalid/
      );
    }
  );

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
