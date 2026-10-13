/**
 * A row of a declared table reads back through `ctx.db` as the type its
 * columns declare, for every column kind, on every dialect.
 *
 * `InferRow` promises each value's type from the declaration alone. Nothing
 * at runtime holds the driver to that promise: a decimal arrives as a string
 * from PostgreSQL and MySQL unless the column is built to parse it, a bigint
 * may arrive as a string or be cut short, a timestamp as a number on SQLite,
 * JSON as text, and bytes in whatever container the driver chose. So the
 * row is written and read back through the plugin's own handle, as a plugin
 * would, and each value is checked by the runtime type its kind's `InferRow`
 * type names, then compared with what was written.
 *
 * `READS_BACK_AS` is keyed by every column kind, so a kind added to the DSL
 * fails type-checking here until it is written, read and judged too.
 */
import { afterEach, expect, it } from "vitest";

import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  definePlugin,
  type PluginContext,
} from "../../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { col, defineTable } from "../dsl";
import type { ExtensionColumnKind } from "../types";

const kinds = defineTable("kinds", {
  id: col.serial(),
  title: col.text(),
  code: col.shortText(),
  body: col.longText(),
  handle: col.varchar(64),
  country: col.char(2),
  externalId: col.uuid(),
  active: col.boolean(),
  quantity: col.integer(),
  rank: col.smallint(),
  views: col.bigint(),
  ratio: col.double(),
  weight: col.real(),
  price: col.decimal(10, 2),
  publishedAt: col.timestamp(),
  settings: col.json<{
    nested: { depth: number };
    list: (number | string)[];
  }>(),
  status: col.enum(["draft", "live"]),
  payload: col.bytes(),
});

/** The runtime type each kind's `InferRow` type names. */
const READS_BACK_AS = {
  serial: value => Number.isInteger(value),
  text: value => typeof value === "string",
  shortText: value => typeof value === "string",
  longText: value => typeof value === "string",
  varchar: value => typeof value === "string",
  char: value => typeof value === "string",
  uuid: value => typeof value === "string",
  enum: value => typeof value === "string",
  boolean: value => typeof value === "boolean",
  integer: value => Number.isInteger(value),
  smallint: value => Number.isInteger(value),
  bigint: value => Number.isInteger(value),
  double: value => typeof value === "number",
  real: value => typeof value === "number",
  decimal: value => typeof value === "number",
  timestamp: value => value instanceof Date,
  json: value => typeof value === "object" && value !== null,
  bytes: value => value instanceof Uint8Array,
} satisfies Record<ExtensionColumnKind, (value: unknown) => boolean>;

/** Values each kind can hold exactly, past the range a narrower type keeps. */
const written = {
  title: "A title",
  code: "c-1",
  body: "A body longer than a short text column would need to hold.",
  handle: "a-handle",
  country: "PK",
  externalId: "0192f3a4-5b6c-7d8e-9f01-23456789abcd",
  active: true,
  quantity: 2_000_000_000,
  rank: 32_000,
  // Past 2^32, so a 32-bit read would change it.
  views: 5_000_000_000,
  ratio: 0.125,
  // Exact in 32 bits, as MySQL's FLOAT stores it.
  weight: 1.5,
  price: 12.34,
  // Whole seconds: SQLite stores a timestamp in seconds, MySQL's TIMESTAMP
  // without a fraction too.
  publishedAt: new Date("2026-01-02T03:04:05.000Z"),
  settings: { nested: { depth: 2 }, list: [1, "two"] },
  status: "live" as const,
  payload: new Uint8Array([0, 1, 127, 128, 254, 255]),
};

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describeEachDialect(
  "a declared table's row read back through ctx.db",
  dialect => {
    async function boot(): Promise<PluginContext> {
      let captured: PluginContext | undefined;
      current = await createTestNextly({
        dialect,
        plugins: [
          definePlugin({
            name: "@test/declared-values",
            version: "1.0.0",
            nextly: ">=0.0.0",
            contributes: { schema: { prefix: "dv", tables: [kinds] } },
            init(ctx) {
              captured = ctx;
            },
          }),
        ],
      });
      if (!captured) throw new Error("the plugin's init did not run");
      return captured;
    }

    it("returns each value as the type its kind declares", async () => {
      // The premise: the table holds one column of every kind, so no kind is
      // judged by a check written for another.
      expect(kinds.columns.map(column => column.kind).sort()).toEqual(
        Object.keys(READS_BACK_AS).sort()
      );

      const ctx = await boot();
      await ctx.db.insert(kinds, written);
      const row = await ctx.db.select(kinds).first();
      if (!row) throw new Error("the row written was not read back");

      const wrongType = kinds.columns
        .filter(column => {
          const value = (row as Record<string, unknown>)[column.key];
          return !READS_BACK_AS[column.kind as ExtensionColumnKind](value);
        })
        .map(
          column =>
            `${column.key} (${column.kind}): ${typeof (row as Record<string, unknown>)[column.key]}`
        );
      expect(wrongType).toEqual([]);

      expect(Number.isInteger(row.id)).toBe(true);
      expect({ ...row, id: 0, payload: [...row.payload] }).toEqual({
        ...written,
        id: 0,
        payload: [...written.payload],
      });
    });
  }
);
