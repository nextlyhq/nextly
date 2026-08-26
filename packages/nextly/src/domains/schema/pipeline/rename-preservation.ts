/**
 * Whether renaming a column between two types leaves the stored values intact.
 *
 * A SECOND question about the same pair that `isTypesCompatible` already
 * answers, and the reason it is asked separately: family membership decides
 * whether a drop/add pair can be READ as a rename, which is not the same as
 * whether the rename PRESERVES what is stored. One flag answering both is how
 * `numeric(10,2) -> float8` came to be offered as "data preserved" — the two
 * share the `decimal` family because `float4`/`float8` had to be listed there
 * for a float column to be compatible with itself, and compatibility was then
 * read as preservation.
 *
 * SCOPE, stated because a green answer is trusted as far as the reader thinks
 * it reaches: this knows about NUMERIC exactness. Every other compatible pair
 * answers `preserved`, which is what they answered before this existed — the
 * point here is to stop the numeric cases lying, not to audit every conversion
 * at once. A pair that changes values in some other way is a gap, not a claim.
 *
 * @module domains/schema/pipeline/rename-preservation
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { conversionForRename } from "./rename-conversion";
import { leadingToken } from "./rename-detector-type-families";

/**
 * Types that store an exact decimal: every digit written is a digit stored.
 */
const EXACT_DECIMAL = new Set(["decimal", "numeric"]);

/**
 * Types that store the nearest representable binary value instead of the
 * value itself. `float4`/`float8` are what PostgreSQL introspection returns
 * for `real` and `double precision`, so both spellings appear.
 */
const BINARY_FLOAT = new Set([
  "real",
  "float4",
  "double precision",
  "float8",
  "double",
  "float",
]);

/** The narrower of the binary floats, by the same two spellings. */
const SINGLE_PRECISION = new Set(["real", "float4"]);

export interface RenamePreservation {
  /** Whether every stored value survives the conversion unchanged. */
  preserved: boolean;
  /**
   * What happens to the values, when something does. Written for an author
   * deciding whether to go ahead, so it names the effect rather than the
   * types.
   */
  reason?: string;
}

const PRESERVED: RenamePreservation = { preserved: true };

/**
 * The precision and scale a decimal declaration carries, when it carries them.
 *
 * `numeric(10,2)` -> `{ precision: 10, scale: 2 }`; a bare `numeric` -> null,
 * which is the unconstrained form and cannot be narrowed by anything.
 */
function decimalModifiers(
  rawType: string
): { precision: number; scale: number } | null {
  const match = /\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)/.exec(rawType);
  if (!match) return null;
  return { precision: Number(match[1]), scale: Number(match[2] ?? 0) };
}

/**
 * Whether the second declaration can hold everything the first could.
 *
 * Both the integer part and the fractional part have to survive: widening the
 * scale while shrinking the precision moves the decimal point and drops
 * leading digits, which a comparison on either number alone calls safe.
 */
function decimalWidens(
  from: { precision: number; scale: number },
  to: { precision: number; scale: number }
): boolean {
  return (
    to.scale >= from.scale &&
    to.precision - to.scale >= from.precision - from.scale
  );
}

/**
 * Whether renaming between these types emits a statement that rewrites rows.
 *
 * Asked of `conversionForRename` rather than by testing the dialect here: it
 * emits nothing at all on SQLite, and two places deciding which renames
 * convert anything is two places that can disagree.
 */
function emitsTypeConversion(
  fromType: string,
  toType: string,
  dialect: SupportedDialect
): boolean {
  return conversionForRename(
    {
      type: "rename_column",
      tableName: "",
      fromColumn: "",
      toColumn: "",
      fromType,
      toType,
    },
    dialect
  ).some(op => op.type === "change_column_type");
}

/**
 * The answer when both sides reduce to the same type token.
 *
 * `numeric(10,2) -> numeric(5,1)` reads as one type by name and is a real
 * conversion: the fraction is rounded, and a value too large for the new
 * precision fails outright.
 */
function sameTokenPreservation(
  token: string,
  fromType: string,
  toType: string
): RenamePreservation {
  if (!EXACT_DECIMAL.has(token)) return PRESERVED;

  const from = decimalModifiers(fromType);
  const to = decimalModifiers(toType);
  if (!from || !to || decimalWidens(from, to)) return PRESERVED;

  return {
    preserved: false,
    reason:
      "the new precision is narrower, so values are rounded and one too large for it fails the conversion",
  };
}

/** The answer when the two sides are different type tokens. */
function crossTokenPreservation(from: string, to: string): RenamePreservation {
  if (EXACT_DECIMAL.has(from) && BINARY_FLOAT.has(to)) {
    return {
      preserved: false,
      reason:
        "exact decimals become the nearest binary float, so stored digits are lost",
    };
  }

  if (BINARY_FLOAT.has(from) && EXACT_DECIMAL.has(to)) {
    return {
      preserved: false,
      reason:
        "binary floats are rounded to the new scale, and a value too large for its precision fails the conversion",
    };
  }

  // Widening between floats keeps every value; narrowing does not.
  if (BINARY_FLOAT.has(from) && BINARY_FLOAT.has(to)) {
    return SINGLE_PRECISION.has(to) && !SINGLE_PRECISION.has(from)
      ? {
          preserved: false,
          reason: "double precision values are narrowed to single precision",
        }
      : PRESERVED;
  }

  return PRESERVED;
}

/**
 * Whether a rename between these two types leaves the stored values alone.
 *
 * `dialect` because the answer is a property of the CONVERSION rather than of
 * the type names: a rename that emits no conversion cannot rewrite a row,
 * whatever the two types are called.
 */
export function renamePreservation(
  fromType: string,
  toType: string,
  dialect: SupportedDialect
): RenamePreservation {
  if (!emitsTypeConversion(fromType, toType, dialect)) return PRESERVED;

  const from = leadingToken(fromType);
  const to = leadingToken(toType);
  if (!from || !to) return PRESERVED;

  return from === to
    ? sameTokenPreservation(from, fromType, toType)
    : crossTokenPreservation(from, to);
}
