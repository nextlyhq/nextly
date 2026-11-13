/**
 * drizzle-kit's PostgreSQL push over the configured schema.
 *
 * What separates this from a plausible broken version: the kit must see the
 * desired tables IN the configured schema (left as `public`, it proposes
 * moving every one), the statements it writes must come back unqualified for
 * that schema only (a literal, and another schema's qualifier, untouched), and
 * every table must be put back afterwards, even when the push throws.
 */
import { getTableConfig, pgTable, text } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearActivePostgresSchema,
  setActivePostgresSchema,
} from "../../services/postgres-schema";
import { pushInActiveSchema, unqualifySchema } from "../pg-active-schema-push";

afterEach(() => {
  clearActivePostgresSchema();
});

function tables() {
  const users = pgTable("users", { id: text("id").primaryKey() });
  const posts = pgTable("posts", {
    id: text("id").primaryKey(),
    author: text("author").references(() => users.id),
  });
  return { users, posts };
}

describe("unqualifySchema", () => {
  it("removes the configured schema's qualifier wherever drizzle-kit writes it", () => {
    expect(
      unqualifySchema(
        'ALTER TABLE "cms"."posts" ADD CONSTRAINT "posts_author_fk" FOREIGN KEY ("author") REFERENCES "cms"."users"("id");',
        "cms"
      )
    ).toBe(
      'ALTER TABLE "posts" ADD CONSTRAINT "posts_author_fk" FOREIGN KEY ("author") REFERENCES "users"("id");'
    );
  });

  it("leaves a string literal that spells the qualifier as it was", () => {
    // The literal holds a doubled quote too, so the scan must not end it early.
    const statement = `ALTER TABLE "cms"."posts" ALTER COLUMN "note" SET DEFAULT 'see "cms".x, it''s fine';`;
    expect(unqualifySchema(statement, "cms")).toBe(
      `ALTER TABLE "posts" ALTER COLUMN "note" SET DEFAULT 'see "cms".x, it''s fine';`
    );
  });

  it("leaves another schema's qualifier, and a name that only starts like it", () => {
    expect(
      unqualifySchema('SELECT 1 FROM "cms2"."posts", "other"."cms"', "cms")
    ).toBe('SELECT 1 FROM "cms2"."posts", "other"."cms"');
  });
});

describe("pushInActiveSchema", () => {
  it("shows drizzle-kit the desired tables in the configured schema, and puts them back", async () => {
    setActivePostgresSchema("cms");
    const { users, posts } = tables();
    let seen: { schema: string; users?: string; posts?: string } | undefined;

    const answer = await pushInActiveSchema({ users, posts }, schema => {
      seen = {
        schema,
        users: getTableConfig(users).schema,
        posts: getTableConfig(posts).schema,
      };
      return Promise.resolve({
        sqlStatements: ['CREATE TABLE "cms"."users" ("id" text PRIMARY KEY);'],
        hints: [{ hint: "x", statement: 'DROP TABLE "cms"."old";' }],
      });
    });

    expect(seen).toEqual({ schema: "cms", users: "cms", posts: "cms" });
    expect(answer.sqlStatements).toEqual([
      'CREATE TABLE "users" ("id" text PRIMARY KEY);',
    ]);
    expect(answer.hints).toEqual([{ hint: "x", statement: 'DROP TABLE "old";' }]);
    expect(getTableConfig(users).schema).toBeUndefined();
    expect(getTableConfig(posts).schema).toBeUndefined();
  });

  it("puts every table back when the push throws", async () => {
    setActivePostgresSchema("cms");
    const { users, posts } = tables();

    await expect(
      pushInActiveSchema({ users, posts }, () =>
        Promise.reject(new Error("kit failed"))
      )
    ).rejects.toThrow("kit failed");

    expect(getTableConfig(users).schema).toBeUndefined();
    expect(getTableConfig(posts).schema).toBeUndefined();
  });

  it("changes nothing for an installation in public", async () => {
    const { users } = tables();
    const kitAnswer = {
      sqlStatements: ['CREATE TABLE "users" ("id" text PRIMARY KEY);'],
      hints: [],
    };
    let seen: { schema: string; table?: string } | undefined;

    const answer = await pushInActiveSchema({ users }, schema => {
      seen = { schema, table: getTableConfig(users).schema };
      return Promise.resolve(kitAnswer);
    });

    expect(seen).toEqual({ schema: "public", table: undefined });
    expect(answer).toBe(kitAnswer);
  });
});
