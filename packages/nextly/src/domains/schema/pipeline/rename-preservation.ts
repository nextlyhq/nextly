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
 * Whether a rename between these two types leaves the stored values alone.
 *
 * Answered from the type tokens only — precision and scale are deliberately
 * not read. `numeric(10,2) -> float8` loses exactness at every scale, and a
 * conversion that depends on the DATA (whether any row exceeds the target's
 * precision) is a question for a probe against the rows, not for a table of
 * type names. Saying "preserved" here on the strength of a scale that happens
 * to fit would be the same overreach this module exists to remove.
 */
export function renamePreservation(
  fromType: string,
  toType: string
): RenamePreservation {
  const from = leadingToken(fromType);
  const to = leadingToken(toType);
  if (!from || !to || from === to) return PRESERVED;

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

  if (BINARY_FLOAT.has(from) && BINARY_FLOAT.has(to)) {
    // Widening keeps every value; narrowing does not.
    return SINGLE_PRECISION.has(to) && !SINGLE_PRECISION.has(from)
      ? {
          preserved: false,
          reason: "double precision values are narrowed to single precision",
        }
      : PRESERVED;
  }

  return PRESERVED;
}
