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
// The disagreements below are recorded, not endorsed. Most resolve by moving the generator to the
// descriptor. Some must move the DESCRIPTOR instead: on MySQL a select renders as `text` in the
// generator and `varchar(255)` in the descriptor, so taking the descriptor's answer would cap
// existing content at 255 characters, and a multi-select is stored as JSON by the field-group
// generator while the descriptor still describes a single string. The same field type resolves the
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
import {
  parseAddColumns,
  parseCreateTable,
  type Rendered,
} from "../../__tests__/helpers/parse-generated-ddl";
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

/**
 * Each way a Schema-Builder column can come into existence.
 *
 * Two generators, and two paths through each: the column created WITH its table, and the same
 * column added to a table that already exists. Those are separate code, so they are separate
 * measurements — a field whose column is right on creation can still be wrong when added later.
 */
interface BuilderPath {
  origin: ColumnOrigin;
  path: "create" | "alter";
  label: string;
}

const BUILDERS: BuilderPath[] = [
  { origin: "collection", path: "create", label: "collection" },
  { origin: "collection", path: "alter", label: "collection-alter" },
  { origin: "fieldGroup", path: "create", label: "fieldGroup" },
  { origin: "fieldGroup", path: "alter", label: "fieldGroup-alter" },
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
  /**
   * Overrides the generated probe name.
   *
   * Only set where the NAME is the thing under test. Every other case uses an already-snake_case
   * name, which cannot detect a builder that stopped converting.
   */
  fieldName?: string;
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
    // How a Builder-created number asks for fractions, as opposed to `dbType` which is how a
    // code-first one does. Approximate storage rather than exact, so it is a different column from
    // the decimal case above and cannot stand in for it.
    {
      label: "float",
      field: { type: "number", options: { format: "float" } },
    },
  ],
  checkbox: [{ label: "plain", field: { type: "checkbox" } }],
  date: [{ label: "plain", field: { type: "date" } }],
  select: [
    { label: "plain", field: { type: "select", options: selectOptions } },
    // A multi-select holds several chosen values at once, which is a different column from the one
    // that holds a single choice.
    {
      label: "hasMany",
      field: { type: "select", hasMany: true, options: selectOptions },
    },
    // The one case whose FIELD NAME is the thing under test. Every builder and the descriptor share
    // one snake_case rule, and nothing measured it: every other probe is already snake_case, so a
    // builder that stopped converting would agree with the descriptor by coincidence.
    {
      label: "camelCase name",
      fieldName: "probeCamelCaseName",
      field: { type: "select", options: selectOptions },
    },
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
  // The migrated spelling of "component" — measured like it, because "no
  // column" must remain the answer under either token.
  fieldGroup: [
    {
      label: "plain",
      field: { type: "fieldGroup", fieldGroup: "hero" },
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

/**
 * Expand a family across the builder paths, dialects and field types it covers.
 *
 * Scoped by builder ORIGIN rather than by label, and expanded across both of that origin's paths by
 * default, because most divergences come from the type map both paths share. `paths` narrows a
 * family to the one path that has it — which is what the ADD COLUMN path needs, since it drops
 * everything a field says beyond its type and length.
 */
function everywhere(
  types: DynamicFieldType[],
  variations: string[],
  aspect: DivergenceAspect,
  reason: string,
  scope: {
    origins?: ColumnOrigin[];
    dialects?: SupportedDialect[];
    paths?: Array<"create" | "alter">;
  } = {}
): AcceptedDivergence[] {
  const origins = scope.origins ?? ["collection", "fieldGroup"];
  const paths = scope.paths ?? ["create", "alter"];
  const dialects = scope.dialects ?? DIALECTS;
  const builders = BUILDERS.filter(
    b => origins.includes(b.origin) && paths.includes(b.path)
  );
  return builders.flatMap(b =>
    dialects.flatMap(dialect =>
      types.flatMap(type =>
        variations.map(variation => ({
          builder: b.label,
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
    { origins: ["fieldGroup"] }
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
    { origins: ["fieldGroup"], dialects: ["postgresql"] }
  ),

  // --- Foreign keys on MySQL: type -----------------------------------------
  ...everywhere(
    ["upload"],
    ["optional", "required"],
    "type",
    "collection generator emits text for an upload FK; descriptor bounds it at varchar(36)",
    { origins: ["collection"], dialects: ["mysql"] }
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
    { origins: ["collection"], dialects: ["postgresql", "mysql"] }
  ),
  ...everywhere(
    ["relationship"],
    ["hasMany", "polymorphic"],
    "type",
    "collection generator emits a single FK column for a multi-reference relationship; descriptor stores the ids as JSON",
    { origins: ["collection"], dialects: ["postgresql", "mysql"] }
  ),

  // --- 🔴 A number that wants fractions -------------------------------------
  // Two ways to ask, and neither generator gives the descriptor's answer. `options.format` is how a
  // Builder-created number asks; the create path answers with an EXACT decimal where the descriptor
  // wants approximate floating point, and the ALTER path answers with a whole number because it
  // never sees the options at all.
  ...everywhere(
    ["number"],
    ["float"],
    "type",
    "collection generator emits an exact decimal for a float field; descriptor says floating point",
    {
      origins: ["collection"],
      paths: ["create"],
      dialects: ["postgresql", "mysql"],
    }
  ),

  // --- 🔴 What the ADD COLUMN path never sees -------------------------------
  // A column added to an existing table is rendered from the field's TYPE and LENGTH only, so
  // everything else a field says is dropped on the way: the short-text variant, the width behind
  // it, and `options.format`. The same field creates one column with its table and a different one
  // when added later, and the diff then proposes that difference on every run afterwards.
  ...everywhere(
    ["text"],
    ["short variant"],
    "type",
    "ADD COLUMN drops the field's options and validation, so a bounded text field is added unbounded",
    {
      origins: ["collection"],
      paths: ["alter"],
      dialects: ["postgresql", "mysql"],
    }
  ),
  ...everywhere(
    ["number"],
    ["float"],
    "type",
    "ADD COLUMN drops the field's options, so a float field is added as a whole number",
    { origins: ["collection"], paths: ["alter"] }
  ),

  // --- 🔴 A select that holds several choices -------------------------------
  // The field-group generator switches a hasMany select to a JSON column; the descriptor does not
  // look at `hasMany` for a select at all and keeps describing a single string. Recorded against the
  // DESCRIPTOR: the generator is storing several values the way several values have to be stored.
  ...everywhere(
    ["select"],
    ["hasMany"],
    "type",
    "field-group generator stores a multi-select as JSON; descriptor still describes a single string",
    { origins: ["fieldGroup"], dialects: ["postgresql", "mysql"] }
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
    { origins: ["collection"], dialects: ["postgresql", "mysql"] }
  ),

  // --- Bounded strings: the two directions ---------------------------------
  // 🔴 These do NOT resolve the same way, which is why each is written down separately rather than
  // as one rule. On MySQL the generator emits `text` (65 535 characters) and the descriptor
  // `varchar(255)`, so taking the descriptor's answer would truncate content that already exists and
  // the DESCRIPTOR has to move. On PostgreSQL it is the reverse: the generator bounds at 255 and the
  // descriptor leaves it unbounded, so the generator can move safely because widening loses nothing.
  ...everywhere(
    ["select"],
    ["plain", "hasMany", "camelCase name"],
    "type",
    "generator emits text, descriptor emits varchar(255); narrowing would truncate, so the descriptor moves",
    { origins: ["collection"], dialects: ["mysql"] }
  ),
  ...everywhere(
    ["radio"],
    ["plain"],
    "type",
    "generator emits text, descriptor emits varchar(255); narrowing would truncate, so the descriptor moves",
    { origins: ["collection"], dialects: ["mysql"] }
  ),
  ...everywhere(
    ["select"],
    ["plain", "camelCase name"],
    "type",
    "field-group generator bounds the column at varchar(255); descriptor leaves it text",
    { origins: ["fieldGroup"], dialects: ["postgresql"] }
  ),
  ...everywhere(
    ["radio"],
    ["plain"],
    "type",
    "field-group generator bounds the column at varchar(255); descriptor leaves it text",
    { origins: ["fieldGroup"], dialects: ["postgresql"] }
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
    { origins: ["fieldGroup"], dialects: ["mysql"] }
  ),
]);

const PROBE_TABLE = "conformance_probe";

/** Every column a builder emits for a field list, through the path being measured. */
function emittedColumns(
  builder: BuilderPath,
  dialect: SupportedDialect,
  fields: FieldDefinition[]
): Map<string, Rendered> {
  if (builder.origin === "collection") {
    const service = new DynamicCollectionSchemaService(undefined, dialect);
    return builder.path === "create"
      ? parseCreateTable(service.generateMigrationSQL(PROBE_TABLE, fields, {}))
      : parseAddColumns(
          // Measured against an empty table. A required column whose type offers no backfill is
          // REFUSED when the table may already hold rows, which is correct and is a different
          // question from what column the field becomes. Saying the table is empty is what makes
          // the generator emit rather than refuse, so there is something to compare.
          service.generateAlterTableMigration(PROBE_TABLE, [], fields, {
            tableHasRows: false,
          })
        );
  }
  const service = new FieldGroupSchemaService(dialect);
  const asConfigs = fields as unknown as Parameters<
    FieldGroupSchemaService["generateMigrationSQL"]
  >[1];
  return builder.path === "create"
    ? parseCreateTable(service.generateMigrationSQL(PROBE_TABLE, asConfigs, {}))
    : parseAddColumns(
        service.generateAlterTableMigration(PROBE_TABLE, [], asConfigs)
      );
}

/**
 * The column a field occupies, looked up by the name the descriptor gives it.
 *
 * The descriptor's name is the right key precisely because it is the name the runtime table and the
 * diff will use: a generator that emits some other name has produced a column the product cannot
 * address, which this reports as an absence. That the two agree on the name at all is checked
 * separately and explicitly, since every probe here is already snake_case and so could not detect a
 * builder that stopped converting.
 */
function generatorColumn(
  builder: BuilderPath,
  dialect: SupportedDialect,
  field: FieldDefinition,
  columnName: string
): Rendered | null {
  return emittedColumns(builder, dialect, [field]).get(columnName) ?? null;
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
          const field = {
            name: testCase.fieldName ?? `probe_${type.toLowerCase()}`,
            ...testCase.field,
          } as unknown as FieldDefinition;

          const described = getColumnDescriptor(field, dialect, builder.origin);
          const generated = described
            ? generatorColumn(builder, dialect, field, described.name)
            : null;
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
    expect(types, "every DynamicFieldType has a row").toBe(19);
    // A Record satisfied by `newType: []` type-checks and measures nothing, and the aggregate below
    // would stay comfortably over its floor while the new type entered uncovered.
    expect(
      Object.entries(CASES)
        .filter(([, cases]) => cases.length === 0)
        .map(([type]) => type),
      "a field type with no cases is covered by nothing"
    ).toEqual([]);
    expect(
      variations * BUILDERS.length * DIALECTS.length,
      "columns compared"
    ).toBeGreaterThanOrEqual(150);
  });
});
