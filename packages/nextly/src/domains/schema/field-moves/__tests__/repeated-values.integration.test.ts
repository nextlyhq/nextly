/**
 * The repeats counted for a field moved out of a group into a unique column are the ones the
 * column itself would hold: two values the column stores as one are counted, and two it keeps
 * apart are not. Each database is asked, not imitated: every value is copied into a real column of
 * the field's type by the move's own statement, and the values the column then compares as one are
 * held against what the count says of them, for every kind a unique field's column can take.
 *
 * Values the column would not keep (`keptValuesOf`) are left out: they are refused before repeats
 * are counted.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import {
  classifyFieldKind,
  type ColumnOrigin,
  getColumnDescriptor,
} from "../../services/field-column-descriptor";
import { keptValuesOf } from "../kept-values";
import {
  heldValueAt,
  moveDataStatements,
  type MoveColumn,
  repeatedValuesAt,
} from "../move-statements";

const TABLE = "repeated_values_probe";
const FROM = { kind: "json" as const, column: "meta", keys: ["v"] };
const TO = { kind: "column" as const, column: "v" };

/** Forms a group's JSON may hold a value in, as JSON text: what one column stores as one among them. */
const HELD = [
  "0",
  "-0.0",
  "1",
  "1.0",
  '"1"',
  '"1.0"',
  '"01"',
  '" 1 "',
  "1.5",
  '"1.50"',
  "100",
  '"1e2"',
  "9007199254740992",
  '"9007199254740993"',
  "true",
  "false",
  '"true"',
  '"abc"',
  '"ABC"',
  '"abc "',
  '"ábc"',
  '"xyz"',
  '"1abc"',
  '""',
  '"2026-07-17"',
  '"2026-07-17T00:00:00Z"',
  '"2026-07-17T02:00:00+02:00"',
];

/**
 * Forms SQLite alone takes into any column, each its own rule of what a column's type makes of it:
 * a number past a double's range, signs and bases, a fraction's digits, and JSON text.
 */
const HELD_ON_SQLITE = [
  '"0"',
  '"-0"',
  '"1.5"',
  '"9007199254740992"',
  '"1e400"',
  '"0x10"',
  '"+1"',
  "0.1",
  '"0.1000000000000000055"',
  '{"a":1}',
  '"{\\"a\\":1}"',
  "[1]",
  '"[1]"',
];

const field = (extra: Record<string, unknown>) =>
  ({ name: "v", label: "v", unique: true, ...extra }) as FieldDefinition;

const KINDS: {
  what: string;
  field: FieldDefinition;
  builtBy: ColumnOrigin;
  /** A kind MySQL cannot index at all. */
  notOnMysql?: true;
}[] = [
  { what: "text", field: field({ type: "text" }), builtBy: "collection" },
  {
    what: "a text of a declared width",
    field: field({
      type: "text",
      options: { variant: "short" },
      validation: { maxLength: 40 },
    }),
    builtBy: "collection",
  },
  {
    what: "textarea",
    field: field({ type: "textarea" }),
    builtBy: "codeFirst",
  },
  { what: "code", field: field({ type: "code" }), builtBy: "codeFirst" },
  {
    what: "json",
    field: field({ type: "json" }),
    builtBy: "codeFirst",
    notOnMysql: true,
  },
  { what: "email", field: field({ type: "email" }), builtBy: "codeFirst" },
  { what: "number", field: field({ type: "number" }), builtBy: "collection" },
  {
    what: "a fractional number",
    field: field({ type: "number", options: { format: "float" } }),
    builtBy: "collection",
  },
  {
    what: "decimal",
    field: field({ type: "number", dbType: "decimal" }),
    builtBy: "codeFirst",
  },
  {
    what: "checkbox",
    field: field({ type: "checkbox" }),
    builtBy: "collection",
  },
  { what: "date", field: field({ type: "date" }), builtBy: "collection" },
  {
    what: "a one-to-one",
    field: field({
      type: "relationship",
      unique: undefined,
      options: { relationType: "oneToOne", target: "people" },
    }),
    builtBy: "collection",
  },
];

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-repeated-values-"));
});

afterEach(async () => {
  try {
    if (instance) await run(`DROP TABLE IF EXISTS ${TABLE}`);
    await instance?.destroy();
  } finally {
    instance = undefined;
    await rm(basePath, { recursive: true, force: true });
  }
});

const run = <T>(statement: string) =>
  (instance?.adapter as unknown as DrizzleAdapter).executeQuery(
    statement
  ) as unknown as Promise<T[]>;

/** The column `moved` makes, as a move out of a group reads values into it. */
function columnOf(
  moved: FieldDefinition,
  dialect: TestDialect,
  builtBy: ColumnOrigin
): MoveColumn {
  const descriptor = getColumnDescriptor(moved, dialect, builtBy);
  if (descriptor === null) throw new Error("the field has no column");
  const { precision, scale } = descriptor;
  return {
    table: TABLE,
    dialect,
    kind: classifyFieldKind(moved, builtBy),
    columnType: descriptor.dialectType,
    ...(precision === undefined ? {} : { precision }),
    ...(scale === undefined ? {} : { scale }),
  };
}

/** A table with a row for each of `values`, held aside until `holding` puts it where a move reads. */
async function makeTable(
  target: MoveColumn,
  values: readonly string[]
): Promise<void> {
  const json = { postgresql: "jsonb", mysql: "json", sqlite: "text" }[
    target.dialect
  ];
  await run(`DROP TABLE IF EXISTS ${TABLE}`);
  await run(
    `CREATE TABLE ${TABLE} (id varchar(36) PRIMARY KEY, held ${json}, meta ${json}, v ${target.columnType} NULL)`
  );
  for (const [i, value] of values.entries()) {
    await run(
      `INSERT INTO ${TABLE} (id, held) VALUES ('${i}', '{"v":${value}}')`
    );
  }
}

/** Puts the values at `ids` where the move reads them, and no other. */
async function holding(ids: readonly string[]): Promise<void> {
  await run(`UPDATE ${TABLE} SET meta = NULL`);
  const list = ids.map(id => `'${id}'`).join(", ");
  await run(`UPDATE ${TABLE} SET meta = held WHERE id IN (${list})`);
}

/** Whether the count takes the values at `ids` as repeating one. */
async function counted(
  target: MoveColumn,
  ids: readonly string[]
): Promise<boolean> {
  await holding(ids);
  return (await run(repeatedValuesAt(target, FROM))).length > 0;
}

/** The ids of the values `target`'s column keeps (`keptValuesOf`). */
async function keptIds(target: MoveColumn): Promise<string[]> {
  const { type, text } = heldValueAt("meta", ["v"], target.dialect);
  await run(`UPDATE ${TABLE} SET meta = held`);
  const rows = await run<{ id: string; type: unknown; text: unknown }>(
    `SELECT id, ${type} AS type, ${text} AS text FROM ${TABLE}`
  );
  const kept = keptValuesOf(target, target.dialect);
  return rows
    .filter(row => kept === undefined || kept.keeps(row))
    .map(row => String(row.id));
}

/** The values at `ids` by what the column holds once the move copied them: each class holds one. */
async function classesInColumn(
  target: MoveColumn,
  ids: readonly string[]
): Promise<string[][]> {
  await holding(ids);
  const { copy } = moveDataStatements({ from: FROM, to: TO }, target);
  for (const statement of copy) await run(statement);
  const firsts = await run<{ id: string; first: string }>(
    `SELECT a.id AS id, MIN(b.id) AS first FROM ${TABLE} a JOIN ${TABLE} b ON a.v = b.v GROUP BY a.id`
  );
  const classes = new Map<string, string[]>();
  for (const { id, first } of firsts) {
    classes.set(first, [...(classes.get(first) ?? []), String(id)]);
  }
  return [...classes.values()];
}

/** The pairs the count gets wrong, as its ids: one the column holds as one value, and two. */
async function disagreements(
  target: MoveColumn,
  classes: readonly string[][]
): Promise<{ missed: string[][]; wrong: string[][] }> {
  const missed: string[][] = [];
  for (const [one, ...others] of classes) {
    for (const other of others) {
      if (!(await counted(target, [one, other]))) missed.push([one, other]);
    }
  }
  const wrong: string[][] = [];
  const ones = classes.map(([one]) => one);
  for (const [i, one] of ones.entries()) {
    for (const other of ones.slice(i + 1)) {
      if (await counted(target, [one, other])) wrong.push([one, other]);
    }
  }
  return { missed, wrong };
}

describe.each(getConfiguredTestDialects())(
  "the repeats counted for a unique column are the ones it would hold (%s)",
  dialect => {
    const values = dialect === "sqlite" ? [...HELD, ...HELD_ON_SQLITE] : HELD;
    const kinds = KINDS.filter(
      kind => !(dialect === "mysql" && kind.notOnMysql === true)
    );

    it.each(kinds)("$what", async ({ field: moved, builtBy }) => {
      instance = await createTestNextly({ dialect, basePath });
      const target = columnOf(moved, dialect, builtBy);
      await makeTable(target, values);
      const ids = await keptIds(target);
      expect(ids.length).toBeGreaterThan(1);

      const classes = await classesInColumn(target, ids);
      const { missed, wrong } = await disagreements(target, classes);

      const told = (pairs: string[][]) =>
        pairs.map(pair => pair.map(id => values[Number(id)]).join(" and "));
      expect({ missed: told(missed), wrong: told(wrong) }).toEqual({
        missed: [],
        wrong: [],
      });
    });
  }
);
