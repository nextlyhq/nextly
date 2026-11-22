/**
 * Turning a selection into a saved, reusable document — planned, not performed.
 *
 * Each planner is PURE. It reads a document and answers with two things: the
 * library row to create, and the ops the page needs. It writes nothing, mints
 * no request and knows no collection: the caller supplies the slug it stores
 * under and the metadata fields that collection declares.
 *
 * ## Why the plan is split from the doing
 *
 * Saving a selection is two writes in two collections, and the failure mode is
 * documented in the design (Elementor #36049): the library row is created, the
 * page edit fails, and an author is left with a pattern nothing points at.
 * Splitting the decision from the execution is what lets the caller wrap both
 * in one unit of work, roll the create back when the page ops fail, and offer
 * the same action as a dry run — the plan IS the dry run, so what a preview
 * shows and what a real save applies cannot differ.
 *
 * It is also what lets an editor, a plugin route and an agent share one answer.
 * A planner takes a document and returns data, so nothing here needs React, a
 * request or a database, and the editor's "Save as pattern" and the API's are
 * the same function rather than two implementations that agree until one moves.
 *
 * @module composition-planners
 */

export type {
  CompositionPlan,
  CreatePlanResult,
  InsertTarget,
  LibraryTarget,
  OrphanedAnchorWarning,
  PatternUpdateTarget,
  PlanProblem,
  PlanRefusal,
  PlanResult,
  PlanWarning,
  PlannedCreate,
  PlannedUpdate,
  StoredPattern,
} from "./composition-planners-contract";
export {
  planSaveAsPattern,
  planUpdatePatternFromSelection,
  saveAsPatternRefusal,
} from "./composition-planners-patterns";
export {
  planConvertToComponent,
  planDuplicateComponent,
  planSaveAsComponent,
} from "./composition-planners-components";
export type {
  ComponentExposure,
  RequestedProperty,
  RequestedSlot,
} from "./composition-planners-components";
export {
  patternRefusal,
  planInsertPattern,
} from "./composition-planners-insert";
// Pasting copied blocks: the same fresh-id copy the pattern insert makes,
// without the record of a saved section the copy did not come from.
export { planPasteBlocks } from "./composition-planners-paste";
export { internalNestingVerdict } from "./composition-planners-refusals";
export { detachedPage, planDetach } from "./composition-planners-detach";

export type { PlacementTarget } from "./nesting";
