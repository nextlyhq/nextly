"use client";

/**
 * What the accessibility check found in each drawn state, for the theme it
 * was checked in, and the list each state draws beside itself.
 *
 * Kept per theme, because a state checked in light says nothing of its
 * contrast in dark: each state shows the findings of the theme on show, or
 * that it has not been checked in it.
 *
 * @module components/features/widgets/preview/preview-findings
 */

import { createContext, useContext, type JSX } from "react";

import { isBlockingFinding, type AccessibilityFinding } from "./accessibility";

/** Each state's findings, keyed by `findingsKey`. */
export type PreviewFindings = ReadonlyMap<string, AccessibilityFinding[]>;

/** The key one state's findings are kept under, in one theme. */
export function findingsKey(theme: string, stateKey: string): string {
  return `${theme}|${stateKey}`;
}

/** The findings so far, and the theme on show. */
export const PreviewFindingsContext = createContext<{
  findings: PreviewFindings;
  theme: string;
}>({ findings: new Map(), theme: "light" });

/** The findings beside one drawn state. */
export function StateFindings({ stateKey }: { stateKey: string }): JSX.Element {
  const { findings, theme } = useContext(PreviewFindingsContext);
  const found = findings.get(findingsKey(theme, stateKey));
  if (found === undefined) {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-preview-findings="unchecked"
      >
        Not checked in {theme}
      </p>
    );
  }
  const blocking = found.filter(isBlockingFinding).length;
  if (found.length === 0) {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-preview-findings="none"
        data-blocking="0"
      >
        No accessibility findings in {theme}
      </p>
    );
  }
  return (
    <ul
      className="space-y-1 text-xs"
      data-preview-findings="found"
      data-blocking={blocking}
      aria-label={`Accessibility findings in ${theme}`}
    >
      {found.map(finding => (
        <li
          key={finding.id}
          data-rule={finding.id}
          data-impact={finding.impact ?? "unknown"}
          className={
            isBlockingFinding(finding)
              ? "font-medium text-destructive"
              : "text-muted-foreground"
          }
        >
          {finding.impact ?? "unrated"}: {finding.help} ({finding.id},{" "}
          {finding.count === 1 ? "1 element" : `${finding.count} elements`})
        </li>
      ))}
    </ul>
  );
}
