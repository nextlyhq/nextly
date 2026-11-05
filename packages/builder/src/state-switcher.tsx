"use client";

/**
 * The control that chooses which interaction state the Style tab edits: a
 * compact menu named "State" on the bar's second line, as the editor mock
 * draws it ("State: Normal ⌄"), its items the four states.
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
  type BreakpointSet,
  type NodeStyles,
  STYLE_STATES,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

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
  base: "Normal",
  hover: "Hover",
  focus: "Focus",
  active: "Pressed",
};

/** A state's name in this product's words: Normal, Hover, Focus, Pressed. */
export function stateLabel(state: StyleState): string {
  return STATE_LABELS[state];
}

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
  /**
   * The site's breakpoints, so a marker counts only tiers the sheet has.
   *
   * A value stored under a deleted tier reaches no visitor, and marking it
   * sends an author looking for an appearance nobody can see.
   */
  breakpoints?: BreakpointSet | undefined;
}

export function StateSwitcher({
  state,
  onSelect,
  styles,
  breakpoints,
}: StateSwitcherProps): React.JSX.Element {
  /*
   * Not marked on `base`. It carries values on almost every block, so a dot
   * there is on permanently and says nothing, and a marker that is always lit
   * is read as decoration, which costs the other three the meaning they
   * depend on.
   */
  const marked = (option: StyleState): boolean =>
    option !== "base" && stateHasOwnValues(styles, option, breakpoints);
  // The states with values that the canvas is NOT showing, which the trigger
  // names so a hidden state stays discoverable with the menu closed.
  const elsewhere = STYLE_STATES.filter(
    option => option !== state && marked(option)
  );
  const triggerName = [
    `State: ${STATE_LABELS[state]}`,
    ...elsewhere.map(option => `${STATE_LABELS[option]} has values`),
  ].join(", ");
  return (
    <>
      {/* Not modal, as the editor's other menus are not: a modal menu hides
          the editor around it while its controls stay focusable. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="nx-state-menu"
            aria-label={triggerName}
            title={`${STATE_LABELS[state]}: ${STATE_HINTS[state]}`}
          >
            <span aria-hidden="true">{STATE_LABELS[state]}</span>
            <ChevronDown aria-hidden="true" size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" collisionPadding={8}>
          {STYLE_STATES.map(option => (
            <DropdownMenuItem
              key={option}
              // One choice of four: a radio item, its choice marked with a
              // tick, which cannot be mistaken for the "has values" dot.
              role="menuitemradio"
              aria-checked={option === state}
              /*
               * The marker is in the ACCESSIBLE NAME, not only in the dot: it
               * is the one piece of information this control adds beyond its
               * labels.
               */
              aria-label={
                marked(option)
                  ? `${STATE_LABELS[option]}, has values`
                  : STATE_LABELS[option]
              }
              title={STATE_HINTS[option]}
              onSelect={() => onSelect(option)}
            >
              <span className="nx-state-menu__tick" aria-hidden="true">
                {option === state ? <Check size={12} /> : null}
              </span>
              {STATE_LABELS[option]}
              {marked(option) ? <StateDot /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {/*
       * The states with values the canvas is not showing, in words beside the
       * trigger rather than as a dot on it, where a dot would read as the
       * shown state having values. The trigger's name already says which.
       * One state is named, so the words say where to look; several are
       * counted, since naming each would outgrow the bar's line.
       */}
      {elsewhere.length > 0 ? (
        <span className="nx-state-menu__elsewhere" aria-hidden="true">
          {elsewhereWords(elsewhere)}
        </span>
      ) : null}
    </>
  );
}

/** The words beside the trigger for the other states with values. */
function elsewhereWords(elsewhere: readonly StyleState[]): string {
  const [only] = elsewhere;
  return elsewhere.length === 1 && only !== undefined
    ? `· ${STATE_LABELS[only]} set`
    : `· ${elsewhere.length} more set`;
}

/**
 * The dot beside a state with values. Coloured `currentColor`, a CSS keyword
 * rather than a theme lookup, so it takes the colour of the words beside it in
 * either theme and in the selected item alike.
 */
function StateDot(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-nx-state-marked="true"
      className="nx-state-menu__dot"
    />
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
  /** The site's breakpoints, so a marker counts only tiers the sheet has. */
  breakpoints?: BreakpointSet | undefined;
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
  breakpoints,
}: StyleStateFieldProps): React.JSX.Element | null {
  if (onSelect === undefined) return null;
  return (
    <span className="nx-inspector__state">
      <StateSwitcher
        state={state}
        onSelect={onSelect}
        styles={node?.styles}
        breakpoints={breakpoints}
      />
    </span>
  );
}
