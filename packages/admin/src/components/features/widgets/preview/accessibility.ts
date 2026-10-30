/**
 * The accessibility check the preview page runs on each drawn state.
 *
 * The check is axe-core's, as the end-to-end suite's is. This package does not
 * depend on axe-core, so the page uses the axe the browser page already holds:
 * `window.axe`, which axe-core's script defines when it is loaded, and which
 * the end-to-end suite loads before asking the page to check. Where there is
 * none the page says so, rather than reporting a state as having no findings
 * nobody looked for.
 *
 * Its answer is outside input, so it is parsed at this boundary and only the
 * parts the page shows are kept.
 *
 * @module components/features/widgets/preview/accessibility
 */

import { z } from "zod";

/** One rule a drawn state breaks, as the page shows it. */
export interface AccessibilityFinding {
  /** The axe rule, such as `label` or `color-contrast`. */
  id: string;
  impact: "minor" | "moderate" | "serious" | "critical" | null;
  /** What the rule asks, in axe's words. */
  help: string;
  /** How many elements in the state break it. */
  count: number;
}

/** Runs the check on one drawn state. */
export type AccessibilityCheck = (
  element: Element
) => Promise<AccessibilityFinding[]>;

/** The part of an axe run's answer the page reads. */
const axeAnswer = z.object({
  violations: z.array(
    z.object({
      id: z.string(),
      impact: z
        .enum(["minor", "moderate", "serious", "critical"])
        .nullable()
        .optional(),
      help: z.string(),
      nodes: z.array(z.unknown()),
    })
  ),
});

/** The axe the page holds: an object with a `run` function. */
interface AxeRunner {
  run: (context: Element, options: object) => Promise<unknown>;
}

function isAxeRunner(value: unknown): value is AxeRunner {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { run?: unknown }).run === "function"
  );
}

/**
 * The check, from the axe this page holds, or `undefined` where it holds
 * none. Read when the check is asked for, not when the page loads, so an axe
 * loaded after the page is found.
 */
export function pageAccessibilityCheck(): AccessibilityCheck | undefined {
  const axe: unknown = (globalThis as { axe?: unknown }).axe;
  if (!isAxeRunner(axe)) return undefined;
  return async element => {
    const answer = axeAnswer.parse(
      await axe.run(element, { resultTypes: ["violations"] })
    );
    return answer.violations.map(violation => ({
      id: violation.id,
      impact: violation.impact ?? null,
      help: violation.help,
      count: violation.nodes.length,
    }));
  };
}

/**
 * Whether a finding stops a first-party widget in CI: a serious or critical
 * one, the impacts that leave a person unable to use the card.
 */
export function isBlockingFinding(finding: AccessibilityFinding): boolean {
  return finding.impact === "serious" || finding.impact === "critical";
}
