/**
 * Align two sequences of opaque string units into pairs.
 *
 * Rich text is a sequence of blocks and formatted source is a sequence of
 * lines; both need the same operation, so it lives here once and is called
 * twice rather than growing two implementations that agree on the day they are
 * written.
 *
 * Each DISTINCT unit is mapped to a private-use code point and the two
 * synthetic strings are diffed with the same engine that diffs prose. That is
 * the standard "line mode" technique, and it reuses a dependency this package
 * already has instead of adding a second edit-distance implementation.
 *
 * Adjacent delete/insert runs are then paired positionally, so an edited unit
 * reports as one `changed` row rather than as a removal the reader has to join
 * to an addition by eye. What changed WITHIN a pair is left to the caller: a
 * block wants a word diff, a line may want something else, and this function
 * knows about neither.
 *
 * @module domains/versions/diff/align-units
 */

import { makeDiff } from "@sanity/diff-match-patch";

import { NextlyError } from "../../../errors/nextly-error";

/** One aligned unit, discriminated by which sides hold it. */
export type UnitPair =
  | {
      status: "unchanged";
      before: string;
      after: string;
      fromIndex: number;
      toIndex: number;
    }
  | {
      status: "changed";
      before: string;
      after: string;
      fromIndex: number;
      toIndex: number;
    }
  | { status: "added"; after: string; toIndex: number }
  | { status: "removed"; before: string; fromIndex: number };

export interface AlignResult {
  /**
   * False when the two sides together held more distinct units than the
   * private-use alphabet can name. `pairs` is then empty and the caller reports
   * "not comparable" rather than a partial result: a silently truncated
   * alignment produces a confident answer about content it never read.
   */
  aligned: boolean;
  pairs: UnitPair[];
}

/**
 * Unicode private-use planes, which carry no assigned characters, so a mapped
 * unit can never be confused with one the differ produced. Authored text MAY
 * contain these code points; that is harmless, because content is mapped
 * THROUGH this alphabet by identity rather than compared against it — two units
 * are the same unit only when their full strings match.
 *
 * The BMP block alone caps at 6400 distinct units, which a long document can
 * exceed, so the two supplementary planes are included as well.
 */
const PUA_RANGES: readonly (readonly [number, number])[] = [
  [0xe000, 0xf8ff],
  [0xf0000, 0xffffd],
  [0x100000, 0x10fffd],
];

const ALPHABET_SIZE = PUA_RANGES.reduce(
  (total, [lo, hi]) => total + (hi - lo + 1),
  0
);

/** The nth code point of the concatenated private-use ranges. */
function codePointAt(index: number): number {
  let remaining = index;
  for (const [lo, hi] of PUA_RANGES) {
    const size = hi - lo + 1;
    if (remaining < size) return lo + remaining;
    remaining -= size;
  }
  // Callers check ALPHABET_SIZE before asking, so this cannot be reached today.
  // It is an assertion over a value already in hand rather than a lookup, so
  // the guard costs nothing on the path that never rejects — and unreachability
  // is a property of the current call graph, not of this function.
  throw NextlyError.internal({
    logContext: { reason: "align-units-index-beyond-alphabet", index },
  });
}

/**
 * Encode both sides against ONE shared unit-to-code-point table, so the same
 * unit is the same character on both sides. Returns null once the table would
 * outgrow the alphabet.
 */
function encode(
  before: readonly string[],
  after: readonly string[]
): { a: string; b: string } | null {
  const table = new Map<string, string>();

  const encodeSide = (units: readonly string[]): string | null => {
    const out: string[] = [];
    for (const unit of units) {
      let ch = table.get(unit);
      if (ch === undefined) {
        if (table.size >= ALPHABET_SIZE) return null;
        ch = String.fromCodePoint(codePointAt(table.size));
        table.set(unit, ch);
      }
      out.push(ch);
    }
    return out.join("");
  };

  const a = encodeSide(before);
  if (a === null) return null;
  const b = encodeSide(after);
  if (b === null) return null;
  return { a, b };
}

/**
 * One unit's position in the edit script, before removals and insertions pair
 * up. Discriminated by `op` so each variant carries exactly the indices it has:
 * a removal has no position on the "after" side and an insertion none on the
 * "before" side, and a shape admitting both would need a fallback at every
 * read.
 */
type Entry =
  | { op: 0; fromIndex: number; toIndex: number }
  | { op: -1; fromIndex: number }
  | { op: 1; toIndex: number };

/**
 * Read a unit the edit script has already proved is present.
 *
 * Indices are produced by counters bounded by these same arrays, so a miss is
 * an internal inconsistency rather than a case to handle — one assertion here
 * beats a fallback at every call site, which would silently substitute an empty
 * unit and report a spurious change.
 */
function unitAt(units: readonly string[], index: number): string {
  const unit = units[index];
  if (unit === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "align-units-index-out-of-range", index },
    });
  }
  return unit;
}

/**
 * Expand the diff's runs into one entry per unit, tracking the index on each
 * side separately. The two sides desynchronise at the first insertion or
 * removal, so a single shared counter would address the wrong unit from there
 * onwards.
 */
function toEntries(ops: readonly [number, string][]): Entry[] {
  const entries: Entry[] = [];
  let fromIndex = 0;
  let toIndex = 0;
  for (const [op, text] of ops) {
    // Iterating a string yields whole code points, so a supplementary-plane
    // marker counts as one unit rather than as two surrogate halves.
    for (const _unit of text) {
      if (op === 0) {
        entries.push({ op: 0, fromIndex: fromIndex++, toIndex: toIndex++ });
      } else if (op === -1) {
        entries.push({ op: -1, fromIndex: fromIndex++ });
      } else {
        entries.push({ op: 1, toIndex: toIndex++ });
      }
    }
  }
  return entries;
}

/**
 * Turn the edit script into pairs, joining a removal that is directly followed
 * by an insertion into one `changed` row: that shape is a unit the author
 * edited, and reporting it as a removal beside an unrelated addition leaves the
 * reader to join the two by eye and gives the caller nothing to diff within.
 */
function buildPairs(
  entries: readonly Entry[],
  before: readonly string[],
  after: readonly string[]
): UnitPair[] {
  const pairs: UnitPair[] = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry === undefined) continue;

    if (entry.op === 0) {
      pairs.push({
        status: "unchanged",
        before: unitAt(before, entry.fromIndex),
        after: unitAt(after, entry.toIndex),
        fromIndex: entry.fromIndex,
        toIndex: entry.toIndex,
      });
      continue;
    }

    if (entry.op === 1) {
      pairs.push({
        status: "added",
        after: unitAt(after, entry.toIndex),
        toIndex: entry.toIndex,
      });
      continue;
    }

    const next = entries[i + 1];
    if (next !== undefined && next.op === 1) {
      pairs.push({
        status: "changed",
        before: unitAt(before, entry.fromIndex),
        after: unitAt(after, next.toIndex),
        fromIndex: entry.fromIndex,
        toIndex: next.toIndex,
      });
      // The insertion has been consumed by the pair above.
      i += 1;
      continue;
    }

    pairs.push({
      status: "removed",
      before: unitAt(before, entry.fromIndex),
      fromIndex: entry.fromIndex,
    });
  }

  return pairs;
}

export function alignUnits(
  before: readonly string[],
  after: readonly string[]
): AlignResult {
  if (before.length === 0 && after.length === 0) {
    return { aligned: true, pairs: [] };
  }

  const encoded = encode(before, after);
  if (encoded === null) return { aligned: false, pairs: [] };

  // No semantic cleanup pass: these are opaque markers, and the heuristics that
  // make prose runs readable would coalesce unrelated units.
  const entries = toEntries(makeDiff(encoded.a, encoded.b));
  return { aligned: true, pairs: buildPairs(entries, before, after) };
}
