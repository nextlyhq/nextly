/**
 * The judgement `nextly migrate` makes of a file's required columns, with the database replaced
 * by facts the test states: which tables the registry names, which columns are live and
 * nullable, and a counter that answers per table. What separates it from a plausible broken
 * judgement: a table the registry does not name is never counted, a field group's rows are
 * named by each collection and Single holding them, and a count that fails refuses rather than
 * passing.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { RowsBreakingNotNull } from "../../pipeline/classifier/count-helpers";
import {
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
      column === "missing"
        ? undefined
        : { nullable: !NOT_NULL.has(`${table}.${String(column)}`) },
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

  it("leaves alone a table the registry does not name, a column not there, one already NOT NULL, and a zero count", async () => {
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
    // Only the column that could hold a null was counted.
    expect(f.counted).toEqual(["dc_pages.body"]);
  });

  it("a count that fails refuses, naming the table, rather than letting the change run", async () => {
    const f = facts({ "dc_posts.sub_title": new Error("connection lost") });
    const error = await judgeRequiredColumnTargets(
      [{ table: "dc_posts", column: "sub_title", required: "sub_title" }],
      f
    ).then(
      () => undefined,
      (thrown: unknown) => thrown
    );
    expect(NextlyError.is(error)).toBe(true);
    expect((error as NextlyError).logMessage).toContain("'dc_posts'");
    expect((error as NextlyError).logContext?.reason).toBe(
      "required-column-count-failed"
    );
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
