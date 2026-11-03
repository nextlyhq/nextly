// The questions every dialect's plan asks of a conversion request, answered once: how a type is
// spelled, whether the type or the kind of value changes, whether a default's literal fits, and
// what the owner can change for each property. PostgreSQL, MySQL and SQLite read them from here, so
// each is answered the same way on every database.
//
// @module domains/schema/repair-columns/conversion/carry

import { typesDiffer } from "../../pipeline/diff/declared-size";
import {
  parseColumnType,
  type TypeFamily,
} from "../../value-conversion/column-type";
import { valueJudgeFor } from "../../value-conversion/judge-value";
import type {
  CompareAs,
  ConversionReasonKind,
} from "../../value-conversion/types";
import type { ColumnState } from "../types";

import type {
  CannotCarry,
  ColumnConversionPlan,
  ConversionRequest,
} from "./types";

/** What a plan says the new type cannot keep, and what it has no place for. */
export type Carry = Pick<ColumnConversionPlan, "cannotCarry" | "notCarried">;

/**
 * A column type as a statement spells it: the type with the size the database reports beside it
 * (PostgreSQL's `varchar` and `255`), or as it is where the type states its own size.
 */
export function renderedType(state: ColumnState): string {
  return state.typeModifier === undefined || state.type.includes("(")
    ? state.type
    : `${state.type}(${state.typeModifier})`;
}

/** Whether the request changes the column's type, rather than its nullability alone. */
export function typeChanges(request: ConversionRequest): boolean {
  return (
    request.referenceList === true ||
    typesDiffer({ name: "", ...request.from }, { name: "", ...request.to })
  );
}

/**
 * The broad kind of value a type family holds. Within one kind an expression over the column
 * (a check, an index expression) reads the new type as it read the old: `length(c)` reads a
 * `varchar` as it read a `text`, and `c > 0` a double as it read a decimal.
 */
const KIND_OF: Record<TypeFamily, string> = {
  text: "string",
  varchar: "string",
  char: "string",
  json: "json",
  uuid: "uuid",
  int2: "number",
  int4: "number",
  int8: "number",
  float4: "number",
  float8: "number",
  numeric: "number",
  other: "other",
};

/**
 * Whether the type changes into a different kind of value, where an expression over the column is
 * read against the new type and may not parse (`jsonb <> text` has no operator). A type no family
 * names is a kind of its own, so any change to or from one counts.
 */
export function kindChanges(request: ConversionRequest): boolean {
  if (!typeChanges(request)) return false;
  const from = KIND_OF[parseColumnType(request.from).family];
  const to = KIND_OF[parseColumnType(request.to).family];
  return from !== to || from === "other";
}

/** How the new column's field compares a value, from the kind the new type holds. */
function compareAsOf(to: ColumnState): CompareAs {
  const kind = KIND_OF[parseColumnType(to).family];
  if (kind === "json") return "json";
  if (kind === "number") return "number";
  return "exact";
}

/**
 * Why the new type would not hold a default's literal value, or null when it would. Judged as a
 * stored value of the column is judged (`value-conversion/judge-value`), so a default and the rows
 * are held to one rule.
 */
export function defaultLiteralRefusal(
  request: ConversionRequest,
  literal: string
): ConversionReasonKind | null {
  const judge = valueJudgeFor({
    dialect: request.dialect,
    from: request.from,
    to: request.to,
    compareAs: compareAsOf(request.to),
    ...(request.referenceList === true ? { referenceList: true } : {}),
  });
  if (judge === null) return "no-conversion";
  return judge({ key: { id: "" }, text: literal });
}

/** What a default's refusal means, in plain words. */
const REFUSAL_WORDS: Record<ConversionReasonKind, string> = {
  "not-json": "is not JSON",
  "kept-unreadable": "would be kept in a form the field cannot read",
  "too-long": "is longer than the new type holds",
  "stored-differently": "would be stored as a different value",
  "null-under-not-null": "is null where the column is to be NOT NULL",
  "unreadable-reference-list": "cannot be read as a list of references",
  "no-conversion": "has no conversion to the new type",
  "late-write": "could be changed by a write while the conversion runs",
};

/** The entry for a default whose literal the new type refuses. */
export function refusedDefault(
  request: ConversionRequest,
  refusal: ConversionReasonKind
): CannotCarry {
  return {
    property: "default",
    name: request.column,
    reason: `the column's default ${REFUSAL_WORDS[refusal]} as ${renderedType(request.to)}`,
    ownerCan: OWNER_CAN.default,
  };
}

/** What the owner can change for each property, so the column converts. */
export const OWNER_CAN: Record<CannotCarry["property"], string> = {
  default:
    "drop the column's default, or set one the new type holds, then run the repair again",
  index:
    "drop the index, run the repair, then create an index the new type can hold",
  key: "drop the foreign key, run the repair, then add it again between columns of matching types",
  check:
    "drop the check, run the repair, then add it again written for the new type",
  trigger:
    "drop the trigger, run the repair, then create it again for the new type",
  view: "drop the view or rule, run the repair, then create it again",
  definition:
    "convert the column by hand, in a manual migration (nextly migrate:create --blank)",
  "generated column":
    "drop the generated column, run the repair, then add it again computed for the new type",
  policy:
    "drop the policy, run the repair, then create it again written for the new type",
};

/**
 * The checks that read the column, named where the kind of value changes: the database reads each
 * one again against the new type (`jsonb <> ''` has no operator). Within one kind each reads as
 * before. Every dialect holds its checks to this one rule.
 */
export function checkRefusals(
  checks: readonly { name: string }[],
  to: string
): CannotCarry[] {
  return checks.map(check => ({
    property: "check",
    name: check.name,
    reason: `the check reads the column and would be read again against ${to}, a different kind of value`,
    ownerCan: OWNER_CAN.check,
  }));
}

/** An index that reads the column in a key expression or its predicate, under a kind change. */
export function expressionIndexRefusal(name: string, to: string): CannotCarry {
  return {
    property: "index",
    name,
    reason: `the index reads the column in an expression, which would be read again against ${to}`,
    ownerCan: OWNER_CAN.index,
  };
}

/** The foreign keys into or out of the column, whose two ends must keep matching types. */
export function foreignKeyRefusals(
  keys: readonly {
    name: string;
    table: string;
    direction: "into" | "out-of";
  }[]
): CannotCarry[] {
  return keys.map(key => ({
    property: "key",
    name: key.name,
    reason:
      key.direction === "into"
        ? `${key.table} references the column, and both ends of a foreign key must keep matching types`
        : `the column references ${key.table}, and both ends of a foreign key must keep matching types`,
    ownerCan: OWNER_CAN.key,
  }));
}
