/**
 * Merging an author's change to one Site Style section onto the section as
 * it is stored now.
 *
 * A Design studio saves a whole section, built from the copy it read (the
 * base). When someone else saved the section since, writing the author's
 * copy as it is would undo their save, so the change is merged three ways:
 * the base, the author's section (mine) and the newest stored one (theirs).
 *
 * ## By entry, then field by field
 *
 * Entries are matched by their identity: a token by `tokenIdentity` (as the
 * Single's own token rules read it), a class by its id, a font face by
 * `faceIdentity`. Inside an entry each value is merged on its own by one
 * rule, {@link mergedValue}: what only one side changed takes that side's
 * value. So two edits to different fields of one class, a padding and a
 * lock, are both kept, and a lock that landed meanwhile holds. A font face is
 * one value whole, its files and descriptors together.
 *
 * ## True conflicts
 *
 * A value both sides changed differently, or an entry one side removed while
 * the other changed it, is a true conflict. It is settled for mine on a
 * forward save and for theirs on an undo or redo, which can no longer take
 * back what has been replaced, and it is reported so the editor can say so.
 *
 * Entries the readers cannot key (no identity, or a second entry under one
 * identity) are kept from theirs exactly as stored, never dropped.
 *
 * Isomorphic and pure: the editor runs it before each section write, and the
 * class rebase onto the site's code runs the same leaf rule.
 *
 * @module site-style-merge
 */
import { isPlainRecord, isTokenRef } from "@nextlyhq/blocks-engine";

import { faceIdentity } from "./site-style";
import { storedVariableIdentity } from "./site-style-storage";
import { readStoredJson, sameStoredValue } from "./stored-json";

/** Whose value a true conflict keeps. */
export type MergeWinner = "mine" | "theirs";

/** The sections a studio saves whole, and so the ones merged. */
export type MergeableSection = "tokens" | "classes" | "fonts";

/**
 * What a true conflict was: both changed the entry differently, they removed
 * what mine changed, or mine removed what they changed (a face they added to
 * a family mine removed among them).
 */
export type ConflictKind = "changed" | "removed-by-them" | "removed-by-me";

/** One true conflict the merge settled, with every side of it. */
export interface EntryConflict {
  /**
   * The entry's identity: a token's id or name, a class's id, a face's
   * identity. For a section-wide setting, the setting's name.
   */
  readonly key: string;
  /** Whether `key` names a section-wide setting (`prefix`, `darkMode`). */
  readonly setting: boolean;
  readonly kind: ConflictKind;
  /** Whose value the merged section holds. */
  readonly kept: MergeWinner;
  /** The entry as the base, mine and theirs held it; absent where removed. */
  readonly base: unknown;
  readonly mine: unknown;
  readonly theirs: unknown;
}

/** A merged section, and the true conflicts settled in it. */
export interface SectionMerge {
  readonly value: unknown;
  readonly conflicts: readonly EntryConflict[];
}

/** How a merge settles a value both sides changed differently. */
export interface MergeSettle {
  readonly prefer: MergeWinner;
  /** Told of each value both sides changed differently. */
  readonly conflict?: () => void;
  /**
   * Keep a value no side changed exactly as it is, an empty record included.
   * Set for a stored entry, whose fields stay; a rebase onto code leaves it
   * unset, so a record left empty is dropped.
   */
  readonly keepUnchanged?: boolean;
}

/** A record's own entry at a key, or `undefined`. */
export function ownValueAt(value: unknown, key: string): unknown {
  return typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** The keys any of several records holds, in first-seen order. */
export function ownKeysOf(...records: unknown[]): string[] {
  return [
    ...new Set(
      records.flatMap(record =>
        typeof record === "object" && record !== null && !Array.isArray(record)
          ? Object.keys(record)
          : []
      )
    ),
  ];
}

/** A record built with own keys, whatever their names. */
export function ownRecordOf<T>(
  entries: readonly [string, T][]
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of entries) {
    Object.defineProperty(out, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** A value merged key by key (a padding's sides), not a token reference or a scalar. */
function isComposite(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isTokenRef(value)
  );
}

/**
 * One value merged three ways: what mine left as the base had it takes
 * theirs; what theirs left takes mine; the same change on both is kept; two
 * different changes are a true conflict, settled by `settle`. `undefined` is
 * a value cleared or never set.
 */
function mergedLeaf(
  base: unknown,
  mine: unknown,
  theirs: unknown,
  settle: MergeSettle
): unknown {
  if (sameStoredValue(mine, base)) return theirs;
  if (sameStoredValue(theirs, base) || sameStoredValue(mine, theirs)) {
    return mine;
  }
  settle.conflict?.();
  return settle.prefer === "mine" ? mine : theirs;
}

/**
 * A value merged three ways: a composite key by key, so one side owning one
 * side of a padding, or one field of an entry, does not take the other's
 * value for another; anything else whole, by {@link mergedLeaf}. Answers
 * `undefined` once nothing is left. Compared as stored JSON, so a key order
 * a database chose is no change.
 */
export function mergedValue(
  base: unknown,
  mine: unknown,
  theirs: unknown,
  settle: MergeSettle
): unknown {
  // Unchanged on every side is kept as it is, an empty record among them,
  // which the walk below would otherwise answer as cleared.
  if (
    settle.keepUnchanged === true &&
    sameStoredValue(mine, base) &&
    sameStoredValue(theirs, base)
  ) {
    return theirs;
  }
  const sides = [mine, base, theirs].filter(value => value !== undefined);
  if (sides.length > 0 && sides.every(isComposite)) {
    const out: [string, unknown][] = [];
    for (const key of ownKeysOf(mine, base, theirs)) {
      const value = mergedValue(
        ownValueAt(base, key),
        ownValueAt(mine, key),
        ownValueAt(theirs, key),
        settle
      );
      if (value !== undefined) out.push([key, value]);
    }
    return out.length > 0 ? ownRecordOf(out) : undefined;
  }
  return mergedLeaf(base, mine, theirs, settle);
}

/** How one section's entries are keyed and merged. */
interface EntryRules {
  /** The entry's identity, or `undefined` for one that cannot be keyed. */
  readonly keyOf: (entry: unknown) => string | undefined;
  /** Two present entries merged, both changed. */
  readonly merge: (
    base: unknown,
    mine: unknown,
    theirs: unknown,
    settle: MergeSettle
  ) => unknown;
  /**
   * Whether an entry only theirs holds goes with something mine removed
   * (a face added to a family mine removed): a true conflict.
   */
  readonly goneWithMine?: (theirs: unknown) => boolean;
}

/** A list's keyed entries, the first under each identity. */
function keyed(
  list: readonly unknown[],
  keyOf: EntryRules["keyOf"]
): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const entry of list) {
    const key = keyOf(entry);
    if (key !== undefined && !out.has(key)) out.set(key, entry);
  }
  return out;
}

/** An entry's sides: present, or `undefined` where that side has none. */
interface Sides {
  readonly base: unknown;
  readonly mine: unknown;
  readonly theirs: unknown;
}

/**
 * Which removal a true conflict over an entry is: mine removed what they
 * changed (or a face they added to a family mine removed), or they removed
 * what mine changed. `undefined` when neither side removed it.
 */
function removalOf(sides: Sides, rules: EntryRules): ConflictKind | undefined {
  const { base, mine, theirs } = sides;
  if (base === undefined) {
    return mine === undefined &&
      theirs !== undefined &&
      rules.goneWithMine?.(theirs) === true
      ? "removed-by-me"
      : undefined;
  }
  if (mine === undefined) return "removed-by-me";
  return theirs === undefined ? "removed-by-them" : undefined;
}

/**
 * An entry only one side changed, or both the same way: its value, wrapped,
 * or `undefined` when the sides are a true conflict. Absent on two sides is
 * the same as unchanged between them.
 */
function cleanEntry(
  sides: Sides,
  rules: EntryRules
): { value: unknown } | undefined {
  const { base, mine, theirs } = sides;
  if (sameStoredValue(mine, base)) {
    // Unchanged by mine, unless mine removed the family theirs added to.
    const gone = base === undefined && removalOf(sides, rules) !== undefined;
    return gone ? undefined : { value: theirs };
  }
  if (sameStoredValue(theirs, base) || sameStoredValue(mine, theirs)) {
    return { value: mine };
  }
  return undefined;
}

/**
 * One entry merged from its three sides, or `undefined` when the merged
 * list holds none, with the true conflict it was, if any.
 */
function mergedEntry(
  key: string,
  sides: Sides,
  rules: EntryRules,
  prefer: MergeWinner
): { value: unknown; conflict?: EntryConflict } {
  const clean = cleanEntry(sides, rules);
  if (clean !== undefined) return clean;
  const conflict = (kind: ConflictKind): EntryConflict => ({
    key,
    setting: false,
    kind,
    kept: prefer,
    ...sides,
  });
  const removal = removalOf(sides, rules);
  if (removal !== undefined) {
    // The side kept is the one preferred, absent where it removed the entry.
    return {
      value: prefer === "mine" ? sides.mine : sides.theirs,
      conflict: conflict(removal),
    };
  }
  let conflicted = false;
  const value = rules.merge(sides.base, sides.mine, sides.theirs, {
    prefer,
    keepUnchanged: true,
    conflict: () => {
      conflicted = true;
    },
  });
  return conflicted ? { value, conflict: conflict("changed") } : { value };
}

/**
 * A list of entries merged: theirs' order, with entries only mine holds
 * added after in mine's order. An entry theirs holds that cannot be keyed is
 * kept where it stands, as stored.
 */
function mergedEntries(
  base: readonly unknown[],
  mine: readonly unknown[],
  theirs: readonly unknown[],
  rules: EntryRules,
  prefer: MergeWinner,
  conflicts: EntryConflict[]
): unknown[] {
  const bases = keyed(base, rules.keyOf);
  const mines = keyed(mine, rules.keyOf);
  const out: unknown[] = [];
  const seen = new Set<string>();
  const place = (key: string, sides: Sides): void => {
    const merged = mergedEntry(key, sides, rules, prefer);
    if (merged.conflict !== undefined) conflicts.push(merged.conflict);
    if (merged.value !== undefined) out.push(merged.value);
  };
  for (const entry of theirs) {
    const key = rules.keyOf(entry);
    if (key === undefined || seen.has(key)) {
      out.push(entry);
      continue;
    }
    seen.add(key);
    place(key, { base: bases.get(key), mine: mines.get(key), theirs: entry });
  }
  for (const [key, entry] of mines) {
    if (seen.has(key)) continue;
    seen.add(key);
    place(key, { base: bases.get(key), mine: entry, theirs: undefined });
  }
  return out;
}

/** A stored list, or none for anything that is not one. */
function listOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A class's identity: its id. */
function classKey(entry: unknown): string | undefined {
  return isPlainRecord(entry) && typeof entry.id === "string" && entry.id !== ""
    ? entry.id
    : undefined;
}

/** Whether a stored descriptor is absent or a string, as a face states it. */
const optionalText = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === "string";

/** A face's identity, for a record that states what the identity reads. */
function faceKey(entry: unknown): string | undefined {
  if (!isPlainRecord(entry)) return undefined;
  const { family, weight, style, unicodeRange } = entry;
  if (
    typeof family !== "string" ||
    !optionalText(weight) ||
    !optionalText(style) ||
    !optionalText(unicodeRange)
  ) {
    return undefined;
  }
  return faceIdentity({
    family,
    ...(weight === undefined ? {} : { weight }),
    ...(style === undefined ? {} : { style }),
    ...(unicodeRange === undefined ? {} : { unicodeRange }),
  });
}

/** The families a list of faces holds. */
function familiesOf(list: readonly unknown[]): Set<string> {
  const out = new Set<string>();
  for (const entry of list) {
    if (isPlainRecord(entry) && typeof entry.family === "string") {
      out.add(entry.family);
    }
  }
  return out;
}

/** A token set's entries merged, and its section-wide settings beside them. */
function mergedTokenSet(
  base: unknown,
  mine: unknown,
  theirs: unknown,
  prefer: MergeWinner,
  conflicts: EntryConflict[]
): unknown {
  const settings: [string, unknown][] = [];
  for (const key of ownKeysOf(theirs, mine, base)) {
    if (key === "tokens") continue;
    let conflicted = false;
    const sides = { base: ownValueAt(base, key), mine: ownValueAt(mine, key) };
    const value = mergedValue(sides.base, sides.mine, ownValueAt(theirs, key), {
      prefer,
      keepUnchanged: true,
      conflict: () => {
        conflicted = true;
      },
    });
    if (conflicted) {
      conflicts.push({
        key,
        setting: true,
        kind: "changed",
        kept: prefer,
        ...sides,
        theirs: ownValueAt(theirs, key),
      });
    }
    if (value !== undefined) settings.push([key, value]);
  }
  const tokens = mergedEntries(
    listOf(ownValueAt(base, "tokens")),
    listOf(ownValueAt(mine, "tokens")),
    listOf(ownValueAt(theirs, "tokens")),
    { keyOf: storedVariableIdentity, merge: mergedValue },
    prefer,
    conflicts
  );
  return { ...ownRecordOf(settings), tokens };
}

/**
 * Whether a stored section can be merged into: nothing stored, or the shape
 * its section has (a token set's record, a list of classes or faces).
 */
function mergeable(section: MergeableSection, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return section === "tokens" ? isPlainRecord(value) : Array.isArray(value);
}

/**
 * The author's section (`mine`, built from `base`) merged onto the section
 * as stored now (`theirs`), with the true conflicts settled for `prefer`.
 *
 * When nobody else saved the section since the base, the answer is mine as
 * it is; when mine changed nothing, it is theirs. A stored section of a shape
 * no reader can merge into is answered with mine, as the section was written
 * before merging.
 */
export function mergeSiteStyleSection(
  section: MergeableSection,
  base: unknown,
  mine: unknown,
  theirs: unknown,
  prefer: MergeWinner
): SectionMerge {
  // SQLite hands a `json` column back as text.
  const [b, m, t] = [base, mine, theirs].map(readStoredJson);
  if (sameStoredValue(t, b) || sameStoredValue(m, t)) {
    return { value: mine, conflicts: [] };
  }
  if (sameStoredValue(m, b)) return { value: t, conflicts: [] };
  if (!mergeable(section, t)) return { value: mine, conflicts: [] };
  const conflicts: EntryConflict[] = [];
  if (section === "tokens") {
    return {
      value: mergedTokenSet(b, m, t, prefer, conflicts),
      conflicts,
    };
  }
  const rules: EntryRules =
    section === "classes"
      ? { keyOf: classKey, merge: mergedValue }
      : fontRules(listOf(b), listOf(m));
  return {
    value: mergedEntries(
      listOf(b),
      listOf(m),
      listOf(t),
      rules,
      prefer,
      conflicts
    ),
    conflicts,
  };
}

/**
 * Faces merged whole, each a value of its own. A face theirs added to a
 * family mine removed goes with the family when mine wins.
 */
function fontRules(
  base: readonly unknown[],
  mine: readonly unknown[]
): EntryRules {
  const kept = familiesOf(mine);
  const removed = new Set(
    [...familiesOf(base)].filter(family => !kept.has(family))
  );
  return {
    keyOf: faceKey,
    merge: mergedLeaf,
    goneWithMine: theirs =>
      isPlainRecord(theirs) &&
      typeof theirs.family === "string" &&
      removed.has(theirs.family),
  };
}
