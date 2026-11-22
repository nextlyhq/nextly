/**
 * The reasons a field's type change gives, beside a repair's: each with its one class, whether it
 * blocks, and its words. A repair's own reasons keep their class and their words exactly, so a path
 * that judged a column before reads it the same now.
 */
import { describe, expect, it } from "vitest";

import { describeReason, isBlockingKind, ownerCanFor } from "../describe";
import { reasonClass } from "../judge-column";
import type { ConversionClass, ConversionReasonKind } from "../types";

/**
 * Each reason a type change gives that a repair does not, keyed by every such kind: a kind added to
 * `ConversionReasonKind` without a case here fails the type check.
 */
const TYPE_CHANGE: Record<
  Exclude<ConversionReasonKind, RepairKind>,
  [ConversionClass, string]
> = {
  "not-a-number": ["lossy", "values that are not a number would be cleared"],
  "not-a-date": [
    "lossy",
    "values that are not an ISO 8601 date or date-time would be cleared",
  ],
  "not-an-email": [
    "lossy",
    "values the email field's rule refuses would be cleared",
  ],
  "not-an-option": [
    "lossy",
    "values that are not one of the field's options would be cleared",
  ],
  "not-a-boolean": [
    "lossy",
    "values other than true, false, 1 or 0 would be cleared",
  ],
  "non-finite": [
    "lossy",
    "NaN or infinite numbers the new field cannot hold would be cleared",
  ],
  object: [
    "lossy",
    "JSON objects, which only rich text or text can take, would be cleared",
  ],
  "kind-never-held": [
    "lossy",
    "JSON values of a kind the new type could never hold would be cleared",
  ],
  "column-refuses": [
    "lossy",
    "values the new column refuses outright would be cleared",
  ],
  "field-refuses": [
    "lossy",
    "values the new field's own validation refuses would be cleared",
  ],
  rounded: ["blocked", "values the new type holds only rounded"],
  "out-of-range": ["blocked", "values outside the range the new type holds"],
  "no-time-or-offset": [
    "blocked",
    "date texts that name no time or no offset from UTC",
  ],
  "several-items": [
    "blocked",
    "lists of several items, which one value cannot keep",
  ],
  "item-not-held": [
    "blocked",
    "lists holding an item the new list cannot hold, and a list is never cut",
  ],
  "pair-blocked": [
    "blocked",
    "no value of the old type could ever be held by the new one",
  ],
  "link-not-carried": [
    "blocked",
    "links the new relationship would not read as the entries they point at, which no save converts",
  ],
  repeated: [
    "blocked",
    "values that become one value of the new type, which a unique field holds once",
  ],
  "needs-rewrite": [
    "blocked",
    "values the new type reads only once they are rewritten into its form, which a save does not do yet",
  ],
  "new-form": [
    "safe",
    "values stored in the new type's form, nothing of them lost",
  ],
};

/** A repair's reasons, as they read before a type change gave any of its own. */
type RepairKind =
  | "not-json"
  | "kept-unreadable"
  | "too-long"
  | "stored-differently"
  | "null-under-not-null"
  | "unreadable-reference-list"
  | "no-conversion"
  | "late-write"
  | "cleared-under-not-null";

const REPAIR: Record<RepairKind, [ConversionClass, string, string | null]> = {
  "not-json": [
    "lossy",
    "values that do not parse as JSON would be cleared",
    null,
  ],
  "kept-unreadable": [
    "lossy",
    "values the new type would keep in a form the field cannot read would be cleared",
    null,
  ],
  "too-long": [
    "blocked",
    "values longer than the new type holds would be cut",
    "shorten the named values so each fits the new type, then run again",
  ],
  "stored-differently": [
    "blocked",
    "values the database would accept and store as a different value",
    "convert the column by hand, in a manual migration (nextly migrate:create --blank)",
  ],
  "null-under-not-null": [
    "blocked",
    "rows hold a null where the column is to be NOT NULL",
    "give the named rows a value, or make the field optional, then run again",
  ],
  "unreadable-reference-list": [
    "blocked",
    "values cannot be read as a list of references",
    "correct the named values to a list of references, then run again",
  ],
  "no-conversion": [
    "blocked",
    "Nextly has no conversion from this type to that one",
    "convert the column by hand, in a manual migration (nextly migrate:create --blank)",
  ],
  "late-write": [
    "blocked",
    "MySQL checks the rows and changes the column in separate transactions, so a value written meanwhile could be changed with no error",
    "convert the column by hand, in a manual migration (nextly migrate:create --blank)",
  ],
  "cleared-under-not-null": [
    "blocked",
    "values that would be cleared, where the column does not allow a null, so a value would have to be invented",
    "give the named rows a value the new type holds, or make the field optional, then run again",
  ],
};

describe("a type change's reasons", () => {
  for (const [kind, [cls, words]] of Object.entries(TYPE_CHANGE) as [
    ConversionReasonKind,
    [ConversionClass, string],
  ][]) {
    it(`${kind}: ${cls}, said as "${words}"`, () => {
      expect(reasonClass(kind)).toBe(cls);
      expect(isBlockingKind(kind)).toBe(cls === "blocked");
      expect(describeReason({ kind })).toBe(words);
    });
  }

  it("names what the owner can change for each one that blocks", () => {
    expect(ownerCanFor("rounded", "save again")).toBe(
      "change the named values so the new type holds each exactly, then save again"
    );
    expect(ownerCanFor("pair-blocked", "save again")).toBe(
      "convert the column by hand, in a manual migration (nextly migrate:create --blank)"
    );
  });
});

describe("a repair's reasons, unchanged", () => {
  for (const [kind, [cls, words, ownerCan]] of Object.entries(REPAIR) as [
    ConversionReasonKind,
    [ConversionClass, string, string | null],
  ][]) {
    it(`${kind} keeps its class and its words`, () => {
      expect(reasonClass(kind)).toBe(cls);
      expect(describeReason({ kind })).toBe(words);
      expect(isBlockingKind(kind)).toBe(cls === "blocked");
      if (ownerCan !== null && isBlockingKind(kind)) {
        expect(ownerCanFor(kind, "run again")).toBe(ownerCan);
      }
    });
  }
});
