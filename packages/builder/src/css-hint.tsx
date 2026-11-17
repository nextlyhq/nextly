"use client";

/**
 * What a panel control writes, where an author can find it: in a tooltip on
 * hover or keyboard focus, for everyone, and printed small under the label
 * while "Show CSS names" is on.
 *
 * The tooltip is the builder's own (`ChromeTooltip`): it opens after a short
 * hover or at once on keyboard focus, stays while the pointer is over it,
 * closes on Escape without that Escape reaching the editor, and is a layer,
 * so nothing in the panel moves while it shows.
 *
 * @module css-hint
 */
import * as React from "react";

import { ChromeTooltip } from "./chrome-tooltip";
import { useCssNames } from "./css-names-context";

/** A control's tooltip: what it does in words, then what it writes. */
function HintContent({
  summary,
  writes,
}: {
  summary: string | undefined;
  writes: string | undefined;
}): React.JSX.Element {
  return (
    <span className="nx-css-hint">
      {summary === undefined ? null : (
        <span className="nx-css-hint__summary">{summary}</span>
      )}
      {writes === undefined ? null : (
        <code className="nx-css-hint__code">{writes}</code>
      )}
    </span>
  );
}

/**
 * A control with its "what it writes" tooltip. Draws the control alone where
 * there is nothing to say.
 */
export function CssHint({
  writes,
  summary,
  children,
}: {
  writes: string | undefined;
  /** What the control does, in words, said above the code. */
  summary?: string | undefined;
  /** The control: one element, which becomes the tooltip's trigger. */
  children: React.ReactElement;
}): React.JSX.Element {
  if (writes === undefined && summary === undefined) return children;
  return (
    <ChromeTooltip
      content={<HintContent summary={summary} writes={writes} />}
      side="left"
      align="start"
    >
      {children}
    </ChromeTooltip>
  );
}

/**
 * The CSS names a control writes, printed small under its label while "Show
 * CSS names" is on, and nothing while it is off. Its `id` joins the control's
 * description, so a screen reader says the names only while they are shown.
 */
export function CssNamesLine({
  id,
  names,
}: {
  id: string;
  names: readonly string[];
}): React.JSX.Element | null {
  const { shown } = useCssNames();
  if (!shown || names.length === 0) return null;
  return (
    <span id={id} className="nx-css-names">
      {names.join(", ")}
    </span>
  );
}

/** A control's description with its CSS names joined while they are shown. */
export function useDescribedWithNames(
  describedBy: string | undefined,
  namesId: string
): string | undefined {
  const { shown } = useCssNames();
  if (!shown) return describedBy;
  return describedBy === undefined ? namesId : `${describedBy} ${namesId}`;
}
