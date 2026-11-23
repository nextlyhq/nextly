/**
 * The types a saved field may be changed to in the Schema Builder, as its type picker lists them:
 * each candidate blocked whatever the field's values hold, and why, or marked by what the change can
 * do to them (keeps every value, converts some, may lose some). Read from the conversion rules
 * themselves (`pairBlocked`, `pairOutcome`), never restated here, so the picker and the save that
 * judges the stored values answer from one set of rules.
 *
 * @module dispatcher/helpers/type-change-targets
 */
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import type {
  ColumnOrigin,
  SupportedDialect,
} from "../../domains/schema/services/field-column-descriptor";
import { fieldTypeOnDialect } from "../../domains/schema/value-conversion/type-change/field-type";
import {
  pairBlocked,
  type PairBlockReason,
} from "../../domains/schema/value-conversion/type-change/judge";
import {
  pairOutcome,
  type PairOutcome,
} from "../../domains/schema/value-conversion/type-change/pair-outcome";

/** One type a saved field could be changed to, as the picker shows it. */
export interface TypeChangeTarget {
  type: string;
  /** Why the change is refused whatever the field's values hold; null where it is not. */
  blocked: PairBlockReason | null;
  /** What the change can do to the field's values; null where it is blocked. */
  outcome: PairOutcome | null;
}

/**
 * Each of `candidates` other than the field's own type, judged as a change from `field`, a field
 * as its entity stores it, on the database this runs on. `builtBy` and `componentRow` say where its
 * values are kept, as the save that would make the change reads them.
 */
export function typeChangeTargets(args: {
  field: FieldDefinition;
  candidates: readonly string[];
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
  componentRow?: boolean;
}): TypeChangeTarget[] {
  const at = args.componentRow === true ? { componentRow: true } : {};
  const from = fieldTypeOnDialect(args.field, args.dialect, args.builtBy, at);
  return args.candidates
    .filter(type => type !== args.field.type)
    .map(type => {
      const to = fieldTypeOnDialect(
        { ...args.field, type } as FieldDefinition,
        args.dialect,
        args.builtBy,
        at
      );
      const blocked = pairBlocked(from, to);
      return {
        type,
        blocked,
        outcome: blocked === null ? pairOutcome(from, to) : null,
      };
    });
}
