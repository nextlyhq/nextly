/**
 * The repeats counted for a field moved out of a group into a unique column are the ones the
 * column itself refuses: two values its unique index holds as one are counted, and two it keeps
 * apart are not. Each database is asked, not imitated: a collection holding the field, made as the
 * product makes it (the Schema Builder's create, or the push of a collection declared in code),
 * has each pair of values copied into the field's own column by the move's own statement, and its
 * unique index refuses the pair or takes it.
 *
 * Values the column would not keep (`keptValuesOf`) are left out: they are refused before repeats
 * are counted.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection } from "../../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import type { CollectionService } from "../../../collections/services/collection-service";
import {
  classifyFieldKind,
  getColumnDescriptor,
} from "../../services/field-column-descriptor";
import { keptValuesOf } from "../kept-values";
import {
  heldValueAt,
  moveDataStatements,
  type MoveColumn,
  repeatedValuesAt,
} from "../move-statements";

const SLUG = "rv_posts";
const PEOPLE = "rv_people";
const TABLE = `dc_${SLUG}`;
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
  // The same form twice, which every unique column refuses.
  '"xyz"',
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

/**
 * Every kind a unique field's column can take, and who makes it. A field group's own table is made
 * by a generator of its own, with the same columns for these kinds but text's width.
 */
const KINDS: {
  what: string;
  field: FieldDefinition;
  builtBy: "collection" | "codeFirst";
  /** A kind whose column the product does not make unique on MySQL. */
  notOnMysql?: true;
}[] = [
  { what: "text", field: field({ type: "text" }), builtBy: "collection" },
  {
    what: "text declared in code",
    field: field({ type: "text" }),
    builtBy: "codeFirst",
  },
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
    builtBy: "collection",
    notOnMysql: true,
  },
  {
    what: "code",
    field: field({ type: "code" }),
    builtBy: "collection",
    notOnMysql: true,
  },
  {
    what: "json",
    field: field({ type: "json" }),
    builtBy: "collection",
    notOnMysql: true,
  },
  { what: "email", field: field({ type: "email" }), builtBy: "collection" },
  { what: "number", field: field({ type: "number" }), builtBy: "collection" },
  {
    what: "a fractional number",
    field: field({ type: "number", options: { format: "float" } }),
    builtBy: "collection",
  },
  {
    what: "decimal declared in code",
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
      relationTo: PEOPLE,
      options: { relationType: "oneToOne", target: PEOPLE },
    }),
    builtBy: "collection",
  },
];

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-repeated-values-"));
  // The Schema Builder's create makes its table in development.
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  try {
    await instance?.destroy();
  } finally {
    instance = undefined;
    vi.unstubAllEnvs();
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
  builtBy: "collection" | "codeFirst"
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

/**
 * The collection holding `moved` on its row beside two groups, as the product makes it: `meta`,
 * where the move reads values, and `aside`, which keeps each entry's own until a pair is tried.
 */
async function makePosts(
  dialect: TestDialect,
  moved: FieldDefinition,
  builtBy: "collection" | "codeFirst"
): Promise<TestNextly> {
  const group = (name: string) => ({
    name,
    type: "group",
    fields: [{ name: "note", type: "text" }],
  });
  const fields = [moved, group("meta"), group("aside")];
  const inCode = [defineCollection({ slug: SLUG, fields: fields as never })];
  const t = await createTestNextly({
    dialect,
    basePath,
    db: { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" },
    ...(builtBy === "codeFirst" ? { collections: inCode } : {}),
  });
  instance = t;
  if (builtBy === "codeFirst") return t;
  const make = (name: string, made: unknown[]) =>
    t
      .getService("collectionService")
      .createCollection(
        { name, label: name, fields: made } as Parameters<
          CollectionService["createCollection"]
        >[0],
        {}
      );
  await make(PEOPLE, [{ name: "note", type: "text" }]);
  await make(SLUG, fields);
  return t;
}

const entry = (i: number) => `p${i}`;
const among = (slugs: readonly string[]) =>
  `slug IN (${slugs.map(slug => `'${slug}'`).join(", ")})`;

/** An entry for each of `values`, in its `aside` group. */
async function seed(t: TestNextly, values: readonly string[]): Promise<void> {
  for (const [i, value] of values.entries()) {
    const slug = entry(i);
    await t.nextly.create({ collection: SLUG, data: { title: slug, slug } });
    await run(
      `UPDATE ${TABLE} SET aside = '{"v":${value}}' WHERE slug = '${slug}'`
    );
  }
}

/** An entry of the people for every id the values read as, which a one-to-one's key asks for. */
async function seedPeople(t: TestNextly, dialect: TestDialect): Promise<void> {
  const people = `dc_${PEOPLE}`;
  await t.nextly.create({
    collection: PEOPLE,
    data: { title: "First", slug: "first" },
  });
  const [first] = await run<Record<string, unknown>>(`SELECT * FROM ${people}`);
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const columns = Object.keys(first);
  const { text } = heldValueAt("aside", ["v"], dialect);
  const read = await run<{ id: string }>(
    `SELECT ${dialect === "sqlite" ? `CAST(${text} AS TEXT)` : text} AS id FROM ${TABLE}`
  );
  // Told apart here, byte for byte: a database may hold two of them as one.
  const ids = new Set(read.map(row => row.id));
  for (const [i, id] of [...ids].entries()) {
    const literal = `'${id.replaceAll("'", "''")}'`;
    const given: Record<string, string> = {
      id: literal,
      slug: `'person-${i}'`,
    };
    const ignoring = {
      mysql: ["INSERT IGNORE", ""],
      postgresql: ["INSERT", " ON CONFLICT DO NOTHING"],
      sqlite: ["INSERT", " ON CONFLICT DO NOTHING"],
    }[dialect];
    await run(
      `${ignoring[0]} INTO ${people} (${columns.map(q).join(", ")}) SELECT ${columns.map(name => given[name] ?? q(name)).join(", ")} FROM ${people} WHERE slug = 'first'${ignoring[1]}`
    );
  }
}

/** The entries whose values `target`'s column keeps (`keptValuesOf`). */
async function keptEntries(target: MoveColumn): Promise<string[]> {
  const { type, text } = heldValueAt("aside", ["v"], target.dialect);
  const rows = await run<{ slug: string; type: unknown; text: unknown }>(
    `SELECT slug, ${type} AS type, ${text} AS text FROM ${TABLE} ORDER BY slug`
  );
  const kept = keptValuesOf(target, target.dialect);
  return rows
    .filter(row => kept === undefined || kept.keeps(row))
    .map(row => row.slug);
}

/** Puts the values of `pair` where the move reads them, in an otherwise empty column. */
async function holding(pair: readonly string[]): Promise<void> {
  await run(`UPDATE ${TABLE} SET meta = NULL, v = NULL WHERE ${among(pair)}`);
  await run(`UPDATE ${TABLE} SET meta = aside WHERE ${among(pair)}`);
}

/** The entries of `kept` whose value the move's own statement leaves the column without. */
async function notArriving(
  target: MoveColumn,
  kept: readonly string[]
): Promise<string[]> {
  const { copy } = moveDataStatements({ from: FROM, to: TO }, target);
  const lost: string[] = [];
  for (const slug of kept) {
    await holding([slug]);
    for (const statement of copy) await run(statement);
    const rows = await run(
      `SELECT slug FROM ${TABLE} WHERE slug = '${slug}' AND v IS NOT NULL`
    );
    if (rows.length !== 1) lost.push(slug);
    await run(
      `UPDATE ${TABLE} SET meta = NULL, v = NULL WHERE ${among([slug])}`
    );
  }
  return lost;
}

/** Whether the column's unique index refuses the two values the move copies into it. */
async function refusedByColumn(
  target: MoveColumn,
  pair: readonly string[]
): Promise<boolean> {
  const { copy } = moveDataStatements({ from: FROM, to: TO }, target);
  try {
    for (const statement of copy) await run(statement);
    return false;
  } catch (error) {
    const said = `${String(error)} ${String((error as { cause?: unknown }).cause)}`;
    // Any other refusal is not the index's answer, and fails the test.
    if (/unique|duplicate/i.test(said)) return true;
    throw error;
  } finally {
    await run(`UPDATE ${TABLE} SET meta = NULL, v = NULL WHERE ${among(pair)}`);
  }
}

describe.each(getConfiguredTestDialects())(
  "the repeats counted for a unique column are the ones it refuses (%s)",
  dialect => {
    const values = dialect === "sqlite" ? [...HELD, ...HELD_ON_SQLITE] : HELD;
    const kinds = KINDS.filter(
      kind => !(dialect === "mysql" && kind.notOnMysql === true)
    );

    it.each(kinds)(
      "$what",
      async ({ field: moved, builtBy }) => {
        const target = columnOf(moved, dialect, builtBy);
        const t = await makePosts(dialect, moved, builtBy);
        await seed(t, values);
        if (moved.type === "relationship") await seedPeople(t, dialect);
        const kept = await keptEntries(target);
        expect(kept.length).toBeGreaterThan(1);
        // A value the copy left out would repeat nothing: each arrives, to be compared at all.
        expect(await notArriving(target, kept)).toEqual([]);

        const missed: string[] = [];
        const wrong: string[] = [];
        let refused = 0;
        for (const [i, one] of kept.entries()) {
          for (const other of kept.slice(i + 1)) {
            const pair = [one, other];
            await holding(pair);
            const counted =
              (await run(repeatedValuesAt(target, FROM))).length > 0;
            const held = await refusedByColumn(target, pair);
            if (held) refused += 1;
            if (held === counted) continue;
            const told = pair
              .map(slug => values[Number(slug.slice(1))])
              .join(" and ");
            (held ? missed : wrong).push(told);
          }
        }
        // The column is unique: some pair is one value to it.
        expect(refused).toBeGreaterThan(0);
        expect({ missed, wrong }).toEqual({ missed: [], wrong: [] });
      },
      120_000
    );
  }
);
