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
  chips: [{ type: "chips" }],
};

/**
 * Every column type the product can put in a table, for one dialect.
 *
 * Both sides are collected because a rename pairs them: the LIVE column carries whatever the builder
 * once emitted, and the DESIRED column is what the descriptor asks for now. A comparison over only
 * one side would miss precisely the pairs a legacy table produces.
 */
function reachableTypes(dialect: SupportedDialect): string[] {
  const found = new Set<string>();
  const service = new DynamicCollectionSchemaService(undefined, dialect);

  for (const [type, shapes] of Object.entries(SHAPES) as Array<
    [DynamicFieldType, Array<Record<string, unknown>>]
  >) {
    for (const shape of shapes) {
      const field = {
        name: `probe_${type.toLowerCase()}`,
        ...shape,
      } as unknown as FieldDefinition;

      const described = getColumnDescriptor(field, dialect, "collection");
      if (described) found.add(described.dialectType);

      // The builder's own rendering, which is what an existing table actually holds.
      const emitted = service.mapFieldTypeToSQL(
        field.type,
        undefined,
        field.options,
        field.validation
      );
      if (emitted) found.add(emitted);
    }
  }
  return [...found];
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
  // MySQL spells a boolean `tinyint(1)`. `normalizeType` knows this and collapses the two; the
  // family table puts `tinyint` in the INTEGER family and `boolean` in the BOOLEAN family, so they
  // never match. Consequence: renaming ANY checkbox field on MySQL drops the column.
  "mysql:tinyint(1)->boolean":
    "MySQL boolean synonym unknown to the family table",
  "mysql:boolean->tinyint(1)":
    "MySQL boolean synonym unknown to the family table",
  // 🔴 `float8` is absent from the PostgreSQL family table entirely, so it is incompatible with
  // ITSELF: `typeFamilyOf` answers null and every pair involving it falls to drop_and_add. `real`
  // (float4) and `numeric` are both present, which is why this went unnoticed. Consequence:
  // renaming a float number field on PostgreSQL drops the column.
  "postgresql:float8->float8":
    "float8 missing from the PostgreSQL family table",
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
