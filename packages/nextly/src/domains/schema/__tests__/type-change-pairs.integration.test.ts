/**
 * A Schema Builder save's field type change converts every value of the field as its pair of types
 * says: one case per pair, a value of each kind the pair keeps or changes, read back through REST
 * and the Direct API, and the table's definition compared before and after. The column keeps every
 * property the change does not name, and every other column, index and constraint is untouched.
 * Proved on SQLite, PostgreSQL and MySQL.
 *
 * What separates the right answer from plausible wrong ones: a conversion that writes a reading as
 * a text literal stores a date as text where SQLite keeps seconds and a checkbox as "true" where
 * MySQL keeps 1; one left to the database's cast reads a text as PostgreSQL writes a date and
 * refuses a text becoming a document; and one that restates the column drops what the change did
 * not name.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { ServiceContainer } from "../../../services";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { documentOfText } from "../value-conversion/type-change/document";
import { rewritesValuesOn } from "../value-conversion/type-change/field-type-changes";

import { textsOf } from "./helpers/document-texts";
import { readTableDefinition } from "./helpers/table-definition";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const SLUG = "tcp_posts";
const TABLE = `dc_${SLUG}`;
const READER = "type-change-pairs-reader";
const ORIGIN = "http://localhost";

type Field = Record<string, unknown>;

/** One pair of types: the values written under the first and what each reads as under the second. */
interface Pair {
  name: string;
  from: Field;
  to: Field;
  /** Each value as written and as it reads back, by the entry's title. */
  values: Record<string, readonly [written: unknown, read: unknown]>;
  /** How many values cannot convert, cleared with the save's confirmation. */
  lost?: number;
  /**
   * The database's cast reads each of these values as the rules do, so the change goes ahead where
   * no road rewrites values (MySQL, `rewritesValuesOn`); any other is refused there.
   */
  cast?: true;
  /** How a value read back is compared, where the form it reads in is not its own. */
  as?: (value: unknown) => unknown;
}

const OPTIONS = [
  { label: "A", value: "a" },
  { label: "B", value: "b" },
  { label: "True", value: "true" },
  { label: "Twelve", value: "12" },
];
const text: Field = { type: "text" };
const email: Field = { type: "email" };
const select: Field = { type: "select", options: OPTIONS };
const richText: Field = { type: "richText" };
const whole: Field = { type: "number" };
const float: Field = { type: "number", options: { format: "float" } };
const checkbox: Field = { type: "checkbox" };
const date: Field = { type: "date" };
const json: Field = { type: "json" };
const chips: Field = { type: "chips" };
const INSTANT = "2024-01-02T03:04:05.000Z";

/** A date as its instant, whichever way a road writes one. */
const instant = (value: unknown) =>
  value === null ? null : new Date(String(value)).toISOString();
/** The document a text holds. */
const parsed = (value: unknown) => JSON.parse(String(value)) as unknown;

const PAIRS: readonly Pair[] = [
  {
    name: "an email becomes a text, kept",
    cast: true,
    from: email,
    to: text,
    values: { a: ["a@b.co", "a@b.co"] },
  },
  {
    name: "a choice becomes a text, kept",
    cast: true,
    from: select,
    to: text,
    values: { a: ["a", "a"] },
  },
  {
    name: "a text becomes an email where it is one, else cleared",
    from: text,
    to: email,
    values: { a: ["a@b.co", "a@b.co"], lost: ["words", null] },
    lost: 1,
  },
  {
    name: "a text becomes a choice where it is an option, else cleared",
    from: text,
    to: select,
    values: { a: ["b", "b"], lost: ["z", null] },
    lost: 1,
  },
  {
    name: "a text becomes a document of its lines",
    from: text,
    to: richText,
    values: { a: ["one\ntwo", ["one", "two"]] },
    as: textsOf,
  },
  {
    name: "a text becomes a whole number where it is one, else cleared",
    from: text,
    to: whole,
    values: { a: ["012", 12], lost: ["words", null] },
    lost: 1,
  },
  {
    name: "a text becomes a fraction",
    from: text,
    to: float,
    values: { a: ["1.50", 1.5] },
  },
  {
    name: "a text becomes a checkbox where it says true or false, else cleared",
    from: text,
    to: checkbox,
    values: {
      t: ["TRUE", true],
      f: ["false", false],
      one: ["1", true],
      zero: ["0", false],
      lost: ["maybe", null],
    },
    lost: 1,
  },
  {
    name: "a text naming an instant becomes a date, else cleared",
    from: text,
    to: date,
    values: { a: [INSTANT, INSTANT], lost: ["words", null] },
    lost: 1,
    as: instant,
  },
  {
    name: "a text becomes a JSON string, one that is JSON too",
    from: text,
    to: json,
    values: { word: ["hello", "hello"], object: ['{"a":1}', '{"a":1}'] },
  },
  {
    name: "a text becomes a list of it",
    from: text,
    to: chips,
    values: { a: ["hello", ["hello"]] },
  },
  {
    name: "a document becomes JSON, kept",
    cast: true,
    from: richText,
    to: json,
    values: { a: [documentOfText("hello"), documentOfText("hello")] },
  },
  {
    name: "a document becomes its JSON text",
    from: richText,
    to: text,
    values: { a: [documentOfText("hello"), documentOfText("hello")] },
    as: parsed,
  },
  {
    name: "a whole number becomes a text",
    cast: true,
    from: whole,
    to: text,
    values: { a: [12, "12"] },
  },
  {
    name: "a fraction becomes a text, a whole one with no point",
    cast: true,
    from: float,
    to: text,
    values: { a: [1.5, "1.5"], whole: [34, "34"] },
  },
  {
    name: "a number becomes a choice where it is an option, else cleared",
    from: whole,
    to: select,
    values: { a: [12, "12"], lost: [13, null] },
    lost: 1,
  },
  {
    name: "a number becomes a document",
    from: whole,
    to: richText,
    values: { a: [12, ["12"]] },
    as: textsOf,
  },
  {
    name: "a whole number becomes a fraction, kept",
    cast: true,
    from: whole,
    to: float,
    values: { a: [12, 12] },
  },
  {
    name: "a number becomes a checkbox for 0 and 1, else cleared",
    from: whole,
    to: checkbox,
    values: { one: [1, true], zero: [0, false], lost: [2, null] },
    lost: 1,
  },
  {
    name: "a number becomes a JSON number",
    cast: true,
    from: float,
    to: json,
    values: { a: [1.5, 1.5] },
  },
  {
    name: "a number becomes a list of it",
    from: whole,
    to: { type: "number", hasMany: true },
    values: { a: [12, [12]] },
  },
  {
    name: "a checkbox becomes a text",
    from: checkbox,
    to: text,
    values: { on: [true, "true"], off: [false, "false"] },
  },
  {
    name: "a checkbox becomes a choice where it is an option, else cleared",
    from: checkbox,
    to: select,
    values: { on: [true, "true"], lost: [false, null] },
    lost: 1,
  },
  {
    name: "a checkbox becomes a document",
    from: checkbox,
    to: richText,
    values: { on: [true, ["true"]] },
    as: textsOf,
  },
  {
    name: "a checkbox becomes a number",
    cast: true,
    from: checkbox,
    to: whole,
    values: { on: [true, 1], off: [false, 0] },
  },
  {
    name: "a checkbox becomes a JSON boolean",
    from: checkbox,
    to: json,
    values: { on: [true, true], off: [false, false] },
  },
  {
    name: "a checkbox becomes a list of it",
    from: checkbox,
    to: chips,
    values: { on: [true, ["true"]] },
  },
  {
    name: "a date becomes its ISO text in UTC",
    from: date,
    to: text,
    values: { a: [INSTANT, "2024-01-02T03:04:05Z"] },
  },
  {
    name: "a date becomes a document",
    from: date,
    to: richText,
    values: { a: [INSTANT, ["2024-01-02T03:04:05Z"]] },
    as: textsOf,
  },
  {
    name: "a date becomes a JSON string",
    from: date,
    to: json,
    values: { a: [INSTANT, "2024-01-02T03:04:05Z"] },
  },
  {
    name: "a date becomes a list of its text",
    from: date,
    to: chips,
    values: { a: [INSTANT, ["2024-01-02T03:04:05Z"]] },
  },
  {
    name: "a JSON value becomes a text: a string kept, any other as its JSON",
    from: json,
    to: text,
    values: {
      word: ["hello", "hello"],
      number: [1.5, "1.5"],
      object: [{ a: 1 }, '{"a":1}'],
    },
  },
  {
    name: "a JSON value becomes a number where it is one, else cleared",
    from: json,
    to: float,
    values: { number: [1.5, 1.5], text: ["2", 2], lost: [{ a: 1 }, null] },
    lost: 1,
  },
  {
    name: "a JSON value becomes a checkbox where it says true or false, else cleared",
    from: json,
    to: checkbox,
    values: { yes: [true, true], lost: [{ a: 1 }, null] },
    lost: 1,
  },
  {
    name: "a JSON value becomes a date where it names an instant, else cleared",
    from: json,
    to: date,
    values: { a: [INSTANT, INSTANT], lost: [5, null] },
    lost: 1,
    as: instant,
  },
  {
    name: "a JSON value becomes a document where it is one, else a document of its text",
    from: json,
    to: richText,
    values: {
      document: [documentOfText("hello"), ["hello"]],
      word: ["words", ["words"]],
    },
    as: textsOf,
  },
  {
    name: "a JSON list becomes a list",
    cast: true,
    from: json,
    to: chips,
    values: {
      a: [
        ["a", "b"],
        ["a", "b"],
      ],
    },
  },
  {
    name: "a list becomes another list, item by item",
    cast: true,
    from: chips,
    to: { type: "select", hasMany: true, options: OPTIONS },
    values: {
      a: [
        ["a", "b"],
        ["a", "b"],
      ],
    },
  },
  {
    name: "a list becomes a JSON list, an empty one kept empty",
    cast: true,
    from: chips,
    to: json,
    values: {
      a: [
        ["a", "b"],
        ["a", "b"],
      ],
      empty: [[], []],
    },
  },
  {
    name: "a list of one becomes its item, an empty one no value",
    from: chips,
    to: text,
    values: { a: [["a"], "a"], empty: [[], null] },
  },
  {
    name: "a list of one becomes a number",
    from: chips,
    to: whole,
    values: { a: [["12"], 12] },
  },
  {
    name: "a list of one becomes a checkbox",
    from: chips,
    to: checkbox,
    values: { a: [["true"], true] },
  },
  {
    name: "a list of one becomes a date",
    from: chips,
    to: date,
    values: { a: [[INSTANT], INSTANT] },
    as: instant,
  },
  {
    name: "a list of one becomes a document",
    from: chips,
    to: richText,
    values: { a: [["hello"], ["hello"]] },
    as: textsOf,
  },
];

let instance: TestNextly | undefined;
let basePath: string;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-type-change-pairs-"));
  // The schema dialog applies its change, and writes its migration, in development only.
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

/** The collection's fields, `v` as `field` beside one the change leaves as it is. */
const fieldsWith = (field: Field): Field[] => [
  { name: "v", ...field },
  { name: "beside", type: "text", unique: true, default: "kept" },
];

/**
 * The table's whole definition as the database reports it, with `v`'s type left out, and what
 * follows from it: the character set and collation a text column has and another has not.
 */
async function definition(t: TestNextly, dialect: TestDialect) {
  const read = await readTableDefinition(
    <T>(statement: string) =>
      (
        t.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(statement),
    dialect,
    TABLE
  );
  return {
    ...read,
    columns: read.columns.map(column =>
      column.name === "v"
        ? { ...column, type: null, charset: null, collation: null }
        : column
    ),
  };
}

/** The Direct API's entries of the collection. */
async function direct(t: TestNextly): Promise<Record<string, unknown>[]> {
  const found = (await t.nextly.find({
    collection: SLUG,
    limit: 100,
  } as never)) as { items: Record<string, unknown>[] };
  return found.items;
}

/** The REST list's entries of the collection, read by a person who may read it. */
async function overRest(): Promise<Record<string, unknown>[]> {
  const token = await signAccessToken(
    buildClaims({
      userId: READER,
      email: `${READER}@example.test`,
      name: READER,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  const segments = ["collections", SLUG, "entries"];
  const res = await createDynamicHandlers().GET(
    new Request(`${ORIGIN}/api/${segments.join("/")}?limit=100`, {
      headers: { origin: ORIGIN, cookie: `nextly_session=${token}` },
    }),
    { params: Promise.resolve({ params: segments }) }
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: Record<string, unknown>[] }).items;
}

/** `v` of each entry by title, compared as the pair compares it. */
function valuesOf(
  items: Record<string, unknown>[],
  as: (value: unknown) => unknown = value => value
): Record<string, unknown> {
  return Object.fromEntries(
    items.map(item => [
      String(item.title),
      item.v === null || item.v === undefined
        ? null
        : as(item.v instanceof Date ? item.v.toISOString() : item.v),
    ])
  );
}

describe.each(getConfiguredTestDialects())(
  "a type change converts each value as its pair of types says (%s)",
  dialect => {
    it.each(PAIRS.map(pair => [pair.name, pair] as const))(
      "%s",
      async (_name, pair) => {
        const t = await createTestNextly({ dialect, basePath, db: DB });
        instance = t;
        await dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          { name: SLUG, label: "Post", fields: fieldsWith(pair.from) }
        );
        for (const [title, [written]] of Object.entries(pair.values)) {
          await t.nextly.create({
            collection: SLUG,
            data: { title, v: written, beside: title },
          } as never);
        }
        const before = await definition(t, dialect);

        // What the review counts is what the person confirms, sent back as it was shown.
        const answer = (await dispatchCollections(
          {} as ServiceContainer,
          "previewSchemaChanges",
          { collectionName: SLUG },
          { fields: fieldsWith(pair.to) }
        )) as Response | Record<string, unknown>;
        const json = (
          answer instanceof Response ? await answer.json() : answer
        ) as Record<string, unknown>;
        const { typeChanges } = (json.data ?? json) as {
          typeChanges: Array<{
            field: string;
            kept: number;
            changed: number;
            lost: number;
          }>;
        };
        expect(typeChanges).toEqual([expect.objectContaining({ field: "v" })]);
        // A value the cast does not read as the rules do is counted as blocked where no road
        // rewrites it, so only where one does are the counts the pair's own.
        if (rewritesValuesOn(dialect)) {
          expect(typeChanges[0]?.lost).toBe(pair.lost ?? 0);
        }

        const held = valuesOf(await direct(t));
        const saved = dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: SLUG },
          {
            fields: fieldsWith(pair.to),
            confirmed: true,
            schemaVersion: 1,
            confirmedTypeChanges: typeChanges.map(
              ({ field, kept, changed, lost }) => ({
                field,
                kept,
                changed,
                lost,
              })
            ),
          }
        );
        if (!rewritesValuesOn(dialect) && pair.cast !== true) {
          await expect(saved).rejects.toMatchObject({
            code: "VALIDATION_ERROR",
            publicData: {
              errors: [
                expect.objectContaining({
                  path: "fields.v",
                  message: expect.stringContaining("can't be deployed yet"),
                }),
              ],
            },
          });
          expect(valuesOf(await direct(t))).toEqual(held);
          expect(await definition(t, dialect)).toEqual(before);
          return;
        }
        await saved;
        clearRegistryRowCache();

        const expected = Object.fromEntries(
          Object.entries(pair.values).map(([title, [, read]]) => [title, read])
        );
        expect(valuesOf(await direct(t), pair.as)).toEqual(expected);
        await userWhoMay(t, READER, "read", [SLUG]);
        expect(valuesOf(await overRest(), pair.as)).toEqual(expected);
        expect(await definition(t, dialect)).toEqual(before);
      }
    );
  }
);
