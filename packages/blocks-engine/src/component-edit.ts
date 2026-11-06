/**
 * The two steps every planner over a component's envelope shares: a copy of
 * the definition safe to edit, and the verdict its save would give the edit.
 *
 * Shared by the exposure and variant planners so the two cannot come to
 * disagree about what a readable definition is or about what refuses one.
 *
 * @module component-edit
 */
import {
  isComponentDocument,
  type BlockDocument,
  type ComponentDocument,
} from "./document";
import type { DocumentLimits } from "./limits";
import { surveyDocument } from "./measure-bytes";
import { isPlainRecord } from "./plain-record";
import {
  componentEnvelopeIssues,
  isErrorIssue,
  type ValidationIssue,
} from "./validation";

/**
 * A copy of the definition to edit; `"not-a-component"` when it cannot be
 * read as one; or the envelope errors when its `exposed`, `slots` or
 * `variants` has a shape a planner would throw on.
 *
 * Copied whole so no edit reaches the caller's document, a stored row or an
 * editor's state. A row that cannot be copied is not plain data, and nothing
 * stored by a save is anything else. The envelope's SHAPE is asked before any
 * planner walks it, so a stored or imported row holding something else is
 * refused rather than thrown from the first spread or iteration.
 */
export function editableComponent(
  definition: BlockDocument
):
  | ComponentDocument
  | "not-a-component"
  | { readonly issues: readonly ValidationIssue[] } {
  if (!isPlainRecord(definition) || !isComponentDocument(definition)) {
    return "not-a-component";
  }
  if (!Array.isArray(definition.nodes)) return "not-a-component";
  let draft: ComponentDocument;
  try {
    draft = structuredClone(definition);
  } catch {
    return "not-a-component";
  }
  // Read as unknown: the declared types describe a well-formed envelope, and
  // this is the check that establishes one.
  const {
    exposed,
    slots,
    variants,
  }: { exposed?: unknown; slots?: unknown; variants?: unknown } = draft;
  const shaped =
    (exposed === undefined || Array.isArray(exposed)) &&
    (slots === undefined || isPlainRecord(slots)) &&
    (variants === undefined || isPlainRecord(variants));
  if (shaped) return draft;
  return { issues: componentEnvelopeIssues(draft).filter(isErrorIssue) };
}

/**
 * What the definition's save would say of an edited definition: past the
 * host's caps, refused with the envelope errors, or accepted with the
 * warnings.
 *
 * Through the survey the save's own gate uses, then under the host's limits
 * as its save judges the definition.
 */
export function editVerdict(
  document: ComponentDocument,
  limits: DocumentLimits
):
  | { readonly verdict: "exceeds-limits" }
  | { readonly verdict: "refused"; readonly errors: ValidationIssue[] }
  | { readonly verdict: "accepted"; readonly warnings: ValidationIssue[] } {
  const survey = surveyDocument(document, limits);
  if (survey.tooLarge || survey.tooDeep || survey.tooManyNodes) {
    return { verdict: "exceeds-limits" };
  }
  const issues = componentEnvelopeIssues(document, limits);
  if (issues.some(isErrorIssue)) {
    return { verdict: "refused", errors: issues.filter(isErrorIssue) };
  }
  return { verdict: "accepted", warnings: issues };
}
