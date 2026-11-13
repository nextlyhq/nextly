import type { DatabaseType, ProjectApproach, ProjectType } from "../types";

import { APPROACHES, DATABASES, SERVER_DATABASES } from "./choices";
import { getAvailableTemplateNames, templateHasApproaches } from "./templates";

/** What a run without a terminal was told, and what it found on disk. */
export interface AnswersGiven {
  /** `--yes`: every answer not given takes its default. */
  defaults: boolean;
  /** The current directory is a Next.js app Nextly would be added to. */
  existingProject: boolean;
  /** A folder name, or `.`, was given as the first argument. */
  folderGiven: boolean;
  /** The folder the scaffold would write into already holds files. */
  targetNotEmpty: boolean;
  /** How the target folder is named in a message. */
  targetLabel: string;
  projectType?: ProjectType;
  approach?: ProjectApproach;
  database?: DatabaseType;
  databaseUrl?: string;
  /** false for `--no-skills`; otherwise the skills prompt would ask. */
  skills?: boolean;
}

/**
 * Every answer the run would ask a prompt for, as the flag that gives it.
 * Asked before anything is written, so a run with no terminal can stop with
 * the whole list rather than fail at the first prompt, one flag per attempt.
 * An answer only some choices need (the schema approach, the connection
 * string) is named while the choice it depends on is still open, with the
 * choices it applies to.
 */
export function missingAnswers(given: AnswersGiven): string[] {
  const template =
    given.projectType ??
    (given.defaults || given.existingProject ? "blank" : undefined);
  return [
    ...targetAnswers(given),
    ...(template
      ? []
      : [`--template <${getAvailableTemplateNames().join("|")}>`]),
    ...approachAnswers(given, template),
    ...(template === "plugin" ? [] : appAnswers(given)),
  ];
}

/** Where the project goes: the folder, or consent to an existing app. */
function targetAnswers(given: AnswersGiven): string[] {
  if (given.existingProject) {
    return given.defaults
      ? []
      : ["--yes (to add Nextly to the Next.js app in this folder)"];
  }
  const missing: string[] = [];
  if (!given.folderGiven && !given.defaults) {
    missing.push(
      "a project folder as the first argument (create-nextly-app my-app, or . for this folder)"
    );
  }
  // No flag answers this one: emptying or overlaying a folder is never a default.
  if (given.targetNotEmpty) {
    missing.push(
      `a new or empty folder: ${given.targetLabel} already holds files`
    );
  }
  return missing;
}

/** The schema approach, for a template that has approaches or may. */
function approachAnswers(
  given: AnswersGiven,
  template: ProjectType | undefined
): string[] {
  if (given.approach || given.defaults) return [];
  const flag = `--approach <${APPROACHES.join("|")}>`;
  const withApproaches = getAvailableTemplateNames().filter(
    templateHasApproaches
  );
  if (template === undefined) {
    return withApproaches.length > 0
      ? [`${flag} (for the ${withApproaches.join(", ")} template)`]
      : [];
  }
  return withApproaches.includes(template) ? [flag] : [];
}

/** An app's database, its connection string, and the skills for agents. */
function appAnswers(given: AnswersGiven): string[] {
  if (given.defaults) return [];
  const missing: string[] = [];
  if (!given.database) missing.push(`--database <${DATABASES.join("|")}>`);
  if (!given.databaseUrl && given.database !== "sqlite") {
    const stdin =
      "--database-url <url>, or --database-url - to read it from standard input";
    missing.push(
      given.database ? stdin : `${stdin} (for ${SERVER_DATABASES.join(", ")})`
    );
  }
  if (given.skills === undefined) {
    missing.push(
      "--no-skills to leave out the skills for coding agents, or --yes to add them"
    );
  }
  return missing;
}

/** The refusal printed when `missing` is not empty. */
export function missingAnswersMessage(missing: string[]): string {
  return [
    "There is no terminal to ask on, and these answers were not given:",
    ...missing.map(item => `  ${item}`),
    "Pass them, or --yes to take the defaults. Nothing was written.",
  ].join("\n");
}
