/**
 * How the reader hands a column's values to the judgement, without a server: that it keeps reading
 * pages until one is short, and that a query that fails stops the judgement with the database's
 * own error rather than reading as values that do not convert. Key order and the comparison that
 * moves from one page to the next are covered against live databases by the classify integration
 * suite, whose large column spans more than one page.
 */
import { describe, expect, it } from "vitest";

import { judgeStoredColumn, readStoredValues } from "../read-values";
import type { ColumnConversion, StoredValue } from "../types";

const toJson: ColumnConversion = {
  dialect: "postgresql",
  from: { type: "text", nullable: true },
  to: { type: "jsonb", nullable: true },
  compareAs: "json",
};

/** A PostgreSQL handle answering each query with the next of `pages`. */
function pagedHandle(pages: Array<Array<Record<string, unknown>>>) {
  let asked = 0;
  return {
    asked: () => asked,
    execute: () => {
      const rows = pages[asked] ?? [];
      asked += 1;
      return Promise.resolve({ rows });
    },
  };
}

const row = (id: number, v: string | null) => ({ k1: String(id), v });

describe("readStoredValues", () => {
  it("reads page after page until a page is short, and yields every row once", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => row(i + 1, "1"));
    const handle = pagedHandle([full, [row(1001, "2"), row(1002, null)]]);
    const values: StoredValue[] = [];
    for await (const value of readStoredValues(handle, "postgresql", {
      table: "t",
      column: "c",
      keyedBy: "id",
      toJson: true,
    })) {
      values.push(value);
    }
    expect(handle.asked()).toBe(2);
    expect(values).toHaveLength(1002);
    expect(values.at(-1)).toEqual({ key: { id: "1002" }, text: null });
  });

  it("names a translation row by its parent and locale", async () => {
    const handle = pagedHandle([[{ k1: "p1", k2: "fr", v: "x" }]]);
    const values: StoredValue[] = [];
    for await (const value of readStoredValues(handle, "postgresql", {
      table: "t_locales",
      column: "c",
      keyedBy: "translation",
      toJson: false,
    })) {
      values.push(value);
    }
    expect(values).toEqual([
      { key: { parent: "p1", locale: "fr" }, text: "x" },
    ]);
  });
});

describe("judgeStoredColumn", () => {
  it("stops with the database's own error when the rows cannot be read", async () => {
    const lockTimeout = Object.assign(new Error("lock timeout"), {
      code: "55P03",
    });
    const handle = { execute: () => Promise.reject(lockTimeout) };
    await expect(
      judgeStoredColumn(handle, toJson, {
        table: "t",
        column: "c",
        keyedBy: "id",
      })
    ).rejects.toBe(lockTimeout);
  });

  it("reads no row for a pair with no conversion", async () => {
    const handle = pagedHandle([[row(1, "x")]]);
    const judgement = await judgeStoredColumn(
      handle,
      { ...toJson, to: { type: "integer", nullable: true } },
      { table: "t", column: "c", keyedBy: "id" }
    );
    expect(judgement.class).toBe("blocked");
    expect(handle.asked()).toBe(0);
  });
});
