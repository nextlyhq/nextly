/**
 * The judgement `nextly migrate` makes of a file's required columns, with the database replaced
 * by facts the test states: which tables the registry names, which columns are live and
 * nullable, and a counter that answers per table. What separates it from a plausible broken
 * judgement: a table the registry does not name is never counted, a field group's rows are
 * named by each collection and Single holding them, and a count that fails refuses rather than
 * passing.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { RowsBreakingNotNull } from "../../pipeline/classifier/count-helpers";
import {
  previewRequiredColumns,
  readRequiredColumnOwners,
  judgeRequiredColumnTargets,
  requiredColumnMigrationRefusal,
  type RequiredColumnFacts,
} from "../required-column-guard";

type Entity = { kind: "collection" | "single" | "fieldGroup"; slug: string };

const OWNERS: Record<
  string,
  { entity: Entity; fieldGroup: boolean; fields: Record<string, string> }
> = {
  dc_posts: {
    entity: { kind: "collection", slug: "posts" },
    fieldGroup: false,
    fields: { sub_title: "subTitle" },
  },
  dc_pages: {
    entity: { kind: "collection", slug: "pages" },
    fieldGroup: false,
    fields: {},
  },
  single_settings: {
    entity: { kind: "single", slug: "settings" },
    fieldGroup: false,
    fields: { tagline: "tagline" },
  },
  comp_seo: {
    entity: { kind: "fieldGroup", slug: "seo" },
    fieldGroup: true,
    fields: { meta_title: "metaTitle" },
  },
};

/** Every live column nullable unless listed here. */
const NOT_NULL = new Set(["dc_posts.id"]);
/** Columns not on the live table: those a file adds. */
const ABSENT = new Set(["single_settings.tagline"]);
/** Tables the database spells otherwise than the lower-cased name a statement is read as. */
const SPELLED: Record<string, string> = { orders: "Orders" };

function facts(
  counts: Record<string, RowsBreakingNotNull | Error>
): RequiredColumnFacts & { counted: string[] } {
  const counted: string[] = [];
  return {
    counted,
    owners: {
      owner: table => {
        const o = OWNERS[table];
        return o === undefined
          ? undefined
          : {
              entity: o.entity,
              table,
              fieldGroup: o.fieldGroup,
              fieldsByColumn: new Map(Object.entries(o.fields)),
            };
      },
      holder: table => {
        const o = OWNERS[table];
        return o === undefined || o.fieldGroup ? undefined : o.entity;
      },
    },
    live: (table, column) =>
      column === "missing" || ABSENT.has(`${table}.${String(column)}`)
        ? undefined
        : {
            nullable: !NOT_NULL.has(`${table}.${String(column)}`),
            ...(SPELLED[table] === undefined ? {} : { table: SPELLED[table] }),
          },
    // `main` stands for the plain table here, as SQLite's does; any other qualifier may not.
    plainQualifier: qualifier => qualifier === "main",
    count: target => {
      const key = `${target.table}.${String(target.column)}`;
      counted.push(`${key}${target.byParent ? " by parent" : ""}`);
      const answer = counts[key];
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(answer ?? { total: 0, byParentTable: new Map() });
    },
  };
}

const rows = (total: number, byParent: Record<string, number> = {}) => ({
  total,
  byParentTable: new Map(Object.entries(byParent)),
});

describe("judgeRequiredColumnTargets", () => {
  it("names the entity, the field the descriptor maps the column to, and the count", async () => {
    const f = facts({ "dc_posts.sub_title": rows(3) });
    expect(
      await judgeRequiredColumnTargets(
        [{ table: "dc_posts", column: "sub_title", required: "sub_title" }],
        f
      )
    ).toEqual([
      {
        entity: { kind: "collection", slug: "posts" },
        field: "subTitle",
        count: 3,
        added: false,
      },
    ]);
  });

  it("an added column counts every row, and says it was added", async () => {
    const f = facts({ "single_settings.null": rows(1) });
    expect(
      await judgeRequiredColumnTargets(
        [{ table: "single_settings", column: null, required: "tagline" }],
        f
      )
    ).toEqual([
      {
        entity: { kind: "single", slug: "settings" },
        field: "tagline",
        count: 1,
        added: true,
      },
    ]);
  });

  it("a field group's rows are counted by parent, and each collection or Single holding nulls is named", async () => {
    const f = facts({
      "comp_seo.meta_title": rows(5, {
        dc_posts: 2,
        single_settings: 3,
        dc_unregistered: 4,
      }),
    });
    const [refusal] = await judgeRequiredColumnTargets(
      [{ table: "comp_seo", column: "meta_title", required: "meta_title" }],
      f
    );
    expect(f.counted).toEqual(["comp_seo.meta_title by parent"]);
    expect(refusal).toEqual({
      entity: { kind: "fieldGroup", slug: "seo" },
      field: "metaTitle",
      count: 5,
      added: false,
      users: [
        { kind: "collection", slug: "posts", count: 2 },
        { kind: "single", slug: "settings", count: 3 },
      ],
    });
  });

  it("leaves alone a column not there, one already NOT NULL, and a zero count", async () => {
    const f = facts({});
    expect(
      await judgeRequiredColumnTargets(
        [
          { table: "users", column: "name", required: "name" },
          { table: "dc_posts", column: "missing", required: "missing" },
          { table: "dc_posts", column: "id", required: "id" },
          { table: "dc_pages", column: "body", required: "body" },
        ],
        f
      )
    ).toEqual([]);
    // Every column that could hold a null was counted, a table the registry does not name too.
    expect(f.counted).toEqual(["users.name", "dc_pages.body"]);
  });

  // `ADD COLUMN IF NOT EXISTS c ... NOT NULL` over a column already there is skipped by the
  // database, so it breaks no row.
  it("leaves alone a required column added over one the table already has", async () => {
    const f = facts({
      "dc_posts.null": { total: 3, byParentTable: new Map() },
    });
    expect(
      await judgeRequiredColumnTargets(
        [{ table: "dc_posts", column: null, required: "slug" }],
        f
      )
    ).toEqual([]);
    expect(f.counted).toEqual([]);
  });

  // `ADD COLUMN IF NOT EXISTS c` then a NOT NULL on c: c's null rows when it is there, every row
  // when the ADD makes it.
  it("a column added IF NOT EXISTS is counted as it is live, or as added when it is not", async () => {
    const f = facts({
      "dc_pages.body": rows(2),
      "dc_posts.null": rows(5),
    });
    expect(
      await judgeRequiredColumnTargets(
        [
          {
            table: "dc_pages",
            column: "body",
            required: "body",
            addedIfMissing: true,
          },
          {
            table: "dc_posts",
            column: "missing",
            required: "missing",
            addedIfMissing: true,
          },
        ],
        f
      )
    ).toEqual([
      {
        entity: { kind: "collection", slug: "pages" },
        field: "body",
        count: 2,
        added: false,
      },
      {
        entity: { kind: "collection", slug: "posts" },
        field: "missing",
        count: 5,
        added: true,
      },
    ]);
    expect(f.counted).toEqual(["dc_pages.body", "dc_posts.null"]);
  });

  // A qualifier the database says is the plain table's own (SQLite's `main`, MySQL's current
  // database) is read as the table; any other may reach another schema, whose rows nothing here
  // counts, so the change is refused before anything runs.
  it("counts a table named through its own qualifier, and refuses one through any other", async () => {
    const f = facts({ "dc_posts.sub_title": rows(2) });
    expect(
      await judgeRequiredColumnTargets(
        [
          {
            table: "dc_posts",
            column: "sub_title",
            required: "sub_title",
            qualifier: "main",
          },
        ],
        f
      )
    ).toMatchObject([
      { entity: { kind: "collection", slug: "posts" }, count: 2 },
    ]);
    const error = await judgeRequiredColumnTargets(
      [
        {
          table: "dc_posts",
          column: "sub_title",
          required: "sub_title",
          qualifier: "other",
        },
      ],
      f
    ).then(
      () => undefined,
      (thrown: unknown) => thrown
    );
    expect((error as NextlyError).publicData).toEqual({
      errors: [
        {
          path: "fields.sub_title",
          code: "REQUIRED_COLUMN_UNCOUNTED",
          message:
            "Table 'other.dc_posts': the rows that would break making 'sub_title' required could not be counted through the qualifier 'other', which may name another schema, so that change was refused before it ran. Write the table's unqualified name, then try again.",
        },
      ],
    });
    // Counted once, for the table named through its own qualifier.
    expect(f.counted).toEqual(["dc_posts.sub_title"]);
  });

  // A quoted mixed-case name is read lower-cased from the statement; the table is counted and
  // named as the database spells it.
  it("counts and names a table by its live spelling", async () => {
    const f = facts({ "Orders.label": rows(1) });
    expect(
      await judgeRequiredColumnTargets(
        [{ table: "orders", column: "label", required: "label" }],
        f
      )
    ).toEqual([
      {
        entity: { kind: "table", slug: "Orders" },
        field: "label",
        count: 1,
        added: false,
      },
    ]);
  });

  // A table that is not a collection, a Single or a field group (a plugin's, an extension's) is
  // judged as well, and named by its table and column.
  it("judges a table the registry does not name, naming its table and column", async () => {
    const f = facts({
      "plugin_forms.label": { total: 2, byParentTable: new Map() },
    });
    expect(
      await judgeRequiredColumnTargets(
        [{ table: "plugin_forms", column: "label", required: "label" }],
        f
      )
    ).toEqual([
      {
        entity: { kind: "table", slug: "plugin_forms" },
        field: "label",
        count: 2,
        added: false,
      },
    ]);
  });

  // Named as the refusal over a counted break names it: by the field the column belongs to.
  it("a count that fails refuses, naming the table and the field, rather than letting the change run", async () => {
    const cause = new Error("connection lost");
    const f = facts({ "dc_posts.sub_title": cause });
    const error = await judgeRequiredColumnTargets(
      [{ table: "dc_posts", column: "sub_title", required: "sub_title" }],
      f
    ).then(
      () => undefined,
      (thrown: unknown) => thrown
    );
    expect(NextlyError.is(error)).toBe(true);
    expect((error as NextlyError).publicData).toEqual({
      errors: [
        {
          path: "fields.subTitle",
          code: "REQUIRED_COLUMN_UNCOUNTED",
          message:
            "Table 'dc_posts': the rows that would break making 'subTitle' required could not be counted, so that change was refused before it ran. Check that the database can be reached and the table read, then try again.",
        },
      ],
    });
    expect((error as NextlyError).cause).toBe(cause);
  });
});

describe("requiredColumnMigrationRefusal", () => {
  const breaks = [
    {
      entity: { kind: "collection" as const, slug: "posts" },
      field: "subTitle",
      count: 2,
      added: false,
    },
  ];

  it("before any statement: names the file, the entity, the field and the count, under the shared code", () => {
    const error = requiredColumnMigrationRefusal(breaks, {
      source: "20261102_000001_x.sql",
      dialect: "mysql",
    });
    expect(error.publicMessage).toContain("20261102_000001_x.sql");
    expect(error.publicMessage).toContain("before any of its statements ran");
    expect(error.publicMessage).toContain(
      "Collection 'posts': field 'subTitle' cannot become required while 2 rows hold no value"
    );
    expect(
      (error.publicData as { errors: Array<{ code: string }> }).errors.map(
        e => e.code
      )
    ).toEqual(["REQUIRED_COLUMN_HAS_NULLS"]);
  });

  it("at a statement on MySQL: names the statements that ran before it, and that schema changes stayed", () => {
    const error = requiredColumnMigrationRefusal(breaks, {
      source: "f.sql",
      dialect: "mysql",
      at: {
        index: 2,
        transaction: true,
        statements: [
          "ALTER TABLE `dc_posts` ADD COLUMN `extra` varchar(255)",
          "UPDATE `dc_posts` SET `sub_title` = 'secret' WHERE `id` = '1'",
          "ALTER TABLE `dc_posts` MODIFY COLUMN `sub_title` varchar(255) NOT NULL",
        ],
      },
    });
    expect(error.publicMessage).toContain(
      "statement 3. ALTER TABLE `dc_posts` MODIFY"
    );
    expect(error.publicMessage).toContain(
      "1. ALTER TABLE `dc_posts` ADD COLUMN `extra` varchar; 2. UPDATE `dc_posts` SET `sub_title` ="
    );
    expect(error.publicMessage).toContain("stayed applied");
    // A label never carries a string literal, which can hold row data.
    expect(error.publicMessage).not.toContain("secret");
    expect(error.logContext?.statement).toBe(3);
  });

  it("at a statement in a PostgreSQL or SQLite transaction: says it was rolled back", () => {
    const error = requiredColumnMigrationRefusal(breaks, {
      source: "f.sql",
      dialect: "postgresql",
      at: {
        index: 1,
        transaction: true,
        statements: [
          "UPDATE t SET a = 1",
          "ALTER TABLE t ALTER a SET NOT NULL",
        ],
      },
    });
    expect(error.publicMessage).toContain(
      "rolled back, so none of them stayed applied"
    );
  });
});

describe("readRequiredColumnOwners", () => {
  // A field-group registry moved to its newer name is read there, as the push reads it, so
  // `nextly migrate` names the same field group the Schema Builder does.
  it("reads the field-group registry under the name it has now", async () => {
    const sqlite = new Database(":memory:");
    try {
      sqlite.exec(
        `CREATE TABLE dynamic_field_groups (slug TEXT, table_name TEXT, fields TEXT)`
      );
      sqlite.exec(
        `INSERT INTO dynamic_field_groups VALUES ('promo', 'fg_promo', '[{"name":"cta","type":"text"}]')`
      );
      const owners = await readRequiredColumnOwners(
        drizzle({ client: sqlite }),
        "sqlite"
      );
      expect(owners.owner("fg_promo")).toMatchObject({
        entity: { kind: "fieldGroup", slug: "promo" },
        fieldGroup: true,
      });
    } finally {
      sqlite.close();
    }
  });
});

describe("previewRequiredColumns", () => {
  // `--dry-run` reports a file it cannot count as a line of the preview, as a real run would
  // refuse it, rather than ending the whole preview on the first such file.
  it("reports a count that fails as a line, naming the table", async () => {
    const sqlite = new Database(":memory:");
    const lines: string[] = [];
    try {
      sqlite.exec(`CREATE TABLE dc_posts (id TEXT, title TEXT)`);
      const db = drizzle({ client: sqlite });
      // The table is read for its columns, then gone when its rows are counted.
      const failing = new Proxy(db, {
        get(target, key, receiver) {
          if (key === "all") {
            return (query: unknown) => {
              const text = JSON.stringify(query);
              if (text.includes("COUNT(*)"))
                throw new Error("table unreadable");
              return (target as unknown as { all(q: unknown): unknown }).all(
                query
              );
            };
          }
          return Reflect.get(target, key, receiver) as unknown;
        },
      });
      await previewRequiredColumns(
        failing,
        "sqlite",
        {
          upSql: `ALTER TABLE "dc_posts" ADD COLUMN "slug" text NOT NULL;`,
          transaction: true,
        },
        { info: message => lines.push(message) },
        false
      );
    } finally {
      sqlite.close();
    }
    expect(lines).toEqual([
      "    ✖ a real run would refuse it: Table 'dc_posts': the rows that would break making 'slug' required could not be counted, so that change was refused before it ran. Check that the database can be reached and the table read, then try again.",
    ]);
  });
});
