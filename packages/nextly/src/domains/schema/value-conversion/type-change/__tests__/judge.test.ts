import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../../schemas/dynamic-collections";
import type { SupportedDialect } from "../../../services/field-column-descriptor";
import { fieldTypeOnDialect, type FieldTypeOnDialect } from "../field-type";
import {
  classOf,
  instantWriting,
  judgeValue,
  type OldValue,
  pairBlocked,
  readDateText,
  type ValueOutcome,
} from "../judge";
import { readNumber } from "../numbers";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** A field of `type`, as the Builder stores it, on `dialect`. */
function typeOf(
  dialect: SupportedDialect,
  type: string,
  extra: Partial<FieldDefinition> = {}
): FieldTypeOnDialect {
  return fieldTypeOnDialect(
    { name: "f", type, ...extra } as FieldDefinition,
    dialect,
    "collection"
  );
}

const text = (value: string): OldValue => ({ kind: "text", text: value });
const num = (value: string): OldValue => {
  const number = readNumber(value);
  if (number === null) throw new Error(`not a number: ${value}`);
  return { kind: "number", number };
};
const bool = (value: boolean): OldValue => ({ kind: "boolean", value });
const json = (value: unknown): OldValue => ({ kind: "json", value });
const list = (...items: OldValue[]): OldValue => ({ kind: "list", items });
const date = (iso: string): OldValue => {
  const instant = readDateText(iso);
  if (typeof instant === "string") throw new Error(`not an instant: ${iso}`);
  return { kind: "date", date: instant };
};
const empty: OldValue = { kind: "empty" };

// The options as the Builder stores a select's or a radio's choices.
const options = (...values: string[]) =>
  ({
    options: values.map(value => ({ label: value, value })),
  }) as unknown as Partial<FieldDefinition>;
const float = { options: { format: "float" } } as Partial<FieldDefinition>;
const decimal = { dbType: "decimal" } as Partial<FieldDefinition>;
const longEnough = "x".repeat(300);

/** One case: from a type to a type, one value, the outcome on each dialect. */
interface Case {
  name: string;
  from: [string, Partial<FieldDefinition>?];
  to: [string, Partial<FieldDefinition>?];
  value: OldValue;
  outcome: ValueOutcome | Partial<Record<SupportedDialect, ValueOutcome>>;
  readsAs?: string;
}

const CASES: Case[] = [
  // Rule 4: empty values stay empty, kept, under every pair.
  {
    name: "a null to a number",
    from: ["text"],
    to: ["number"],
    value: empty,
    outcome: "kept",
  },
  {
    name: "a JSON null to a list",
    from: ["json"],
    to: ["chips"],
    value: json(null),
    outcome: "kept",
  },
  {
    name: "a JSON [] to text",
    from: ["json"],
    to: ["text"],
    value: json([]),
    outcome: "kept",
  },
  {
    name: "an empty list to a text",
    from: ["chips"],
    to: ["text"],
    value: list(),
    outcome: "kept",
  },

  // Text, Email, Choice to Text.
  {
    name: "an email to text",
    from: ["email"],
    to: ["text"],
    value: text("a@b.io"),
    outcome: "kept",
    readsAs: "a@b.io",
  },
  // A short text is a varchar(255) on PostgreSQL and MySQL, and unbounded text on SQLite.
  {
    name: "a textarea value over 255 characters to a short text",
    from: ["textarea"],
    to: ["text", { options: { variant: "short" } } as Partial<FieldDefinition>],
    value: text(longEnough),
    outcome: { postgresql: "blocked", mysql: "blocked", sqlite: "kept" },
  },
  {
    name: "a textarea value over 255 characters to a text",
    from: ["textarea"],
    to: ["text"],
    value: text(longEnough),
    outcome: "kept",
  },

  // To Email.
  {
    name: "a text the email rule accepts",
    from: ["text"],
    to: ["email"],
    value: text("a@b.io"),
    outcome: "kept",
  },
  {
    name: "a text the email rule refuses",
    from: ["text"],
    to: ["email"],
    value: text("not an email"),
    outcome: "lost",
  },
  {
    name: "a textarea value over 255 characters to an email",
    from: ["textarea"],
    to: ["email"],
    value: text(longEnough),
    outcome: { postgresql: "lost", mysql: "blocked", sqlite: "lost" },
  },

  // To Choice.
  {
    name: "a text that is an option",
    from: ["text"],
    to: ["radio", options("red", "blue")],
    value: text("red"),
    outcome: "kept",
  },
  {
    name: "a text that is no option",
    from: ["text"],
    to: ["radio", options("red", "blue")],
    value: text("green"),
    outcome: "lost",
  },
  {
    name: "a textarea value over 255 characters to a choice",
    from: ["textarea"],
    to: ["select", options(longEnough)],
    value: text(longEnough),
    outcome: { postgresql: "kept", mysql: "blocked", sqlite: "kept" },
  },

  // To Rich text: one paragraph per line, changed.
  {
    name: "a text to rich text",
    from: ["text"],
    to: ["richText"],
    value: text("one\ntwo"),
    outcome: "changed",
  },

  // To Number (rule 2: "01" reads back as 1, changed).
  {
    name: '"01" to a whole number',
    from: ["text"],
    to: ["number"],
    value: text("01"),
    outcome: "changed",
    readsAs: "1",
  },
  {
    name: '"1.50" to a float',
    from: ["text"],
    to: ["number", float],
    value: text("1.50"),
    outcome: "changed",
    readsAs: "1.5",
  },
  {
    name: "a fraction text to a whole number",
    from: ["text"],
    to: ["number"],
    value: text("1.5"),
    outcome: "blocked",
  },
  {
    name: "a text that is not a number",
    from: ["text"],
    to: ["number"],
    value: text("abc"),
    outcome: "lost",
  },
  {
    name: "an empty string to a number",
    from: ["text"],
    to: ["number"],
    value: text(""),
    outcome: "lost",
  },
  // A number is read as the column judgement reads one (`exactNumber`): blanks around it are not part
  // of it.
  {
    name: "a number with blanks around it to a number",
    from: ["text"],
    to: ["number"],
    value: text(" 1 "),
    outcome: "changed",
    readsAs: "1",
  },
  {
    name: "a text beyond 32 bits to a whole number",
    from: ["text"],
    to: ["number"],
    value: text("3000000000"),
    outcome: { postgresql: "blocked", mysql: "blocked", sqlite: "changed" },
  },
  {
    name: "a text Infinity to a float",
    from: ["text"],
    to: ["number", float],
    value: text("Infinity"),
    outcome: { postgresql: "changed", mysql: "lost", sqlite: "changed" },
  },
  {
    name: "a text Infinity to a decimal",
    from: ["text"],
    to: ["number", decimal],
    value: text("infinity"),
    outcome: { postgresql: "lost", mysql: "lost", sqlite: "changed" },
  },

  // To Checkbox.
  {
    name: "a text TRUE to a checkbox",
    from: ["text"],
    to: ["checkbox"],
    value: text("TRUE"),
    outcome: "changed",
    readsAs: "true",
  },
  {
    name: "a text 0 to a checkbox",
    from: ["text"],
    to: ["checkbox"],
    value: text("0"),
    outcome: "changed",
    readsAs: "false",
  },
  {
    name: "a text yes to a checkbox",
    from: ["text"],
    to: ["checkbox"],
    value: text("yes"),
    outcome: "lost",
  },

  // To Date (rule 7).
  {
    name: "a date-time with an offset to a date",
    from: ["text"],
    to: ["date"],
    value: text("2026-01-02T03:04:05+02:00"),
    outcome: "changed",
    readsAs: "2026-01-02T01:04:05Z",
  },
  {
    name: "a date-only text to a date",
    from: ["text"],
    to: ["date"],
    value: text("2026-01-02"),
    outcome: "blocked",
  },
  {
    name: "a date-time with no offset to a date",
    from: ["text"],
    to: ["date"],
    value: text("2026-01-02T03:04:05"),
    outcome: "blocked",
  },
  {
    name: "a date-time with milliseconds to a date",
    from: ["text"],
    to: ["date"],
    value: text("2026-01-02T03:04:05.250Z"),
    outcome: { postgresql: "changed", mysql: "blocked", sqlite: "blocked" },
  },
  {
    name: "a date-time past 2038 to a date",
    from: ["text"],
    to: ["date"],
    value: text("2040-01-01T00:00:00Z"),
    outcome: { postgresql: "changed", mysql: "blocked", sqlite: "changed" },
  },
  {
    name: "a text that is no date",
    from: ["text"],
    to: ["date"],
    value: text("tomorrow"),
    outcome: "lost",
  },
  // Read by the one exact ISO 8601 reader, whose separator between date and time is `T` alone.
  {
    name: "a date-time written with a space to a date",
    from: ["text"],
    to: ["date"],
    value: text("2026-01-02 03:04:05Z"),
    outcome: "lost",
  },
  {
    name: "a day that does not exist",
    from: ["text"],
    to: ["date"],
    value: text("2026-02-30T00:00:00Z"),
    outcome: "lost",
  },

  // To JSON and to List.
  {
    name: "a text to JSON (kept as a JSON string)",
    from: ["text"],
    to: ["json"],
    value: text("hello"),
    outcome: "kept",
  },
  // PostgreSQL's jsonb refuses a \u0000 escape, so it cannot hold the JSON string at all (rule 1).
  {
    name: "a text holding a NUL character to JSON",
    from: ["text"],
    to: ["json"],
    value: text("a\u0000b"),
    outcome: { postgresql: "lost", mysql: "kept", sqlite: "kept" },
  },
  {
    name: "a text to a list of text",
    from: ["text"],
    to: ["chips"],
    value: text("a"),
    outcome: "changed",
    readsAs: '["a"]',
  },
  {
    name: "a text that is no number to a list of numbers",
    from: ["text"],
    to: ["number", { hasMany: true }],
    value: text("abc"),
    outcome: "lost",
  },

  // Rich text.
  {
    name: "rich text to JSON",
    from: ["richText"],
    to: ["json"],
    value: {
      kind: "document",
      value: { root: { type: "root", children: [] } },
    },
    outcome: "kept",
  },
  {
    name: "rich text to text",
    from: ["richText"],
    to: ["text"],
    value: {
      kind: "document",
      value: { root: { type: "root", children: [] } },
    },
    outcome: "changed",
  },
  {
    name: "rich text to a number",
    from: ["richText"],
    to: ["number"],
    value: {
      kind: "document",
      value: { root: { type: "root", children: [] } },
    },
    outcome: "blocked",
  },

  // Number.
  {
    name: "a number to text",
    from: ["number", float],
    to: ["text"],
    value: num("1.25"),
    outcome: "changed",
    readsAs: "1.25",
  },
  {
    name: "a whole number to a float",
    from: ["number"],
    to: ["number", float],
    value: num("7"),
    outcome: "kept",
  },
  {
    name: "a fraction to a whole number",
    from: ["number", float],
    to: ["number"],
    value: num("1.5"),
    outcome: "blocked",
  },
  {
    name: "a whole number beyond what a double holds exactly",
    from: ["number", decimal],
    to: ["number", float],
    value: num("9007199254740993"),
    outcome: "blocked",
  },
  {
    name: "a float with more digits than a decimal's scale",
    from: ["number", float],
    to: ["number", decimal],
    value: num("1.255"),
    outcome: "blocked",
  },
  {
    name: "a number 1 to a checkbox",
    from: ["number"],
    to: ["checkbox"],
    value: num("1"),
    outcome: "changed",
  },
  {
    name: "a number 2 to a checkbox",
    from: ["number"],
    to: ["checkbox"],
    value: num("2"),
    outcome: "lost",
  },
  {
    name: "a NaN to JSON",
    from: ["number", float],
    to: ["json"],
    value: num("NaN"),
    outcome: "lost",
  },
  {
    name: "an Infinity to text",
    from: ["number", float],
    to: ["text"],
    value: num("Infinity"),
    outcome: "changed",
    readsAs: "Infinity",
  },
  {
    name: "a number to a list of numbers",
    from: ["number"],
    to: ["number", { hasMany: true }],
    value: num("3"),
    outcome: "changed",
    // A list of numbers holds JSON numbers, not their writing as text.
    readsAs: "[3]",
  },
  {
    name: "a text list to a list of float numbers, written as JSON numbers",
    from: ["chips"],
    to: [
      "number",
      {
        hasMany: true,
        options: { format: "float" },
      } as Partial<FieldDefinition>,
    ],
    value: list(text("1"), text("2.5")),
    outcome: "changed",
    readsAs: "[1,2.5]",
  },
  // A list of numbers keeps its numbers as JSON numbers going to JSON.
  {
    name: "a list of numbers to JSON",
    from: ["number", { hasMany: true }],
    to: ["json"],
    value: list(num("3")),
    outcome: "kept",
    readsAs: "[3]",
  },
  // A typed list holds no null item: the field's validator refuses one.
  {
    name: "a JSON [null] to a list of numbers",
    from: ["json"],
    to: ["number", { hasMany: true }],
    value: json([null]),
    outcome: "blocked",
  },
  // A list of numbers is JSON on every database, which holds no non-finite number (rule 6).
  {
    name: "a text Infinity to a list of numbers",
    from: ["text"],
    to: ["number", { hasMany: true }],
    value: text("Infinity"),
    outcome: "lost",
  },
  // A list of whole numbers keeps the field's whole-number rule.
  {
    name: "a fraction text to a list of whole numbers",
    from: ["text"],
    to: ["number", { hasMany: true }],
    value: text("1.5"),
    outcome: "blocked",
  },
  // A text field holding several values keeps them as a list.
  {
    name: "a text to a text holding several values",
    from: ["text"],
    to: ["text", { hasMany: true } as Partial<FieldDefinition>],
    value: text("a"),
    outcome: "changed",
    readsAs: '["a"]',
  },
  // A number is read as a JavaScript number on SQLite, which holds no integer past 2^53 exactly.
  {
    name: "a text past 2^53 to a whole number",
    from: ["text"],
    to: ["number"],
    value: text("9007199254740993"),
    outcome: "blocked",
  },
  // A date field reads a JavaScript Date, which keeps milliseconds and no finer.
  {
    name: "a date-time with microseconds to a date",
    from: ["text"],
    to: ["date"],
    value: text("2026-01-02T03:04:05.123456Z"),
    outcome: "blocked",
  },
  // A number spelled with an exponent no column could hold is judged, never expanded.
  {
    name: "a text with a huge exponent to a number",
    from: ["text"],
    to: ["number", float],
    value: text("1e1000000000"),
    outcome: "blocked",
  },
  // A JSON field is read through a JavaScript number, so a number a double does not hold exactly
  // reads back as another.
  {
    name: "a decimal no double holds exactly to JSON",
    from: ["number", decimal],
    to: ["json"],
    value: num("9007199254740993"),
    outcome: "blocked",
  },
  // A document whose writing is longer than MySQL's text column holds.
  {
    name: "a JSON document past 65,535 bytes to rich text",
    from: ["json"],
    to: ["richText"],
    value: json({
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: [], text: "x".repeat(70_000) },
        ],
      },
    }),
    outcome: { postgresql: "kept", mysql: "blocked", sqlite: "kept" },
  },
  // Only a document the editor reads is kept as one: its root's children are nodes.
  {
    name: "a JSON object whose root children are not nodes to rich text",
    from: ["json"],
    to: ["richText"],
    value: json({ root: { type: "root", children: [42] } }),
    outcome: "lost",
  },

  // Checkbox.
  {
    name: "a checkbox to text",
    from: ["checkbox"],
    to: ["text"],
    value: bool(true),
    outcome: "changed",
    readsAs: "true",
  },
  {
    name: "a checkbox to a number",
    from: ["checkbox"],
    to: ["number"],
    value: bool(false),
    outcome: "changed",
    readsAs: "0",
  },
  {
    name: "a checkbox to JSON",
    from: ["checkbox"],
    to: ["json"],
    value: bool(true),
    outcome: "kept",
  },
  {
    name: "a checkbox to rich text",
    from: ["checkbox"],
    to: ["richText"],
    value: bool(true),
    outcome: "changed",
  },
  {
    name: "a checkbox to a list of options holding it",
    from: ["checkbox"],
    to: ["select", { hasMany: true, ...options("true", "false") }],
    value: bool(true),
    outcome: "changed",
  },
  {
    name: "a checkbox to a list of options not holding it",
    from: ["checkbox"],
    to: ["select", { hasMany: true, ...options("yes") }],
    value: bool(true),
    outcome: "lost",
  },
  {
    name: "a checkbox to a list (never kept)",
    from: ["checkbox"],
    to: ["chips"],
    value: bool(true),
    outcome: "changed",
  },

  // Date.
  {
    name: "a date to text",
    from: ["date"],
    to: ["text"],
    value: date("2026-01-02T03:04:05Z"),
    outcome: "changed",
    readsAs: "2026-01-02T03:04:05Z",
  },
  {
    name: "a date to JSON",
    from: ["date"],
    to: ["json"],
    value: date("2026-01-02T03:04:05Z"),
    outcome: "changed",
  },
  {
    name: "a date to a list of options not holding it",
    from: ["date"],
    to: ["select", { hasMany: true, ...options("x") }],
    value: date("2026-01-02T03:04:05Z"),
    outcome: "lost",
  },

  // JSON (rule 8).
  {
    name: "a JSON true to a number",
    from: ["json"],
    to: ["number"],
    value: json(true),
    outcome: "changed",
    readsAs: "1",
  },
  {
    name: "a JSON true to a checkbox",
    from: ["json"],
    to: ["checkbox"],
    value: json(true),
    outcome: "kept",
  },
  {
    name: "a JSON [true] to a checkbox",
    from: ["json"],
    to: ["checkbox"],
    value: json([true]),
    outcome: "changed",
  },
  {
    name: "a JSON number to a date",
    from: ["json"],
    to: ["date"],
    value: json(5),
    outcome: "lost",
  },
  {
    name: "a JSON 1.5 to a whole number",
    from: ["json"],
    to: ["number"],
    value: json(1.5),
    outcome: "blocked",
  },
  {
    name: 'a JSON ["x"] to a number',
    from: ["json"],
    to: ["number"],
    value: json(["x"]),
    outcome: "blocked",
  },
  {
    name: "a JSON object to text",
    from: ["json"],
    to: ["text"],
    value: json({ b: 1, a: 2 }),
    outcome: "changed",
    readsAs: '{"a":2,"b":1}',
  },
  {
    name: "a JSON object to a number",
    from: ["json"],
    to: ["number"],
    value: json({ a: 1 }),
    outcome: "lost",
  },
  {
    name: "a JSON document to rich text",
    from: ["json"],
    to: ["richText"],
    value: json({ root: { type: "root", children: [] } }),
    outcome: "kept",
  },
  {
    name: "a JSON string to email",
    from: ["json"],
    to: ["email"],
    value: json("a@b.io"),
    outcome: "kept",
  },

  // Lists (rule 5).
  {
    name: "a one-item list to a text",
    from: ["chips"],
    to: ["text"],
    value: list(text("a")),
    outcome: "changed",
    readsAs: "a",
  },
  {
    name: "a list of several items to a text",
    from: ["chips"],
    to: ["text"],
    value: list(text("a"), text("b")),
    outcome: "blocked",
  },
  {
    name: "a one-item list holding no number to a number",
    from: ["chips"],
    to: ["number"],
    value: list(text("x")),
    outcome: "blocked",
  },
  {
    name: "a list to JSON",
    from: ["chips"],
    to: ["json"],
    value: list(text("a")),
    outcome: "kept",
  },
  {
    name: "a list of text to a list of numbers, every item a number",
    from: ["chips"],
    to: ["number", { hasMany: true }],
    value: list(text("1"), text("2")),
    outcome: "changed",
  },
  {
    name: "a list of text to a list of numbers, one item not",
    from: ["chips"],
    to: ["number", { hasMany: true }],
    value: list(text("1"), text("x")),
    outcome: "blocked",
  },
];

describe("a stored value's outcome when its field's type changes", () => {
  for (const dialect of DIALECTS) {
    describe(dialect, () => {
      for (const c of CASES) {
        it(c.name, () => {
          const verdict = judgeValue(
            typeOf(dialect, c.from[0], c.from[1]),
            typeOf(dialect, c.to[0], c.to[1]),
            c.value
          );
          const expected =
            typeof c.outcome === "string" ? c.outcome : c.outcome[dialect];
          expect(verdict.outcome).toBe(expected);
          if (
            c.readsAs !== undefined &&
            expected !== "lost" &&
            expected !== "blocked"
          ) {
            expect(verdict.readsAs).toBe(c.readsAs);
          }
        });
      }
    });
  }
});

describe("pairs blocked whatever their values hold (rule 3, and the pairs no rule converts)", () => {
  const blocked: [
    string,
    string,
    Partial<FieldDefinition>?,
    Partial<FieldDefinition>?,
  ][] = [
    [
      "relationship",
      "text",
      { relationTo: "people" } as Partial<FieldDefinition>,
    ],
    ["group", "json"],
    ["password", "text"],
    ["text", "password"],
    ["date", "number", undefined, { hasMany: true }],
    ["number", "email"],
    ["checkbox", "date"],
    ["date", "checkbox"],
    ["richText", "select", undefined, options("x")],
  ];
  for (const [from, to, fromExtra, toExtra] of blocked) {
    it(`blocks ${from} to ${to}${toExtra?.hasMany ? " list" : ""}`, () => {
      expect(
        pairBlocked(
          typeOf("postgresql", from, fromExtra),
          typeOf("postgresql", to, toExtra)
        )
      ).not.toBeNull();
    });
  }

  it("blocks a relationship to another target, and keeps one to the same target from one to several", () => {
    const one = typeOf("postgresql", "relationship", {
      relationTo: "people",
    } as Partial<FieldDefinition>);
    const other = typeOf("postgresql", "relationship", {
      relationTo: "teams",
    } as Partial<FieldDefinition>);
    const several = typeOf("postgresql", "relationship", {
      relationTo: "people",
      hasMany: true,
    } as Partial<FieldDefinition>);
    expect(pairBlocked(one, other)).toBe("relationship");
    expect(pairBlocked(one, several)).toBeNull();
    expect(judgeValue(one, several, text("p1")).outcome).toBe("changed");
    expect(judgeValue(several, one, list(text("p1"), text("p2"))).outcome).toBe(
      "blocked"
    );
  });

  it("changes a polymorphic reference to a polymorphic list of them, never keeping it", () => {
    const one = typeOf("postgresql", "relationship", {
      relationTo: ["people", "teams"],
    } as Partial<FieldDefinition>);
    const several = typeOf("postgresql", "relationship", {
      relationTo: ["people", "teams"],
      hasMany: true,
    } as Partial<FieldDefinition>);
    expect(
      judgeValue(one, several, json({ relationTo: "people", value: "p1" }))
        .outcome
    ).toBe("changed");
  });

  it("tells two target sets apart that write alike once joined", () => {
    const first = typeOf("postgresql", "relationship", {
      relationTo: ["aa", "bcd"],
    } as Partial<FieldDefinition>);
    const second = typeOf("postgresql", "relationship", {
      relationTo: ["aab", "cd"],
    } as Partial<FieldDefinition>);
    expect(pairBlocked(first, second)).toBe("relationship");
  });

  it("blocks a built-in type no rule names (an icon) as having no rule, and reads every built-in type", () => {
    expect(
      pairBlocked(typeOf("postgresql", "icon"), typeOf("postgresql", "text"))
    ).toBe("no-rule");
    expect(typeOf("postgresql", "fieldGroup").family).toBe("container");
  });

  it("leaves JSON to any family to its values (rule 8), never blocking the pair", () => {
    for (const to of ["date", "number", "checkbox", "email", "chips"]) {
      expect(
        pairBlocked(typeOf("mysql", "json"), typeOf("mysql", to))
      ).toBeNull();
    }
  });
});

describe("the class a change takes from its values", () => {
  it("is safe where every value is kept or changed, lossy with a lost one, blocked with any blocked", () => {
    expect(classOf(["kept", "changed"])).toBe("safe");
    expect(classOf(["kept", "lost"])).toBe("lossy");
    expect(classOf(["lost", "blocked", "kept"])).toBe("blocked");
    expect(classOf([])).toBe("safe");
  });
});

describe("reading an ISO 8601 instant", () => {
  it("keeps every digit of a second and writes it back in UTC", () => {
    const instant = readDateText("2026-06-30T23:30:00.123456-01:00");
    expect(typeof instant).toBe("object");
    if (typeof instant === "object") {
      expect(instantWriting(instant)).toBe("2026-07-01T00:30:00.123456Z");
    }
  });
});
