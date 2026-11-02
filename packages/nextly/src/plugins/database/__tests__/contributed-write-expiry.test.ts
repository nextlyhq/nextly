/**
 * A `ctx.db.contributed` write expires the cached reads of the entry or Single
 * whose row it changed, and nothing else.
 *
 * Run against a real in-memory SQLite database through Drizzle, so the parent
 * a field group's row names is read back as the statement reads it.
 * `expireContent` records what it is asked to expire; what an expiry then
 * flushes is `expire-content-target`'s, tested beside it.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EntityOwner } from "../../../domains/schema/extension/build-extension-schema";
import { col } from "../../../domains/schema/extension/dsl";
import type { SchemaOwner } from "../../../domains/schema/extension/types";
import * as logger from "../../../observability/logger";
import type { ContributedColumn } from "../access";
import { type ContentTarget, MAX_COMPONENT_DEPTH } from "../content-target";
import { createPluginDatabase } from "../plugin-database";

const FX: SchemaOwner = { kind: "plugin", id: "fx" };

const posts = sqliteTable("dc_posts", {
  id: text("id").primaryKey(),
  fx_flag: text("fx_flag"),
});
const banner = sqliteTable("single_banner", {
  id: text("id").primaryKey(),
  fx_flag: text("fx_flag"),
});
/** A field group, with the parent columns every field group's table has. */
function fieldGroupTable(name: string) {
  return sqliteTable(name, {
    id: text("id").primaryKey(),
    _parent_id: text("_parent_id"),
    _parent_table: text("_parent_table"),
    fx_flag: text("fx_flag"),
  });
}
const hero = fieldGroupTable("comp_hero");
const cta = fieldGroupTable("comp_cta");
const chain = fieldGroupTable("comp_chain");
const notes = sqliteTable("fx__notes", {
  id: text("id").primaryKey(),
  fx_flag: text("fx_flag"),
});
const RUNTIME: Record<string, unknown> = {
  dc_posts: posts,
  single_banner: banner,
  comp_hero: hero,
  comp_cta: cta,
  comp_chain: chain,
  fx__notes: notes,
};

/** What the compiled schema seeded each entity table from. */
const OWNERS = new Map<string, EntityOwner>([
  ["dc_posts", { kind: "collection", slug: "posts" }],
  ["single_banner", { kind: "single", slug: "banner" }],
  ["comp_hero", { kind: "component", slug: "hero" }],
  ["comp_cta", { kind: "component", slug: "cta" }],
  ["comp_chain", { kind: "component", slug: "chain" }],
]);

const flagColumns = { fxFlag: col.text({ nullable: true }) };
const CONTRIBUTIONS = new Map<string, readonly ContributedColumn[]>(
  Object.keys(RUNTIME).map(table => [
    table,
    [
      {
        name: "fx_flag",
        key: "fxFlag",
        contributedBy: FX,
        spec: {
          key: "fxFlag",
          name: "fx_flag",
          kind: "text",
          nullable: true,
          hidden: true,
        },
      },
    ],
  ])
);

/** `comp_chain` rows k0…k{n-1}, each inside the next, the last inside post p1. */
function chainOf(length: number): string {
  const rows: string[] = [];
  for (let i = 0; i < length; i++) {
    const parent =
      i === length - 1 ? "'p1', 'dc_posts'" : `'k${i + 1}', 'comp_chain'`;
    rows.push(`INSERT INTO comp_chain VALUES ('k${i}', ${parent}, NULL);`);
  }
  return rows.join("");
}

let sqlite: Database.Database;
let expired: ContentTarget[];

beforeEach(() => {
  sqlite = new Database(":memory:");
  expired = [];
  // Toy tables for this test, not copies of production ones.
  sqlite.exec(
    "CREATE TABLE dc_posts (id TEXT PRIMARY KEY, fx_flag TEXT);" +
      "CREATE TABLE single_banner (id TEXT PRIMARY KEY, fx_flag TEXT);" +
      "CREATE TABLE comp_hero (id TEXT PRIMARY KEY, _parent_id TEXT, _parent_table TEXT, fx_flag TEXT);" +
      "CREATE TABLE comp_cta (id TEXT PRIMARY KEY, _parent_id TEXT, _parent_table TEXT, fx_flag TEXT);" +
      "CREATE TABLE comp_chain (id TEXT PRIMARY KEY, _parent_id TEXT, _parent_table TEXT, fx_flag TEXT);" +
      "CREATE TABLE fx__notes (id TEXT PRIMARY KEY, fx_flag TEXT);" +
      "INSERT INTO dc_posts VALUES ('p1', NULL);" +
      "INSERT INTO single_banner VALUES ('b1', NULL);" +
      "INSERT INTO comp_hero VALUES ('h1', 'p1', 'dc_posts', NULL);" +
      "INSERT INTO comp_hero VALUES ('h2', 'b1', 'single_banner', NULL);" +
      "INSERT INTO comp_hero VALUES ('orphan', NULL, NULL, NULL);" +
      "INSERT INTO comp_cta VALUES ('c1', 'h1', 'comp_hero', NULL);" +
      "INSERT INTO comp_cta VALUES ('loop', 'loop', 'comp_cta', NULL);" +
      "INSERT INTO fx__notes VALUES ('n1', NULL);"
  );
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

function surface(
  overrides: Partial<Parameters<typeof createPluginDatabase>[0]> = {}
) {
  const db = drizzle({ client: sqlite });
  return createPluginDatabase({
    dialect: "sqlite",
    owner: FX,
    dependsOn: new Set(),
    owners: () => new Map([["fx__notes", FX]]),
    tables: () => ({ fx__notes: notes }),
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
    entityTable: name => RUNTIME[name],
    contentEntity: name => OWNERS.get(name),
    expireContent: target => {
      expired.push(target);
      return Promise.resolve();
    },
    ...overrides,
  });
}

async function setFlag(table: string, id: string): Promise<number> {
  return surface().contributed(table, flagColumns).set(id, { fxFlag: "on" });
}

describe("a contributed write expires its document's cached reads", () => {
  it("expires the collection entry whose row it changed", async () => {
    expect(await setFlag("dc_posts", "p1")).toBe(1);
    expect(expired).toEqual([{ kind: "collection", slug: "posts", id: "p1" }]);
  });

  it("expires the Single whose row it changed", async () => {
    await setFlag("single_banner", "b1");
    expect(expired).toEqual([{ kind: "single", slug: "banner" }]);
  });

  it("expires the entry a field group's row sits in", async () => {
    await setFlag("comp_hero", "h1");
    expect(expired).toEqual([{ kind: "collection", slug: "posts", id: "p1" }]);
  });

  it("expires the Single a field group's row sits in", async () => {
    await setFlag("comp_hero", "h2");
    expect(expired).toEqual([{ kind: "single", slug: "banner" }]);
  });

  it("climbs a field group inside a field group to its entry", async () => {
    await setFlag("comp_cta", "c1");
    expect(expired).toEqual([{ kind: "collection", slug: "posts", id: "p1" }]);
  });

  it(`climbs ${MAX_COMPONENT_DEPTH} field groups, and stops at one more`, async () => {
    const warn = vi.fn();
    vi.spyOn(logger, "getNextlyLogger").mockReturnValue({
      error: vi.fn(),
      warn,
      info: vi.fn(),
      debug: vi.fn(),
    } as never);

    sqlite.exec(chainOf(MAX_COMPONENT_DEPTH));
    await setFlag("comp_chain", "k0");
    expect(expired).toEqual([{ kind: "collection", slug: "posts", id: "p1" }]);
    expect(warn).not.toHaveBeenCalled();

    expired = [];
    sqlite.exec("DELETE FROM comp_chain;" + chainOf(MAX_COMPONENT_DEPTH + 1));
    expect(await setFlag("comp_chain", "k0")).toBe(1);
    expect(expired).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "contributed-write-parent-too-deep" })
    );
  });

  it("ends a parent chain that loops, expiring nothing", async () => {
    vi.spyOn(logger, "getNextlyLogger").mockReturnValue({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } as never);
    expect(await setFlag("comp_cta", "loop")).toBe(1);
    expect(expired).toEqual([]);
  });

  it("expires nothing for a field group's row that names no parent", async () => {
    expect(await setFlag("comp_hero", "orphan")).toBe(1);
    expect(expired).toEqual([]);
  });

  it("expires nothing when the write changed no row", async () => {
    expect(await setFlag("dc_posts", "missing")).toBe(0);
    expect(expired).toEqual([]);
  });

  it("expires nothing for a table no collection or Single stores", async () => {
    expect(await setFlag("fx__notes", "n1")).toBe(1);
    expect(expired).toEqual([]);
  });
});

describe("a contributed write whose document cannot be found", () => {
  it("still resolves, the write kept, and says what was not expired", async () => {
    const warn = vi.fn();
    vi.spyOn(logger, "getNextlyLogger").mockReturnValue({
      error: vi.fn(),
      warn,
      info: vi.fn(),
      debug: vi.fn(),
    } as never);
    const failing = surface({
      contentEntity: () => {
        throw new Error("registry unavailable");
      },
    });

    await expect(
      failing.contributed("dc_posts", flagColumns).set("p1", { fxFlag: "on" })
    ).resolves.toBe(1);
    expect(
      sqlite.prepare("SELECT fx_flag FROM dc_posts WHERE id = 'p1'").get()
    ).toEqual({ fx_flag: "on" });
    expect(expired).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "contributed-write-expiry-failed",
        table: "dc_posts",
        id: "p1",
      })
    );
  });
});

describe("a contributed write whose expiry fails and whose logger throws", () => {
  it("still resolves, the write kept", async () => {
    vi.spyOn(logger, "getNextlyLogger").mockReturnValue({
      error: vi.fn(),
      warn: () => {
        throw new Error("logger down");
      },
      info: vi.fn(),
      debug: vi.fn(),
    } as never);
    const failing = surface({
      contentEntity: () => {
        throw new Error("registry unavailable");
      },
    });

    await expect(
      failing.contributed("dc_posts", flagColumns).set("p1", { fxFlag: "on" })
    ).resolves.toBe(1);
    expect(
      sqlite.prepare("SELECT fx_flag FROM dc_posts WHERE id = 'p1'").get()
    ).toEqual({ fx_flag: "on" });
  });
});

describe("a contributed write inside ctx.db.transaction", () => {
  it("expires once the transaction commits, not before", async () => {
    let duringCallback: ContentTarget[] | undefined;
    await surface().transaction(async tx => {
      await tx.contributed("comp_cta", flagColumns).set("c1", { fxFlag: "on" });
      duringCallback = [...expired];
    });
    expect(duringCallback).toEqual([]);
    expect(expired).toEqual([{ kind: "collection", slug: "posts", id: "p1" }]);
  });

  it("expires nothing when the transaction rolls back", async () => {
    await expect(
      surface().transaction(async tx => {
        await tx
          .contributed("dc_posts", flagColumns)
          .set("p1", { fxFlag: "on" });
        throw new Error("rolled back on purpose");
      })
    ).rejects.toThrow("rolled back on purpose");
    expect(expired).toEqual([]);
    expect(
      sqlite.prepare("SELECT fx_flag FROM dc_posts WHERE id = 'p1'").get()
    ).toEqual({ fx_flag: null });
  });
});
