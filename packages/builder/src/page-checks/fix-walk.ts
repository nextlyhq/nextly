/**
 * Walking the Page checks list while fixing, as the bar under the checks'
 * count shows it: "Check 2 of 5", with Previous and Next.
 *
 * The findings change under the author as they fix things, so the place is
 * kept by the finding's key, with its index as last seen. A finding that
 * goes is "Fixed", and Next then goes to the one that took its place, so the
 * walk carries on from where the author was rather than starting again.
 * Nothing here moves the author: the bar only says where they are until they
 * press Previous or Next.
 *
 * Pure, so the walk is tested without a bar.
 *
 * @module page-checks/fix-walk
 */
import type { PageFinding } from "./page-checks";

/** The finding the author went to, and its index when they last saw it. */
export interface FixPlace {
  readonly key: string;
  readonly index: number;
}

/** Where the walk stands now. */
export type FixStep =
  | {
      readonly kind: "at";
      readonly finding: PageFinding;
      readonly index: number;
      readonly total: number;
    }
  /** The finding is gone; `next` is the index Next goes to. */
  | { readonly kind: "fixed"; readonly next: number; readonly total: number }
  | { readonly kind: "clear" };

/** Where the author is among the findings as they stand now. */
export function fixStep(
  findings: readonly PageFinding[],
  place: FixPlace
): FixStep {
  if (findings.length === 0) return { kind: "clear" };
  const index = findings.findIndex(each => each.key === place.key);
  const finding = findings[index];
  if (finding !== undefined) {
    return { kind: "at", finding, index, total: findings.length };
  }
  return {
    kind: "fixed",
    next: Math.min(Math.max(place.index, 0), findings.length),
    total: findings.length,
  };
}

/** The finding Previous (`-1`) or Next (`1`) goes to, if there is one. */
export function fixNeighbour(
  findings: readonly PageFinding[],
  step: FixStep,
  direction: -1 | 1
): PageFinding | undefined {
  if (step.kind === "clear") return undefined;
  if (step.kind === "at") return findings[step.index + direction];
  return findings[direction === 1 ? step.next : step.next - 1];
}

/** What the bar says of where the author is. */
export function fixStepWords(step: FixStep): string {
  if (step.kind === "clear") return "All clear";
  if (step.kind === "at") {
    return `Check ${String(step.index + 1)} of ${String(step.total)}`;
  }
  return `Fixed · ${String(step.total)} to go`;
}
