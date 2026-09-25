/**
 * What `ctx.db` fills in, and what it sends to the driver.
 *
 * Driven through a fake handle rather than a database: the behaviour under
 * test is what the surface DECIDES — which columns it generates, which names
 * it maps to, which table it resolves — and a real connection would only make
 * those decisions harder to observe. The three-dialect behaviour is the
 * integration suite's job.
 */
import { describe, expect, it, vi } from "vitest";

import { col, defineTable } from "../../../domains/schema/extension/dsl";
import type { SchemaOwner } from "../../../domains/schema/extension/types";
import { NextlyError } from "../../../errors/nextly-error";
import { uuidV7Timestamp } from "../../../utils/uuid-v7";
import { createPluginDatabase } from "../plugin-database";

const notes = defineTable("notes", {
  id: col.id(),
  bodyText: col.shortText(),
  archived: col.boolean({ default: false }),
  ...col.timestamps(),
});

const OWNER: SchemaOwner = { kind: "plugin", id: "fx" };

function harness() {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];

  const db = {
    insert: () => ({
      values: (rows: unknown) => {
        inserted.push(rows);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: () => {
          updated.push(values);
          return Promise.resolve({ rowCount: 3 });
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve({ rowCount: 2 }) }),
  };

  const surface = createPluginDatabase({
    dialect: "postgresql",
    owner: OWNER,
    dependsOn: new Set(),
    owners: () => new Map([["fx__notes", OWNER]]),
    tables: () => ({ fx__notes: { name: "fx__notes" } }),
    tableList: () => [{ name: "fx__notes", authored: "notes", owner: OWNER }],
    db: () => db,
    relationalDb: () => db,
    transaction: fn => fn(db),
  });

  return { surface, inserted, updated };
}

describe("generated columns on insert", () => {
  it("fills a uuidv7 id when the caller omits one", async () => {
    const { surface, inserted } = harness();
    await surface.insert(notes, { bodyText: "hello" } as never);

    const row = (inserted[0] as Record<string, unknown>[])[0];
    // A real v7, not merely a string: the timestamp must decode.
    expect(uuidV7Timestamp(row.id as string)).not.toBeNull();
  });

  it("keeps an id the caller supplied", async () => {
    // The control. A generator that always overwrote would satisfy the test
    // above and silently discard a caller's chosen key.
    const { surface, inserted } = harness();
    await surface.insert(notes, {
      id: "11111111-1111-7111-8111-111111111111",
      bodyText: "hello",
    } as never);

    const row = (inserted[0] as Record<string, unknown>[])[0];
    expect(row.id).toBe("11111111-1111-7111-8111-111111111111");
  });

  it("fills the timestamps the DSL declares", async () => {
    const { surface, inserted } = harness();
    await surface.insert(notes, { bodyText: "hello" } as never);

    const row = (inserted[0] as Record<string, unknown>[])[0];
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.updated_at).toBeInstanceOf(Date);
  });

  it("maps authored keys onto their SQL column names", async () => {
    const { surface, inserted } = harness();
    await surface.insert(notes, { bodyText: "hello" } as never);

    const row = (inserted[0] as Record<string, unknown>[])[0];
    // `bodyText` is stored as `body_text`; sending the authored spelling
    // would be a column the table does not have.
    expect(row).toHaveProperty("body_text", "hello");
    expect(row).not.toHaveProperty("bodyText");
  });

  it("accepts an array of rows", async () => {
    const { surface, inserted } = harness();
    await surface.insert(notes, [
      { bodyText: "one" },
      { bodyText: "two" },
    ] as never);
    expect(inserted[0]).toHaveLength(2);
  });
});

describe("update", () => {
  it("refreshes the column marked onUpdate, and reports affected rows", async () => {
    const { surface, updated } = harness();
    const affected = await surface
      .update(notes, { bodyText: "changed" } as never)
      .where({} as never);

    const values = updated[0] as Record<string, unknown>;
    expect(values.updated_at).toBeInstanceOf(Date);
    expect(values.body_text).toBe("changed");
    // `created_at` must NOT be rewritten: it records when the row was made.
    expect(values).not.toHaveProperty("created_at");
    expect(affected).toBe(3);
  });
});

describe("delete", () => {
  it("reports affected rows", async () => {
    const { surface } = harness();
    expect(await surface.delete(notes).where({} as never)).toBe(2);
  });
});

describe("access", () => {
  it("refuses a table this owner cannot reach", async () => {
    const { surface } = harness();
    const stranger = defineTable("invoices", { id: col.id() });
    await expect(surface.insert(stranger, {} as never)).rejects.toThrow(
      NextlyError
    );
  });
});

describe("the surface ctx.db used to be", () => {
  it("refuses an old-style call by name, pointing at ctx.db.raw", async () => {
    // `ctx.db` was the Drizzle instance, so plugins wrote
    // `ctx.db.select().from(table)`. The four verbs now take the table
    // DEFINITION, and a call written the old way reached `sqlNameOf(undefined)`
    // and died on a missing property — saying nothing about what changed.
    const { surface } = harness();

    let message = "";
    try {
      (surface.select as unknown as () => void)();
    } catch (error) {
      const data = (
        error as { publicData?: { errors?: { message: string }[] } }
      ).publicData;
      message = data?.errors?.[0]?.message ?? "";
    }

    expect(message).toContain("ctx.db.raw");
    expect(message).toContain("ctx.db.select(myTable)");
  });

  it("still accepts a real definition", async () => {
    // The control: a guard that refused everything would satisfy the test
    // above and break the surface.
    const { surface, inserted } = harness();
    await surface.insert(notes, { bodyText: "ok" } as never);
    expect(inserted).toHaveLength(1);
  });
});

describe("transaction", () => {
  it("runs the callback against a surface bound to the transaction handle", async () => {
    const { surface, inserted } = harness();
    await surface.transaction(async tx => {
      await tx.insert(notes, { bodyText: "inside" } as never);
    });
    expect(inserted).toHaveLength(1);
  });

  it("runs the work INSIDE the transaction the deps supply", async () => {
    // `ctx.db.transaction` used to call the callback directly, opening no
    // transaction at all: a plugin that wrote twice and then threw kept the
    // first write. The surface has to hand the work to the transaction it was
    // given, which on SQLite is the adapter's manual BEGIN IMMEDIATE path.
    const order: string[] = [];
    const db = {
      insert: () => ({ values: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve({}) }) }),
      delete: () => ({ where: () => Promise.resolve({}) }),
    };
    const surface = createPluginDatabase({
      dialect: "postgresql",
      owner: OWNER,
      dependsOn: new Set(),
      owners: () => new Map([["fx__notes", OWNER]]),
      tables: () => ({ fx__notes: { name: "fx__notes" } }),
      tableList: () => [{ name: "fx__notes", authored: "notes", owner: OWNER }],
      db: () => db,
      relationalDb: () => db,
      transaction: async fn => {
        order.push("begin");
        const result = await fn(db);
        order.push("commit");
        return result;
      },
    });

    await surface.transaction(async () => {
      order.push("work");
    });

    expect(order).toEqual(["begin", "work", "commit"]);
  });

  it("propagates a failure rather than swallowing it", async () => {
    const { surface } = harness();
    const boom = vi.fn().mockRejectedValue(new Error("rolled back"));
    await expect(surface.transaction(boom)).rejects.toThrow("rolled back");
  });
});

describe("relational queries", () => {
  /**
   * A namespace shaped like Drizzle's: schema-wide, naming a core table and
   * another plugin's table alongside the caller's own. That width is the
   * whole point — the surface has to narrow it, because the handle it comes
   * from cannot.
   */
  function queryHarness(dependsOn: string[] = []) {
    const answered: string[] = [];
    const entry = (name: string) => ({
      findMany: async () => {
        answered.push(name);
        return [];
      },
      findFirst: async () => {
        answered.push(name);
        return null;
      },
    });

    const relational = {
      query: {
        fx__notes: entry("fx__notes"),
        other__invoices: entry("other__invoices"),
        users: entry("users"),
      },
    };

    const surface = createPluginDatabase({
      dialect: "postgresql",
      owner: OWNER,
      dependsOn: new Set(dependsOn),
      owners: () =>
        new Map<string, SchemaOwner>([
          ["fx__notes", OWNER],
          ["other__invoices", { kind: "plugin", id: "other" }],
        ]),
      tables: () => ({ fx__notes: { name: "fx__notes" } }),
      tableList: () => [{ name: "fx__notes", authored: "notes", owner: OWNER }],
      db: () => relational,
      relationalDb: () => relational,
      transaction: fn => fn(relational),
    });

    return { surface, answered };
  }

  it("answers for a table this owner owns", async () => {
    // The must-differ control. A namespace that refused everything would
    // satisfy every test below and break the feature.
    const { surface, answered } = queryHarness();
    await surface.query.fx__notes.findMany();
    expect(answered).toEqual(["fx__notes"]);
  });

  it("refuses a core table", async () => {
    // `ctx.db.select(users)` already refuses; reaching the same rows through
    // `query` was a way around it. Core tables stay behind ctx.services.
    const { surface, answered } = queryHarness();
    expect(() => surface.query.users).toThrow(NextlyError);
    expect(answered).toEqual([]);
  });

  it("refuses another plugin's table that was not declared in dependsOn", () => {
    const { surface } = queryHarness();
    expect(() => surface.query.other__invoices).toThrow(NextlyError);
  });

  it("answers for another plugin's table once dependsOn declares it", async () => {
    const { surface, answered } = queryHarness(["other"]);
    await surface.query.other__invoices.findFirst();
    expect(answered).toEqual(["other__invoices"]);
  });

  it("re-reads the rules per access, so a new dependency takes effect", () => {
    // The getter is not cached, and neither is the check inside it: a
    // namespace captured once would keep answering for the schema it was
    // taken from.
    const dependsOn = new Set<string>();
    const relational = {
      query: { other__invoices: { findMany: async () => [] } },
    };
    const surface = createPluginDatabase({
      dialect: "postgresql",
      owner: OWNER,
      dependsOn,
      owners: () =>
        new Map<string, SchemaOwner>([
          ["other__invoices", { kind: "plugin", id: "other" }],
        ]),
      tables: () => ({}),
      tableList: () => [],
      db: () => relational,
      relationalDb: () => relational,
      transaction: fn => fn(relational),
    });

    const namespace = surface.query;
    expect(() => namespace.other__invoices).toThrow(NextlyError);
    dependsOn.add("other");
    expect(() => namespace.other__invoices).not.toThrow();
  });

  it("does not enumerate a table it would refuse", () => {
    const { surface } = queryHarness();
    expect(Object.keys(surface.query)).toEqual(["fx__notes"]);
    expect("users" in surface.query).toBe(false);
    expect("fx__notes" in surface.query).toBe(true);
  });
});
