"use client";

/**
 * Whether a `<label for>` actually reached a control that can carry a name.
 *
 * Every failure this module reports is silent by construction: the label
 * renders, the control renders, they sit next to each other on screen, and only
 * the ASSOCIATION between them is missing. Nothing throws, nothing looks wrong,
 * and the defect is invisible until someone drives the form with a screen
 * reader. Four such defects have shipped in this admin panel.
 *
 * `FieldShell` in `@nextlyhq/ui` carries an equivalent check for the same
 * reason. This is the admin-side counterpart, shared by every row component
 * that emits a `<label for>` of its own, so there is one implementation of the
 * question rather than one per row type.
 *
 * @module lib/forms/label-landing
 */

import { useEffect } from "react";

/**
 * Elements a `<label for>` is permitted to name.
 *
 * This is the HTML standard's set of "labelable elements" verbatim. It is not a
 * heuristic and not a list of what happens to work today: `for` on anything
 * outside this set forms no association at all, so assistive technology reads
 * the control as unnamed however sensible the markup looks.
 *
 * Compared against `tagName`, which the DOM reports uppercased for HTML
 * elements.
 */
const LABELABLE_TAGS: ReadonlySet<string> = new Set([
  "BUTTON",
  "INPUT",
  "METER",
  "OUTPUT",
  "PROGRESS",
  "SELECT",
  "TEXTAREA",
]);

/**
 * What became of the id a label points at.
 *
 * Three outcomes rather than two, because the two failures have different
 * causes and different fixes, and collapsing them would hand the developer a
 * message that fits one of them at best.
 */
export type LabelTargetVerdict =
  /** The id is on an element that can carry an accessible name. */
  | "labelable"
  /** No element in the document carries the id at all. */
  | "absent"
  /** An element carries the id, but a label cannot name that kind of element. */
  | "not-labelable";

/**
 * Classify what a label's `for` target turned out to be.
 *
 * Separated from the hook below and exported so the rule is testable without a
 * render: the property being asserted is about an ELEMENT, and a test that has
 * to mount a component to ask about one is testing two things at once.
 *
 * Presence alone is deliberately NOT the verdict. An id that landed somewhere
 * and an id that landed on a control are both "found" by a lookup, and it was
 * exactly that gap which let a `FormControl` clone its id onto a positioning
 * wrapper and read as correctly wired.
 */
export function classifyLabelTarget(
  target: Element | null
): LabelTargetVerdict {
  if (target === null) return "absent";
  if (!LABELABLE_TAGS.has(target.tagName)) return "not-labelable";
  // The one exclusion inside the labelable set: a hidden input has no
  // presentation to name and cannot be focused, so a label pointing at one
  // names nothing in practice.
  if (
    target.tagName === "INPUT" &&
    (target as HTMLInputElement).type === "hidden"
  ) {
    return "not-labelable";
  }
  return "labelable";
}

/**
 * Messages already emitted, keyed by the message itself.
 *
 * A row that re-renders on every keystroke would otherwise repeat its warning
 * per frame, and twenty identical lines make one defect harder to see rather
 * than easier.
 */
const emitted = new Set<string>();

/**
 * Forget which warnings have been emitted.
 *
 * For tests, so each case observes its own warning instead of inheriting the
 * suppression an earlier case caused.
 */
export function resetLabelLandingWarnings(): void {
  emitted.clear();
}

/**
 * The environments this check is allowed to speak in.
 *
 * `test` sits beside `development` because a suite asserting that the warning
 * fires is exercising the same contract a developer relies on; omitting it
 * would make every such test pass for the wrong reason.
 */
const SPEAKING_ENVIRONMENTS = new Set(["development", "test"]);

/**
 * Whether this runtime has positively identified itself as a development one.
 *
 * Deliberately not `!== "production"`. Asking whether the environment is
 * production answers "no" when `NODE_ENV` is absent entirely, which would ship
 * every warning below to real users' consoles. Silence in an environment that
 * cannot be identified is the cheaper of the two mistakes.
 */
function isDevelopmentRuntime(): boolean {
  const env = process.env.NODE_ENV;
  return env !== undefined && SPEAKING_ENVIRONMENTS.has(env);
}

/** What to tell the developer, chosen by which way the association failed. */
export interface LabelLandingRemedies {
  /** Shown when nothing on the page carries the id. */
  absent: string;
  /** Shown when the id landed on an element a label cannot name. */
  notLabelable: string;
}

export interface LabelLandingCheckOptions {
  /**
   * Whether this row claims to point a label at a single control.
   *
   * A row that has deliberately opted out — one exposing a GROUP of controls,
   * which names itself with `role="group"` and `aria-labelledby` instead —
   * passes `false` and is not checked, because it makes no claim to verify.
   */
  enabled?: boolean;
  /** The value the label's `htmlFor` was given. */
  targetId: string;
  /** The label's text, so the console message names the field on screen. */
  label: string;
  remedies: LabelLandingRemedies;
}

/**
 * Warn, in development, when a `<label for>` names nothing usable.
 *
 * **This observes the commit in which the row rendered, and errs toward
 * silence.** A control that mounts in a LATER commit — one gated on a fetch
 * that has not resolved — is not seen, and no warning is emitted. That
 * direction is deliberate: a warning that fires on correct markup gets
 * suppressed or deleted by the next person to read it, taking its true reports
 * with it, whereas a missed report costs only the defect it failed to name.
 */
export function useLabelLandingCheck({
  enabled = true,
  targetId,
  label,
  remedies,
}: LabelLandingCheckOptions): void {
  const { absent, notLabelable } = remedies;

  useEffect(() => {
    // Checked before the lookup rather than only before the `console.warn`, so
    // production pays for no DOM query at all.
    if (!enabled || !isDevelopmentRuntime()) return;
    if (typeof document === "undefined") return;

    const verdict = classifyLabelTarget(document.getElementById(targetId));
    if (verdict === "labelable") return;

    const detail =
      verdict === "absent"
        ? `no element carries that id, so the label names nothing. ${absent}`
        : `the element carrying that id is not one a label can name, so the ` +
          `label names nothing. ${notLabelable}`;

    const message = `[Nextly] The label "${label}" points at #${targetId}, but ${detail}`;
    if (emitted.has(message)) return;
    emitted.add(message);
    console.warn(message);
  }, [enabled, targetId, label, absent, notLabelable]);
}
