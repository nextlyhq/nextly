/**
 * Whether a value's stored form is already what the new type reads, so a save's own conversion
 * (the database's cast, or the reference-list conversion every road runs) reaches that reading with
 * nothing rewritten. No save rewrites values yet, so a value whose stored form is not its reading
 * blocks the change (`needs-rewrite`), whether the rules keep it or change it: a text "foo" kept
 * as a JSON string is stored unquoted, and PostgreSQL's cast refuses it.
 *
 * @module domains/schema/value-conversion/type-change/stored-as-read
 */
import { canonicalJson } from "../../../../shared/lib/canonical-json";
import { EMPTY_REFERENCE_TEXTS } from "../../pipeline/reference-list-conversion";
import { exactNumber } from "../value-readings";

import type { FieldTypeOnDialect } from "./field-type";
import type { ValueOutcome } from "./judge";

/** How a type change's stored values are compared with their readings. */
export interface StoredAsRead {
  /** Whether a value kept or changed is stored as the new type reads it. */
  value(stored: string | null, readsAs: string, outcome: ValueOutcome): boolean;
  /**
   * Whether a stored empty list (`[]`) is an empty value of the new type as it stands: only where
   * the new type keeps a list. Into a scalar, the column would hold the text `[]`.
   */
  emptyListHeld: boolean;
  /**
   * What the save's conversion writes for a value stored blank, where it writes one: one link
   * becoming a list writes a blank link as the empty list `[]`, which the new field then judges.
   */
  blankAs?: string;
  /**
   * The stored texts, trimmed, that the save's conversion writes as no value, so each is the new
   * type's empty as it stands: a list of links becoming one link, and a switch to or from naming
   * several collections, both clear each of `EMPTY_REFERENCE_TEXTS` to no value.
   */
  writtenAsNone?: readonly string[];
}

const NONE: StoredAsRead = { value: () => false, emptyListHeld: false };

/** How `from`'s stored values compare with what `to` reads, by what `to` keeps. */
export function storedAsRead(
  from: FieldTypeOnDialect,
  to: FieldTypeOnDialect
): StoredAsRead {
  // A switch to or from naming several collections, asked first: one link becoming a list that
  // names them is this switch, not the list conversion. No conversion carries a link across it, so
  // a held link blocks it, and its guard clears each stored empty to no value.
  if (switchesNamingCollections(from, to)) {
    return {
      value: () => false,
      emptyListHeld: false,
      writtenAsNone: EMPTY_REFERENCE_TEXTS,
    };
  }
  // One link becoming a list of links: every road's reference-list conversion writes the list.
  if (from.relation?.kept === "one" && keepsLinkList(to)) {
    return { value: () => true, emptyListHeld: true, blankAs: "[]" };
  }
  // A list of links becoming one link: every road's many-to-one conversion (`referenceScalar`)
  // writes a one-link list as its link and each stored empty as no link. A list of several is
  // blocked before this is asked (`judgeRelation`); a required field over an empty is refused by
  // the switch's own count (`refuseSeveralReferencesForOne`) before anything runs.
  if (from.relation?.kept === "list" && to.relation?.kept === "one") {
    return {
      value: () => true,
      emptyListHeld: false,
      writtenAsNone: EMPTY_REFERENCE_TEXTS,
    };
  }
  if (keepsJson(to)) {
    return {
      value: (stored, readsAs) => stored !== null && sameJson(stored, readsAs),
      emptyListHeld: true,
    };
  }
  if (to.family === "number")
    return { value: numberStored, emptyListHeld: false };
  if (keepsText(to)) {
    return {
      value: (stored, readsAs) => stored === readsAs,
      emptyListHeld: false,
    };
  }
  return NONE;
}

/**
 * A number's stored text as the new number column reads it: a text changed into a number only where
 * it is the number's canonical writing ("5", not "01"), which every database's cast reads alike; a
 * number kept from another number column where it is the same number, which a cast between number
 * columns keeps.
 */
function numberStored(
  stored: string | null,
  readsAs: string,
  outcome: ValueOutcome
): boolean {
  if (stored === null) return false;
  if (outcome === "changed") return stored.trim() === readsAs;
  const exact = exactNumber(stored);
  return exact !== null && exact === exactNumber(readsAs);
}

/**
 * Whether a relationship's change moves between links to one collection and references naming
 * theirs, which every road plans as `requireEmpty` (`conversionBetweenShapes`). A join table is
 * neither: its links are not on the row.
 */
function switchesNamingCollections(
  from: FieldTypeOnDialect,
  to: FieldTypeOnDialect
): boolean {
  const a = from.relation?.kept;
  const b = to.relation?.kept;
  if (a === undefined || b === undefined || a === b) return false;
  if (a === "join" || b === "join") return false;
  const names = (kept: string) => kept === "targets" || kept === "targetList";
  return names(a) || names(b);
}

function keepsLinkList(to: FieldTypeOnDialect): boolean {
  const kept = to.relation?.kept;
  return kept === "list" || kept === "targetList";
}

/** A type whose column keeps a JSON writing: a list, JSON, rich text, or links kept as JSON. */
function keepsJson(to: FieldTypeOnDialect): boolean {
  return (
    to.item !== undefined ||
    to.family === "list" ||
    to.family === "json" ||
    to.family === "richText" ||
    keepsLinkList(to) ||
    to.relation?.kept === "targets"
  );
}

/** A type whose column keeps its value's text as it is: text, an email, an option, one link. */
function keepsText(to: FieldTypeOnDialect): boolean {
  return (
    to.family === "text" ||
    to.family === "email" ||
    to.family === "choice" ||
    to.relation?.kept === "one"
  );
}

/** Whether two JSON writings are one value, whatever their spacing or key order. */
function sameJson(stored: string, readsAs: string): boolean {
  try {
    return (
      canonicalJson(JSON.parse(stored) as unknown) ===
      canonicalJson(JSON.parse(readsAs) as unknown)
    );
  } catch {
    return false;
  }
}
