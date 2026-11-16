// A difference's class, from both things that decide it: what its rows give, and what its
// conversion cannot keep.
//
// Kept apart from the modules that read the database, so the report can ask it without loading
// them.
//
// @module domains/schema/repair-columns/difference-class

import type {
  ConversionClass,
  ConversionJudgement,
} from "../value-conversion/types";

import type { ColumnConversionPlan } from "./conversion/types";

/**
 * The class its rows give, made blocked by anything the new type cannot keep: a conversion never
 * drops or changes a default, index, key, check, trigger or view silently.
 */
export function differenceClass(
  judgement: ConversionJudgement,
  conversion: ColumnConversionPlan | null
): ConversionClass {
  return conversion !== null && conversion.cannotCarry.length > 0
    ? "blocked"
    : judgement.class;
}
