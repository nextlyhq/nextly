/**
 * The setup plan: one description of a new project that every way into the
 * installer fills and reads. The questions, the flags, presets, `--yes`,
 * `--dry-run`, `--json` and the recreate command all go through it, so they
 * cannot disagree about a default. Its JSON Schema is published with the
 * package as `create-nextly-app/setup-plan.schema.json`.
 *
 * @experimental
 */
export { changeAnswer } from "./change";
export { answerApplies, databaseFor, resolvePlan } from "./resolve";
export {
  AGENT_RULES,
  CODING_TOOLS,
  FEATURES,
  HOSTS,
  IMAGE_STORAGES,
  LANGUAGE_CODE,
  MAIN_LANGUAGE,
  PLAN_ANSWER_ORDER,
  PLAN_DATABASES,
  PLAN_PACKAGE_MANAGERS,
  PLAN_VERSION,
  STARTS,
  type AgentRules,
  type CodingTool,
  type Feature,
  type Host,
  type ImageStorage,
  type PackageManager,
  type PlanAnswers,
  type PlanDatabase,
  type PlanEnvironment,
  type PluginPlan,
  type SetupDraft,
  type SetupPlan,
  type SitePlan,
  type Start,
} from "./values";
export {
  formatPlanWarning,
  planWarnings,
  type PlanFindings,
  type PlanWarning,
  type PlanWarningCode,
} from "./warnings";
