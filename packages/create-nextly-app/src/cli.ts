#!/usr/bin/env node

import * as telemetry from "@nextlyhq/telemetry";
import { Command } from "commander";

import {
  resolveProjectArg,
  validateProjectName,
  validateTemplateName,
} from "./cli-args";
import { createNextly } from "./create-nextly";
import { packageVersion } from "./lib/package-version";
import { getAvailableTemplateNames } from "./lib/templates";
import type { DatabaseType, ProjectApproach, ProjectType } from "./types";

const program = new Command();

program
  .name("create-nextly-app")
  .description(
    "Scaffold a new Nextly CMS project or add Nextly to an existing Next.js app"
  )
  .version("0.1.0")
  // No default value here on purpose: when the user omits the argument we
  // want `directory` to arrive as `undefined` so the interactive prompt
  // can ask for a folder name. The earlier default of "." caused no-arg
  // invocations to be silently treated as "install in cwd" and then abort
  // when the cwd was non-empty.
  .argument(
    "[directory]",
    "Project name or '.' to install in the current directory (omit to be prompted)"
  )
  .option(
    "-y, --yes",
    "Skip prompts and use defaults (blank template, SQLite, local storage)"
  )
  .option(
    "-t, --template <template>",
    // From the registry, so --help names every template the flag accepts.
    `Project template (${getAvailableTemplateNames().join(", ")})`
  )
  .option("-a, --approach <approach>", "Schema approach (code-first, visual)")
  .option("-d, --database <db>", "Database type (sqlite, postgresql, mysql)")
  // No default: with none given, a downloaded template comes from this CLI's
  // own release, which an explicit `--branch main` does not.
  .option(
    "-b, --branch <branch>",
    "Git branch to take the template from (default: this release)"
  )
  .option(
    "--local-template <path>",
    "Path to local templates directory (development only)"
  )
  .option("--skip-install", "Skip dependency installation (for local testing)")
  .option(
    "--no-skills",
    "Do not add the Nextly skills for coding agents to the project"
  )
  .option(
    "--use-yalc",
    "Use yalc for local package installation (development only)"
  )
  .addHelpText(
    "after",
    `
Examples:
  $ npx create-nextly-app@alpha             (prompts for folder name)
  $ npx create-nextly-app@alpha my-project
  $ npx create-nextly-app@alpha my-project -y
  $ npx create-nextly-app@alpha my-blog -t blog -a code-first
  $ npx create-nextly-app@alpha my-project --database postgresql
  $ npx create-nextly-app@alpha .           (install in the current directory)
`
  )
  .action(
    async (
      // commander now passes `undefined` when the positional is omitted
      // (we dropped the "." default above). Reflect that in the type.
      directory: string | undefined,
      options: {
        yes?: boolean;
        template?: string;
        approach?: string;
        database?: string;
        branch?: string;
        localTemplate?: string;
        skipInstall?: boolean;
        useYalc?: boolean;
        // Commander sets it from --no-skills: true unless that is passed.
        skills?: boolean;
      }
    ) => {
      // Initialize telemetry. Cheap, no network. Prints one-time banner if needed.
      await telemetry.init({
        cliName: "create-nextly-app",
        cliVersion: packageVersion(),
      });

      try {
        const cwd = process.cwd();
        const { projectName, installInCwd } = resolveProjectArg(directory);

        // Reject malformed positional arguments up-front so the user sees the
        // error before the interactive flow starts. The interactive prompt
        // applies the same validator, so the two entry points stay in sync.
        if (projectName) {
          const nameError = validateProjectName(projectName);
          if (nameError) {
            console.error(
              `Error: Invalid project name '${projectName}'. ${nameError}.`
            );
            process.exit(1);
          }
        }

        const projectType = options.template as ProjectType | undefined;

        // Validate --template flag against the template registry, which is
        // also what the interactive prompt offers.
        const templateError = projectType
          ? validateTemplateName(projectType)
          : undefined;
        if (templateError) {
          console.error(`Error: ${templateError}`);
          process.exit(1);
        }

        // Validate --approach flag
        const validApproaches = ["code-first", "visual"];
        if (options.approach && !validApproaches.includes(options.approach)) {
          console.error(
            `Error: Approach '${options.approach}' is not valid. Use: ${validApproaches.join(", ")}`
          );
          process.exit(1);
        }

        telemetry.capture("scaffold_started", {
          flags: {
            yes: Boolean(options.yes),
            skipInstall: Boolean(options.skipInstall),
            useYalc: Boolean(options.useYalc),
          },
        });

        await createNextly({
          cwd,
          defaults: options.yes,
          projectType,
          approach: options.approach as ProjectApproach | undefined,
          database: options.database as DatabaseType | undefined,
          branch: options.branch,
          localTemplatePath: options.localTemplate,
          skipInstall: options.skipInstall,
          useYalc: options.useYalc,
          skills: options.skills,
          projectNameFromArg: projectName,
          installInCwd,
        });
      } finally {
        // Always flush. shutdown() has its own 2s timeout so this never hangs.
        await telemetry.shutdown();
      }
    }
  );

program.parse();
