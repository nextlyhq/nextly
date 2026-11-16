/**
 * A migration scoped to one collection (`scope`) changes only that collection's tables, and its
 * snapshot is the latest snapshot with only that collection's tables and settings replaced.
 *
 * A Schema Builder save writes the migration for the collection it saved. Whatever else the
 * project changed since the last snapshot — a code-first collection dev push already changed, a
 * Builder collection saved elsewhere — stays for the next `migrate:create` to write: in neither
 * the file nor the snapshot, so that run still sees it as a change. On every dialect.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseSqlSections } from "../../migrate/sql-sections";
import { generateMigration, type MinimalConfigEntity } from "../generate";
import type { SnapshotFile } from "../snapshot-io";

/** A collection with its settings record, as a Builder or a config declares it. */
function collection(
  slug: string,
  fields: MinimalConfigEntity["fields"],
  label: string
): MinimalConfigEntity {
  return {
    slug,
    tableName: `dc_${slug}`,
    fields,
    settings: { source: "builder", settings: { slug, label } },
  };
}

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

describe.each(DIALECTS)(
  "a migration scoped to one collection (%s)",
  dialect => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "nextly-scoped-"));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    async function generate(
      step: number,
      collections: MinimalConfigEntity[],
      scope?: { kind: "collection"; slug: string; tables: ReadonlySet<string> }
    ): Promise<{ up: string; snapshot: SnapshotFile } | null> {
      const result = await generateMigration({
        name: `step_${step}`,
        dialect,
        migrationsDir: dir,
        collections,
        singles: [],
        components: [],
        nonInteractive: true,
        ...(scope === undefined ? {} : { scope }),
        now: new Date(Date.UTC(2026, 10, 6, 12, step)),
      });
      if (result === null) return null;
      return {
        up: parseSqlSections(await readFile(result.sqlPath, "utf-8")).upSql,
        snapshot: JSON.parse(
          await readFile(result.snapshotPath, "utf-8")
        ) as SnapshotFile,
      };
    }

    const columnsOf = (snapshot: SnapshotFile, table: string) =>
      snapshot.snapshot.tables
        .find(t => t.name === table)
        ?.columns.map(c => c.name)
        .sort();

    const posts = (label: string, ...extra: string[]) =>
      collection(
        "posts",
        [
          { name: "title", type: "text" },
          ...extra.map(name => ({ name, type: "text" as const })),
        ],
        label
      );
    const pages = (label: string, ...extra: string[]) =>
      collection(
        "pages",
        [
          { name: "heading", type: "text" },
          ...extra.map(name => ({ name, type: "text" as const })),
        ],
        label
      );

    it("writes only the saved collection's change, and snapshots only its new shape", async () => {
      await generate(1, [posts("Posts"), pages("Pages")]);

      // Since then: posts gains a field (the save), pages gains one and is relabelled, and a new
      // collection appeared — none of which this save is for.
      const saved = await generate(
        2,
        [
          posts("Posts", "subtitle"),
          pages("Pages (all)", "intro"),
          collection("notes", [{ name: "body", type: "text" }], "Notes"),
        ],
        { kind: "collection", slug: "posts", tables: new Set(["dc_posts"]) }
      );

      expect(saved).not.toBeNull();
      const { up, snapshot } = saved!;
      expect(columnsOf(snapshot, "dc_notes")).toBeUndefined();
      expect(columnsOf(snapshot, "dc_pages")).not.toContain("intro");
      expect(snapshot.entities?.collections.notes).toBeUndefined();
      expect(up).toMatch(
        new RegExp(`${q("dc_posts")}[\\s\\S]*${q("subtitle")}`)
      );
      expect(up).not.toMatch(/dc_pages|dc_notes/);
      expect(up).not.toMatch(/DROP TABLE/);

      expect(columnsOf(snapshot, "dc_posts")).toContain("subtitle");
      // pages stands as the last snapshot left it: the save neither dropped nor changed it.
      expect(columnsOf(snapshot, "dc_pages")).toContain("heading");
      expect(snapshot.entities?.collections.pages).toEqual({
        source: "builder",
        settings: { slug: "pages", label: "Pages" },
      });
      expect(snapshot.entities?.collections.posts).toEqual({
        source: "builder",
        settings: { slug: "posts", label: "Posts" },
      });
    });

    it("leaves what it did not write for the next unscoped run", async () => {
      await generate(1, [posts("Posts"), pages("Pages")]);
      await generate(2, [posts("Posts", "subtitle")], {
        kind: "collection",
        slug: "posts",
        tables: new Set(["dc_posts"]),
      });

      const next = await generate(3, [
        posts("Posts", "subtitle"),
        pages("Pages (all)", "intro"),
      ]);

      expect(next).not.toBeNull();
      expect(next!.up).toMatch(
        new RegExp(`${q("dc_pages")}[\\s\\S]*${q("intro")}`)
      );
      expect(next!.up).not.toMatch(/subtitle/);
    });

    it("names only the saved collection's settings change, and writes one for it alone", async () => {
      await generate(1, [posts("Posts"), pages("Pages")]);

      const saved = await generate(2, [posts("Articles")], {
        kind: "collection",
        slug: "posts",
        tables: new Set(["dc_posts"]),
      });

      expect(saved).not.toBeNull();
      expect(saved!.snapshot.entities?.collections.posts?.settings).toEqual({
        slug: "posts",
        label: "Articles",
      });
      expect(saved!.snapshot.entities?.collections.pages?.settings).toEqual({
        slug: "pages",
        label: "Pages",
      });
    });

    it("drops the deleted collection's table and record, and nothing else", async () => {
      await generate(1, [posts("Posts"), pages("Pages")]);

      const deleted = await generate(2, [], {
        kind: "collection",
        slug: "posts",
        tables: new Set(["dc_posts"]),
      });

      expect(deleted).not.toBeNull();
      expect(deleted!.up).toMatch(
        new RegExp(`DROP TABLE[^;]*${q("dc_posts")}`)
      );
      expect(deleted!.up).not.toMatch(/dc_pages/);
      expect(columnsOf(deleted!.snapshot, "dc_posts")).toBeUndefined();
      expect(columnsOf(deleted!.snapshot, "dc_pages")).toContain("heading");
      expect(deleted!.snapshot.entities?.collections.posts).toBeUndefined();
      expect(deleted!.snapshot.entities?.collections.pages).toBeDefined();
    });

    it("writes nothing when the saved collection is as the last snapshot left it", async () => {
      await generate(1, [posts("Posts"), pages("Pages")]);

      expect(
        await generate(2, [posts("Posts")], {
          kind: "collection",
          slug: "posts",
          tables: new Set(["dc_posts"]),
        })
      ).toBeNull();
    });
  }
);
