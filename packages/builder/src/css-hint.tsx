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
import { TooltipProvider } from "@nextlyhq/ui";
import * as React from "react";

import { ChromeTooltip } from "./chrome-tooltip";
import { useCssNames } from "./css-names-context";
import { isElement } from "./dom-kind";

/**
 * What each option of the field around it writes, as the engine compiles it,
 * for an option's own tooltip; `undefined` outside a field.
 */
export const OptionWrites: React.Context<
  ((option: string) => string) | undefined
> = React.createContext<((option: string) => string) | undefined>(undefined);

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
  children: React.ReactElement<TriggerHandlers>;
}): React.JSX.Element {
  if (writes === undefined && summary === undefined) return children;
  return (
    // Its own provider, so a control drawn outside the panel still has one; a
    // provider above keeps the shell's shared delay.
    <TooltipProvider delayDuration={300}>
      <ChromeTooltip
        content={<HintContent summary={summary} writes={writes} />}
        side="left"
        align="start"
      >
        {React.cloneElement(children, {
          ...ownElementsOnly(children.props),
          // Noted in the control's own document, which is an iframe's where
          // the editor is drawn in one.
          ref: withNavigationNoted(children.props.ref),
        })}
      </ChromeTooltip>
    </TooltipProvider>
  );
}

/** The handlers the trigger's own element passes on, composed below. */
interface TriggerHandlers {
  onFocus?: (event: React.FocusEvent<HTMLElement>) => void;
  onPointerMove?: (event: React.PointerEvent<HTMLElement>) => void;
  ref?: React.Ref<HTMLElement> | undefined;
}

/**
 * The control's own ref, with its document noted as it mounts: whether the
 * last key pressed there moved between controls is read in that document.
 */
/** @internal Exported for its tests. */
export function withNavigationNoted(
  own: React.Ref<HTMLElement> | undefined
): React.RefCallback<HTMLElement> {
  return node => {
    if (node !== null) noteNavigation(node.ownerDocument);
    if (typeof own === "function") own(node);
    else if (own !== null && own !== undefined) {
      own.current = node;
    }
  };
}

/** The keys that move focus from one control to the next. */
const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

/** The documents a key listener is on, so each gets one. */
const LISTENING: WeakSet<Document> = new WeakSet();

/** Whether the last key pressed in a document moved focus between controls. */
const NAVIGATED: WeakMap<Document, boolean> = new WeakMap();

/** Start noting, for a document, whether its last key press navigated. */
function noteNavigation(at: Document): void {
  if (LISTENING.has(at)) return;
  LISTENING.add(at);
  const note = (event: Event) =>
    NAVIGATED.set(at, NAVIGATION_KEYS.has((event as KeyboardEvent).key));
  at.addEventListener("keydown", note, true);
  // A press of the pointer is not navigation, whatever key came before it.
  const pressed = () => NAVIGATED.set(at, false);
  at.addEventListener("pointerdown", pressed, true);
  at.addEventListener("mousedown", pressed, true);
}

/**
 * Whether focus arrived by the author moving from control to control with the
 * keyboard. Focus handed back after a menu or picker closes, by pointer or by
 * Escape, opens no tooltip, so the Escape that follows still reaches the
 * editor.
 */
/** @internal Exported for its tests. */
export function keyboardFocus(target: EventTarget): boolean {
  if (!isElement(target)) return false;
  const at = target.ownerDocument;
  const navigated = NAVIGATED.get(at) === true;
  // Spent on the one focus it moved: a later focus is judged by a later key.
  NAVIGATED.set(at, false);
  return navigated;
}

/**
 * The trigger's focus and hover, answered only for what is inside its own
 * element on the page. A menu or picker it opens is portalled elsewhere in the
 * page but stays inside it in React's tree, where its events bubble through:
 * answered there, the field's tooltip opened over the picker and took the
 * Escape that should close it. Marked handled, the tooltip leaves them.
 */
function ownElementsOnly(props: TriggerHandlers): TriggerHandlers {
  const outside = (event: React.SyntheticEvent<HTMLElement>) =>
    !isElement(event.target) || !event.currentTarget.contains(event.target);
  return {
    onFocus: event => {
      props.onFocus?.(event);
      if (outside(event) || !keyboardFocus(event.target))
        event.preventDefault();
    },
    onPointerMove: event => {
      props.onPointerMove?.(event);
      if (outside(event)) event.preventDefault();
    },
  };
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
