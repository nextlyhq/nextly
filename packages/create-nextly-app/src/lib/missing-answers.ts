import type { DatabaseType, ProjectApproach, ProjectType } from "../types";

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

const DATABASES = "sqlite, postgresql, mysql";
const SERVER_DATABASES = "postgresql, mysql";

/**
 * Every answer the run would ask a prompt for, as the flag that gives it.
 * Asked before anything is written, so a run with no terminal can stop with
 * the whole list rather than fail at the first prompt, one flag per attempt.
 * An answer only some choices need (the schema approach, the connection
 * string) is named while the choice it depends on is still open, with the
 * choices it applies to.
 */
export function missingAnswers(given: AnswersGiven): string[] {
  const missing: string[] = [];
  const { defaults } = given;

  if (given.existingProject) {
    if (!defaults) {
      missing.push("--yes (to add Nextly to the Next.js app in this folder)");
    }
  } else {
    if (!given.folderGiven && !defaults) {
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
  }

  const template =
    given.projectType ??
    (defaults || given.existingProject ? "blank" : undefined);
  if (!template) {
    missing.push(`--template <${getAvailableTemplateNames().join("|")}>`);
  }

  if (!given.approach && !defaults) {
    const withApproaches = getAvailableTemplateNames().filter(
      templateHasApproaches
    );
    if (template === undefined && withApproaches.length > 0) {
      missing.push(
        `--approach <code-first|visual> (for the ${withApproaches.join(", ")} template)`
      );
    } else if (template && withApproaches.includes(template)) {
      missing.push("--approach <code-first|visual>");
    }
  }

  if (template !== "plugin") {
    if (!given.database && !defaults) {
      missing.push(`--database <${DATABASES.replaceAll(", ", "|")}>`);
    }
    const database = given.database ?? (defaults ? "sqlite" : undefined);
    if (!given.databaseUrl && !defaults && database !== "sqlite") {
      missing.push(
        database
          ? "--database-url <url>, or --database-url - to read it from standard input"
          : `--database-url <url>, or --database-url - to read it from standard input (for ${SERVER_DATABASES})`
      );
    }
    if (given.skills === undefined && !defaults) {
      missing.push(
        "--no-skills to leave out the skills for coding agents, or --yes to add them"
      );
    }
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
