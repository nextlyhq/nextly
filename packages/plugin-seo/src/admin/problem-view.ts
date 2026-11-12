/**
 * How the problem list's screen arranges what the list answers: grouped by
 * kind in the list's order, and when it was last checked, in words.
 *
 * @module admin/problem-view
 */
import {
  KIND_ORDER,
  KIND_TEXT,
  type Problem,
  type ProblemKind,
} from "../problems/contract";

/** One kind's problems, as a group of the screen. */
export interface ProblemGroup {
  kind: ProblemKind;
  title: string;
  explain: string;
  siteWide: boolean;
  problems: Problem[];
}

/** The problems grouped by kind, in the order the list draws kinds in. */
export function groupsOf(problems: readonly Problem[]): ProblemGroup[] {
  return KIND_ORDER.flatMap(kind => {
    const found = problems.filter(problem => problem.kind === kind);
    return found.length === 0
      ? []
      : [{ kind, ...KIND_TEXT[kind], problems: found }];
  });
}

/** Each unit "last checked" is said in, largest first, in milliseconds. */
const UNITS = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
] as const;

/** When the list was last checked, in words: `3 minutes ago`. */
export function checkedWords(checkedAt: string, now: number): string {
  const ago = now - Date.parse(checkedAt);
  for (const [unit, size] of UNITS) {
    const count = Math.floor(ago / size);
    if (count >= 1) return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  }
  return "just now";
}
