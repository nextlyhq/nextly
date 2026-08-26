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
 * One RUN of the edit script — consecutive units sharing an operation — with
 * the index its first unit sits at on each side it exists on.
 *
 * Runs rather than individual units, because that is the shape a replacement
 * actually arrives in: the differ emits every removed unit, then every inserted
 * one. Walking unit by unit sees only the boundary between those two runs and
 * pairs a single removal with a single insertion, which mis-reports two
 * consecutive edits as `removed, changed, added`.
 *
 * Discriminated by `op` so each variant carries exactly the indices it has: a
 * removal has no position on the "after" side and an insertion none on the
 * "before" side, and a shape admitting both would need a fallback at every read.
 */
type Run =
  | { op: 0; fromIndex: number; toIndex: number; count: number }
  | { op: -1; fromIndex: number; count: number }
  | { op: 1; toIndex: number; count: number };

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
 * Read the diff's runs, tracking the index on each side separately. The two
 * sides desynchronise at the first insertion or removal, so a single shared
 * counter would address the wrong unit from there onwards.
 */
function toRuns(ops: readonly [number, string][]): Run[] {
  const runs: Run[] = [];
  let fromIndex = 0;
  let toIndex = 0;
  for (const [op, text] of ops) {
    // Spreading a string yields whole code points, so a supplementary-plane
    // marker counts as one unit rather than as two surrogate halves.
    const count = [...text].length;
    if (count === 0) continue;
    if (op === 0) {
      runs.push({ op: 0, fromIndex, toIndex, count });
      fromIndex += count;
      toIndex += count;
    } else if (op === -1) {
      runs.push({ op: -1, fromIndex, count });
      fromIndex += count;
    } else {
      runs.push({ op: 1, toIndex, count });
      toIndex += count;
    }
  }
  return runs;
}

/** Append `count` units from the "after" side as additions. */
function pushAdded(
  pairs: UnitPair[],
  after: readonly string[],
  toIndex: number,
  count: number
): void {
  for (let k = 0; k < count; k += 1) {
    pairs.push({
      status: "added",
      after: unitAt(after, toIndex + k),
      toIndex: toIndex + k,
    });
  }
}

/** Append `count` units from the "before" side as removals. */
function pushRemoved(
  pairs: UnitPair[],
  before: readonly string[],
  fromIndex: number,
  count: number
): void {
  for (let k = 0; k < count; k += 1) {
    pairs.push({
      status: "removed",
      before: unitAt(before, fromIndex + k),
      fromIndex: fromIndex + k,
    });
  }
}

/**
 * Turn the edit script into pairs.
 *
 * A replacement arrives as a removal run followed by an insertion run, so the
 * two are zipped POSITIONALLY: the nth removed unit pairs with the nth inserted
 * one, and whichever side is longer contributes its tail as plain removals or
 * additions. Pairing only at the boundary between the runs reports two
 * consecutive edits as `removed, changed, added`, which loses the within-unit
 * comparison on both outer units.
 *
 * Positional is the only defensible zip here: these units are opaque strings
 * whose contents this function does not read, so it has nothing better than
 * order to match them by.
 */
function buildPairs(
  runs: readonly Run[],
  before: readonly string[],
  after: readonly string[]
): UnitPair[] {
  const pairs: UnitPair[] = [];

  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    if (run === undefined) continue;

    if (run.op === 0) {
      for (let k = 0; k < run.count; k += 1) {
        pairs.push({
          status: "unchanged",
          before: unitAt(before, run.fromIndex + k),
          after: unitAt(after, run.toIndex + k),
          fromIndex: run.fromIndex + k,
          toIndex: run.toIndex + k,
        });
      }
      continue;
    }

    if (run.op === 1) {
      pushAdded(pairs, after, run.toIndex, run.count);
      continue;
    }

    // A removal run. Only an insertion run DIRECTLY after it is a replacement;
    // anything else means these units were simply deleted.
    const next = runs[i + 1];
    if (next === undefined || next.op !== 1) {
      pushRemoved(pairs, before, run.fromIndex, run.count);
      continue;
    }

    const zipped = Math.min(run.count, next.count);
    for (let k = 0; k < zipped; k += 1) {
      pairs.push({
        status: "changed",
        before: unitAt(before, run.fromIndex + k),
        after: unitAt(after, next.toIndex + k),
        fromIndex: run.fromIndex + k,
        toIndex: next.toIndex + k,
      });
    }
    pushRemoved(pairs, before, run.fromIndex + zipped, run.count - zipped);
    pushAdded(pairs, after, next.toIndex + zipped, next.count - zipped);
    // The insertion run has been consumed by the pairing above.
    i += 1;
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
  const runs = toRuns(makeDiff(encoded.a, encoded.b));
  return { aligned: true, pairs: buildPairs(runs, before, after) };
}
