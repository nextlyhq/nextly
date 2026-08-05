/**
 * A bound on what one compile may spend explaining itself.
 *
 * Every value the compiler declines to write earns a warning naming its
 * JSON-Pointer, and a pointer repeats every key above it. A document inside the
 * byte cap can hold thousands of such values under a long ancestor slot key, so
 * the answer grows faster than the question and a result nothing rejected can
 * still exhaust memory when it is serialized.
 *
 * Deliberately NOT the `StyleIssueBudget`. That budget decides what gets
 * WRITTEN — a style map reached after it runs out is refused rather than
 * written unchecked — so spending it on diagnostics would let one bad settings
 * record or one malformed token name take a whole page's stylesheet down with
 * it. These cost only their own output.
 *
 * @module style/warning-allowance
 */
import type { ValidationIssue } from "../validation";

/** How many warnings one compile reports about values it did not write. */
export const MAX_COMPILE_WARNINGS = 50;

/** How many bytes of JSON-Pointer those warnings may spend between them. */
export const MAX_COMPILE_WARNING_PATH_BYTES = 10_000;

export interface WarningAllowance {
  remaining: number;
  pathBytes: number;
  /** Whether the run has already said it stopped reporting. */
  announced: boolean;
  /**
   * Whether this run has already reported an unusable token prefix.
   *
   * The prefix is one CONFIGURATION fact, not a fact about any style map, but
   * it is discovered while compiling each of them. Reported per map, a page of
   * fifty styled nodes spends the whole allowance restating one setting — and
   * then announces truncation, so the values that really were dropped go
   * unexplained because the compiler was busy repeating itself.
   */
  prefixReported: boolean;
  /**
   * Whether this run has already carried a style-issue truncation marker.
   *
   * The marker is exempt from the allowance on purpose — charged to the bound it describes it is
   * the first thing dropped, leaving a truncated list looking complete. Exempt AND repeatable is
   * the other failure: every map that hit its own style budget adds one, so a large class library
   * answers with thousands of identical markers.
   */
  styleIssuesAnnounced: boolean;
}

/** A fresh allowance for one compile. */
export function newWarningAllowance(): WarningAllowance {
  return {
    remaining: MAX_COMPILE_WARNINGS,
    pathBytes: MAX_COMPILE_WARNING_PATH_BYTES,
    announced: false,
    prefixReported: false,
    styleIssuesAnnounced: false,
  };
}

/** Whether an allowance has nothing left, so producing more is wasted work. */
export function allowanceSpent(allowance: WarningAllowance): boolean {
  return allowance.remaining <= 0 || allowance.pathBytes <= 0;
}

/**
 * Report one warning, or say once that the rest are not being reported.
 *
 * Silent after that. A word per unreported value would repeat the pointer this
 * bound exists to stop repeating, restated as an explanation of the bound.
 */
export function pushBoundedWarning(
  allowance: WarningAllowance,
  warnings: ValidationIssue[],
  issue: ValidationIssue
): void {
  // Charged BEFORE it is admitted. Charging afterwards makes the byte allowance a running total
  // rather than a bound: the first warning is always admitted whole, so a single pointer larger
  // than the whole allowance is returned in full and only then drives the count negative. A
  // pointer carries its key whole, on purpose, and what keeps that bounded is the document byte
  // cap — which does not reach a class library or a block-type default, both of them settings
  // read on every page render. One corrupt key of any size therefore reached the answer intact.
  if (issue.path.length > allowance.pathBytes) {
    allowance.pathBytes = 0;
  }
  if (allowanceSpent(allowance)) {
    if (allowance.announced) return;
    allowance.announced = true;
    warnings.push({
      path: "",
      code: "style-issues-truncated",
      severity: "warning",
      message:
        "More values were left out of the stylesheet than are listed here, so some are not explained.",
    });
    return;
  }
  allowance.remaining -= 1;
  allowance.pathBytes -= issue.path.length;
  warnings.push(issue);
}
