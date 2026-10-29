import { describe, it, expect } from "vitest";

import { NextlyError } from "../errors/nextly-error";

import { DbError } from "./errors";
import { asNotMigrated, withDbErrors } from "./with-db-errors";

describe("withDbErrors", () => {
  it("passes through successful results", async () => {
    const result = await withDbErrors(async () => 42);
    expect(result).toBe(42);
  });

  it("converts a DbError thrown inside to a NextlyError", async () => {
    const dbErr = new DbError({
      message: "duplicate key",
      kind: "unique-violation",
      dialect: "postgresql",
      cause: new Error("driver"),
    });

    await expect(
      withDbErrors(async () => {
        throw dbErr;
      })
    ).rejects.toMatchObject({
      name: "NextlyError",
      code: "DUPLICATE",
      statusCode: 409,
      publicMessage: "Resource already exists.",
    });
  });

  it("preserves the DbError as cause on the converted NextlyError", async () => {
    const dbErr = new DbError({
      message: "deadlock",
      kind: "deadlock",
      dialect: "postgresql",
      cause: new Error("driver"),
    });

    await expect(
      withDbErrors(async () => {
        throw dbErr;
      })
    ).rejects.toSatisfy((err: unknown) => {
      return NextlyError.is(err) && err.cause === dbErr;
    });
  });

  it("re-throws non-DbError errors unchanged", async () => {
    const otherErr = new Error("not a DbError");
    await expect(
      withDbErrors(async () => {
        throw otherErr;
      })
    ).rejects.toBe(otherErr);
  });

  it("re-throws NextlyError instances unchanged (no double-wrap)", async () => {
    const nextlyErr = NextlyError.notFound({ logContext: { id: "p_99" } });
    await expect(
      withDbErrors(async () => {
        throw nextlyErr;
      })
    ).rejects.toBe(nextlyErr);
  });

  it("supports synchronous returns from the wrapped function (returning a Promise)", async () => {
    const result = await withDbErrors(() => Promise.resolve("sync-async"));
    expect(result).toBe("sync-async");
  });
});

describe("asNotMigrated", () => {
  const posts = {
    tableName: "dc_posts",
    fields: [
      { name: "title", type: "text" },
      { name: "heroImage", type: "upload" },
      // A component keeps its values in its own table, so it has no column
      // here to be missing.
      { name: "body", type: "component" },
    ],
  };
  const entity = (row: unknown = posts) => ({
    kind: "collection" as const,
    slug: "posts",
    load: () => Promise.resolve(row as typeof posts),
  });
  const driver = (message: string, code: string) =>
    Object.assign(new Error(message), { code });
  /** The driver's error under the query builder's, which quotes the statement. */
  const statementOn = (table: string, cause: Error) =>
    new Error(`Failed query: select \`title\` from \`${table}\`\nparams: `, {
      cause,
    });
  /**
   * The adapter's error, as it wraps the driver's: under its own context line,
   * which quotes the statement, and with the driver's code copied onto it, so
   * it classifies as well as the driver's error beneath it does.
   */
  const wrapped = (cause: Error) =>
    Object.assign(
      new Error(
        `select operation failed on table 'dc_posts': Query failed: select "title", "hero_image" from "dc_posts"`,
        { cause }
      ),
      {
        name: "DatabaseError",
        kind: "query",
        code: (cause as { code?: string }).code,
      }
    );

  it("names the field whose column is missing, from its column's name", async () => {
    const answer = await asNotMigrated(
      wrapped(driver('column "hero_image" does not exist', "42703")),
      entity()
    );
    expect(answer).toMatchObject({
      code: "ENTITY_NOT_MIGRATED",
      statusCode: 409,
      publicData: {
        reason: "column",
        kind: "collection",
        slug: "posts",
        table: "dc_posts",
        field: "heroImage",
      },
    });
    // The driver's error stays on the answer, for the log.
    expect((answer as NextlyError).cause).toBeInstanceOf(Error);
  });

  it("names the entity and its table when its table is missing", async () => {
    const answer = await asNotMigrated(
      wrapped(driver("no such table: dc_posts", "SQLITE_ERROR")),
      entity()
    );
    expect(answer).toMatchObject({
      code: "ENTITY_NOT_MIGRATED",
      publicData: { reason: "table", table: "dc_posts" },
    });
  });

  it("says an entity this instance never registered is not registered", async () => {
    const refusal = Object.assign(
      new Error(
        `Table "dc_posts" not found in schema registry: this running instance has not registered it.`
      ),
      {
        name: "DatabaseError",
        kind: "query",
        code: "NEXTLY_TABLE_NOT_REGISTERED",
        table: "dc_posts",
      }
    );
    expect(await asNotMigrated(refusal, entity())).toMatchObject({
      code: "ENTITY_NOT_MIGRATED",
      publicData: { reason: "unregistered", table: "dc_posts" },
    });
  });

  it("leaves another table's absence as it was", async () => {
    // The statement's own table is named in the adapter's context line; the
    // table the driver reports missing is a different one, and saying the
    // entity's table is missing would send the operator after the wrong one.
    const error = wrapped(
      driver('relation "dc_posts_locales" does not exist', "42P01")
    );
    expect(await asNotMigrated(error, entity())).toBe(error);
  });

  it("leaves a missing column that is none of the entity's fields as it was", async () => {
    // The adapter's context line quotes `title` and `hero_image`; the column
    // the driver reports is another one.
    const error = wrapped(driver('column "_status" does not exist', "42703"));
    expect(await asNotMigrated(error, entity())).toBe(error);
  });

  it("never takes a word of the driver's sentence for a field", async () => {
    // Fields named like the words each dialect's sentence is made of: only the
    // identifier the sentence quotes or qualifies is a name.
    const worded = entity({
      tableName: "dc_posts",
      fields: [
        { name: "table", type: "text" },
        { name: "column", type: "text" },
        { name: "unknown", type: "text" },
        { name: "title", type: "text" },
      ],
    });
    for (const message of [
      "table dc_posts has no column named title",
      "no such column: title",
      'column "title" does not exist',
      "Unknown column 'title' in 'field list'",
    ]) {
      expect(
        await asNotMigrated(
          statementOn("dc_posts", driver(message, "SQLITE_ERROR")),
          worded
        ),
        message
      ).toMatchObject({ publicData: { field: "title" } });
    }
  });

  it("leaves a missing column of another table as it was", async () => {
    // A write of `posts` also writes a component's table; that table lacking a
    // column named like one of `posts`' fields is not `posts` unmigrated.
    for (const [message, code] of [
      ["table comp_hero has no column named title", "SQLITE_ERROR"],
      ['column "title" of relation "comp_hero" does not exist', "42703"],
      ["column comp_hero.title does not exist", "42703"],
      ["Unknown column 'comp_hero.title' in 'where clause'", "1054"],
    ] as const) {
      const error = driver(message, code);
      expect(await asNotMigrated(error, entity()), message).toBe(error);
    }
  });

  it("places an unqualified missing column by the statement that failed", async () => {
    // MySQL names no table: "Unknown column 'title' in 'field list'". Only the
    // failed statement says whose column it is, and a cascade into another
    // table is not the entity's field.
    const unqualified = () =>
      driver("Unknown column 'title' in 'field list'", "ER_BAD_FIELD_ERROR");
    expect(
      await asNotMigrated(statementOn("dc_posts", unqualified()), entity())
    ).toMatchObject({ publicData: { reason: "column", field: "title" } });
    expect(
      await asNotMigrated(
        Object.assign(unqualified(), {
          sql: "INSERT INTO `dc_posts` (`title`) VALUES (?)",
        }),
        entity()
      )
    ).toMatchObject({ publicData: { reason: "column", field: "title" } });
    for (const error of [
      statementOn("comp_hero", unqualified()),
      Object.assign(
        new Error(
          "insert operation failed on table 'comp_hero': Unknown column 'title' in 'field list'",
          { cause: unqualified() }
        ),
        {
          name: "DatabaseError",
          kind: "query",
          code: "1054",
          table: "comp_hero",
        }
      ),
      // mysql2 keeps the statement on its own error, for a raw statement no
      // query builder wrapped.
      Object.assign(unqualified(), {
        sql: "INSERT INTO `comp_hero` (`title`) VALUES (?)",
      }),
      // Nothing says where it was: left as it was, not guessed.
      unqualified(),
    ]) {
      expect(await asNotMigrated(error, entity())).toBe(error);
    }
  });

  it("names a translatable field whose column its companion table lacks", async () => {
    // A localized field's column lives on the entity's own `_locales` table.
    expect(
      await asNotMigrated(
        driver("column dc_posts_locales.title does not exist", "42703"),
        entity()
      )
    ).toMatchObject({ publicData: { reason: "column", field: "title" } });
    expect(
      await asNotMigrated(
        driver('column "title" of relation "dc_posts" does not exist', "42703"),
        entity()
      )
    ).toMatchObject({ publicData: { reason: "column", field: "title" } });
  });

  it("leaves an unrelated failure as it was, without reading the registry", async () => {
    let reads = 0;
    const error = wrapped(driver("duplicate key value", "23505"));
    const answer = await asNotMigrated(error, {
      kind: "collection",
      slug: "posts",
      load: () => {
        reads++;
        return Promise.resolve(posts);
      },
    });
    expect(answer).toBe(error);
    expect(reads).toBe(0);
  });

  it("leaves the error as it was when the registry row cannot be read", async () => {
    const error = wrapped(driver("no such table: dc_posts", "SQLITE_ERROR"));
    expect(
      await asNotMigrated(error, {
        kind: "collection",
        slug: "posts",
        load: () => Promise.reject(new Error("registry unavailable")),
      })
    ).toBe(error);
    expect(await asNotMigrated(error, entity(null))).toBe(error);
  });

  it("leaves a NextlyError as it was", async () => {
    const error = NextlyError.notFound();
    expect(await asNotMigrated(error, entity())).toBe(error);
    // A typed answer keeps its meaning even when a missing column caused it.
    const conflict = NextlyError.conflict({
      reason: "state",
      message: "Translations are not ready.",
      cause: driver('column "hero_image" does not exist', "42703"),
    });
    expect(await asNotMigrated(conflict, entity())).toBe(conflict);
  });

  it("reads beneath an internal error a layer below already made of it", async () => {
    // "Unexpected" is all INTERNAL_ERROR says; the driver's error on its cause
    // says what was missing.
    const internal = NextlyError.internal({
      cause: wrapped(driver('column "hero_image" does not exist', "42703")),
    });
    expect(await asNotMigrated(internal, entity())).toMatchObject({
      code: "ENTITY_NOT_MIGRATED",
      publicData: { reason: "column", field: "heroImage" },
    });
  });
});
