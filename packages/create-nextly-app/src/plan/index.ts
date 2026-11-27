/**
 * The setup plan: one description of a new project that every way into the
 * installer fills and reads. The questions, the flags, presets, `--yes`,
 * `--dry-run`, `--json` and the recreate command all go through it, so they
 * cannot disagree about a default. Its JSON Schema is published with the
 * package as `create-nextly-app/setup-plan.schema.json`.
 *
 * The rest of the plan's types live in `./values` and `./warnings`, and are
 * re-exported here as a front end comes to need them.
 *
 * @experimental
 */
export { changeAnswer } from "./change";
export { answerApplies, resolvePlan } from "./resolve";
export {
  AGENT_RULES,
  CODING_TOOLS,
  FEATURES,
  HOSTS,
  IMAGE_STORAGES,
  LANGUAGE_CODE,
  PLAN_ANSWER_ORDER,
  PLAN_DATABASES,
  PLAN_PACKAGE_MANAGERS,
  PLAN_VERSION,
  STARTS,
  type PackageManager,
  type PlanAnswers,
  type PlanEnvironment,
  type SetupDraft,
  type SetupPlan,
} from "./values";
export { formatPlanWarning, planWarnings } from "./warnings";
