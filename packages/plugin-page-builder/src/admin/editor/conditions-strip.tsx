"use client";

/**
 * The switch that applies visibility conditions on the canvas, and what it
 * says they did.
 *
 * On a template it sits in the Previewing strip after the entry, and checks
 * the conditions against that entry as a visitor reads it. On a component or
 * a Layout there is no entry to check, so a strip of its own holds the switch
 * disabled, with the reason beside it. Either appears only while the document
 * holds a conditioned block, so a document without one keeps the canvas's
 * full height.
 *
 * The switch is the author's own, for this session: it never changes what is
 * stored.
 *
 * @module conditions-strip
 */

import type { AppliedConditions } from "@nextlyhq/builder/shell";
import { useId } from "react";

/** The switch's state on a template, as the host keeps it. */
export interface TemplateConditions {
  /** Whether the conditions are applied. */
  readonly on: boolean;
  readonly toggle: () => void;
  /** Whether an entry is previewed to check them against. */
  readonly available: boolean;
  /** What applying them did, while they are applied and an entry is previewed. */
  readonly applied: AppliedConditions | undefined;
  /** What the entry is called in words, lower case: "post". */
  readonly noun: string;
}

/** The switch itself: a button announced as a switch, pressed or not. */
function ConditionsSwitch({
  on,
  disabled,
  onToggle,
  describedBy,
}: {
  readonly on: boolean;
  readonly disabled: boolean;
  readonly onToggle?: () => void;
  readonly describedBy?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="nx-preview-strip__switch"
      disabled={disabled}
      onClick={onToggle}
      {...(describedBy === undefined
        ? {}
        : { "aria-describedby": describedBy })}
    >
      <span className="nx-preview-strip__track" aria-hidden="true" />
      Apply conditions
    </button>
  );
}

/**
 * What the conditions did for the entry, at the strip's far end: how many of
 * the blocks that read it are hidden, or that every one shows. A live region,
 * present while the switch is off too, so each change is announced.
 */
export function conditionsCountWords(
  applied: AppliedConditions | undefined,
  noun: string
): string {
  if (applied === undefined) return "";
  const hidden = applied.hidden.length;
  if (hidden === 0) return `Every conditioned block shows for this ${noun}`;
  return `${String(hidden)} block${hidden === 1 ? "" : "s"} hidden for this ${noun}`;
}

/**
 * The switch and its count, as the Previewing strip holds them after the
 * entry. Disabled while no entry is previewed: the strip's own notice says
 * why there is none.
 */
export function TemplateConditionsPart({
  conditions,
}: {
  readonly conditions: TemplateConditions;
}): React.JSX.Element {
  return (
    <>
      <span className="nx-preview-strip__sep" aria-hidden="true" />
      <ConditionsSwitch
        on={conditions.on && conditions.available}
        disabled={!conditions.available}
        onToggle={conditions.toggle}
      />
      <span className="nx-preview-strip__count" role="status">
        {conditions.on
          ? conditionsCountWords(conditions.applied, conditions.noun)
          : ""}
      </span>
    </>
  );
}

/**
 * The strip a component or a Layout gets while it holds a conditioned block:
 * what is being edited, and the switch, disabled, since there is no entry to
 * check against until the block is placed somewhere that has one.
 */
export function PlacedConditionsStrip({
  kind,
  name,
}: {
  /** What is being edited, in words: "Component" or "Layout". */
  readonly kind: string;
  readonly name: string;
}): React.JSX.Element {
  const why = useId();
  return (
    <div className="nx-preview-strip">
      <span>{kind}</span>
      <b className="font-medium text-[var(--nx-foreground)]">{name}</b>
      <span className="nx-preview-strip__sep" aria-hidden="true" />
      <ConditionsSwitch on={false} disabled describedBy={why} />
      <span className="nx-preview-strip__why" id={why}>
        No entry to check here. They’re checked where it’s placed.
      </span>
    </div>
  );
}
