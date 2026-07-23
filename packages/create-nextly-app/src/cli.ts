#!/usr/bin/env node

import * as telemetry from "@nextlyhq/telemetry";
import { Command } from "commander";

import { resolveProjectArg, validateProjectName } from "./cli-args";
import { createNextly } from "./create-nextly";
import { getAvailableTemplateNames } from "./lib/templates";
import type { DatabaseType, ProjectApproach, ProjectType } from "./types";

// Static require for package.json. Works because tsup adds the createRequire
// banner (see tsup.config.ts) so `require` exists in our ESM output.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("../package.json") as { version: string };

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
  .option("-t, --template <template>", "Project template (blank, blog, plugin)")
  .option("-a, --approach <approach>", "Schema approach (code-first, visual)")
  .option("-d, --database <db>", "Database type (sqlite, postgresql, mysql)")
  .option("-b, --branch <branch>", "Git branch for template download", "main")
  .option(
    "--local-template <path>",
    "Path to local templates directory (development only)"
  )
  .option("--skip-install", "Skip dependency installation (for local testing)")
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
      }
    ) => {
      // Initialize telemetry. Cheap, no network. Prints one-time banner if needed.
      await telemetry.init({
        cliName: "create-nextly-app",
        cliVersion: pkg.version,
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

        // Validate --template flag against the template registry so newly
        // registered templates are accepted without touching this file.
        const validTypes = getAvailableTemplateNames();
        if (projectType && !validTypes.includes(projectType)) {
          console.error(
            `Error: Template '${projectType}' is not available. Use: ${validTypes.join(", ")}`
          );
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
