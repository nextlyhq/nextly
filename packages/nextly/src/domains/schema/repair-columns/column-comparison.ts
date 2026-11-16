// Whether a live column differs from the column its field's descriptor names, and in which way.
//
// A difference is in the column's TYPE or its NULLABILITY and in nothing else. A default, an index,
// a key or a check is never compared: none of them decides whether a stored value is valid or a
// write succeeds, and indexes and keys have their own owner in the schema diff. Comparing them here
// would make this a second schema diff, reporting changes nobody asked this command about.
//
// The type half is `typesDiffer`, the one rule the schema diff uses: two spellings of one type
// (`int4` and `integer`) are the same type, and a size counts only when both sides state one, so a
// `varchar` length or a decimal's precision and scale is compared where the database reports it and
// ignored where it does not. A second copy of that rule here would drift from the diff's, and the
// two would then disagree about whether the same column needs work.
//
// @module domains/schema/repair-columns/column-comparison

import { typesDiffer } from "../pipeline/diff/declared-size";
import type { ColumnSpec } from "../pipeline/diff/types";

/** A column as introspection or a descriptor states it, without its name. */
export type ColumnShape = Omit<ColumnSpec, "name">;

/** Which aspects of a column differ. At least one is true whenever a comparison returns one. */
export interface ColumnAspects {
  type: boolean;
  nullability: boolean;
}

/**
 * How a live column differs from the expected one, or null when it does not.
 *
 * `live` is a column as `introspectLiveColumns` reports it; `expected` is the descriptor's column,
 * its size written inside the type.
 */
export function compareColumn(
  live: ColumnShape,
  expected: ColumnShape
): ColumnAspects | null {
  const type = typesDiffer({ name: "", ...live }, { name: "", ...expected });
  const nullability = live.nullable !== expected.nullable;
  return type || nullability ? { type, nullability } : null;
}
