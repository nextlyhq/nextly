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

describe("transaction", () => {
  it("runs the callback against a surface bound to the transaction handle", async () => {
    const { surface, inserted } = harness();
    await surface.transaction(async tx => {
      await tx.insert(notes, { bodyText: "inside" } as never);
    });
    expect(inserted).toHaveLength(1);
  });

  it("propagates a failure rather than swallowing it", async () => {
    const { surface } = harness();
    const boom = vi.fn().mockRejectedValue(new Error("rolled back"));
    await expect(surface.transaction(boom)).rejects.toThrow("rolled back");
  });
});
