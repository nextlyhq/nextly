/**
 * The setup plan's answers and the values each may take, defined once. The
 * questions, the flags, presets, `--json`, `--dry-run` and the recreate
 * command all read these lists, and the published JSON Schema
 * (`setup-plan.schema.json`) is held to them by a test.
 *
 * @experimental The plan's shape may change until the guided installer is
 * finished; its format version says which shape a saved plan has.
 */

/** The plan's format version, carried by every plan and its JSON Schema. */
export const PLAN_VERSION = 1 as const;

/** How the project starts. */
export const STARTS = ["website", "blank", "plugin"] as const;
export type Start = (typeof STARTS)[number];

/** Where the site will run. */
export const HOSTS = ["unsure", "vercel", "server"] as const;
export type Host = (typeof HOSTS)[number];

/** The database the project uses. */
export const PLAN_DATABASES = ["sqlite", "postgres", "mysql"] as const;
export type PlanDatabase = (typeof PLAN_DATABASES)[number];

/** Features added at creation, each one a later `nextly plugins add`. */
export const FEATURES = ["page-builder", "seo", "forms", "languages"] as const;
export type Feature = (typeof FEATURES)[number];

/** Where uploaded images are kept. */
export const IMAGE_STORAGES = [
  "local",
  "vercel-blob",
  "s3",
  "uploadthing",
  "later",
] as const;
export type ImageStorage = (typeof IMAGE_STORAGES)[number];

/** The coding tools the installer can set up. */
export const CODING_TOOLS = ["claude-code", "cursor", "codex"] as const;
export type CodingTool = (typeof CODING_TOOLS)[number];

/** Whether the coding tools get their permission rules. */
export const AGENT_RULES = ["yes", "no"] as const;
export type AgentRules = (typeof AGENT_RULES)[number];

/** The package managers a project can be installed with. */
export const PLAN_PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
export type PackageManager = (typeof PLAN_PACKAGE_MANAGERS)[number];

/** The main language, always first in a plan's languages. */
export const MAIN_LANGUAGE = "en" as const;

/**
 * A language code: a two- or three-letter language, then optional subtags
 * (`pt-BR`, `zh-Hant`). Only the shape is checked here; which languages a
 * site supports is the site's own list.
 */
export const LANGUAGE_CODE: RegExp = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * Every answer a person, a flag or a preset can give, each optional: what
 * is left out takes its default from the answers before it. The project
 * name and the connection string are not answers here; they sit beside the
 * plan for the run (`SetupDraft`), so a preset or a recreate command can
 * never carry them.
 */
export interface PlanAnswers {
  start?: Start;
  host?: Host;
  db?: PlanDatabase;
  features?: readonly Feature[];
  languages?: readonly string[];
  images?: ImageStorage;
  agents?: readonly CodingTool[];
  agentRules?: AgentRules;
  packageManager?: PackageManager;
  git?: boolean;
}

/** The answers in the order the questions ask them. */
export const PLAN_ANSWER_ORDER: readonly (keyof PlanAnswers)[] = [
  "start",
  "host",
  "db",
  "features",
  "languages",
  "images",
  "agents",
  "agentRules",
  "packageManager",
  "git",
];

interface PlanCommon {
  version: typeof PLAN_VERSION;
  agents: CodingTool[];
  /** Present only when at least one coding tool is set up. */
  agentRules?: AgentRules;
  packageManager: PackageManager;
  git: boolean;
}

/** A Website or Blank project: every answer, each filled. */
export interface SitePlan extends PlanCommon {
  start: "website" | "blank";
  host: Host;
  db: PlanDatabase;
  /** In the order of `FEATURES`, whatever order they were chosen in. */
  features: Feature[];
  /** English first, then the others in the order chosen. */
  languages: string[];
  images: ImageStorage;
}

/**
 * A Plugin project. Its development app always uses SQLite, and it is asked
 * nothing about hosting, features, languages or images.
 */
export interface PluginPlan extends PlanCommon {
  start: "plugin";
  db: "sqlite";
}

/**
 * Every answer for a new project, with each default filled. Plain data, so
 * it serializes as it is.
 *
 * @experimental
 */
export type SetupPlan = SitePlan | PluginPlan;

/**
 * A run in progress: the answers so far, and the two values that sit beside
 * the plan and never inside it.
 *
 * @experimental
 */
export interface SetupDraft {
  projectName?: string;
  answers: PlanAnswers;
  /** A secret, held for the run only. */
  connectionString?: string;
}

/**
 * What the installer found on this machine, which some defaults follow.
 * Passed in rather than detected here, so the plan reads nothing and the
 * same answers on the same machine always make the same plan.
 */
export interface PlanEnvironment {
  /** The coding tools found on this computer, pre-ticked. */
  detectedCodingTools: readonly CodingTool[];
  /** The package manager the installer was run with. */
  detectedPackageManager: PackageManager;
  gitAvailable: boolean;
  /** The project's folder is already inside a git repository. */
  insideGitRepository: boolean;
}
