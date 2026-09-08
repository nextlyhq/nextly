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
 */
export function compositionRefusalReason(refusal: PlanRefusal): string {
  const sentence = REFUSAL_COPY[refusal.problem];
  const permitted = refusal.permitted ?? [];
  if (permitted.length === 0) return sentence;
  return `${sentence} It belongs inside ${listOf(permitted)}.`;
}

/**
 * "a Row", or "a Row or a Column", or "a Row, a Column or a Grid".
 *
 * Spelled as a sentence rather than joined with commas, because this lands
 * mid-sentence in a tooltip an author reads rather than in a log.
 */
function listOf(names: readonly string[]): string {
  const [first, ...rest] = names;
  if (first === undefined) return "another block";
  const last = rest.at(-1);
  if (last === undefined) return first;
  return `${[first, ...rest.slice(0, -1)].join(", ")} or ${last}`;
}
