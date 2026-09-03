// Two implementations decide whether two type spellings mean one column, and they must not disagree.
//
//   normalizeType        the schema DIFF's answer — decides whether a column changed at all
//   isTypesCompatible    the rename DETECTOR's answer — decides whether a rename keeps the data
//
// The invariant is one-directional and follows from what each is for. If the diff says two spellings
// are the same column, then moving a column between them changes nothing about its storage, so the
// detector must offer the rename that MOVES the data. When it does not, the only recovery on offer
// drops the column and recreates it empty — for a column the database never needed to touch.
//
// The reverse is not required and is not asserted: the detector may accept a change the diff calls
// real, which is how `text` into JSON is offered as a convertible rename.
//
// ## Why a matrix rather than a case
//
// This is the same failure the column-conformance matrix exists for, one layer down: a second
// implementation of a question that already had an answer. It was found by measuring one field type
// on one dialect, which is exactly how the generator/descriptor divergences were found one at a time
// for a month. The types are therefore enumerated from what the product actually produces rather
// than hand-listed, so a new field type or a changed rendering enters this comparison automatically.

import { describe, expect, it } from "vitest";

import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { FieldGroupSchemaService } from "../../../field-groups/services/field-group-schema-service";
import { parseCreateTable } from "../../__tests__/helpers/parse-generated-ddl";
import { getColumnDescriptor } from "../../services/field-column-descriptor";
import { normalizeType } from "../diff/normalize-type";
import { isTypesCompatible } from "../rename-detector-type-families";

import type { SupportedDialect } from "../../services/field-column-descriptor";
import type {
  DynamicFieldType,
  FieldDefinition,
} from "../../../../schemas/dynamic-collections";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

const selectOptions = { options: [{ label: "One", value: "one" }] };

/**
 * One field shape per storage a column can reach.
 *
 * Keyed by the field-type union so a new type cannot be added without deciding what it stores, the
 * same guard the column-conformance matrix uses. The variations are only those that change the
 * physical column, because this file compares TYPES rather than field behaviour.
 */
const SHAPES: Record<DynamicFieldType, Array<Record<string, unknown>>> = {
  text: [{ type: "text" }, { type: "text", options: { variant: "short" } }],
  textarea: [{ type: "textarea" }],
  richText: [{ type: "richText" }],
  email: [{ type: "email" }],
  password: [{ type: "password" }],
  code: [{ type: "code" }],
  number: [
    { type: "number" },
    { type: "number", dbType: "decimal", precision: 10, scale: 2 },
    { type: "number", options: { format: "float" } },
    { type: "number", hasMany: true },
  ],
  checkbox: [{ type: "checkbox" }],
  date: [{ type: "date" }],
  select: [{ type: "select", options: selectOptions }],
  radio: [{ type: "radio", options: selectOptions }],
  upload: [{ type: "upload" }, { type: "upload", hasMany: true }],
  relationship: [
    { type: "relationship", options: { target: "posts" } },
    { type: "relationship", hasMany: true, options: { target: "posts" } },
  ],
  repeater: [{ type: "repeater", fields: [] }],
  group: [{ type: "group", fields: [] }],
  json: [{ type: "json" }],
  component: [{ type: "component", options: { target: "hero" } }],
  // The migrated spelling of "component" — same storage, so the same rename
  // agreement is required of it.
  fieldGroup: [{ type: "fieldGroup", fieldGroup: "hero" }],
  chips: [{ type: "chips" }],
};

/**
 * One field per shape in `SHAPES`, named so a generated table can hold them all at once.
 *
 * Named per shape rather than per type: two variations of one type are two different columns, and
 * reusing a name would have the second overwrite the first in the parsed column map.
 */
function probeFields(): FieldDefinition[] {
  const out: FieldDefinition[] = [];
  for (const [type, shapes] of Object.entries(SHAPES) as Array<
    [DynamicFieldType, Array<Record<string, unknown>>]
  >) {
    shapes.forEach((shape, i) => {
      out.push({
        name: `probe_${type.toLowerCase()}_${i}`,
        ...shape,
      } as unknown as FieldDefinition);
    });
  }
  return out;
}

/**
 * Every column type the product can put in a table, for one dialect.
 *
 * Both sides are collected because a rename pairs them: the LIVE column carries whatever the builder
 * once emitted, and the DESIRED column is what the descriptor asks for now. A comparison over only
 * one side would miss precisely the pairs a legacy table produces.
 */
function reachableTypes(dialect: SupportedDialect): string[] {
  const found = new Set<string>();
  const collections = new DynamicCollectionSchemaService(undefined, dialect);
  const fieldGroups = new FieldGroupSchemaService(dialect);
  const probes = probeFields();

  for (const field of probes) {
    const described = getColumnDescriptor(field, dialect, "collection");
    if (described) found.add(described.dialectType);

    // What a table built by that rendering REPORTS when introspected, which is the string the
    // detector actually receives. The emitted DDL spelling is not it, and using it here invents
    // pairs that no rename can produce.
    const emitted = collections.mapFieldTypeToSQL(
      field.type,
      undefined,
      field.options,
      field.validation
    );
    if (emitted) found.add(asIntrospected(emitted, dialect));
  }

  for (const type of fieldGroupTypes(fieldGroups, probes, dialect)) {
    found.add(type);
  }

  return [...found];
}

/**
 * The column types the OTHER builder puts in a table a rename can touch.
 *
 * A field group's storage is a `comp_` table built by `FieldGroupSchemaService`, and a rename inside
 * one compares live columns that builder produced. It does not render every type the way the
 * collection builder does — a single relationship reaches `UUID` on PostgreSQL and a date reaches
 * `DATETIME` on MySQL, neither of which the collection builder emits — so a universe built from one
 * builder leaves the pairs only the other can produce unmeasured.
 *
 * Read out of the generated DDL rather than from any table of declared types, because what the
 * builder RENDERS is what reaches the database, and those two have already diverged once.
 *
 * Separate from `reachableTypes` so the test can assert this contributed anything at all. A parse
 * that silently found nothing would leave every assertion below passing while measuring one builder
 * instead of two, which is the failure this addition exists to fix.
 */
function fieldGroupTypes(
  service: FieldGroupSchemaService,
  probes: FieldDefinition[],
  dialect: SupportedDialect
): string[] {
  const columns = parseCreateTable(
    service.generateMigrationSQL(
      "comp_probe",
      probes as unknown as Parameters<
        FieldGroupSchemaService["generateMigrationSQL"]
      >[1],
      {}
    )
  );
  return [...columns.values()].map(c => asIntrospected(c.type, dialect));
}

/**
 * The string introspection returns for a column that was created with `declared`.
 *
 * The live side of every rename comes from `introspect-live.ts`, not from the DDL that built the
 * table, and the two are not the same string. PostgreSQL reports `udt_name`, which is the canonical
 * token with no modifier: a `boolean` column reads back as `bool`, `integer` as `int4`,
 * `double precision` as `float8`. MySQL reports `COLUMN_TYPE`, which is the type as the server
 * stores it: a column declared `boolean` reads back as `tinyint(1)`, because MySQL has no separate
 * boolean type. SQLite reports the declaration as written.
 *
 * 🔴 Modelling the emitted DDL instead of this manufactures disagreements that cannot happen. A
 * checkbox rename on MySQL compares `tinyint(1)` against `tinyint(1)`; it never compares `boolean`
 * against anything, because that spelling exists only in the CREATE statement and never survives a
 * round trip through the database.
 */
function asIntrospected(declared: string, dialect: SupportedDialect): string {
  if (dialect === "sqlite") return declared;
  if (dialect === "mysql") {
    const t = declared.trim();
    // The two declared spellings MySQL does not preserve, both measured against a live server
    // rather than inferred: a column declared `boolean` reads back as `tinyint(1)` because MySQL
    // has no boolean type, and one declared `integer` reads back as `int` because that is the
    // canonical name for the type. Everything else the builders emit — varchar(n), text, json,
    // decimal(p,s), datetime, double — is reported exactly as declared.
    if (/^bool(ean)?$/i.test(t)) return "tinyint(1)";
    if (/^int(eger)?$/i.test(t)) return "int";
    return declared;
  }
  // PostgreSQL: udt_name drops the modifier and names the underlying type, which is exactly what
  // `normalizeType` canonicalises to. Reusing it keeps one definition of that mapping rather than a
  // second copy that can drift from the introspection this models.
  return normalizeType(declared) ?? declared;
}

/**
 * A disagreement that exists today, is known, and is not this file's job to fix.
 *
 * Recorded rather than repaired so the ratchet can go green while the fixes are decided separately,
 * and checked in BOTH directions: an entry describing a disagreement that no longer happens fails
 * too, so resolving one forces its removal here and cannot be done silently.
 *
 * 🔴 Every entry below is a LIVE data-loss path, not a cosmetic mismatch. A rename between these
 * spellings recreates the column empty, for a change the diff itself says is not a change.
 */
const ACCEPTED: Record<string, string> = {
  // Empty, and it is worth saying why rather than leaving the next reader to wonder whether the
  // list was ever populated. It held one entry: `float8` was absent from the PostgreSQL family
  // table, so a float column was incompatible with ITSELF and every rename of one fell to
  // drop_and_add. Adding `float8` and `float4` to that table resolved it, and the assertion below
  // is what forced this entry out with them.
  //
  // The family table also splits MySQL's `boolean` from `tinyint`, which looks like the same class
  // of bug and must not be added here. That spelling never reaches the detector: a column declared
  // `boolean` is reported by MySQL as `tinyint(1)`, so a checkbox rename compares `tinyint(1)` with
  // itself and is already compatible.
};

const keyFor = (dialect: string, from: string, to: string): string =>
  `${dialect}:${from}->${to}`;

describe("the diff and the rename detector agree about what one column is", () => {
  it.each(DIALECTS)(
    "offers a data-preserving rename between spellings the diff calls identical — %s",
    dialect => {
      const types = reachableTypes(dialect);
      // Guards against a vacuous pass: an empty or tiny universe would satisfy the assertion below
      // while comparing nothing.
      expect(types.length, "types reachable on this dialect").toBeGreaterThan(
        3
      );

      // The second builder is IN the universe, not merely asked for. Its columns are read by
      // parsing generated DDL, and a parse that stops matching what the builder emits fails silently
      // — it returns nothing, every pair it would have contributed goes unmeasured, and the ratchet
      // keeps passing while covering half of what it claims. That is how the divergence this file
      // records went unnoticed in the first place.
      expect(
        fieldGroupTypes(
          new FieldGroupSchemaService(dialect),
          probeFields(),
          dialect
        ).length,
        "columns read from the field-group builder's DDL"
      ).toBeGreaterThan(3);

      const disagreements: string[] = [];
      for (const from of types) {
        for (const to of types) {
          const sameColumn =
            normalizeType(from) !== undefined &&
            normalizeType(from) === normalizeType(to);
          if (!sameColumn) continue;
          if (isTypesCompatible(from, to, dialect)) continue;
          if (ACCEPTED[keyFor(dialect, from, to)]) continue;
          disagreements.push(
            `${from} -> ${to}: the diff reads one column (${normalizeType(from)}), ` +
              `the detector offers drop_and_add`
          );
        }
      }

      expect(
        disagreements,
        "a rename between these spellings recreates the column empty, for a change the diff says is not a change"
      ).toEqual([]);
    }
  );

  // The other direction of the ratchet. Without it, a fixed divergence leaves its entry behind and
  // the list slowly stops describing the code — which is how a record of known problems becomes a
  // record of problems someone once had.
  it("keeps no accepted entry for a disagreement that no longer happens", () => {
    const live = new Set<string>();
    for (const dialect of DIALECTS) {
      const types = reachableTypes(dialect);
      for (const from of types) {
        for (const to of types) {
          const same =
            normalizeType(from) !== undefined &&
            normalizeType(from) === normalizeType(to);
          if (same && !isTypesCompatible(from, to, dialect)) {
            live.add(keyFor(dialect, from, to));
          }
        }
      }
    }

    expect(
      Object.keys(ACCEPTED).filter(k => !live.has(k)),
      "this disagreement was resolved; delete its entry so the list keeps meaning what it says"
    ).toEqual([]);
  });
});
