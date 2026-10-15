/**
 * The spent two-factor marks, held in memory for unit tests.
 *
 * Keeps the database's one rule that matters to a caller: of two spends of
 * one mark, only the first is written. The real marks, on each dialect, are
 * covered by the integration suite.
 */
import type { SpentChallenges } from "../../pipeline/spent-challenges";

/** In-memory marks, and the set they are kept in for a case to inspect. */
export function fakeSpentChallenges(): SpentChallenges & {
  marks: Map<string, number>;
} {
  const marks = new Map<string, number>();
  return {
    marks,
    isSpent: mark => Promise.resolve(marks.has(mark)),
    spend: (mark, expiresAt) => {
      if (marks.has(mark)) return Promise.resolve(false);
      marks.set(mark, expiresAt);
      return Promise.resolve(true);
    },
  };
}
