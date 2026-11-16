// The words one judgement of a column's conversion is said in.
//
// Every path that judges a conversion by `judge-column` describes it with these: a repair's report,
// and the conversion `db:sync` and the development push offer. So an owner reads the same class,
// the same reason and the same rows for one column whichever path names it. Rows are named by their
// key, never by their value, so a log holds no content.
//
// @module domains/schema/value-conversion/describe

import type {
  AffectedRows,
  ConversionClass,
  ConversionReasonKind,
  RowKey,
} from "./types";

/** What each reason means for the column's values. */
const REASON_TEXT: Record<ConversionReasonKind, string> = {
  "not-json": "values that do not parse as JSON would be cleared",
  "kept-unreadable":
    "values the new type would keep in a form the field cannot read would be cleared",
  "too-long": "values longer than the new type holds would be cut",
  "stored-differently":
    "values the database would accept and store as a different value",
  "null-under-not-null": "rows hold a null where the column is to be NOT NULL",
  "unreadable-reference-list": "values cannot be read as a list of references",
  "no-conversion": "Nextly has no conversion from this type to that one",
  "late-write":
    "MySQL checks the rows and changes the column in separate transactions, so a value written meanwhile could be changed with no error",
  "cleared-under-not-null":
    "values that would be cleared, where the column does not allow a null, so a value would have to be invented",
};

/** A row as every report and question names it: by its key, never by its value. */
export function describeKey(key: RowKey): string {
  return "id" in key
    ? `id ${key.id}`
    : `parent ${key.parent} locale ${key.locale}`;
}

/** "1 row" or "N rows". */
export function describeRowCount(count: number): string {
  return count === 1 ? "1 row" : `${String(count)} rows`;
}

/** One reason, as a judgement or a record holds it: its rows absent for a reason of the types. */
export interface DescribedReason {
  kind: ConversionReasonKind;
  rows?: (Pick<AffectedRows, "count"> & { first: readonly RowKey[] }) | null;
}

/** One reason with the rows that give it, by key and never by value. */
export function describeReason(reason: DescribedReason): string {
  const text = REASON_TEXT[reason.kind];
  if (reason.rows === null || reason.rows === undefined) return text;
  const { first, count } = reason.rows;
  const keys = first.map(describeKey).join(", ");
  const shown = first.length < count ? `, first ${String(first.length)}` : "";
  return `${text} (${describeRowCount(count)}${shown}: ${keys})`;
}

/** A judgement's class and every reason behind it: "lossy: <reason> (<rows>); <reason>". */
export function describeClassed(judgement: {
  class: ConversionClass;
  reasons: readonly DescribedReason[];
}): string {
  return judgement.reasons.length === 0
    ? judgement.class
    : `${judgement.class}: ${judgement.reasons.map(describeReason).join("; ")}`;
}

/** The reasons that block a column; the rest clear values, which a consent can allow. */
export type BlockingReasonKind = Exclude<
  ConversionReasonKind,
  "not-json" | "kept-unreadable"
>;

/** What the owner can do where no conversion Nextly runs keeps the values. */
export const OWNER_CAN_CONVERT_BY_HAND =
  "convert the column by hand, in a manual migration (nextly migrate:create --blank)";

/**
 * What the owner can change for each reason that blocks a column, before the step that tries the
 * conversion again; null for a reason only a conversion by hand gets past.
 */
const REASON_OWNER_CAN: Record<BlockingReasonKind, string | null> = {
  "too-long": "shorten the named values so each fits the new type",
  "null-under-not-null":
    "give the named rows a value, or make the field optional",
  "unreadable-reference-list":
    "correct the named values to a list of references",
  "stored-differently": null,
  "no-conversion": null,
  "late-write": null,
  "cleared-under-not-null":
    "give the named rows a value the new type holds, or make the field optional",
};

/** Whether `kind` blocks a column, whatever a consent names. */
export function isBlockingKind(
  kind: ConversionReasonKind
): kind is BlockingReasonKind {
  return Object.hasOwn(REASON_OWNER_CAN, kind);
}

/**
 * What the owner can change for one blocking reason, ending with `nextStep`, the step of the path
 * that names it ("run the repair again", "run db:sync again").
 */
export function ownerCanFor(
  kind: BlockingReasonKind,
  nextStep: string
): string {
  const change = REASON_OWNER_CAN[kind];
  return change === null
    ? OWNER_CAN_CONVERT_BY_HAND
    : `${change}, then ${nextStep}`;
}
