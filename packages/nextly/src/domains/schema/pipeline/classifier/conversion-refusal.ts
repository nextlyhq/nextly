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
import type {
  ClassificationResult,
  TypeChangeEvent,
} from "../resolution/types";

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
  uncovered: ReadonlyArray<{
    conversion: JudgedConversion;
    consent: ColumnConsent;
  }>
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

/** A type change an apply goes on to make after judging it: safe, or cleared under consent. */
export type ConvertingColumn = Omit<JudgedConversion, "judgement">;

/**
 * MySQL's errors for a value a statement cannot convert: out of range (1264), cut (1265, 1406),
 * an incorrect value (1292, 1366), and text that is not JSON (3140).
 */
const MYSQL_VALUE_ERRORS = new Set([1264, 1265, 1292, 1366, 1406, 3140]);

/**
 * Whether `err`, or an error it wraps, is the database refusing a value: PostgreSQL's data
 * exceptions (SQLSTATE class 22, e.g. 22P02 for text that is not JSON), or MySQL's above.
 */
function isValueRefusal(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    const { code, errno, cause } = current as {
      code?: unknown;
      errno?: unknown;
      cause?: unknown;
    };
    if (typeof code === "string" && /^22[0-9A-Z]{3}$/.test(code)) return true;
    if (typeof errno === "number" && MYSQL_VALUE_ERRORS.has(errno)) {
      return true;
    }
    current = cause;
  }
  return false;
}

/**
 * The failure of an apply whose statement the database refused over a value, where the apply was
 * converting columns it judged: a value written after the judgement, which no check before the
 * statement could see. Named by its columns and the step that checks them again, rather than as
 * the database's own error. Null for any other failure, which keeps its own report.
 */
export function lateValueFailure(
  err: unknown,
  converting: readonly ConvertingColumn[],
  nextStep: string
): NextlyError | null {
  if (converting.length === 0 || !isValueRefusal(err)) return null;
  return NextlyError.validation({
    errors: converting.map(column => ({
      path: `schema.${column.tableName}.${column.columnName}`,
      code: "CONVERSION_REFUSED_A_LATER_VALUE",
      message: `${column.tableName}.${column.columnName}: ${column.fromType} -> ${column.toType} stopped at a value written after the column was checked, which the new type cannot hold. To see that row, ${nextStep}: the check names it.`,
    })),
    ...(err instanceof Error ? { cause: err } : {}),
    logContext: {
      converting: converting.map(c => `${c.tableName}.${c.columnName}`),
    },
  });
}

/**
 * The type changes an apply goes on to make after judging them: each judged safe, and each judged
 * lossy whose clearing was consented to (`clearing`).
 */
export function convertingColumns(
  classification: ClassificationResult,
  clearing: readonly string[]
): ConvertingColumn[] {
  const cleared = new Set(clearing);
  return [
    ...(classification.safeConversions ?? []),
    ...classification.events.filter(
      (event): event is TypeChangeEvent =>
        event.kind === "type_change" &&
        event.lossy !== undefined &&
        cleared.has(event.id)
    ),
  ].map(({ tableName, columnName, fromType, toType }) => ({
    tableName,
    columnName,
    fromType,
    toType,
  }));
}

/**
 * The messages of a blocked-conversion refusal (`conversionRefusal`), one per column, or null for
 * any other error: what a dry run lists as the refusals a real run would make.
 */
export function blockedConversionMessages(err: unknown): string[] | null {
  if (!NextlyError.isValidation(err)) return null;
  const data: unknown = err.publicData;
  if (!data || typeof data !== "object" || !("errors" in data)) return null;
  const { errors } = data;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const messages: string[] = [];
  for (const entry of errors as unknown[]) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("code" in entry) ||
      entry.code !== "CONVERSION_BLOCKED" ||
      !("message" in entry) ||
      typeof entry.message !== "string"
    ) {
      return null;
    }
    messages.push(entry.message);
  }
  return messages;
}
