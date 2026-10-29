// Why a live column differs from its field's descriptor, where that is known.
//
// Two answers matter to the site owner, and they point in opposite directions. A column a CURRENT
// generator still creates is not legacy at all: repairing it today would see it come back on the
// next table that generator makes, so the report names the generator as the cause. A column only
// an EARLIER generator created is legacy, and the report names the first release that stopped
// creating it, so the owner can tell which of their tables predate it.
//
// The first answer is asked of the generators themselves, through the same methods they create
// columns with, rather than kept as a list of known disagreements beside them: a list agrees with
// the generators on the day it is written and drifts silently after.
//
// @module domains/schema/repair-columns/difference-cause

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../../dynamic-collections/services/dynamic-collection-schema-service";
import { FieldGroupSchemaService } from "../../field-groups/services/field-group-schema-service";
import { declaredSize } from "../pipeline/diff/declared-size";
import { normalizeType } from "../pipeline/diff/normalize-type";
import {
  toSnakeCase,
  usesJunctionTable,
  type SupportedDialect,
} from "../services/field-column-descriptor";

import { compareColumn } from "./column-comparison";
import type {
  ColumnState,
  DifferenceCause,
  LegacyShape,
  RepairColumnOrigin,
  RepairEntityKind,
} from "./types";

/**
 * The first release whose generator no longer creates each legacy shape, as the report names it.
 *
 * A repeater or group became JSON in 0.0.2-alpha.67; a float, a select, a radio and an upload
 * started reading the descriptor in 0.0.2-alpha.66; a component's many-to-many became a JSON list
 * in 0.0.2-alpha.69.
 */
const LEGACY_BEFORE: Record<LegacyShape, string> = {
  "structured-as-text": "0.0.2-alpha.67",
  "float-as-decimal": "0.0.2-alpha.66",
  "mysql-text-fallback": "0.0.2-alpha.66",
  "component-list-in-scalar": "0.0.2-alpha.69",
};

/** Scalar types an older component row held a many-to-many in. */
const SCALAR_REFERENCE_TYPES = new Set(["uuid", "text", "varchar"]);

/** Field types the legacy MySQL map left as `text`, where the descriptor names a varchar. */
const MYSQL_TEXT_FALLBACK_TYPES = new Set([
  "select",
  "radio",
  "upload",
  "text",
]);

export interface DifferenceCauseArgs {
  field: FieldDefinition;
  kind: RepairEntityKind;
  origin: RepairColumnOrigin;
  dialect: SupportedDialect;
  /** The column is in the entity's `_locales` translation table. */
  translation: boolean;
  live: ColumnState;
  expected: ColumnState;
}

/** Why `live` differs from `expected`, or null when no known generator explains it. */
export function differenceCause(
  args: DifferenceCauseArgs
): DifferenceCause | null {
  const generated = currentGeneratorColumn(args);
  if (generated !== null && compareColumn(args.live, generated) === null) {
    return { kind: "current-generator" };
  }
  const shape = legacyShape(args);
  return shape === null
    ? null
    : { kind: "legacy", shape, before: LEGACY_BEFORE[shape] };
}

/**
 * One generator of each kind per dialect, shared by every column of a run.
 *
 * Neither keeps state a call changes: each holds its dialect, and the collection generator a
 * validation service these calls never use, so building two for every differing column would only
 * repeat the same construction.
 */
const collectionGenerators = new Map<
  SupportedDialect,
  DynamicCollectionSchemaService
>();
const fieldGroupGenerators = new Map<
  SupportedDialect,
  FieldGroupSchemaService
>();

/** The generator `cache` holds for `dialect`, made by `make` the first time it is asked for. */
function generatorFor<T>(
  cache: Map<SupportedDialect, T>,
  dialect: SupportedDialect,
  make: () => T
): T {
  let generator = cache.get(dialect);
  if (generator === undefined) {
    generator = make();
    cache.set(dialect, generator);
  }
  return generator;
}

/** The column the Schema Builder's generator creates for a field of a collection or a Single. */
function collectionGeneratorColumn(
  field: FieldDefinition,
  dialect: SupportedDialect
): ColumnState | null {
  const type = generatorFor(
    collectionGenerators,
    dialect,
    () => new DynamicCollectionSchemaService(undefined, dialect)
  )
    .plannedColumnTypes([field])
    .get(toSnakeCase(field.name));
  // The Builder's CREATE writes NOT NULL for every required field, a relationship included.
  return type === undefined
    ? null
    : { type, nullable: field.required !== true };
}

/** The column the field-group generator creates for a field of a field group. */
function fieldGroupGeneratorColumn(
  field: FieldDefinition,
  dialect: SupportedDialect
): ColumnState | null {
  const type = generatorFor(
    fieldGroupGenerators,
    dialect,
    () => new FieldGroupSchemaService(dialect)
  ).columnTypeFor(
    field as unknown as Parameters<FieldGroupSchemaService["columnTypeFor"]>[0]
  );
  // The field-group CREATE writes NOT NULL for a required field, except a many-to-many.
  return type === null
    ? null
    : {
        type,
        nullable: !(field.required === true && !usesJunctionTable(field)),
      };
}

/**
 * The column the user-extension builder adds for a field `user_ext` lacks.
 *
 * Its CREATE TABLE writes NOT NULL for a required field, which is what the descriptor describes, but
 * a field added once the table exists gets `ADD COLUMN` with the type alone, so that column is
 * nullable whatever `required` says. Both are the current builder.
 */
function userFieldsGeneratorColumn(expected: ColumnState): ColumnState {
  return { type: expected.type, nullable: true };
}

/**
 * The column today's generator creates for the field on this entity's table, or null where that
 * generator is the descriptor itself and so cannot disagree with it.
 *
 * The Schema Builder's tables (collections and Singles) and field-group tables have generators of
 * their own, and the user-extension builder adds a column differently from how its CREATE TABLE
 * makes one. Code-first tables and translation tables are built from the descriptor, so a
 * difference there is never one a current generator creates.
 */
function currentGeneratorColumn(args: DifferenceCauseArgs): ColumnState | null {
  if (args.translation) return null;
  switch (args.origin) {
    case "collection":
      return collectionGeneratorColumn(args.field, args.dialect);
    case "fieldGroup":
      return fieldGroupGeneratorColumn(args.field, args.dialect);
    case "userFields":
      return userFieldsGeneratorColumn(args.expected);
    case "codeFirst":
      return null;
  }
}

/** A column as the legacy-shape tests read it: the field's type, and both column types normalised. */
interface ShapeFacts {
  args: DifferenceCauseArgs;
  type: string;
  liveType: string | undefined;
  expectedType: string | undefined;
  expectsJson: boolean;
}

/** A repeater or group held as `text`, where the descriptor names JSON. */
function isStructuredAsText({
  type,
  liveType,
  expectsJson,
}: ShapeFacts): boolean {
  return (
    (type === "repeater" || type === "group") &&
    liveType === "text" &&
    expectsJson
  );
}

/** A float number held as the `decimal(10,2)` the legacy map gave every number. */
function isFloatAsDecimal({ args, type, liveType }: ShapeFacts): boolean {
  return (
    type === "number" &&
    args.field.options?.format === "float" &&
    liveType === "numeric" &&
    declaredSize({ name: "", ...args.live }) === "10,2"
  );
}

/** A MySQL column the legacy type map left as `text`, where the descriptor names a varchar. */
function isMysqlTextFallback({
  args,
  type,
  liveType,
  expectedType,
}: ShapeFacts): boolean {
  return (
    args.dialect === "mysql" &&
    MYSQL_TEXT_FALLBACK_TYPES.has(type) &&
    liveType === "text" &&
    expectedType === "varchar"
  );
}

/** A component's many-to-many held in a scalar column, where the descriptor names a JSON list. */
function isComponentListInScalar({
  args,
  liveType,
  expectsJson,
}: ShapeFacts): boolean {
  return (
    args.kind === "fieldGroup" &&
    usesJunctionTable(args.field) &&
    expectsJson &&
    liveType !== undefined &&
    SCALAR_REFERENCE_TYPES.has(liveType)
  );
}

/**
 * Each legacy shape with the test that recognises it, in the order they are tried. Each test asks
 * for a different field type, so at most one holds and the order changes no answer.
 */
const LEGACY_SHAPE_TESTS: ReadonlyArray<
  readonly [LegacyShape, (facts: ShapeFacts) => boolean]
> = [
  ["structured-as-text", isStructuredAsText],
  ["float-as-decimal", isFloatAsDecimal],
  ["mysql-text-fallback", isMysqlTextFallback],
  ["component-list-in-scalar", isComponentListInScalar],
];

/** The legacy shape the live column holds, or null when it holds none of them. */
function legacyShape(args: DifferenceCauseArgs): LegacyShape | null {
  // Every legacy shape is one an earlier collection or field-group generator created. `user_ext`
  // has only ever been built by the user-extension builder, so none of them can explain its columns.
  if (args.origin === "userFields") return null;
  const liveType = normalizeType(args.live.type);
  const expectedType = normalizeType(args.expected.type);
  const facts: ShapeFacts = {
    args,
    type: String(args.field.type),
    liveType,
    expectedType,
    expectsJson: expectedType === "jsonb" || expectedType === "json",
  };
  for (const [shape, holds] of LEGACY_SHAPE_TESTS) {
    if (holds(facts)) return shape;
  }
  return null;
}
