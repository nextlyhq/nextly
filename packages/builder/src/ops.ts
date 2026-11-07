/**
 * The published `ops` entry: everything a server, a script or an agent needs
 * to make the edits the editor makes, without the editor.
 *
 * - The op vocabulary (`./op-vocabulary`), the same functions the canvas
 *   applies.
 * - The planners, re-exported from the engine for the same reason: each
 *   composition action an editor takes is a planner, and a server or an agent
 *   planning that action must reach the same function rather than a copy.
 * - The actions as data (`./composition-actions`): the schemas the page
 *   builder's routes parse with, and the definition planner they run.
 * - The collection template actions (`./template-actions`), the schema the
 *   template route parses with.
 *
 * The editor's own modules import `./op-vocabulary`, never this entry, so the
 * schemas load only where they are used.
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
} from "./op-vocabulary";

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
  type ConditionInput,
  type DefinitionAction,
  type DefinitionActionSources,
  type ExposureTargetInput,
  type ListQueryChange,
  type PageAction,
  type UnbindKeep,
} from "./composition-actions";

export { bindOp, unbindOp, type KeptProps } from "./binding-ops";
export { conditionsOp } from "./condition-ops";

export {
  TEMPLATE_ACTION_KINDS,
  templateActionJsonSchema,
  templateActionSchema,
  type TemplateAction,
} from "./template-actions";
