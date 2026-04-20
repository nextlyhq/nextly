#!/usr/bin/env node

import * as telemetry from "@nextly/telemetry";
import { Command } from "commander";

import { resolveProjectArg } from "./cli-args";
import { createNextly } from "./create-nextly";
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
  .argument(
    "[directory]",
    "Project name or '.' to install in the current directory",
    "."
  )
  .option(
    "-y, --yes",
    "Skip prompts and use defaults (blank template, SQLite, local storage)"
  )
  .option("-t, --template <template>", "Project template (blank, blog)")
  .option(
    "-a, --approach <approach>",
    "Schema approach (code-first, visual, both)"
  )
  .option("--demo-data", "Include demo content with sample posts and images")
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
  $ npx @revnixhq/create-nextly-app my-project
  $ npx @revnixhq/create-nextly-app my-project -y
  $ npx @revnixhq/create-nextly-app my-blog -t blog -a code-first --demo-data
  $ npx @revnixhq/create-nextly-app my-project --database postgresql
  $ npx @revnixhq/create-nextly-app .
  `
  )
  .action(
    async (
      directory: string,
      options: {
        yes?: boolean;
        template?: string;
        approach?: string;
        demoData?: boolean;
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

        const projectType = options.template as ProjectType | undefined;

        // Validate --template flag
        const validTypes = ["blank", "blog"];
        if (projectType && !validTypes.includes(projectType)) {
          console.error(
            `Error: Template '${projectType}' is not available. Use: ${validTypes.join(", ")}`
          );
          process.exit(1);
        }

        // Validate --approach flag
        const validApproaches = ["code-first", "visual", "both"];
        if (options.approach && !validApproaches.includes(options.approach)) {
          console.error(
            `Error: Approach '${options.approach}' is not valid. Use: ${validApproaches.join(", ")}`
          );
          process.exit(1);
        }

        telemetry.capture("scaffold_started", {
          flags: {
            yes: Boolean(options.yes),
            demoData: Boolean(options.demoData),
            skipInstall: Boolean(options.skipInstall),
            useYalc: Boolean(options.useYalc),
          },
        });

        await createNextly({
          cwd,
          defaults: options.yes,
          projectType,
          approach: options.approach as ProjectApproach | undefined,
          demoData: options.demoData,
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
