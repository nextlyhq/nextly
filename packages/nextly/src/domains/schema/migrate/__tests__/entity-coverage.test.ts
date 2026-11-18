import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SQL } from "drizzle-orm";
import { SQLiteDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it, vi } from "vitest";

import {
  consentCovers,
  resolveDataLossConsent,
  type Deletion,
} from "../data-loss-consent";
import {
  coveredEntity,
  entityOwners,
  withOwners,
  type CoveredEntity,
} from "../entity-coverage";
import {
  countEntityRows,
  coverRunDeletions,
  entityRowsOf,
  FIELD_GROUP_TABLES,
  retiredByRun,
  withEntityCoverage,
} from "../entity-shared-rows";

const manyToMany = (name: string, target: string, junctionTable?: string) => ({
  name,
  type: "relationship",
  options: {
    relationType: "manyToMany",
    target,
    ...(junctionTable === undefined ? {} : { junctionTable }),
  },
});

const posts = coveredEntity({
  kind: "collection",
  slug: "posts",
  tableName: "dc_posts",
  source: "code",
  fields: [
    { name: "title", type: "text" },
    manyToMany("tags", "tags"),
    manyToMany("related", "pages", "posts_related_pages"),
  ],
}) as CoveredEntity;
const home = coveredEntity({
  kind: "single",
  slug: "home",
  tableName: "single_home",
  source: "ui",
  fields: "[]",
}) as CoveredEntity;
const pages = coveredEntity({
  kind: "collection",
  slug: "pages",
  tableName: "dc_pages",
  source: "code",
  fields: [manyToMany("links", "posts")],
}) as CoveredEntity;

const table = (name: string): Deletion => ({ kind: "table", table: name });
const consent = (targets: string) =>
  resolveDataLossConsent({ flag: targets, env: {} });

describe("what an entity owns", () => {
  it("owns its main table, its translation table and its junction tables", () => {
    expect(posts.tables).toEqual([
      "dc_posts",
      "dc_posts_locales",
      "dc_posts_dc_tags_tags",
      "posts_related_pages",
    ]);
    expect(home.tables).toEqual(["single_home", "single_home_locales"]);
  });

  it("reads a registry row's fields stored as text", () => {
    const stored = coveredEntity({
      kind: "collection",
      slug: "posts",
      tableName: "dc_posts",
      source: "code",
      fields: JSON.stringify([manyToMany("tags", "tags")]),
    });
    expect(stored?.tables).toContain("dc_posts_dc_tags_tags");
  });

  it("owns no junction when its fields cannot be read, never a guessed one", () => {
    const unreadable = coveredEntity({
      kind: "collection",
      slug: "posts",
      tableName: "dc_posts",
      source: "code",
      fields: "{not json",
    });
    expect(unreadable?.tables).toEqual(["dc_posts", "dc_posts_locales"]);
  });

  it("leaves out a plugin's entities and Nextly's own", () => {
    for (const source of ["plugin:seo", "built-in"]) {
      expect(
        coveredEntity({
          kind: "collection",
          slug: "x",
          tableName: "dc_x",
          source,
          fields: [],
        })
      ).toBeUndefined();
    }
  });
});

describe("whose a dropped table is", () => {
  it("gives a table the entity owns its main table as owner, and the main table none", () => {
    // On a server that folds the case of table names, as SQLite does.
    const owners = entityOwners([posts, home], { foldsCase: true });
    expect(
      withOwners(
        [
          table("dc_posts"),
          table("dc_posts_locales"),
          table("DC_POSTS_DC_TAGS_TAGS"),
          { kind: "column", table: "dc_posts_locales", column: "title" },
          { kind: "rows", table: "posts_related_pages" },
          table("single_home_locales"),
          table("dc_other"),
        ],
        owners
      )
    ).toEqual([
      table("dc_posts"),
      { kind: "table", table: "dc_posts_locales", owner: "dc_posts" },
      { kind: "table", table: "DC_POSTS_DC_TAGS_TAGS", owner: "dc_posts" },
      {
        kind: "column",
        table: "dc_posts_locales",
        column: "title",
        owner: "dc_posts",
      },
      { kind: "rows", table: "posts_related_pages", owner: "dc_posts" },
      { kind: "table", table: "single_home_locales", owner: "single_home" },
      table("dc_other"),
    ]);
  });

  it("owns no table that differs from its own only in case, where the server keeps case", () => {
    // A quoted `DC_POSTS_LOCALES` is a table of its own on PostgreSQL: naming `dc_posts` covers none of it.
    const owners = entityOwners([posts]);
    expect(
      withOwners([table("DC_POSTS_LOCALES"), table("dc_posts_locales")], owners)
    ).toEqual([
      table("DC_POSTS_LOCALES"),
      { kind: "table", table: "dc_posts_locales", owner: "dc_posts" },
    ]);
    expect(owners.mainOf("DC_POSTS")).toBeUndefined();
    expect(
      consentCovers(
        consent("dc_posts"),
        withOwners([table("DC_POSTS_LOCALES")], owners)[0]
      )
    ).toBe(false);
  });

  it("gives a table two entities claim no owner, so each must be named", () => {
    const twin = coveredEntity({
      kind: "collection",
      slug: "pages",
      tableName: "dc_pages",
      source: "code",
      fields: [manyToMany("x", "posts", "posts_related_pages")],
    }) as CoveredEntity;
    const owners = entityOwners([posts, twin]);
    expect(withOwners([table("posts_related_pages")], owners)).toEqual([
      table("posts_related_pages"),
    ]);
  });

  it("keeps one entity the owner of a junction its fields name twice", () => {
    // The recorded and the declared fields together can name one field twice.
    const twice = coveredEntity({
      kind: "collection",
      slug: "posts",
      tableName: "dc_posts",
      source: "code",
      fields: [manyToMany("tags", "tags"), manyToMany("tags", "tags")],
    }) as CoveredEntity;
    expect(
      withOwners([table("dc_posts_dc_tags_tags")], entityOwners([twice]))
    ).toEqual([
      { kind: "table", table: "dc_posts_dc_tags_tags", owner: "dc_posts" },
    ]);
  });

  it("never makes one entity's main table another's", () => {
    const greedy = coveredEntity({
      kind: "collection",
      slug: "greedy",
      tableName: "dc_greedy",
      source: "code",
      fields: [manyToMany("x", "posts", "dc_posts")],
    }) as CoveredEntity;
    const owners = entityOwners([posts, greedy]);
    expect(withOwners([table("dc_posts")], owners)).toEqual([
      table("dc_posts"),
    ]);
  });
});

describe("a run's deletions with the entities they remove", () => {
  it("lists the entity's rows in shared tables under the file that drops its main table", () => {
    const owners = entityOwners([posts, home, pages]);
    const [first, second] = coverRunDeletions(
      [
        [table("dc_posts_dc_tags_tags")],
        [table("dc_posts"), table("dc_posts_locales")],
      ],
      owners
    );
    expect(first).toEqual([
      { kind: "table", table: "dc_posts_dc_tags_tags", owner: "dc_posts" },
    ]);
    expect(second).toEqual([
      table("dc_posts"),
      { kind: "table", table: "dc_posts_locales", owner: "dc_posts" },
      ...entityRowsOf(posts),
    ]);
  });

  it("lists every kind of row a removal of the entity takes, each belonging to it", () => {
    const listed = entityRowsOf(home);
    expect(listed.map(d => d.kind === "rows" && d.table)).toEqual([
      "the field groups' tables",
      "nextly_i18n_archive",
      "nextly_versions",
      "nextly_version_pins",
      "nextly_version_views",
      "nextly_dashboard_pins",
      "nextly_media_usage",
      "nextly_review_states",
    ]);
    for (const d of listed) {
      expect(d).toMatchObject({
        kind: "rows",
        owner: "single_home",
        of: { kind: "single", slug: "home" },
      });
    }
  });

  it("is covered whole by naming the main table, and by nothing narrower", () => {
    const owners = entityOwners([posts, pages]);
    const run = coverRunDeletions(
      [
        [
          table("dc_posts"),
          table("dc_posts_locales"),
          table("dc_posts_dc_tags_tags"),
        ],
      ],
      owners
    ).flat();
    expect(run.every(d => consentCovers(consent("dc_posts"), d))).toBe(true);
    // Naming another collection's main table covers none of the removed one's.
    expect(run.some(d => consentCovers(consent("dc_pages"), d))).toBe(false);
  });

  it("adds nothing for a table no registry row names as an entity's main table", () => {
    const owners = entityOwners([posts]);
    expect(coverRunDeletions([[table("dc_other")]], owners)).toEqual([
      [table("dc_other")],
    ]);
  });
});

describe("a main table two registry rows name", () => {
  it("belongs to neither, so neither entity's tables or rows are covered through it", () => {
    const twin = coveredEntity({
      kind: "collection",
      slug: "articles",
      tableName: "dc_posts",
      source: "code",
      fields: [],
    }) as CoveredEntity;
    const owners = entityOwners([posts, twin]);
    expect(owners.mainOf("dc_posts")).toBeUndefined();
    expect(
      coverRunDeletions(
        [[table("dc_posts"), table("dc_posts_locales")]],
        owners
      )
    ).toEqual([[table("dc_posts"), table("dc_posts_locales")]]);
  });
});

describe("shared rows of an entity the run does not retire", () => {
  it("are not listed, while its own tables still belong to it", () => {
    const owners = entityOwners([posts]);
    expect(
      coverRunDeletions(
        [[table("dc_posts"), table("dc_posts_locales")]],
        owners,
        () => false
      )
    ).toEqual([
      [
        table("dc_posts"),
        { kind: "table", table: "dc_posts_locales", owner: "dc_posts" },
      ],
    ]);
  });
});

describe("which entities a run retires, from the snapshot it ends at", () => {
  const snapshot = (collections: string[]) =>
    JSON.stringify({
      version: 1,
      migrationHash: "a".repeat(64),
      snapshot: { tables: [] },
      entities: {
        collections: Object.fromEntries(
          collections.map(slug => [
            slug,
            { source: "code", settings: { slug } },
          ])
        ),
        singles: {},
        fieldGroups: {},
      },
    });

  it("retires an entity the last snapshot of the run leaves out, and keeps one it records", async () => {
    const meta = mkdtempSync(join(tmpdir(), "nextly-retired-"));
    try {
      writeFileSync(
        join(meta, "0001_a.snapshot.json"),
        snapshot(["posts", "pages"])
      );
      writeFileSync(join(meta, "0002_b.snapshot.json"), snapshot(["pages"]));
      const retires = await retiredByRun(meta, ["0001_a", "0002_b"]);
      expect(retires?.({ kind: "collection", slug: "posts" })).toBe(true);
      expect(retires?.({ kind: "collection", slug: "pages" })).toBe(false);
      // A run with no snapshot says nothing, and every drop is listed as a retirement.
      expect(await retiredByRun(meta, ["0003_none"])).toBeUndefined();
    } finally {
      rmSync(meta, { recursive: true, force: true });
    }
  });
});

describe("counting within the time a run allows", () => {
  it("lists what it could not count in time without a count, rather than waiting", async () => {
    // A PostgreSQL connection whose every read hangs: the registry read and every count.
    const hanging = {
      execute: () => new Promise(() => {}),
      transaction: () => new Promise(() => {}),
    };
    const started = Date.now();
    const listed = await withEntityCoverage([[table("dc_posts")]], {
      db: hanging,
      dialect: "postgresql",
      budgetMs: 50,
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(listed).toEqual([[table("dc_posts")]]);
  });
});

describe("an entity's field-group values where the walk cannot read a table", () => {
  it("counts the entity's own level by its parent table, and lists what is nested below it", async () => {
    // A command outside a booted instance: no schema registers `comp_seo`, so the ORM cannot
    // address it and the walk refuses, while a raw count by parent table still reads it.
    const adapter = {
      dialect: "sqlite" as const,
      listTables: vi.fn().mockResolvedValue(["comp_seo"]),
      tableExists: vi.fn().mockResolvedValue(false),
      delete: vi.fn(),
      getDrizzle: vi.fn(),
      executeQuery: vi.fn().mockResolvedValue([{ n: 2 }]),
      select: vi.fn(async (table: string) => {
        if (table === "comp_seo") {
          throw new Error(
            'Table "comp_seo" not found in schema registry. Ensure setTableResolver() has been called during boot.'
          );
        }
        return [];
      }),
    };
    const [values] = entityRowsOf(posts);
    const listed = await countEntityRows([values], {
      db: { all: () => [] },
      dialect: "sqlite",
      adapter,
    });
    expect(listed).toEqual([
      { ...values, table: "comp_seo", count: 2 },
      {
        ...values,
        table: FIELD_GROUP_TABLES,
        reason: "the field-group values nested in them",
      },
    ]);
  });
});

describe("counting an entity's rows in each shared table", () => {
  const sqlite = new SQLiteDialect();
  /**
   * A SQLite connection answering the catalog with `present`, and each count with what `count`
   * says of the table and the values bound into its condition (kind, slug, then any narrowing).
   */
  const connection = (
    present: readonly string[],
    count: (table: string, params: readonly unknown[]) => number
  ) => ({
    all: (query: SQL) => {
      const { sql: text, params } = sqlite.sqlToQuery(query);
      if (text.includes("sqlite_master"))
        return present.map(name => ({ name }));
      const table = /FROM "([^"]+)"/.exec(text)?.[1] ?? "";
      return [{ n: count(table, params) }];
    },
  });
  const [, archive, autosaves, pins, views] = entityRowsOf(posts);

  it("counts the entity's own rows in each, and leaves out a table holding none or absent", async () => {
    const db = connection(
      ["nextly_i18n_archive", "nextly_versions", "nextly_version_pins"],
      (table, params) => {
        // Only the entity's rows are counted: its kind and slug are what the condition binds.
        if (params[1] !== "posts") return 99;
        if (table === "nextly_versions") return params[2] === 1 ? 2 : 99;
        if (table === "nextly_i18n_archive")
          return params[0] === "unknown" ? 0 : 1;
        return 0;
      }
    );
    expect(
      await countEntityRows([archive, autosaves, pins, views], {
        db,
        dialect: "sqlite",
      })
    ).toEqual([
      { ...archive, count: 1 },
      { ...autosaves, count: 2 },
    ]);
  });

  it("lists the archive's entry uncounted while rows of the slug have no recorded kind", async () => {
    const db = connection(["nextly_i18n_archive"], (_table, params) =>
      params[0] === "unknown" ? 3 : 1
    );
    expect(await countEntityRows([archive], { db, dialect: "sqlite" })).toEqual(
      [archive]
    );
  });

  it("lists every entry uncounted when the catalog cannot be read", async () => {
    const db = {
      all: () => {
        throw new Error("no database");
      },
    };
    expect(
      await countEntityRows([archive, autosaves], { db, dialect: "sqlite" })
    ).toEqual([archive, autosaves]);
  });
});
