import {
  AGENT_RULES,
  CODING_TOOLS,
  FEATURES,
  HOSTS,
  IMAGE_STORAGES,
  LANGUAGE_CODE,
  MAIN_LANGUAGE,
  PLAN_DATABASES,
  PLAN_PACKAGE_MANAGERS,
  PLAN_VERSION,
  STARTS,
  type Feature,
  type Host,
  type ImageStorage,
  type PlanAnswers,
  type PlanDatabase,
  type PlanEnvironment,
  type SetupPlan,
  type Start,
} from "./values";

/**
 * Whether an answer is asked, given the answers before it. A Plugin is asked
 * nothing about hosting, data, features or images; the languages only once
 * "More than one language" is ticked; the permission rules only once a
 * coding tool is. An answer that does not apply holds no value in the plan,
 * whatever was given for it. The questions read this to decide what to show.
 *
 * @experimental
 */
export function answerApplies(
  key: keyof PlanAnswers,
  answers: PlanAnswers
): boolean {
  const site = (answers.start ?? defaultStart()) !== "plugin";
  switch (key) {
    case "host":
    case "db":
    case "features":
    case "images":
      return site;
    case "languages":
      return (
        site &&
        (answers.features ?? defaultFeatures(answers)).includes("languages")
      );
    case "agentRules":
      return (answers.agents ?? []).length > 0;
    default:
      return true;
  }
}

function defaultStart(): Start {
  return "website";
}

function defaultHost(): Host {
  return "unsure";
}

/** Vercel keeps no data in a file, so it starts on PostgreSQL. */
function defaultDatabase(host: Host): PlanDatabase {
  return host === "vercel" ? "postgres" : "sqlite";
}

/**
 * The database these answers make: the one given, else the host's default;
 * always SQLite for a Plugin's development app. The plan and the reset of
 * the connection string both read it.
 */
export function databaseFor(answers: PlanAnswers): PlanDatabase {
  if ((answers.start ?? defaultStart()) === "plugin") return "sqlite";
  return answers.db ?? defaultDatabase(answers.host ?? defaultHost());
}

/** Vercel keeps no file written to the project folder. */
function defaultImages(host: Host): ImageStorage {
  return host === "vercel" ? "vercel-blob" : "local";
}

/** Website comes with Page Builder, SEO and Forms; Blank with none. */
function defaultFeatures(answers: PlanAnswers): readonly Feature[] {
  return (answers.start ?? defaultStart()) === "website"
    ? ["page-builder", "seo", "forms"]
    : [];
}

/**
 * The plan for these answers: each answer given kept, each one missing
 * filled from its default, which follows from the answers before it (where
 * it runs decides the database and images; the start decides the
 * features), as the questions pre-select them. So answering nothing, as
 * `--yes` does, makes the plan that pressing Enter at every question makes.
 *
 * Sets come back in their list's order and languages with English first,
 * so the same choices made in any order make an equal plan. A combination
 * that will break is kept as given: `planWarnings` names it, and nothing
 * here refuses it. An answer outside its list is refused, naming it.
 *
 * @experimental
 */
export function resolvePlan(
  answers: PlanAnswers,
  env: PlanEnvironment
): SetupPlan {
  checkAnswers(answers);
  const agents = inListOrder(
    answers.agents ?? env.detectedCodingTools,
    CODING_TOOLS
  );
  // The answers every start has, which come last in a plan.
  const tools = {
    agents,
    ...(answerApplies("agentRules", { agents })
      ? { agentRules: answers.agentRules ?? "yes" }
      : {}),
    packageManager: answers.packageManager ?? env.detectedPackageManager,
    git: answers.git ?? (env.gitAvailable && !env.insideGitRepository),
  };
  const start = answers.start ?? defaultStart();
  if (start === "plugin") {
    // The plugin's own development app, as every Plugin project has.
    return { version: PLAN_VERSION, start, db: "sqlite", ...tools };
  }
  const host = answers.host ?? defaultHost();
  const features = inListOrder(
    answers.features ?? defaultFeatures(answers),
    FEATURES
  );
  const languages = answerApplies("languages", { start, features })
    ? mainLanguageFirst(answers.languages ?? [])
    : [MAIN_LANGUAGE];
  return {
    version: PLAN_VERSION,
    start,
    host,
    db: databaseFor(answers),
    features,
    languages,
    images: answers.images ?? defaultImages(host),
    ...tools,
  };
}

/** The values chosen, once each, in the order their list gives. */
function inListOrder<T extends string>(
  chosen: readonly T[],
  list: readonly T[]
): T[] {
  return list.filter(value => chosen.includes(value));
}

/** English first, always, then the others once each in the order chosen. */
function mainLanguageFirst(chosen: readonly string[]): string[] {
  return [...new Set([MAIN_LANGUAGE, ...chosen])];
}

/**
 * Refuses an answer outside its list. The types already say so for code
 * that compiles against them; this holds for answers read from a file or
 * passed from plain JavaScript, and costs nothing when they are right.
 */
function checkAnswers(answers: PlanAnswers): void {
  checkOne("start", answers.start, STARTS);
  checkOne("host", answers.host, HOSTS);
  checkOne("db", answers.db, PLAN_DATABASES);
  checkEach("features", answers.features, FEATURES);
  checkOne("images", answers.images, IMAGE_STORAGES);
  checkEach("agents", answers.agents, CODING_TOOLS);
  checkOne("agentRules", answers.agentRules, AGENT_RULES);
  checkOne("packageManager", answers.packageManager, PLAN_PACKAGE_MANAGERS);
  if (answers.git !== undefined && typeof answers.git !== "boolean") {
    throw new TypeError(
      `git must be true or false, not ${JSON.stringify(answers.git)}.`
    );
  }
  for (const language of answers.languages ?? []) {
    if (!LANGUAGE_CODE.test(language)) {
      throw new TypeError(
        `languages: ${JSON.stringify(language)} is not a language code such as fr or pt-BR.`
      );
    }
  }
}

function checkOne(
  key: keyof PlanAnswers,
  value: unknown,
  list: readonly string[]
): void {
  if (value === undefined) return;
  if (typeof value === "string" && list.includes(value)) return;
  throw new TypeError(
    `${key}: ${JSON.stringify(value)} is not one of ${list.join(", ")}.`
  );
}

function checkEach(
  key: keyof PlanAnswers,
  values: readonly unknown[] | undefined,
  list: readonly string[]
): void {
  for (const value of values ?? []) checkOne(key, value, list);
}
