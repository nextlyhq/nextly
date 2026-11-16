// The refusals of a type change the push offers, raised before any statement runs.
//
// A conversion the repair command's rule judges blocked is never run, and one it judges lossy runs
// only under the consent naming its column. Each refusal names the table, the column, the class,
// every reason with the rows that give it, and what the owner can do, in the words a repair's
// report uses (`value-conversion/describe`), never a raw database error.

import { NextlyError } from "../../../../errors";
import type { ColumnConsent } from "../../repair-columns/consent";
import {
  describeClassed,
  isBlockingKind,
  ownerCanFor,
} from "../../value-conversion/describe";
import type { ConversionJudgement } from "../../value-conversion/types";

/** One offered type change and its judgement. */
export interface JudgedConversion {
  tableName: string;
  columnName: string;
  fromType: string;
  toType: string;
  judgement: ConversionJudgement;
}

/** "t.c: from -> to is <class>: <reasons>." */
function describeConversion(conversion: JudgedConversion): string {
  const { tableName, columnName, fromType, toType, judgement } = conversion;
  return `${tableName}.${columnName}: ${fromType} -> ${toType} is ${describeClassed(judgement)}.`;
}

/**
 * The refusal of every blocked conversion an apply offers, each said once with what its owner can
 * change, ending with `nextStep`, the step that tries the conversion again.
 */
export function conversionRefusal(
  blocked: readonly JudgedConversion[],
  nextStep: string
): NextlyError {
  return NextlyError.validation({
    errors: blocked.map(conversion => {
      const ownerCan = [
        ...new Set(
          conversion.judgement.reasons
            .map(reason => reason.kind)
            .filter(isBlockingKind)
            .map(kind => ownerCanFor(kind, nextStep))
        ),
      ];
      return {
        path: `schema.${conversion.tableName}.${conversion.columnName}`,
        code: "CONVERSION_BLOCKED",
        message: `${describeConversion(conversion)} The owner can: ${ownerCan.join("; or ")}.`,
      };
    }),
    logContext: {
      blocked: blocked.map(c => `${c.tableName}.${c.columnName}`),
    },
  });
}

/**
 * The refusal of lossy conversions no consent covers, where no one can be asked: each with why a
 * consent given does not cover it, and the consent naming its column that would.
 */
export function lossyConsentRefusal(
  uncovered: ReadonlyArray<{ conversion: JudgedConversion; consent: ColumnConsent }>
): NextlyError {
  return NextlyError.validation({
    errors: uncovered.map(({ conversion, consent }) => {
      const column = `${conversion.tableName}.${conversion.columnName}`;
      const notice = consent.notice === null ? "" : ` ${consent.notice}.`;
      return {
        path: `schema.${column}`,
        code: "CONVERSION_NEEDS_CONSENT",
        message: `${describeConversion(conversion)}${notice} To convert it, clearing the named values, give the consent naming the column: ${consent.flag} (or NEXTLY_ACCEPT_DATA_LOSS=${column}).`,
      };
    }),
    logContext: {
      uncovered: uncovered.map(
        ({ conversion }) => `${conversion.tableName}.${conversion.columnName}`
      ),
    },
  });
}
