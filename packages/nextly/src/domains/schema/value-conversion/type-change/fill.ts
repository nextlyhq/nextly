/**
 * The value a person chose for the rows a required field's type change would leave with none: its
 * fill. Written into each of them in place of the value that cannot convert, or of no value, so it
 * is held to the new type by the rules a stored value is (`judgeValue`), and to the new field's own
 * validation, before anything is written.
 *
 * @module domains/schema/value-conversion/type-change/fill
 */
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { readsAsPostgresJson } from "../value-readings";

import type { FieldTypeOnDialect } from "./field-type";
import { judgeValue } from "./judge";
import { fieldAccepts, readsAsItsOwnJson } from "./judge-stored";

/** A fill as it was chosen, and as the new type reads it. */
export interface ChosenFill {
  /** The value as it was sent, which a migration file carries. */
  value: unknown;
  /** The value as the new type reads it; absent where the field cannot take it as its fill. */
  readsAs?: string;
}

/**
 * The fill chosen for the field `to`, by its name in `fills`, held to its new type; undefined where
 * none was. A field that is not required takes none: the values of its that cannot convert are
 * cleared, as the review says, and a fill beside that would be one nobody sees written.
 */
export async function chosenFill(
  to: FieldDefinition,
  toType: FieldTypeOnDialect,
  fills: ReadonlyMap<string, unknown> | undefined
): Promise<ChosenFill | undefined> {
  const value = fills?.get(to.name);
  if (value === undefined) return undefined;
  const readsAs =
    to.required === true ? await fillReading(to, toType, value) : undefined;
  return { value, ...(readsAs === undefined ? {} : { readsAs }) };
}

/**
 * A fill as the new type reads it, or undefined where the new field does not take it as it stands:
 * a value the type would rewrite (the text `12` for a number) is no fill, so what is written is
 * what was chosen. Only a date has no JSON form of its own, and is its ISO writing.
 */
async function fillReading(
  to: FieldDefinition,
  toType: FieldTypeOnDialect,
  value: unknown
): Promise<string | undefined> {
  const { outcome, readsAs } = judgeValue(
    { dialect: toType.dialect, type: "json", family: "json" },
    toType,
    { kind: "json", value }
  );
  const asChosen =
    outcome === "kept" || (outcome === "changed" && toType.family === "date");
  if (!asChosen || readsAs === undefined) return undefined;
  if (!readsBackAsChosen(toType, readsAs)) return undefined;
  return (await fieldAccepts(toType, to)(readsAs)) ? readsAs : undefined;
}

/**
 * Whether the column takes a fill's writing and gives it back: a stored JSON value is one the database
 * already took, where a chosen one is asked (`readsAsPostgresJson`), and a text that is itself JSON
 * would be read as what it says (`readsAsItsOwnJson`).
 */
function readsBackAsChosen(
  toType: FieldTypeOnDialect,
  readsAs: string
): boolean {
  if (readsAsItsOwnJson(toType, readsAs)) return false;
  return (
    toType.family !== "json" ||
    toType.dialect !== "postgresql" ||
    readsAsPostgresJson(readsAs)
  );
}
