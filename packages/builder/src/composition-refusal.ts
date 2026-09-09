/**
 * Why a composition verb refused, in words an author can act on.
 *
 * The planners answer with a CAUSE — `"gap"`, `"restricted-at-root"`,
 * `"exceeds-limits"` — and never with a sentence, deliberately: `PlanResult`'s
 * own docblock says the cause travels unchanged "so the sentence shown to an
 * author is composed once per surface rather than once per planner". This is
 * that one composition. The toolbar, the context menu, the palette and the save
 * dialog all reach it, so a refusal reads the same wherever an author meets it.
 *
 * ## Remedies, not rules
 *
 * Every sentence says what to do, following the refusals already in
 * `selection-ops.ts`: "These blocks sit in different containers. Move blocks
 * that share one." describes the document AND the fix. A sentence that only
 * names the rule leaves an author correct and stuck.
 *
 * ## Total over the causes, not over the ones reachable today
 *
 * A `Record<PlanProblem, …>` rather than a lookup with a fallback. A fallback is
 * a sentence nobody wrote for a cause nobody classified, and it appears in front
 * of an author the first time a planner learns a new way to say no. The compiler
 * naming the omission is the whole point.
 *
 * That means causes no PATTERN save can reach are phrased here too, and they are
 * not dead copy: they are the causes `planSaveAsComponent` and
 * `planConvertToComponent` produce, which arrive at these same surfaces. One map
 * for the family is what the engine's docblock asks for.
 *
 * @module composition-refusal
 */

import type { PlanProblem, PlanRefusal } from "@nextlyhq/blocks-engine";

import { asPermittedList, permittedLabel } from "./permitted-prose";

/**
 * The sentence for each cause, with no subject and no block name.
 *
 * Written to sit in a toolbar tooltip, a disabled menu row and a dialog alike,
 * so none of them names the selection: the surface is already drawn against it.
 */
const REFUSAL_COPY: Record<PlanProblem, string> = {
  // From the selection itself.
  empty: "Select a block first.",
  unknown: "That selection is no longer on the page. Select a block again.",
  split:
    "These blocks sit in different containers. Select blocks that share one.",
  gap: "These blocks have others between them. Select a run with no gaps.",

  // From the nesting rule.
  "wrong-parent": "This block cannot sit in that container.",
  "restricted-at-root":
    "This block only works inside another one. Include the container it sits in.",
  "not-allowed-in-slot": "That container does not accept this block.",

  // From the shape of what would be stored.
  "invalid-node": "Part of this selection cannot be copied. Try a smaller one.",
  "duplicate-dom-id":
    "Two of these blocks share one HTML id. Give one of them a different id.",
  "dom-id-collision":
    "An HTML id here keeps colliding. Change it and try again.",
  "unusable-document":
    "This page cannot be read well enough to copy from. Reload and try again.",
  "exceeds-limits": "This selection is too large to save. Try a smaller one.",

  // From the destination, for the verbs that write back to the page.
  "not-a-pattern": "That library entry is not a pattern.",
  "duplicate-destination":
    "Two blocks on this page share one id. Reload and try again.",
  "destination-locked":
    "A locked block is in the way. Unlock it and try again.",
  "invalid-position": "That is not somewhere a block can go.",
  "invalid-source":
    "That library entry is missing the details needed to place it.",

  // From a component's exposure, for the verbs that create one.
  "invalid-exposure":
    "One of the properties chosen cannot be exposed. Remove it and try again.",
  "ambiguous-exposure":
    "Two blocks here answer to one name. Rename one and try again.",
  "self-reference":
    "This selection already uses the component being created. Remove that instance first.",
  "not-a-component": "That library entry is not a component.",
  "condition-gated":
    "This selection is shown conditionally and holds conditions of its own. Simplify one of them first.",
};

/**
 * What to tell an author about a refusal.
 *
 * The `permitted` set is spelled out where the planner supplies one, because
 * "this block only works inside another one" sends an author looking while
 * naming the containers tells them where. The refusal carries the set rather
 * than leaving it to be looked up again — `NestingVerdict` says why — so this
 * never asks the rule source a second question.
 *
 * **What the set MEANS depends on the cause**, which is the reading
 * `refusalWording` already takes of the same list. For `not-allowed-in-slot`
 * the planner answers with what the SLOT ACCEPTS — the children it will hold —
 * and for the other two with the CONTAINERS the refused block may sit in.
 * Read as containers either way, a narrowed slot produces "It belongs inside
 * Heading or Text" about blocks that are neither containers nor where anything
 * belongs.
 *
 * The joiner follows from that: containers are alternatives an author picks
 * between, and a slot's list is an enumeration of what it holds.
 *
 * Through the SAME prose the drag refusal uses. The set holds registry
 * specifiers, and a namespace wildcard is not a block name: read naively,
 * `core/*` announces that a block "belongs inside *".
 */
export function compositionRefusalReason(refusal: PlanRefusal): string {
  const sentence = REFUSAL_COPY[refusal.problem];
  const permitted = (refusal.permitted ?? []).map(permittedLabel);
  if (permitted.length === 0) return sentence;
  return refusal.problem === "not-allowed-in-slot"
    ? `${sentence} It takes ${asPermittedList(permitted, "and")}.`
    : `${sentence} It belongs inside ${asPermittedList(permitted, "or")}.`;
}

/**
 * Whether a string is a cause this vocabulary knows.
 *
 * Derived from the copy map, which is total over {@link PlanProblem}, so this
 * recognises exactly the causes a sentence exists for and cannot drift from
 * them. It exists because a cause can arrive from OUTSIDE the process: a save
 * refused by the server carries its `PlanProblem` on the wire, and the surface
 * that has to phrase it is holding a string rather than a typed union.
 */
export function isPlanProblem(value: unknown): value is PlanProblem {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(REFUSAL_COPY, value)
  );
}
