/**
 * Every judge of whether a field's values survive its move into the translations table asks one
 * rule, so one change gets one answer wherever it is made: the Schema Builder's preflight (its
 * first move and its retry of a move an earlier apply made, one function), a code-first apply
 * judged against the live main table, and `migrate:create` judged between two snapshots.
 *
 * The same pairs of a field as it was, shared, and as it is, translated, run through each judge on
 * each dialect and for each column origin, and each answer is checked against the expected one.
 * The code-first apply and `migrate:create` have only the database's types, never the field's
 * kind, so where a dialect stores both kinds of a pair, or both bounds, as one declared type
 * (SQLite's `integer` for a checkbox and a number, its `numeric` for every decimal), they see no
 * change and keep the move, the values held as they were. Those pairs are found from the types the
 * descriptor gives each side, not listed by hand.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  generateMigration,
  type MinimalConfigEntity,
} from "../../schema/migrate-create/generate";
import {
  type ColumnOrigin,
  getColumnDescriptor,
} from "../../schema/services/field-column-descriptor";
import { joiningFieldsLosingValues } from "../migration/archive-preflight";
import { joinsReshapedAgainst } from "../migration/field-joins-translation";

type Field = Record<string, unknown> & { type: string };

const short = (maxLength: number): Field => ({
  type: "text",
  options: { variant: "short" },
  validation: { maxLength },
});
const TEXT: Field = { type: "text" };
const LONG: Field = { type: "text", options: { variant: "long" } };
const INTEGER: Field = { type: "number" };
const FLOAT: Field = { type: "number", options: { format: "float" } };
const decimal = (precision: number, scale: number): Field => ({
  type: "number",
  dbType: "decimal",
  precision,
  scale,
});
const CHECKBOX: Field = { type: "checkbox" };
const JSON_FIELD: Field = { type: "json" };
const DATE: Field = { type: "date" };

type Answer = "keeps" | "refused";
const ALL_REFUSED = {
  postgresql: "refused",
  mysql: "refused",
  sqlite: "refused",
} as const;
const ALL_KEEP = { postgresql: "keeps", mysql: "keeps", sqlite: "keeps" } as const;
/** Refused where the database enforces a length or precision; SQLite enforces neither. */
const BOUND_NARROWED = {
  postgresql: "refused",
  mysql: "refused",
  sqlite: "keeps",
} as const;

/** A field as it was and as it is, and the answer every judge that sees the kinds gives. */
const PAIRS: {
  name: string;
  from: Field;
  to: Field;
  expected: Record<SupportedDialect, Answer>;
}[] = [
  {
    name: "a short text made longer",
    from: short(100),
    to: short(200),
    expected: ALL_KEEP,
  },
  {
    name: "a short text made shorter",
    from: short(100),
    to: short(10),
    expected: BOUND_NARROWED,
  },
  {
    name: "a short text made long",
    from: short(100),
    to: LONG,
    expected: ALL_KEEP,
  },
  {
    name: "a long text made short",
    from: LONG,
    to: short(50),
    expected: BOUND_NARROWED,
  },
  { name: "a text made long", from: TEXT, to: LONG, expected: ALL_KEEP },
  {
    name: "an integer made a float",
    from: INTEGER,
    to: FLOAT,
    expected: ALL_REFUSED,
  },
  {
    name: "a float made an integer",
    from: FLOAT,
    to: INTEGER,
    expected: ALL_REFUSED,
  },
  {
    name: "an integer made a decimal",
    from: INTEGER,
    to: decimal(10, 2),
    expected: ALL_REFUSED,
  },
  {
    name: "a decimal made wider",
    from: decimal(10, 2),
    to: decimal(12, 2),
    expected: ALL_KEEP,
  },
  {
    name: "a decimal given fewer digits",
    from: decimal(10, 2),
    to: decimal(8, 2),
    expected: ALL_REFUSED,
  },
  {
    name: "a decimal made an integer",
    from: decimal(10, 2),
    to: INTEGER,
    expected: ALL_REFUSED,
  },
  {
    name: "a checkbox made a number",
    from: CHECKBOX,
    to: INTEGER,
    expected: ALL_REFUSED,
  },
  {
    name: "a number made text",
    from: INTEGER,
    to: short(20),
    expected: ALL_REFUSED,
  },
  {
    name: "a JSON field made text",
    from: JSON_FIELD,
    to: LONG,
    expected: ALL_REFUSED,
  },
  {
    name: "a date made a number",
    from: DATE,
    to: INTEGER,
    expected: ALL_REFUSED,
  },
];

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];
const ORIGINS: ColumnOrigin[] = ["collection", "codeFirst"];

/** The field `f`, shared or translated, beside a translated `headline`. */
const fieldsWith = (field: Field, localized: boolean) => [
  { name: "headline", type: "text", localized: true },
  { ...field, name: "f", localized },
];

/** The type the field's main column has as shared, as the descriptor gives it. */
function sharedType(
  field: Field,
  dialect: SupportedDialect,
  builtBy: ColumnOrigin
): string | undefined {
  return getColumnDescriptor(
    { ...field, name: "f", localized: false } as unknown as FieldDefinition,
    dialect,
    builtBy
  )?.dialectType;
}

/** The Schema Builder's preflight, for a first move and for its retry alike. */
function builderAnswer(
  pair: (typeof PAIRS)[number],
  dialect: SupportedDialect,
  builtBy: ColumnOrigin
): Answer {
  const losing = joiningFieldsLosingValues(
    ["f"],
    {
      oldFields: fieldsWith(pair.from, false),
      newFields: fieldsWith(pair.to, true),
      builtBy,
    },
    dialect
  );
  return losing.includes("f") ? "refused" : "keeps";
}

/** A code-first apply, judged against the main table as the field's shared form built it. */
async function applyAnswer(
  pair: (typeof PAIRS)[number],
  dialect: SupportedDialect,
  builtBy: ColumnOrigin
): Promise<Answer> {
  const liveType = sharedType(pair.from, dialect, builtBy);
  if (liveType === undefined) throw new Error("the field has no column");
  const reshaped = await joinsReshapedAgainst(
    {
      name: "dc_docs",
      columns: [{ name: "f", type: liveType, nullable: true }],
      indexes: [],
    },
    {
      fields: fieldsWith(pair.to, true),
      joining: [{ field: "f", column: "f" }],
      rowColumns: false,
      builtBy,
      dialect,
    }
  );
  return reshaped.includes("f") ? "refused" : "keeps";
}

/** `migrate:create`, generating the entity with `f` shared, then with `f` translated. */
async function migrateCreateAnswer(
  pair: (typeof PAIRS)[number],
  dialect: SupportedDialect,
  builtBy: ColumnOrigin
): Promise<Answer> {
  const dir = await mkdtemp(join(tmpdir(), "nextly-join-judges-"));
  const entity = (field: Field, localized: boolean): MinimalConfigEntity => ({
    slug: "docs",
    tableName: "dc_docs",
    localized: true,
    fields: fieldsWith(field, localized),
    // A Builder collection's tables are described by the Builder's rule.
    ...(builtBy === "collection"
      ? { settings: { source: "builder", settings: {} } }
      : {}),
  });
  const run = (e: MinimalConfigEntity, name: string, at: string) =>
    generateMigration({
      name,
      dialect,
      migrationsDir: dir,
      defaultLocale: "en",
      collections: [e],
      singles: [],
      components: [],
      nonInteractive: true,
      now: new Date(at),
    });
  try {
    await run(entity(pair.from, false), "one", "2026-11-11T10:00:00.000Z");
    const before = new Set(await readdir(dir));
    try {
      await run(entity(pair.to, true), "two", "2026-11-11T11:00:00.000Z");
    } catch (error) {
      const errors = (error as { publicData?: { errors?: unknown } })
        .publicData?.errors;
      expect(errors).toEqual([
        expect.objectContaining({
          path: "fields.f",
          code: "RESHAPED_FIELD_JOINS_TRANSLATION",
        }),
      ]);
      return "refused";
    }
    // Kept: the second run wrote the move.
    expect(
      (await readdir(dir)).filter(f => !before.has(f) && f.endsWith(".sql"))
    ).toContainEqual(expect.stringMatching(/_joins_localization_docs\.sql$/));
    return "keeps";
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe.each(DIALECTS)(
  "every judge of a field joining translation (%s)",
  dialect => {
    describe.each(ORIGINS)("for a column built by %s", builtBy => {
      it.each(PAIRS.map(p => [p.name, p] as const))(
        "gives one answer for %s",
        async (_name, pair) => {
          const expected = pair.expected[dialect];
          // Where the database stores both sides as one declared type, a judge with only types
          // sees no change, and the database keeps every value as it was.
          const typesOnly =
            sharedType(pair.from, dialect, builtBy) ===
            sharedType(pair.to, dialect, builtBy)
              ? "keeps"
              : expected;

          expect({
            builder: builderAnswer(pair, dialect, builtBy),
            apply: await applyAnswer(pair, dialect, builtBy),
            migrateCreate: await migrateCreateAnswer(pair, dialect, builtBy),
          }).toEqual({
            builder: expected,
            apply: typesOnly,
            migrateCreate: typesOnly,
          });
        }
      );
    });
  }
);
