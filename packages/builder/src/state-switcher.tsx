"use client";

/**
 * The control that chooses which interaction state the Style tab edits.
 *
 * **At the top of the Style tab, not in the canvas chrome.** A breakpoint is a
 * fact about the whole page and belongs beside the canvas it resizes; a state
 * is a fact about the SELECTED BLOCK, and the panel is already scoped to that
 * block. Putting the two together would promise a symmetry that does not hold
 * and would leave this control needing a dead state whenever nothing is
 * selected. Webflow, Framer and Plasmic all place it inside the style panel for
 * the same reason, so an author arriving from any of them finds it where they
 * expect.
 *
 * **It reports which states already carry values**, which is the question
 * reading the values cannot answer. Styles inherit: opening `focus` on a block
 * with no focus styles shows the base values, so an author checking each state
 * in turn sees plausible numbers everywhere and still cannot tell which ones
 * were set. Marking the states that hold declarations of their own turns four
 * clicks and a misreading into one glance.
 *
 * @module state-switcher
 */

import {
  type NodeStyles,
  STYLE_STATES,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import { cn } from "@nextlyhq/ui/utils";
import * as React from "react";

import { radioGroupStep } from "./roving-radios";
import { stateHasOwnValues } from "./style-values";

/**
 * What each state is CALLED, in this product's vocabulary.
 *
 * The engine's identifiers are CSS's — `base`, `hover`, `focus`, `active` — and
 * they are the wrong words for the people using this control. `active` is the
 * most misread term in CSS: authors reliably take it to mean "current" or
 * "selected" rather than "being pressed". The labels describe what the visitor
 * is DOING, which is the thing an author is styling.
 *
 * Typed as a total record rather than a lookup with a fallback, so adding a
 * state to the engine fails to compile here instead of shipping a control with
 * an unnamed option.
 */
const STATE_LABELS: Readonly<Record<StyleState, string>> = {
  base: "None",
  hover: "Hover",
  focus: "Focused",
  active: "Pressed",
};

/**
 * What each state MEANS, for the accessible name and the tooltip.
 *
 * The label alone does not say what selecting it will do — "Pressed" names a
 * state without saying whose, and a screen reader user gets no more from it
 * than the word.
 */
const STATE_HINTS: Readonly<Record<StyleState, string>> = {
  base: "the normal appearance, before any interaction",
  hover: "while the pointer is over it",
  focus: "while it has keyboard focus",
  active: "while it is being pressed",
};

/**
 * Props for StateSwitcher.
 * @experimental
 */
export interface StateSwitcherProps {
  /** The state currently being edited. */
  state: StyleState;
  /** Choose a different state to edit and preview. */
  onSelect: (state: StyleState) => void;
  /**
   * The selected node's stored styles, for reporting which states carry values.
   *
   * Optional because the marker is an affordance rather than the control: a
   * host that cannot supply them gets a working switcher with nothing marked,
   * which is honest. Supplying an empty object would claim every state is
   * unstyled.
   */
  styles?: NodeStyles | undefined;
}

export function StateSwitcher({
  state,
  onSelect,
  styles,
}: StateSwitcherProps): React.JSX.Element {
  const radios = React.useRef<Array<HTMLButtonElement | null>>([]);
  const index = STYLE_STATES.indexOf(state);
  /*
   * A selection that is somehow not one of the states still leaves a reachable
   * control: the roving tab stop falls back to the first option rather than to
   * `-1`, which would put every option out of the tab order and strand a
   * keyboard user on a group they cannot enter.
   */
  const activeIndex = index === -1 ? 0 : index;

  /*
   * Roving tabindex: one stop for the whole group, arrows move within it.
   *
   * The same model the breakpoint switcher uses, and for the same reason — a
   * radio group that put every option in the tab order costs a keyboard user
   * one Tab per state to cross a control they may not be using.
   *
   * Selection FOLLOWS focus, which is the APG's radio-group behaviour and is
   * right here: choosing a state is free and instantly reversible, and the
   * canvas showing the state under the cursor is the whole point of arrowing
   * through them.
   */
  const move = (delta: number): void => {
    const next =
      (activeIndex + delta + STYLE_STATES.length) % STYLE_STATES.length;
    const target = STYLE_STATES[next];
    if (target === undefined) return;
    onSelect(target);
    radios.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Interaction state"
      className="nx-state-switcher flex items-center gap-0.5 rounded-md border p-0.5"
      onKeyDown={event => {
        const step = radioGroupStep(event.key);
        if (step === null) return;
        event.preventDefault();
        move(step);
      }}
    >
      {STYLE_STATES.map((option, position) => {
        const selected = option === state;
        /*
         * Not marked on `base`. It carries values on almost every block, so a
         * dot there is on permanently and says nothing — and a marker that is
         * always lit is read as decoration, which costs the other three the
         * meaning they depend on.
         */
        const marked = option !== "base" && stateHasOwnValues(styles, option);
        return (
          <button
            key={option}
            ref={element => {
              radios.current[position] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            /*
             * The marker is in the ACCESSIBLE NAME, not only in the dot. It is
             * the one piece of information this control adds beyond its labels,
             * and a purely visual form withholds it from the people who can
             * least afford to click through four states to find out.
             */
            aria-label={`${STATE_LABELS[option]} — ${STATE_HINTS[option]}${
              marked ? ", has styles" : ""
            }`}
            title={`${STATE_LABELS[option]}: ${STATE_HINTS[option]}`}
            tabIndex={position === activeIndex ? 0 : -1}
            onClick={() => onSelect(option)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-xs",
              selected
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground"
            )}
          >
            <span aria-hidden="true">{STATE_LABELS[option]}</span>
            {marked ? (
              <span
                aria-hidden="true"
                data-nx-state-marked="true"
                /*
                 * `bg-current` — the button's own text colour — rather than a
                 * named colour utility, and the reason is measured rather than
                 * stylistic.
                 *
                 * A named one fails at TWO layers here, so fixing either alone
                 * leaves the dot invisible. `bg-accent-foreground` is emitted
                 * into no stylesheet this package produces or consumes: the
                 * builder's own is built from these sources and this was its
                 * only use, and the admin's emits `bg-muted-foreground` and not
                 * the accent one. And the theme token behind it,
                 * `--accent-foreground`, is undefined on both `:root` and
                 * `.nx-builder-chrome` in the editor, so even a rule that WAS
                 * emitted would paint transparent.
                 *
                 * `currentColor` depends on neither: it is a CSS keyword rather
                 * than a theme lookup, so the utility is generated from this
                 * use alone. It is also the better answer independently — the
                 * dot takes the colour of the label it sits beside, so it stays
                 * legible in both the selected and unselected states without
                 * restating either, and cannot drift from them.
                 */
                className="size-1 rounded-full bg-current"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Props for StyleStateField.
 * @experimental
 */
export interface StyleStateFieldProps {
  /** The state currently being edited. `base` when the host says nothing. */
  state?: StyleState | undefined;
  /**
   * Choose a different state, or `undefined` where nothing can act on the
   * choice — which is what withholds the control.
   */
  onSelect?: ((state: StyleState) => void) | undefined;
  /**
   * The selected node, whose stored styles the markers are read from.
   *
   * The NODE rather than its styles, so the one place that knows a marker is
   * about stored styles is also the place that reaches for them — a caller
   * handed a styles-shaped prop has to know that much itself, and every caller
   * then knows it separately.
   */
  node?: { styles?: NodeStyles } | null | undefined;
}

/**
 * The switcher as a style panel mounts it, including whether to mount it.
 *
 * The condition lives with the CONTROL rather than at the call site, because it
 * is a property of the control: this switcher's state and `Canvas.forcedState`
 * are one value, so a host that cannot carry the choice to its canvas would get
 * a switcher reporting a state the author is not looking at. Deciding that
 * where the control is defined also keeps the panel free of a branch per
 * optional prop, which is how a panel already rendering three tabs becomes one
 * nobody can read.
 *
 * Both props accept an explicit `undefined` so a caller can forward whatever it
 * holds without a conditional spread at every call site.
 */
export function StyleStateField({
  state = "base",
  onSelect,
  node,
}: StyleStateFieldProps): React.JSX.Element | null {
  if (onSelect === undefined) return null;
  return (
    <div className="nx-inspector__state">
      <StateSwitcher state={state} onSelect={onSelect} styles={node?.styles} />
    </div>
  );
}
