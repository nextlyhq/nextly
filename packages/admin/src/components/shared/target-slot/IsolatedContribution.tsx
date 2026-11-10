"use client";

/**
 * Wraps one contributed component, so what it does inside its own form stays
 * there.
 *
 * Places sit inside the document's own form on the edit pages: the editor
 * renders one `<form onSubmit>` around the whole document. React's `submit`
 * and `reset` events bubble through the component tree, so a plugin's own
 * form submitted inside a place would otherwise reach the document's handler
 * and save the document. Stopping them here keeps a plugin's submit its own.
 *
 * A control with no form of its own is another way in: a button inside a
 * contribution belongs to the document's form, and a plain `<button>` is a
 * submit button, so clicking it submits the document, and so does Enter in a
 * contributed input. That submit is the document form's own event, which
 * never passes through the contribution, so it is stopped where it starts:
 * the click or the key on a control whose form lies outside the contribution
 * has its default action prevented. A control of the contribution's own form
 * is left alone, and the page's own Save, outside every contribution, is
 * never judged.
 *
 * Only contributed components are wrapped, never a page's own parts, so a
 * page with nothing contributed has the DOM it had; `contents` (display:
 * contents) keeps the wrapper out of the layout where something is.
 *
 * @module components/shared/target-slot/IsolatedContribution
 */
import type {
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  SyntheticEvent,
} from "react";

const stop = (event: SyntheticEvent) => event.stopPropagation();

/** The form a control acts on, where that form lies outside `contribution`. */
function formOutside(
  control: HTMLButtonElement | HTMLInputElement,
  contribution: Element
): boolean {
  return control.form !== null && !contribution.contains(control.form);
}

/** Types of control whose click submits or resets the form it belongs to. */
const SUBMITTING_INPUTS = new Set(["submit", "image", "reset"]);

/**
 * A click inside the contribution on a control that would submit or reset a
 * form outside it: its default action is prevented.
 */
const guardClick = (event: MouseEvent<Element>) => {
  if (!(event.target instanceof Element)) return;
  const control = event.target.closest("button, input");
  if (control === null || !event.currentTarget.contains(control)) return;
  const acts =
    control instanceof HTMLButtonElement
      ? control.type === "submit" || control.type === "reset"
      : control instanceof HTMLInputElement &&
        SUBMITTING_INPUTS.has(control.type);
  if (
    acts &&
    formOutside(
      control as HTMLButtonElement | HTMLInputElement,
      event.currentTarget
    )
  ) {
    event.preventDefault();
  }
};

/**
 * Enter in an input inside the contribution whose form lies outside it, which
 * would submit that form: its default action is prevented. A textarea or an
 * editable region takes Enter as a new line, and is never an input.
 */
const guardEnter = (event: KeyboardEvent<Element>) => {
  if (event.key !== "Enter") return;
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (formOutside(input, event.currentTarget)) event.preventDefault();
};

/** The handlers an element framing one contribution carries. */
export interface ContainedContributionEvents {
  onSubmit: (event: SyntheticEvent) => void;
  onReset: (event: SyntheticEvent) => void;
  onClickCapture: (event: MouseEvent<Element>) => void;
  onKeyDownCapture: (event: KeyboardEvent<Element>) => void;
}

/**
 * The handlers that keep a contribution's `submit` and `reset` to itself and
 * keep its controls from submitting or resetting a form outside it, for an
 * element that already frames one (a side panel section) and so needs no
 * wrapper of its own.
 */
export const containedContributionEvents: ContainedContributionEvents = {
  onSubmit: stop,
  onReset: stop,
  onClickCapture: guardClick,
  onKeyDownCapture: guardEnter,
};

export function IsolatedContribution({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <div className="contents" {...containedContributionEvents}>
      {children}
    </div>
  );
}
