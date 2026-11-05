/**
 * The op vocabulary, re-exported from the engine.
 *
 * These moved to `@nextlyhq/blocks-engine` and are re-exported here unchanged.
 * Applying an edit is not an editing-surface concern: a plugin route, a script
 * or an agent has the same right to the operations the editor applies, and each
 * would otherwise grow its own vocabulary that agrees with this one only until
 * one of them changed.
 *
 * The re-export is not a transition step to be tidied away. Twenty-six modules
 * in this package import ops from here, and a builder file reaching into the
 * engine for something the builder is the primary user of would spread that
 * import path across all of them for no gain. One path in, one place to change
 * if the engine ever reorganises.
 *
 * The planners travel the same way, and for the same reason: each composition
 * action an editor takes is a planner from the engine, and a server or an
 * agent planning that action must reach the same function rather than a copy.
 * Beside them are the actions as data (`./composition-actions`): the schemas
 * the page builder's routes parse with, and the definition planner they run.
 *
 * @module ops
 */
export {
  applyOp,
  applyOps,
  OpError,
  positionOf,
  sameStoredValue,
  sameStyleValue,
  type AppliedOp,
  type AppliedOps,
  type BuilderOp,
  type NodePatch,
  type OpPosition,
  type SlotAddress,
} from "@nextlyhq/blocks-engine";

export {
  planAddVariant,
  planConvertToComponent,
  planDeleteVariant,
  planDetach,
  planDuplicateComponent,
  planExposeProperty,
  planInsertPattern,
  planRemoveExposedSlot,
  planRemoveExposure,
  planRenameExposure,
  planRenameVariant,
  planResetVariantValue,
  planRetargetExposure,
  planSaveAsComponent,
  planSaveAsPattern,
  planSetVariantValue,
  planUpdatePatternFromSelection,
  type CompositionPlan,
  type CreatePlanResult,
  type ExposeRequest,
  type ExposureEdit,
  type ExposureEditProblem,
  type ExposureEditRefusal,
  type ExposureEditResult,
  type ExposureSources,
  type ExposureTarget,
  type InsertTarget,
  type NewVariantSources,
  type PlanProblem,
  type PlanRefusal,
  type PlanResult,
  type PrunedVariant,
  type StoredPattern,
  type VariantEdit,
  type VariantEditProblem,
  type VariantEditRefusal,
  type VariantEditResult,
} from "@nextlyhq/blocks-engine";

export {
  DEFINITION_ACTION_KINDS,
  definitionActionJsonSchema,
  definitionActionSchema,
  PAGE_ACTION_KINDS,
  pageActionJsonSchema,
  pageActionSchema,
  planDefinitionAction,
  type ActionPosition,
  type DefinitionAction,
  type DefinitionActionSources,
  type ExposureTargetInput,
  type PageAction,
} from "./composition-actions";
