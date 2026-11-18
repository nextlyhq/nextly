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
  // A field's type change gives these besides (`type-change/judge`).
  "not-a-number": "values that are not a number would be cleared",
  "not-a-date":
    "values that are not an ISO 8601 date or date-time would be cleared",
  "not-an-email": "values the email field's rule refuses would be cleared",
  "not-an-option":
    "values that are not one of the field's options would be cleared",
  "not-a-boolean": "values other than true, false, 1 or 0 would be cleared",
  "non-finite":
    "NaN or infinite numbers the new field cannot hold would be cleared",
  object:
    "JSON objects, which only rich text or text can take, would be cleared",
  "kind-never-held":
    "JSON values of a kind the new type could never hold would be cleared",
  "column-refuses": "values the new column refuses outright would be cleared",
  "field-refuses":
    "values the new field's own validation refuses would be cleared",
  rounded: "values the new type holds only rounded",
  "out-of-range": "values outside the range the new type holds",
  "no-time-or-offset": "date texts that name no time or no offset from UTC",
  "several-items": "lists of several items, which one value cannot keep",
  "item-not-held":
    "lists holding an item the new list cannot hold, and a list is never cut",
  "pair-blocked": "no value of the old type could ever be held by the new one",
  repeated:
    "values that become one value of the new type, which a unique field holds once",
  "new-form": "values stored in the new type's form, nothing of them lost",
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
  | "not-json"
  | "kept-unreadable"
  // A type change's values cleared with consent, and one stored in its new form, block nothing.
  | "not-a-number"
  | "not-a-date"
  | "not-an-email"
  | "not-an-option"
  | "not-a-boolean"
  | "non-finite"
  | "object"
  | "kind-never-held"
  | "column-refuses"
  | "field-refuses"
  | "new-form"
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
  rounded: "change the named values so the new type holds each exactly",
  "out-of-range": "change the named values to ones within the new type's range",
  "no-time-or-offset": "give the named dates a time and an offset from UTC",
  "several-items": "leave one item in each named list",
  "item-not-held":
    "correct or remove, in the named rows, the items the new list cannot hold",
  "pair-blocked": null,
  repeated:
    "make the named values distinct, or turn off Unique, before the change",
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
