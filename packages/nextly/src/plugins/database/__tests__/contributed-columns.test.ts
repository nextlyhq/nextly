/**
 * `ctx.db.contributed` — a contributor's typed path to the columns it added to
 * a table it does not own, and to nothing else there.
 *
 * Run against a real in-memory SQLite database through Drizzle, so what is
 * asserted is what the statements actually read and wrote. `dc_posts` carries
 * the collection's own `title`, a column plugin `fx` contributed
 * (`search_vector`) and one plugin `other` contributed (`seo_score`). Every
 * refusal has a control beside it that the same call shape is answered for
 * the caller's own column, so a surface that refused everything fails.
 */
import Database from "better-sqlite3";
import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { col } from "../../../domains/schema/extension/dsl";
import type { SchemaOwner } from "../../../domains/schema/extension/types";
import { NextlyError } from "../../../errors/nextly-error";
import type { ContributedColumn } from "../access";
import { createPluginDatabase } from "../plugin-database";

const FX: SchemaOwner = { kind: "plugin", id: "fx" };
const OTHER: SchemaOwner = { kind: "plugin", id: "other" };
const APP: SchemaOwner = { kind: "app" };

/** The runtime table, keyed as an entity's runtime table keys contributed columns. */
const posts = sqliteTable("dc_posts", {
  id: text("id").primaryKey(),
  title: text("title"),
  search_vector: text("search_vector"),
  seo_score: text("seo_score"),
  app_flag: text("app_flag"),
});
const fxNotes = sqliteTable("fx__notes", {
  id: text("id").primaryKey(),
  postId: text("post_id"),
  app_note: text("app_note"),
  other_tag: text("other_tag"),
});
/** A plugin table keyed by a database-assigned number, as `col.serial()` makes. */
const fxCounters = sqliteTable("fx__counters", {
  seq: integer("seq").primaryKey(),
  app_mark: text("app_mark"),
});
const relations = defineRelations(
  { dc_posts: posts, fx__notes: fxNotes },
  r => ({
    fx__notes: {
      post: r.one.dc_posts({ from: r.fx__notes.postId, to: r.dc_posts.id }),
    },
  })
);

/** What each contributor declared through `schema.extendTable("dc_posts", …)`. */
const fxColumns = { searchVector: col.text({ nullable: true }) };
const otherColumns = { seoScore: col.text({ nullable: true }) };
const appColumns = { appFlag: col.text({ nullable: true }) };
/** What the app contributed to plugin fx's own table. */
const appOnFxColumns = { appNote: col.text({ nullable: true }) };

/** One contribution as the compiled schema records it: a nullable text column. */
function contribution(
  name: string,
  key: string,
  contributedBy: SchemaOwner
): ContributedColumn {
  return {
    name,
    key,
    contributedBy,
    spec: { key, name, kind: "text", nullable: true, hidden: true },
  };
}

const CONTRIBUTIONS = new Map<string, readonly ContributedColumn[]>([
  [
    "dc_posts",
    [
      contribution("search_vector", "searchVector", FX),
      contribution("seo_score", "seoScore", OTHER),
      contribution("app_flag", "appFlag", APP),
    ],
  ],
  ["fx__counters", [contribution("app_mark", "appMark", APP)]],
  [
    "fx__notes",
    [
      contribution("app_note", "appNote", APP),
      contribution("other_tag", "otherTag", OTHER),
    ],
  ],
]);

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  // A toy table for this test, not a copy of a production one.
  sqlite.exec(
    "CREATE TABLE dc_posts (id TEXT PRIMARY KEY, title TEXT, search_vector TEXT, seo_score TEXT, app_flag TEXT);" +
      "CREATE TABLE fx__notes (id TEXT PRIMARY KEY, post_id TEXT, app_note TEXT, other_tag TEXT);" +
      "CREATE TABLE fx__counters (seq INTEGER PRIMARY KEY, app_mark TEXT);" +
      "INSERT INTO fx__counters VALUES (7, 'seven');" +
      "INSERT INTO dc_posts VALUES ('p1', 'Hello', 'hello world', '90', 'on');" +
      "INSERT INTO dc_posts VALUES ('p2', 'Other', NULL, NULL, NULL);" +
      "INSERT INTO fx__notes VALUES ('n1', 'p1', 'from app', 'tagged');"
  );
});

afterEach(() => {
  sqlite.close();
});

function surfaceFor(owner: SchemaOwner, dependsOn: string[] = []) {
  const db = drizzle({ client: sqlite, relations });
  return createPluginDatabase({
    dialect: "sqlite",
    owner,
    dependsOn: new Set(dependsOn),
    owners: () =>
      new Map<string, SchemaOwner>([
        ["fx__notes", FX],
        ["fx__counters", FX],
      ]),
    tables: () => ({ fx__notes: fxNotes }),
    tableList: () => [{ name: "fx__notes", authored: "notes", owner: FX }],
    db: () => db,
    relationalDb: () => db,
    // better-sqlite3 refuses an async callback, so the transaction is opened
    // and closed by statement, as the adapter's SQLite path does.
    transaction: async fn => {
      sqlite.exec("BEGIN");
      try {
        const result = await fn({ db, relationalDb: db });
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    contributions: () => CONTRIBUTIONS,
    entityTable: name =>
      ({ dc_posts: posts, fx__notes: fxNotes, fx__counters: fxCounters })[name],
  });
}

function stored(id: string): Record<string, unknown> {
  return sqlite
    .prepare("SELECT * FROM dc_posts WHERE id = ?")
    .get(id) as Record<string, unknown>;
}

async function refusal(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("a plugin's own contributed column", () => {
  it("is read by id, alone beside the key", async () => {
    const row = await surfaceFor(FX)
      .contributed("dc_posts", fxColumns)
      .get("p1");

    // Exactly the key and the caller's column: not the title, not the other
    // plugin's column.
    expect(row).toEqual({ id: "p1", searchVector: "hello world" });
  });

  it("works with its methods taken off the object", async () => {
    // A destructured method has no receiver; one that reached its siblings
    // through `this` threw here.
    const { get, set } = surfaceFor(FX).contributed("dc_posts", fxColumns);
    await set("p2", { searchVector: "detached" });
    expect(await get("p2")).toEqual({ id: "p2", searchVector: "detached" });
  });

  it("reads several rows, and none for an id with no row", async () => {
    const reader = surfaceFor(FX).contributed("dc_posts", fxColumns);
    const rows = await reader.getMany(["p1", "p2", "missing"]);
    expect(rows).toHaveLength(2);
    expect(await reader.get("missing")).toBeNull();
  });

  it("is written by id, and nothing else on the row changes", async () => {
    const changed = await surfaceFor(FX)
      .contributed("dc_posts", fxColumns)
      .set("p2", { searchVector: "other text" });

    expect(changed).toBe(1);
    expect(stored("p2")).toEqual({
      id: "p2",
      title: "Other",
      search_vector: "other text",
      seo_score: null,
      app_flag: null,
    });
  });

  it("is read and written inside a transaction", async () => {
    const surface = surfaceFor(FX);
    const read = await surface.transaction(async tx => {
      await tx
        .contributed("dc_posts", fxColumns)
        .set("p1", { searchVector: "in tx" });
      return tx.contributed("dc_posts", fxColumns).get("p1");
    });

    expect(read).toEqual({ id: "p1", searchVector: "in tx" });
    expect(stored("p1").search_vector).toBe("in tx");
  });
});

describe("what a plugin may not reach on the same table", () => {
  it("refuses the table's own column, for a read and for a write", async () => {
    const surface = surfaceFor(FX);
    const read = await refusal(() =>
      surface
        .contributed("dc_posts", { title: col.text({ nullable: true }) })
        .get("p1")
    );
    const write = await refusal(() =>
      surface
        .contributed("dc_posts", fxColumns)
        .set("p1", { title: "Hijacked" } as never)
    );

    expect(NextlyError.isForbidden(read)).toBe(true);
    expect(NextlyError.isForbidden(write)).toBe(true);
    expect(stored("p1").title).toBe("Hello");
  });

  it("refuses another plugin's contributed column", async () => {
    const surface = surfaceFor(FX);
    const read = await refusal(() =>
      surface.contributed("dc_posts", otherColumns).get("p1")
    );
    const write = await refusal(() =>
      surface
        .contributed("dc_posts", fxColumns)
        .set("p1", { seoScore: "0" } as never)
    );

    expect(NextlyError.isForbidden(read)).toBe(true);
    expect(NextlyError.isForbidden(write)).toBe(true);
    expect(stored("p1").seo_score).toBe("90");
  });

  it("refuses a whole-row insert or delete through the ordinary methods", async () => {
    const surface = surfaceFor(FX);
    const definition = {
      name: "dc_posts",
      columns: [],
      indexes: [],
      foreignKeys: [],
      checks: [],
      relations: [],
    };
    const inserted = await refusal(() =>
      surface.insert(definition as never, { id: "p3" } as never)
    );
    const deleted = await refusal(() =>
      surface.delete(definition as never).where(undefined as never)
    );

    expect(NextlyError.isForbidden(inserted)).toBe(true);
    expect(NextlyError.isForbidden(deleted)).toBe(true);
    expect(sqlite.prepare("SELECT count(*) AS n FROM dc_posts").get()).toEqual({
      n: 2,
    });
  });

  it("refuses the entity through a relation from its own table", async () => {
    const surface = surfaceFor(FX);
    // The control: the plugin's own table answers without the relation.
    await expect(surface.query.fx__notes.findMany()).resolves.toHaveLength(1);

    const joined = await refusal(() =>
      surface.query.fx__notes.findMany({ with: { post: true } })
    );
    expect(NextlyError.isForbidden(joined)).toBe(true);
  });

  it("refuses inside a transaction exactly as outside one", async () => {
    const refused = await refusal(() =>
      surfaceFor(FX).transaction(tx =>
        tx.contributed("dc_posts", otherColumns).get("p1")
      )
    );
    expect(NextlyError.isForbidden(refused)).toBe(true);
  });
});

describe("the app as a contributor", () => {
  it("reaches the column the app contributed, and not a plugin's", async () => {
    const surface = surfaceFor(APP);

    await surface
      .contributed("dc_posts", appColumns)
      .set("p1", { appFlag: "off" });
    expect(await surface.contributed("dc_posts", appColumns).get("p1")).toEqual(
      { id: "p1", appFlag: "off" }
    );

    const refused = await refusal(() =>
      surface.contributed("dc_posts", fxColumns).get("p1")
    );
    expect(NextlyError.isForbidden(refused)).toBe(true);
  });
});

describe("the app's column on a plugin's table", () => {
  // The app's ctx.db is refused the plugin's table outright, so its own
  // contribution there is reached the same way as one on a collection.
  it("is reached by the app, and the rest of the table is not", async () => {
    const surface = surfaceFor(APP);
    const notes = surface.contributed("fx__notes", appOnFxColumns);

    expect(await notes.get("n1")).toEqual({ id: "n1", appNote: "from app" });
    await notes.set("n1", { appNote: "changed" });
    expect(
      sqlite.prepare("SELECT * FROM fx__notes WHERE id = 'n1'").get()
    ).toEqual({
      id: "n1",
      post_id: "p1",
      app_note: "changed",
      other_tag: "tagged",
    });

    const refused = await refusal(() =>
      surface
        .contributed("fx__notes", { postId: col.text({ nullable: true }) })
        .get("n1")
    );
    expect(NextlyError.isForbidden(refused)).toBe(true);
  });

  it("is written by a plugin on a dependency's table it may already read", async () => {
    // `other` depends on fx, so it reads fx's table through the ordinary
    // methods — but those write through fx's definition, which does not
    // declare `other`'s column. `contributed` is how it writes that column.
    const otherTag = { otherTag: col.text({ nullable: true }) };
    const surface = surfaceFor(OTHER, ["fx"]);

    await surface.contributed("fx__notes", otherTag).set("n1", {
      otherTag: "retagged",
    });
    expect(await surface.contributed("fx__notes", otherTag).get("n1")).toEqual({
      id: "n1",
      otherTag: "retagged",
    });

    // Still only its own: the app's column and fx's own column are refused.
    const appsColumn = await refusal(() =>
      surface.contributed("fx__notes", appOnFxColumns).get("n1")
    );
    const ownersColumn = await refusal(() =>
      surface
        .contributed("fx__notes", { postId: col.text({ nullable: true }) })
        .get("n1")
    );
    expect(NextlyError.isForbidden(appsColumn)).toBe(true);
    expect(NextlyError.isForbidden(ownersColumn)).toBe(true);
  });

  it("is refused to a plugin that did not contribute it", async () => {
    const refused = await refusal(() =>
      surfaceFor(OTHER).contributed("fx__notes", appOnFxColumns).get("n1")
    );
    expect(NextlyError.isForbidden(refused)).toBe(true);
  });
});

describe("a table keyed by a number", () => {
  it("is read and written by its numeric key, returned as `id`", async () => {
    const counters = surfaceFor(APP).contributed("fx__counters", {
      appMark: col.text({ nullable: true }),
    });

    await expect(counters.set(7, { appMark: "marked" })).resolves.toBe(1);
    // The key column is `seq`; the row reports it as `id`, as the number it is.
    expect(await counters.get(7)).toEqual({ id: 7, appMark: "marked" });
  });
});
