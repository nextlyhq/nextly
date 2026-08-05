// What column does a field become? Three implementations answer that, and they must not drift
// apart without someone saying so out loud.
//
//   DynamicCollectionSchemaService  builds Schema-Builder collections and singles
//   FieldGroupSchemaService         builds Schema-Builder field groups
//   getColumnDescriptor             read by the runtime Drizzle table and by the schema diff
//
// The descriptor is the one the product READS through: the runtime table selects the columns it
// names, and the diff decides what to alter by comparing against it. So whenever a generator
// disagrees with the descriptor, the table a user gets is not the table the rest of the system
// believes it has, and the failure surfaces far from its cause: a write rejected by a column whose
// type nobody declared, a diff that proposes the same change on every run, or a select against a
// column the table does not have.
//
// This matrix renders every field type through both generators on every dialect, asks the
// descriptor for the same column, and fails on any disagreement that is not written down in
// ACCEPTED below with a reason.
//
// ## Why the accepted list, rather than fixing them here
//
// Fifty-two disagreements are recorded today. Most resolve by moving the generator to the
// descriptor, and at least one must move the DESCRIPTOR to the generator instead: on MySQL a select
// renders as
// `text` in the generator and `varchar(255)` in the descriptor, and taking the descriptor's answer
// would silently cap existing content at 255 characters. The same two field types resolve the
// OTHER way on PostgreSQL, where the generator is the one that bounds. Deciding those one at a time
// is a different job from stopping new ones appearing, and this file is the second job.
//
// The list is therefore a ratchet, not a permission slip. It is checked in both directions: an
// entry describing a disagreement that no longer happens fails too, so resolving one forces its
// removal here and cannot be done silently.
//
// ## Why this drift is structural rather than careless
//
// The documented recipe for adding a field type names `getColumnDescriptor` as the single source of
// truth for what column a field becomes, and does not mention either generator. Someone following
// it correctly, end to end, adds the type to the descriptor and leaves both generators unaware of
// it — so the drift this file measures is what the documented process PRODUCES, not what someone
// forgot. That is why a test has to hold the line: the instructions cannot.
//
// ## Why a Record over the field-type union
//
// CASES is keyed by `DynamicFieldType`. Adding a field type to that union without adding its rows
// here is a COMPILE error, so a new type cannot enter the product uncovered. A hand-maintained
// array would have let it.

import { describe, expect, it } from "vitest";

import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { FieldGroupSchemaService } from "../../../field-groups/services/field-group-schema-service";
import { normalizeType } from "../../pipeline/diff/normalize-type";
import { getColumnDescriptor } from "../field-column-descriptor";

// Both taken from the descriptor rather than from the database layer: it is the side under test
// that decides which dialects have an answer and what a provenance is called.
import type {
  ColumnOrigin,
  SupportedDialect,
} from "../field-column-descriptor";
import type {
  DynamicFieldType,
  FieldDefinition,
} from "../../../../schemas/dynamic-collections";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** The two Schema-Builder generators, each named by the provenance the descriptor knows it as. */
const BUILDERS = [
  { origin: "collection" as ColumnOrigin, label: "collection" },
  { origin: "fieldGroup" as ColumnOrigin, label: "fieldGroup" },
];

/**
 * One field shape to measure.
 *
 * `label` names the variation rather than the type, because a type's answer often depends on what
 * the field says about itself: a required relationship and an optional one reach different columns,
 * and that difference is exactly where two of the live disagreements live.
 */
interface FieldCase {
  label: string;
  field: Record<string, unknown>;
}

const selectOptions = { options: [{ label: "One", value: "one" }] };

/**
 * Every field type, with the variations that change the column it produces.
 *
 * Keyed by the union so a new type cannot be added without deciding what it stores.
 */
const CASES: Record<DynamicFieldType, FieldCase[]> = {
  text: [
    { label: "plain", field: { type: "text" } },
    { label: "required", field: { type: "text", required: true } },
    // The short variant is the one key that bounds a text column for the collection builder; the
    // field-group builder reads a top-level maxLength instead, so both spellings are measured.
    {
      label: "short variant",
      field: {
        type: "text",
        options: { variant: "short" },
        validation: { maxLength: 120 },
      },
    },
    { label: "top-level maxLength", field: { type: "text", maxLength: 120 } },
  ],
  textarea: [{ label: "plain", field: { type: "textarea" } }],
  richText: [{ label: "plain", field: { type: "richText" } }],
  email: [{ label: "plain", field: { type: "email" } }],
  password: [{ label: "plain", field: { type: "password" } }],
  code: [{ label: "plain", field: { type: "code" } }],
  number: [
    { label: "integer", field: { type: "number" } },
    // `dbType` is how a number states it wants exact fixed-point storage, which is what a money
    // field needs. Measured on its own because the two generators do not agree that it exists.
    {
      label: "decimal",
      field: { type: "number", dbType: "decimal", precision: 10, scale: 2 },
    },
    // A hasMany number holds an array, which the write path stringifies, so the descriptor stores
    // it as JSON and ignores `dbType` entirely. A shape that changes the physical column, and one
    // no scalar case can stand in for.
    { label: "hasMany", field: { type: "number", hasMany: true } },
    {
      label: "hasMany decimal",
      field: { type: "number", hasMany: true, dbType: "decimal" },
    },
  ],
  checkbox: [{ label: "plain", field: { type: "checkbox" } }],
  date: [{ label: "plain", field: { type: "date" } }],
  select: [
    { label: "plain", field: { type: "select", options: selectOptions } },
  ],
  radio: [{ label: "plain", field: { type: "radio", options: selectOptions } }],
  upload: [
    { label: "optional", field: { type: "upload" } },
    { label: "required", field: { type: "upload", required: true } },
    // Many references are held as a JSON array of ids rather than one FK column. An upload is
    // never junction-backed, so this always reaches a column and always has an answer.
    { label: "hasMany", field: { type: "upload", hasMany: true } },
  ],
  relationship: [
    {
      label: "optional",
      field: { type: "relationship", options: { target: "posts" } },
    },
    {
      label: "required",
      field: {
        type: "relationship",
        required: true,
        options: { target: "posts" },
      },
    },
    // Two ways to reference many rows, and they are not interchangeable: hasMany may be
    // junction-backed, in which case there is no column on this row at all, while a `relationTo`
    // array names several targets and holds their ids together. Both change the storage the
    // descriptor picks, so neither can be inferred from the single-target cases.
    {
      label: "hasMany",
      field: {
        type: "relationship",
        hasMany: true,
        options: { target: "posts" },
      },
    },
    {
      label: "polymorphic",
      field: {
        type: "relationship",
        relationTo: ["posts", "pages"],
        options: { target: "posts" },
      },
    },
  ],
  repeater: [{ label: "plain", field: { type: "repeater", fields: [] } }],
  group: [{ label: "plain", field: { type: "group", fields: [] } }],
  json: [{ label: "plain", field: { type: "json" } }],
  // A component field stores its rows in the field group's own table, so it occupies no column on
  // the parent. Measured anyway: "no column" is an answer both sides have to give.
  component: [
    {
      label: "plain",
      field: { type: "component", options: { target: "hero" } },
    },
  ],
  chips: [{ label: "plain", field: { type: "chips" } }],
};

/**
 * A disagreement that exists today, is known, and is not this file's job to fix.
 *
 * `reason` states what the two sides each produce and which direction the resolution has to go,
 * because "accepted" without that is indistinguishable from "unnoticed".
 */
/**
 * `aspect` is what makes the ratchet exact.
 *
 * A column can disagree in two ways at once — a required upload on MySQL differs in both its type
 * and its nullability — and those two are resolved by different changes. Recorded only by column,
 * fixing one of them would leave the other's entry in place with the column still observed, so the
 * list would keep claiming a defect that is gone and no longer force its own removal. Recorded by
 * aspect, each half has to be retired when it is actually resolved.
 */
type DivergenceAspect = "type" | "width" | "nullability" | "absence";

interface AcceptedDivergence {
  builder: string;
  dialect: SupportedDialect;
  type: DynamicFieldType;
  variation: string;
  aspect: DivergenceAspect;
  reason: string;
}

/**
 * One disagreement, named down to the aspect, so observed and accepted rows match exactly.
 *
 * The aspect is part of the identity rather than a note on it. Two entries about one column are two
 * separate claims, and each has to be retired on its own.
 */
function key(o: {
  builder: string;
  dialect: string;
  type: string;
  variation: string;
  aspect: DivergenceAspect;
}): string {
  return `${o.builder}/${o.dialect}/${o.type}/${o.variation}/${o.aspect}`;
}

function byAspect(entries: AcceptedDivergence[]): Map<string, string> {
  const merged = new Map<string, string>();
  for (const entry of entries) merged.set(key(entry), entry.reason);
  return merged;
}

/** Every builder/dialect combination a family covers, so a family is declared once and not nine times. */
function everywhere(
  types: DynamicFieldType[],
  variations: string[],
  aspect: DivergenceAspect,
  reason: string,
  scope: { builders?: string[]; dialects?: SupportedDialect[] } = {}
): AcceptedDivergence[] {
  const builders = scope.builders ?? BUILDERS.map(b => b.label);
  const dialects = scope.dialects ?? DIALECTS;
  return builders.flatMap(builder =>
    dialects.flatMap(dialect =>
      types.flatMap(type =>
        variations.map(variation => ({
          builder,
          dialect,
          type,
          variation,
          aspect,
          reason,
        }))
      )
    )
  );
}

const FK_TYPES: DynamicFieldType[] = ["upload", "relationship"];

const ACCEPTED = byAspect([
  // --- 🔴 A field type one generator has never heard of ---------------------
  // The field-group generator has no case for `chips` and emits NOTHING: the column is absent from
  // the CREATE TABLE while the descriptor names a JSON column, so the runtime table binds a column
  // the database does not have. Not a shape disagreement, an absence. Fixed on its own, not here.
  ...everywhere(
    ["chips"],
    ["plain"],
    "absence",
    "field-group generator emits no column at all for chips; descriptor names a JSON column",
    { builders: ["fieldGroup"] }
  ),

  // --- 🔴 Fixed-point numbers ----------------------------------------------
  // The field-group generator honours `dbType: "decimal"`; the collection generator never reads it
  // and emits a whole-number column, so a money field loses its fraction. The generator moves.
  ...everywhere(
    ["number"],
    ["decimal"],
    "type",
    "collection generator ignores dbType and emits an integer column; descriptor says exact decimal",
    { builders: ["collection"] }
  ),

  // --- Required foreign keys: nullability ----------------------------------
  // The descriptor states that every FK column is nullable and that requiredness is enforced above
  // the database. Both generators emit NOT NULL, so a row the application would have rejected with
  // a field-level message is refused by the database with a driver error instead.
  ...everywhere(
    FK_TYPES,
    ["required"],
    "nullability",
    "generator emits NOT NULL for a required FK column; descriptor calls every FK column nullable"
  ),

  // --- Foreign keys on PostgreSQL: type ------------------------------------
  // The field-group generator gives an FK column the UUID type; the descriptor calls it text, which
  // is what the runtime table binds and what a collection's own FK columns are. A UUID column
  // refuses any id that is not one.
  ...everywhere(
    FK_TYPES,
    ["optional", "required"],
    "type",
    "field-group generator types an FK column as UUID; descriptor and the runtime say text",
    { builders: ["fieldGroup"], dialects: ["postgresql"] }
  ),

  // --- Foreign keys on MySQL: type -----------------------------------------
  ...everywhere(
    ["upload"],
    ["optional", "required"],
    "type",
    "collection generator emits text for an upload FK; descriptor bounds it at varchar(36)",
    { builders: ["collection"], dialects: ["mysql"] }
  ),

  // --- 🔴 Many values in one column ----------------------------------------
  // A field that holds MANY values stores them as a JSON array, and the descriptor says so for
  // every one of them. Neither generator asks the question: both route these through the same
  // scalar mapping a single-valued field of that type gets, so the column holds one value while
  // the runtime binds an array to it. `dbType` does not rescue the number case — the descriptor
  // ignores it once `hasMany` is set, and the field-group generator still emits DECIMAL.
  ...everywhere(
    ["number"],
    ["hasMany", "hasMany decimal"],
    "type",
    "generator emits a scalar number column for a hasMany field; descriptor stores the array as JSON"
  ),
  // SQLite is absent from the two below on purpose: it stores JSON as text, so the two sides land
  // on the same column there and there is nothing to accept.
  ...everywhere(
    ["upload"],
    ["hasMany"],
    "type",
    "collection generator emits a single FK column for a hasMany upload; descriptor stores the ids as JSON",
    { builders: ["collection"], dialects: ["postgresql", "mysql"] }
  ),
  ...everywhere(
    ["relationship"],
    ["hasMany", "polymorphic"],
    "type",
    "collection generator emits a single FK column for a multi-reference relationship; descriptor stores the ids as JSON",
    { builders: ["collection"], dialects: ["postgresql", "mysql"] }
  ),

  // --- Structured values ---------------------------------------------------
  // Repeater and group hold structured data. The collection generator stores them as text while the
  // descriptor names the dialect's JSON type, so the ORM binds a JSON column over a text one.
  // SQLite is absent on purpose: it stores JSON as text, so there is nothing to disagree about.
  ...everywhere(
    ["repeater", "group"],
    ["plain"],
    "type",
    "collection generator stores structured values as text; descriptor names the JSON type",
    { builders: ["collection"], dialects: ["postgresql", "mysql"] }
  ),

  // --- Bounded strings: the two directions ---------------------------------
  // 🔴 These do NOT resolve the same way, which is why each is written down separately rather than
  // as one rule. On MySQL the generator emits `text` (65 535 characters) and the descriptor
  // `varchar(255)`, so taking the descriptor's answer would truncate content that already exists and
  // the DESCRIPTOR has to move. On PostgreSQL it is the reverse: the generator bounds at 255 and the
  // descriptor leaves it unbounded, so the generator can move safely because widening loses nothing.
  ...everywhere(
    ["select", "radio"],
    ["plain"],
    "type",
    "generator emits text, descriptor emits varchar(255); narrowing would truncate, so the descriptor moves",
    { builders: ["collection"], dialects: ["mysql"] }
  ),
  ...everywhere(
    ["select", "radio"],
    ["plain"],
    "type",
    "field-group generator bounds the column at varchar(255); descriptor leaves it text",
    { builders: ["fieldGroup"], dialects: ["postgresql"] }
  ),
  ...everywhere(
    ["email", "password"],
    ["plain"],
    "type",
    "generator bounds the column at varchar(255); descriptor leaves it unbounded text",
    { dialects: ["postgresql"] }
  ),

  // --- Timestamps on MySQL --------------------------------------------------
  // DATETIME and TIMESTAMP differ in MySQL by range and by time-zone handling, so this is a real
  // storage difference rather than a spelling one.
  ...everywhere(
    ["date"],
    ["plain"],
    "type",
    "field-group generator emits DATETIME; descriptor says timestamp",
    { builders: ["fieldGroup"], dialects: ["mysql"] }
  ),
]);

/**
 * The text between the CREATE TABLE column list's own parentheses.
 *
 * Found by counting depth rather than by taking the last `)`, because a column can close its own
 * parenthesis after the list's does not: `DECIMAL(10, 2)` and an inline CHECK both do.
 */
function balancedBody(create: string): string {
  const open = create.indexOf("(");
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < create.length; i++) {
    if (create[i] === "(") depth++;
    else if (create[i] === ")") {
      depth--;
      if (depth === 0) return create.slice(open + 1, i);
    }
  }
  return create.slice(open + 1);
}

/**
 * Split a column list on the commas that separate columns.
 *
 * A plain split on "," cuts `DECIMAL(10, 2)` in half and reports the fragment as the column's type,
 * which reads as a real disagreement and is not one.
 */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** What one side says a column is. `null` means that side produces no column at all. */
interface Rendered {
  type: string;
  notNull: boolean;
}

/**
 * The columns a generated CREATE TABLE declares.
 *
 * Reads the emitted SQL rather than any intermediate the generator happens to expose, because the
 * SQL is what reaches the database and an intermediate can agree while the rendering does not.
 */
function parseCreateTable(sql: string): Map<string, Rendered> {
  const out = new Map<string, Rendered>();
  const create = sql.split(";").find(s => /CREATE TABLE/i.test(s));
  if (!create) return out;

  for (const raw of splitTopLevel(balancedBody(create))) {
    const line = raw.trim();
    // Constraint and key clauses are not column declarations.
    if (/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|KEY|INDEX)\b/i.test(line))
      continue;
    const m = line.match(/^["`]?([a-z0-9_]+)["`]?\s+(.+)$/i);
    if (!m?.[1] || !m[2]) continue;
    const rest = m[2].trim();
    out.set(m[1], {
      // Strip the clauses that qualify a column rather than name its type.
      type: rest
        .replace(/\b(NOT NULL|PRIMARY KEY|UNIQUE|AUTO_INCREMENT)\b/gi, "")
        .replace(/\bDEFAULT\s+[^,]*/gi, "")
        .replace(/\bREFERENCES\b.*/gi, "")
        .trim(),
      notNull: /\bNOT NULL\b/i.test(rest),
    });
  }
  return out;
}

function generatorColumn(
  builder: ColumnOrigin,
  dialect: SupportedDialect,
  field: FieldDefinition,
  columnName: string
): Rendered | null {
  const table = "conformance_probe";
  const sql =
    builder === "collection"
      ? new DynamicCollectionSchemaService(
          undefined,
          dialect
        ).generateMigrationSQL(table, [field], {})
      : new FieldGroupSchemaService(dialect).generateMigrationSQL(
          table,
          [field] as unknown as Parameters<
            FieldGroupSchemaService["generateMigrationSQL"]
          >[1],
          {}
        );
  return parseCreateTable(sql).get(columnName) ?? null;
}

/**
 * Types whose parenthesised modifier changes what the column can hold.
 *
 * `varchar(36)` and `varchar(255)` are different columns; `int4` and `integer` are one column
 * spelled two ways, and `tinyint(1)` is how MySQL spells a boolean. Comparing modifiers everywhere
 * reported all three families as differences and buried the real ones, so the comparison is scoped
 * to the types where the modifier is load-bearing. Named by the canonical form `normalizeType`
 * produces, since that is what the two sides are reduced to before they get here.
 */
const WIDTH_BEARING = new Set(["varchar", "bpchar", "numeric", "decimal"]);

/**
 * The parenthesised modifier of a rendered type, whitespace removed.
 *
 * Empty when there is none, so a type that should carry one and does not is still a difference.
 */
function modifier(type: string): string {
  return (type.match(/\(([^)]*)\)/)?.[1] ?? "").replace(/\s+/g, "");
}

/**
 * How the two sides differ, or null when they agree.
 *
 * Base type is compared through `normalizeType` — the same function the schema diff uses to decide
 * whether two spellings mean one column — so `int4` and `integer` are not reported as a difference
 * the product would never act on. Width is compared separately BECAUSE that function strips it:
 * `varchar(36)` and `varchar(255)` normalise alike and are not the same column.
 */
function difference(
  generated: Rendered | null,
  described: { dialectType: string; nullable: boolean } | null
): Array<{ aspect: DivergenceAspect; detail: string }> {
  if (!generated && !described) return [];
  if (!generated)
    return [
      {
        aspect: "absence",
        detail: `generator produces no column; descriptor says ${described?.dialectType}`,
      },
    ];
  if (!described)
    return [
      {
        aspect: "absence",
        detail: `descriptor produces no column; generator says ${generated.type}`,
      },
    ];

  const parts: Array<{ aspect: DivergenceAspect; detail: string }> = [];
  const base = normalizeType(generated.type);
  if (base !== normalizeType(described.dialectType)) {
    parts.push({
      aspect: "type",
      detail: `generator=${generated.type} descriptor=${described.dialectType}`,
    });
  } else if (
    base !== undefined &&
    WIDTH_BEARING.has(base) &&
    modifier(generated.type) !== modifier(described.dialectType)
  ) {
    parts.push({
      aspect: "width",
      detail: `generator=${generated.type} descriptor=${described.dialectType}`,
    });
  }
  if (generated.notNull === described.nullable) {
    parts.push({
      aspect: "nullability",
      detail: `generator=${generated.notNull ? "NOT NULL" : "nullable"} descriptor=${described.nullable ? "nullable" : "NOT NULL"}`,
    });
  }
  return parts;
}

interface Observed {
  builder: string;
  dialect: SupportedDialect;
  type: DynamicFieldType;
  variation: string;
  aspect: DivergenceAspect;
  detail: string;
}

/** Every disagreement the three implementations currently produce. */
function measure(): Observed[] {
  const found: Observed[] = [];
  for (const builder of BUILDERS) {
    for (const dialect of DIALECTS) {
      for (const [type, cases] of Object.entries(CASES) as Array<
        [DynamicFieldType, FieldCase[]]
      >) {
        for (const testCase of cases) {
          const columnName = `probe_${type.toLowerCase()}`;
          const field = {
            name: columnName,
            ...testCase.field,
          } as unknown as FieldDefinition;

          const generated = generatorColumn(
            builder.origin,
            dialect,
            field,
            columnName
          );
          const described = getColumnDescriptor(field, dialect, builder.origin);
          for (const { aspect, detail } of difference(generated, described)) {
            found.push({
              builder: builder.label,
              dialect,
              type,
              variation: testCase.label,
              aspect,
              detail,
            });
          }
        }
      }
    }
  }
  return found;
}

describe("column conformance: the generators against the descriptor", () => {
  const observed = measure();

  it("produces no disagreement that is not written down", () => {
    const unaccepted = observed.filter(o => !ACCEPTED.has(key(o)));
    expect(
      unaccepted.map(o => `${key(o)} -> ${o.detail}`),
      "a generator and the descriptor disagree about a column, and nothing says so on purpose"
    ).toEqual([]);
  });

  it("keeps no accepted entry for a disagreement that no longer happens", () => {
    const observedKeys = new Set(observed.map(key));
    const stale = [...ACCEPTED.entries()].filter(([k]) => !observedKeys.has(k));
    expect(
      stale.map(([k, reason]) => `${k} (${reason})`),
      "this disagreement was resolved; delete its entry so the list keeps meaning what it says"
    ).toEqual([]);
  });

  // The matrix is only worth its cost if it covers the whole surface, and a silently empty CASES
  // entry or a parse that found no columns would leave it passing while measuring nothing.
  it("measured every field type through both generators on every dialect", () => {
    const types = Object.keys(CASES).length;
    const variations = Object.values(CASES).reduce((n, c) => n + c.length, 0);
    expect(types, "every DynamicFieldType has a row").toBe(18);
    expect(
      variations * BUILDERS.length * DIALECTS.length,
      "columns compared"
    ).toBeGreaterThanOrEqual(150);
  });
});
